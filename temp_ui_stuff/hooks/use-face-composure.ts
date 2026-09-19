"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Real, in-browser composure estimation from the webcam via MediaPipe
 * FaceLandmarker (ARKit-style blendshapes + head-pose matrix). This is the
 * concrete implementation behind the Presage "vitals" seam: it runs fully
 * client-side, no backend, and produces a rolling 0-1 composure score plus
 * the expression/engagement signals the ComposureSample expects.
 *
 * Everything is smoothed with EMAs so the score reflects sustained state
 * rather than single-frame noise.
 */

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"

/**
 * The MediaPipe WASM runtime flushes benign TFLite/GL status lines through
 * console.error / console.warn (e.g. "INFO: Created TensorFlow Lite XNNPACK
 * delegate", "OpenGL error checking is disabled"). Next.js's dev overlay then
 * surfaces them as a red "Console Error". They are not errors, so we filter
 * exactly these known lines once, globally, on the client.
 */
let logFilterInstalled = false
function installMediaPipeLogFilter() {
  if (logFilterInstalled || typeof window === "undefined") return
  logFilterInstalled = true
  const NOISE = [
    "Created TensorFlow Lite XNNPACK delegate",
    "OpenGL error checking is disabled",
    "gl_context.cc",
    "feedback_tensors",
  ]
  const isNoise = (args: unknown[]) =>
    typeof args[0] === "string" && NOISE.some((n) => (args[0] as string).includes(n))
  const origError = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => {
    if (isNoise(args)) return
    origError(...args)
  }
  console.warn = (...args: unknown[]) => {
    if (isNoise(args)) return
    origWarn(...args)
  }
}

export interface FaceMetrics {
  /** Unified 0-1 composure score. */
  composure: number
  /** 0-1 neutrality of expression. */
  neutral: number
  /** 0-1 estimated stress. */
  stress: number
  /** 0-1 engagement (gaze on camera + head steady). */
  engagement: number
  /** Whether a face is currently detected. */
  faceVisible: boolean
  /** Raw diagnostic signals (unsmoothed unless noted) for the debug panel. */
  raw: {
    /** 0-1 look-away magnitude from eye gaze blendshapes. */
    lookAway: number
    /** 0-1 head instability from smoothed yaw/pitch deltas. */
    instability: number
    /** Estimated blinks per minute over a rolling 10s window. */
    blinksPerMin: number
    /** 0-1 stress contribution from facial expression only. */
    exprStress: number
    /** 0-1 stress contribution from blink rate only. */
    blinkStress: number
  }
}

/** Pull a named blendshape score (0-1) from a categories list. */
function bs(map: Map<string, number>, name: string): number {
  return map.get(name) ?? 0
}

