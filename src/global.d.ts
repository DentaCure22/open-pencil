export {}

declare global {
  interface Uint8ArrayConstructor {
    fromBase64(base64: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array
  }

  interface Uint8Array {
    toBase64(options?: { alphabet?: 'base64' | 'base64url' }): string
  }

  interface GestureEvent extends UIEvent {
    scale: number
    rotation: number
    clientX: number
    clientY: number
  }

  interface FilePickerAcceptType {
    description: string
    accept: Record<string, string[]>
  }

  interface FilePickerOptions {
    types?: FilePickerAcceptType[]
    suggestedName?: string
  }

  type SpeechRecognitionAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable'

  interface SpeechRecognitionOptions {
    langs: string[]
    processLocally: boolean
  }

  interface SpeechRecognitionAlternative {
    readonly confidence: number
    readonly transcript: string
  }

  interface SpeechRecognitionResult {
    readonly isFinal: boolean
    readonly length: number
    readonly [index: number]: SpeechRecognitionAlternative
  }

  interface SpeechRecognitionResultList {
    readonly length: number
    readonly [index: number]: SpeechRecognitionResult
  }

  interface SpeechRecognitionEvent extends Event {
    readonly resultIndex: number
    readonly results: SpeechRecognitionResultList
  }

  interface SpeechRecognitionErrorEvent extends Event {
    readonly error: string
    readonly message: string
  }

  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    processLocally: boolean
    onend: (() => void) | null
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
    onresult: ((event: SpeechRecognitionEvent) => void) | null
    abort(): void
    start(): void
    stop(): void
  }

  interface SpeechRecognitionConstructor {
    new (): SpeechRecognition
    available?(options: SpeechRecognitionOptions): Promise<SpeechRecognitionAvailability>
    install?(options: SpeechRecognitionOptions): Promise<boolean>
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
    showOpenFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(options?: FilePickerOptions): Promise<FileSystemFileHandle>
    queryLocalFonts?(): Promise<
      {
        family: string
        fullName: string
        style: string
        postscriptName: string
        blob(): Promise<Blob>
      }[]
    >
    mockWindowOpen?(url: string): void
  }
}
