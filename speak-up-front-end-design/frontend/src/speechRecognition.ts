/** Minimal Web Speech API recognition types (Chrome / Edge). */

export type SpeechRecognitionResultList = {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

export type SpeechRecognitionResult = {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

export type SpeechRecognitionAlternative = {
  transcript: string
  confidence: number
}

export type SpeechRecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-available'
  | 'bad-grammar'
  | 'language-not-supported'

export type SpeechRecognitionErrorEvent = Event & {
  error: SpeechRecognitionErrorCode
  message: string
}

export type SpeechRecognitionEvent = Event & {
  resultIndex: number
  results: SpeechRecognitionResultList
}

export type BrowserSpeechRecognition = EventTarget & {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onaudiostart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null
  onaudioend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null
  onend: ((this: BrowserSpeechRecognition, ev: Event) => void) | null
  onerror:
    | ((this: BrowserSpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
    | null
  onresult:
    | ((this: BrowserSpeechRecognition, ev: SpeechRecognitionEvent) => void)
    | null
  onstart: ((this: BrowserSpeechRecognition, ev: Event) => void) | null
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition

export function getSpeechRecognition():
  | SpeechRecognitionConstructor
  | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}
