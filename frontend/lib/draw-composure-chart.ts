import type { SessionTurn } from "@/lib/api-types"

export function drawComposureChart(
  canvas: HTMLCanvasElement,
  turns: SessionTurn[],
  dark = true,
): void {
  const ctx = canvas.getContext("2d")
  if (!ctx || turns.length === 0) {
    return
  }

  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  canvas.width = Math.floor(cssWidth * dpr)
  canvas.height = Math.floor(cssHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const pad = { top: 16, right: 16, bottom: 32, left: 44 }
  const plotW = cssWidth - pad.left - pad.right
  const plotH = cssHeight - pad.top - pad.bottom

  ctx.fillStyle = dark ? "#171717" : "#fff"
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  ctx.strokeStyle = dark ? "#404040" : "#e2e2e6"
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(pad.left + plotW, y)
    ctx.stroke()
    const value = 1 - i / 4
    ctx.fillStyle = dark ? "#a3a3a3" : "#888"
    ctx.font = "11px system-ui, sans-serif"
    ctx.textAlign = "right"
    ctx.textBaseline = "middle"
    ctx.fillText(value.toFixed(2), pad.left - 6, y)
  }

  const values = turns.map((t) => t.composure)
  const n = values.length

  const xAt = (index: number) =>
    n === 1 ? pad.left + plotW / 2 : pad.left + (plotW * index) / (n - 1)

  ctx.strokeStyle = "#34d399"
  ctx.lineWidth = 2
  ctx.beginPath()
  values.forEach((v, i) => {
    const x = xAt(i)
    const y = pad.top + plotH * (1 - Math.min(1, Math.max(0, v)))
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.stroke()

  ctx.fillStyle = "#34d399"
  values.forEach((v, i) => {
    const x = xAt(i)
    const y = pad.top + plotH * (1 - Math.min(1, Math.max(0, v)))
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  })

  ctx.fillStyle = dark ? "#d4d4d4" : "#555"
  ctx.font = "11px system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  turns.forEach((t, i) => {
    ctx.fillText(String(t.turn), xAt(i), pad.top + plotH + 8)
  })

  ctx.fillStyle = dark ? "#fafafa" : "#333"
  ctx.font = "600 12px system-ui, sans-serif"
  ctx.textAlign = "left"
  ctx.fillText("Composure by turn", pad.left, 4)
}
