import { computed, ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import {
  cancelBridgeDictation,
  readBridgeDictation,
  sendBridgeDictationAudio,
  startBridgeDictation,
  stopBridgeDictation
} from '@/app/speech-dictation-bridge'
import type { VoiceDictationContext } from '@/app/speech-dictation-bridge'
import { contextualizeSpeechDictation } from '@/app/speech-dictation-context'

export const speechDictationActiveOwner = ref<string | null>(null)
export const speechDictationError = ref<string | null>(null)
export const speechDictationSpeaking = ref(false)
export const speechDictationWaveform = ref<number[]>([0, 0, 0, 0, 0])
export const speechDictationAvailable = computed(() => IS_BROWSER)

let recognition: SpeechRecognition | null = null
let bridgeRun: BridgeDictationRun | null = null
let meterStream: MediaStream | null = null
let meterContext: AudioContext | null = null
let meterSource: MediaStreamAudioSourceNode | null = null
let meterAnalyser: AnalyserNode | null = null
let meterProcessor: ScriptProcessorNode | null = null
let meterSink: GainNode | null = null
let meterFrame: number | null = null
let meterReady = false
let generation = 0

type BridgeDictationRun = {
  audioQueue: Promise<void>
  browserOnly: boolean
  browserTranscript: string
  context?: VoiceDictationContext
  currentGeneration: number
  ownerId: string
  pendingAudio: ArrayBuffer[]
  pendingAudioBytes: number
  sessionId: string | null
  liveTranscript: string
  stopSent: boolean
  stopRequested: boolean
  transcriptBase: string
  updateText(text: string): void
}

const VOICE_SAMPLE_RATE = 16_000
const MAX_PENDING_AUDIO_BYTES = VOICE_SAMPLE_RATE * 2 * 30

const WAVEFORM_BANDS = [
  [1, 3],
  [3, 6],
  [6, 12],
  [12, 24],
  [24, 48]
] as const

export function speechDictationText(base: string, transcript: string) {
  return [base.trim(), transcript.trim()].filter(Boolean).join(' ')
}

function transcriptWordCount(value: string) {
  const compact = value.trim()
  return compact ? compact.split(/\s+/).length : 0
}

/** Keep the instant browser draft visible until the contextual CLI revision has equal coverage. */
export function selectSpeechDictationTranscript(cliTranscript: string, browserTranscript: string) {
  const cli = cliTranscript.trim()
  const browser = browserTranscript.trim()
  if (!cli) return browser
  if (!browser) return cli
  return transcriptWordCount(cli) >= transcriptWordCount(browser) ? cli : browser
}

function updateBridgeDictationPreview(run: BridgeDictationRun) {
  const transcript = selectSpeechDictationTranscript(
    contextualizeSpeechDictation(run.liveTranscript, run.context),
    contextualizeSpeechDictation(run.browserTranscript, run.context)
  )
  if (transcript) run.updateText(speechDictationText(run.transcriptBase, transcript))
}

export function speechWaveformLevels(frequencies: Uint8Array, previous: readonly number[]) {
  return WAVEFORM_BANDS.map(([start, end], index) => {
    let total = 0
    const cappedEnd = Math.min(end, frequencies.length)
    for (let cursor = start; cursor < cappedEnd; cursor += 1) {
      total += frequencies[cursor]
    }
    const count = Math.max(1, cappedEnd - start)
    const normalized = Math.min(1, Math.max(0, (total / count / 255 - 0.025) * 2))
    return (previous[index] ?? 0) * 0.64 + normalized * 0.36
  })
}

export function speechPcm16(samples: Float32Array, sampleRate = VOICE_SAMPLE_RATE): ArrayBuffer {
  if (samples.length === 0) return new ArrayBuffer(0)
  const ratio = sampleRate / VOICE_SAMPLE_RATE
  const length = Math.max(1, Math.floor(samples.length / ratio))
  const buffer = new ArrayBuffer(length * 2)
  const output = new DataView(buffer)
  for (let index = 0; index < length; index += 1) {
    const start = Math.min(samples.length - 1, Math.floor(index * ratio))
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)))
    let total = 0
    for (let cursor = start; cursor < end; cursor += 1) total += samples[cursor] ?? 0
    const sample = Math.max(-1, Math.min(1, total / (end - start)))
    output.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

function recognitionConstructor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function stopSpeechMeter() {
  if (meterFrame !== null) cancelAnimationFrame(meterFrame)
  meterFrame = null
  meterReady = false
  if (meterProcessor) meterProcessor.onaudioprocess = null
  meterSource?.disconnect()
  meterAnalyser?.disconnect()
  meterProcessor?.disconnect()
  meterSink?.disconnect()
  meterSource = null
  meterAnalyser = null
  meterProcessor = null
  meterSink = null
  for (const track of meterStream?.getTracks() ?? []) track.stop()
  meterStream = null
  const context = meterContext
  meterContext = null
  if (context && context.state !== 'closed') void context.close().catch(() => undefined)
  speechDictationWaveform.value = [0, 0, 0, 0, 0]
  speechDictationSpeaking.value = false
}