/** Exponential moving average. */
function ema(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev)
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export function useFaceComposure(videoRef: React.RefObject<HTMLVideoElement | null>, active: boolean) {
  const [ready, setReady] = useState(false)
  const landmarkerRef = useRef<import("@mediapipe/tasks-vision").FaceLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const lastVideoTimeRef = useRef(-1)

  // Smoothed metric state.
  const metricsRef = useRef<FaceMetrics>({
    composure: 0.7,
    neutral: 0.7,
    stress: 0.2,
    engagement: 0.7,
    faceVisible: false,
    raw: { lookAway: 0, instability: 0, blinksPerMin: 0, exprStress: 0, blinkStress: 0 },
  })

  // Head-pose tracking for stability (yaw/pitch from the transform matrix).
  const lastYawRef = useRef(0)
  const lastPitchRef = useRef(0)
  const motionRef = useRef(0) // smoothed head motion magnitude
  // Blink-rate tracking.
  const blinkStateRef = useRef(false)
  const blinkTimesRef = useRef<number[]>([])

  const getMetrics = useCallback((): FaceMetrics | null => {
    if (!ready) return null
    return metricsRef.current
  }, [ready])

  // Load the model once.
  useEffect(() => {
    installMediaPipeLogFilter()
    let cancelled = false
    ;(async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision")
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL)
        const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        })
        if (cancelled) {
          landmarker.close()
          return
        }
        landmarkerRef.current = landmarker
        setReady(true)
        console.log("[v0] FaceLandmarker ready")
      } catch (err) {
        console.log("[v0] FaceLandmarker failed to load:", String(err))
      }
    })()
    return () => {
      cancelled = true
      landmarkerRef.current?.close()
      landmarkerRef.current = null
    }
  }, [])

  // Run the detection loop while active.
  useEffect(() => {
    if (!active || !ready) return
    const video = videoRef.current
    const landmarker = landmarkerRef.current
    if (!video || !landmarker) return

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop)
      if (video.readyState < 2 || video.videoWidth === 0) return
      const now = performance.now()
      if (video.currentTime === lastVideoTimeRef.current) return
      lastVideoTimeRef.current = video.currentTime

      let result
      try {
        result = landmarker.detectForVideo(video, now)
      } catch {
        return
      }

      const cats = result.faceBlendshapes?.[0]?.categories
      if (!cats || cats.length === 0) {
        metricsRef.current = { ...metricsRef.current, faceVisible: false }
        return
      }

      const map = new Map<string, number>()
      for (const c of cats) map.set(c.categoryName, c.score)

      // --- Stress: worried brows, frowning, lip pressing, tension, jaw drop.
      const brows = (bs(map, "browInnerUp") + bs(map, "browDownLeft") + bs(map, "browDownRight")) / 2
      const frown = (bs(map, "mouthFrownLeft") + bs(map, "mouthFrownRight")) / 2
      const press = (bs(map, "mouthPressLeft") + bs(map, "mouthPressRight")) / 2
      const squint = (bs(map, "eyeSquintLeft") + bs(map, "eyeSquintRight")) / 2
      const jaw = bs(map, "jawOpen") * 0.5
      const rawStress = clamp01(brows * 0.4 + frown * 0.25 + press * 0.2 + squint * 0.1 + jaw * 0.05)

      // --- Gaze / engagement: eyes pointed at camera = low look-away magnitude.
      const lookAway =
        (bs(map, "eyeLookOutLeft") +
          bs(map, "eyeLookOutRight") +
          bs(map, "eyeLookInLeft") +
          bs(map, "eyeLookInRight") +
          bs(map, "eyeLookUpLeft") +
          bs(map, "eyeLookUpRight") +
          bs(map, "eyeLookDownLeft") +
          bs(map, "eyeLookDownRight")) /
        8

      // --- Head stability from the transform matrix (yaw/pitch deltas).
      const matrix = result.facialTransformationMatrixes?.[0]?.data
      if (matrix && matrix.length === 16) {
        // Column-major 4x4. Rotation basis in r0..r10.
        const r20 = matrix[2]
        const r21 = matrix[6]
        const r22 = matrix[10]
        const yaw = Math.atan2(matrix[8], matrix[10])
        const pitch = Math.atan2(-r20, Math.sqrt(r21 * r21 + r22 * r22))
        const dYaw = Math.abs(yaw - lastYawRef.current)
        const dPitch = Math.abs(pitch - lastPitchRef.current)
        lastYawRef.current = yaw
        lastPitchRef.current = pitch
        motionRef.current = ema(motionRef.current, dYaw + dPitch, 0.3)
      }
      // Normalize motion: ~0.15 rad/frame of combined delta reads as very fidgety.
      const instability = clamp01(motionRef.current / 0.15)

      // --- Blink rate: count blink onsets over a rolling 10s window.
      const blink = (bs(map, "eyeBlinkLeft") + bs(map, "eyeBlinkRight")) / 2
      const isBlinking = blink > 0.5
      if (isBlinking && !blinkStateRef.current) {
        blinkTimesRef.current.push(now)
      }
      blinkStateRef.current = isBlinking
      const cutoff = now - 10_000
      blinkTimesRef.current = blinkTimesRef.current.filter((t) => t >= cutoff)
      const blinksPerMin = (blinkTimesRef.current.length / 10) * 60
      // Calm ~15/min; >35/min reads as elevated arousal.
      const blinkStress = clamp01((blinksPerMin - 20) / 25)

      const engagement = clamp01(1 - lookAway * 1.4 - instability * 0.5)
      const stress = clamp01(rawStress * 0.7 + blinkStress * 0.3)
      const neutral = clamp01(1 - stress)

      // Composure: mostly the inverse of stress, lifted by engagement, docked
      // for a fidgety head.
      const composure = clamp01(0.55 * (1 - stress) + 0.3 * engagement + 0.15 * (1 - instability))

      const prev = metricsRef.current
      metricsRef.current = {
        composure: ema(prev.composure, composure, 0.15),
        neutral: ema(prev.neutral, neutral, 0.15),
        stress: ema(prev.stress, stress, 0.15),
        engagement: ema(prev.engagement, engagement, 0.15),
        faceVisible: true,
        raw: {
          lookAway: Number(lookAway.toFixed(3)),
          instability: Number(instability.toFixed(3)),
          blinksPerMin: Number(blinksPerMin.toFixed(1)),
          exprStress: Number(rawStress.toFixed(3)),
          blinkStress: Number(blinkStress.toFixed(3)),
        },
      }
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastVideoTimeRef.current = -1
    }
  }, [active, ready, videoRef])

  return { ready, getMetrics }
}