function queueBridgeAudio(run: BridgeDictationRun, audio: ArrayBuffer) {
  if (bridgeRun !== run || run.currentGeneration !== generation) return
  if (!run.sessionId) {
    run.pendingAudio.push(audio)
    run.pendingAudioBytes += audio.byteLength
    while (run.pendingAudioBytes > MAX_PENDING_AUDIO_BYTES && run.pendingAudio.length > 1) {
      const removed = run.pendingAudio.shift()
      run.pendingAudioBytes -= removed?.byteLength ?? 0
    }
    return
  }
  const sessionId = run.sessionId
  run.audioQueue = run.audioQueue
    .then(() => sendBridgeDictationAudio(sessionId, audio))
    .catch((error: unknown) => failBridgeDictation(run, error))
}

function flushPendingBridgeAudio(run: BridgeDictationRun) {
  const pending = run.pendingAudio
  run.pendingAudio = []
  run.pendingAudioBytes = 0
  for (const audio of pending) queueBridgeAudio(run, audio)
}

async function requestBridgeStop(run: BridgeDictationRun) {
  if (!run.sessionId || run.stopSent) return
  run.stopSent = true
  await run.audioQueue
  if (bridgeRun !== run || run.currentGeneration !== generation) return
  await stopBridgeDictation(run.sessionId)
}

async function startSpeechMeter(run: BridgeDictationRun) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true
      },
      video: false
    })
    if (run.currentGeneration !== generation) {
      for (const track of stream.getTracks()) track.stop()
      return
    }

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(2048, 1, 1)
    const sink = context.createGain()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.68
    sink.gain.value = 0
    source.connect(analyser)
    source.connect(processor)
    processor.connect(sink)
    sink.connect(context.destination)
    processor.onaudioprocess = (event) => {
      if (run.currentGeneration !== generation) return
      queueBridgeAudio(
        run,
        speechPcm16(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate)
      )
    }
    if (context.state === 'suspended') await context.resume()
    if (run.currentGeneration !== generation) {
      source.disconnect()
      analyser.disconnect()
      processor.disconnect()
      sink.disconnect()
      for (const track of stream.getTracks()) track.stop()
      void context.close().catch(() => undefined)
      return
    }

    meterStream = stream
    meterContext = context
    meterSource = source
    meterAnalyser = analyser
    meterProcessor = processor
    meterSink = sink
    meterReady = true
    const frequencies = new Uint8Array(analyser.frequencyBinCount)
    let smoothed = [0, 0, 0, 0, 0]
    let lastVoiceAt = 0

    const sample = () => {
      if (run.currentGeneration !== generation || meterAnalyser !== analyser) return
      analyser.getByteFrequencyData(frequencies)
      smoothed = speechWaveformLevels(frequencies, smoothed)
      speechDictationWaveform.value = smoothed
      const peak = Math.max(...smoothed)
      const now = performance.now()
      if (peak > 0.08) lastVoiceAt = now
      speechDictationSpeaking.value = now - lastVoiceAt < 180
      meterFrame = requestAnimationFrame(sample)
    }

    meterFrame = requestAnimationFrame(sample)
  } catch {
    if (run.currentGeneration !== generation) return
    meterReady = false
    speechDictationWaveform.value = [0, 0, 0, 0, 0]
  }
}

export function stopSpeechDictation(ownerId?: string) {
  if (ownerId && speechDictationActiveOwner.value !== ownerId) return
  const run = bridgeRun
  if (run && (!ownerId || run.ownerId === ownerId)) {
    run.stopRequested = true
    const activeRecognition = recognition
    recognition = null
    activeRecognition?.stop()
    stopSpeechMeter()
    if (run.sessionId) {
      void requestBridgeStop(run).catch((error: unknown) => {
        failBridgeDictation(run, error)
      })
    }
    return
  }
  generation += 1
  recognition?.stop()
  recognition = null
  stopSpeechMeter()
  speechDictationActiveOwner.value = null
}

function finishBridgeDictation(run: BridgeDictationRun, transcript: string) {
  if (bridgeRun !== run || run.currentGeneration !== generation) return
  const compact = contextualizeSpeechDictation(transcript, run.context).trim()
  if (compact) {
    run.updateText(speechDictationText(run.transcriptBase, compact))
  }
  run.pendingAudio = []
  run.pendingAudioBytes = 0
  const activeRecognition = recognition
  recognition = null
  activeRecognition?.stop()
  generation += 1
  bridgeRun = null
  stopSpeechMeter()
  speechDictationActiveOwner.value = null
}

function failBridgeDictation(run: BridgeDictationRun | null, error: unknown) {
  if (!run || bridgeRun !== run || run.currentGeneration !== generation) return
  speechDictationError.value = error instanceof Error ? error.message : 'CLI dictation stopped.'
  const activeRecognition = recognition
  recognition = null
  activeRecognition?.stop()
  generation += 1
  bridgeRun = null
  stopSpeechMeter()
  speechDictationActiveOwner.value = null
}

async function followBridgeDictation(run: BridgeDictationRun) {
  try {
    const started = await startBridgeDictation(run.context)
    if (bridgeRun !== run || run.currentGeneration !== generation) {
      await cancelBridgeDictation(started.sessionId).catch(() => undefined)
      return
    }
    run.sessionId = started.sessionId
    flushPendingBridgeAudio(run)
    if (run.stopRequested) await requestBridgeStop(run)

    for (;;) {
      if (bridgeRun !== run || run.currentGeneration !== generation) return
      const current = await readBridgeDictation(started.sessionId)
      if (current.phase === 'ready') {
        finishBridgeDictation(run, current.transcript)
        return
      }
      if (current.phase === 'cancelled') {
        finishBridgeDictation(run, '')
        return
      }
      if (current.phase === 'error') {
        throw new Error(current.error || 'Antigravity voice input stopped unexpectedly.')
      }
      if (current.transcript && current.transcript !== run.liveTranscript) {
        run.liveTranscript = current.transcript
        updateBridgeDictationPreview(run)
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 120)
      })
    }
  } catch (error) {
    if (bridgeRun !== run || run.currentGeneration !== generation) return
    if (!run.stopRequested && promoteBrowserSpeechRecognition(run)) return
    failBridgeDictation(run, error)
  }
}

function promoteBrowserSpeechRecognition(run: BridgeDictationRun) {
  if (recognition) {
    run.browserOnly = true
    bridgeRun = null
    run.pendingAudio = []
    run.pendingAudioBytes = 0
    return true
  }
  return startBrowserSpeechRecognition(run, true)
}

function startBrowserSpeechRecognition(run: BridgeDictationRun, browserOnly = false) {
  const Recognition = recognitionConstructor()
  if (!Recognition) return false
  if (browserOnly) {
    run.browserOnly = true
    bridgeRun = null
    run.pendingAudio = []
    run.pendingAudioBytes = 0
  }
  const browserRecognition = new Recognition()
  recognition = browserRecognition
  browserRecognition.continuous = true
  browserRecognition.interimResults = true
  browserRecognition.lang = navigator.language || 'en-US'
  browserRecognition.addEventListener('speechstart', () => {
    if (run.currentGeneration !== generation) return
    if (!meterReady) speechDictationSpeaking.value = true
  })
  browserRecognition.addEventListener('speechend', () => {
    if (run.currentGeneration !== generation) return
    if (!meterReady) speechDictationSpeaking.value = false
  })
  browserRecognition.onresult = (event) => {
    if (run.currentGeneration !== generation) return
    let transcript = ''
    for (const result of Array.from(event.results)) {
      transcript += result[0].transcript
    }
    run.browserTranscript = transcript
    updateBridgeDictationPreview(run)
  }
  browserRecognition.onerror = (event) => {
    if (run.currentGeneration !== generation) return
    if (recognition === browserRecognition) recognition = null
    if (!run.browserOnly) return
    speechDictationError.value =
      event.error === 'not-allowed'
        ? 'Microphone access was denied. Typed input still works.'
        : 'Dictation stopped unexpectedly. Typed input still works.'
    stopSpeechDictation(run.ownerId)
  }
  browserRecognition.onend = () => {
    if (run.currentGeneration !== generation) return
    if (recognition === browserRecognition) recognition = null
    if (!run.browserOnly) return
    stopSpeechMeter()
    speechDictationActiveOwner.value = null
  }
  try {
    browserRecognition.start()
  } catch {
    if (recognition === browserRecognition) recognition = null
    return false
  }
  return true
}

export function startSpeechDictation(
  ownerId: string,
  currentText: string,
  updateText: (text: string) => void,
  context?: VoiceDictationContext
) {
  if (bridgeRun?.sessionId) void cancelBridgeDictation(bridgeRun.sessionId).catch(() => undefined)
  bridgeRun = null
  generation += 1
  recognition?.stop()
  recognition = null
  stopSpeechMeter()
  speechDictationError.value = null
  const currentGeneration = ++generation
  const run: BridgeDictationRun = {
    audioQueue: Promise.resolve(),
    browserOnly: false,
    browserTranscript: '',
    ...(context ? { context } : {}),
    currentGeneration,
    ownerId,
    pendingAudio: [],
    pendingAudioBytes: 0,
    sessionId: null,
    liveTranscript: '',
    stopSent: false,
    stopRequested: false,
    transcriptBase: currentText.trim(),
    updateText
  }
  bridgeRun = run
  speechDictationActiveOwner.value = ownerId
  void startSpeechMeter(run)
  startBrowserSpeechRecognition(run)
  void followBridgeDictation(run)
  return true
}
