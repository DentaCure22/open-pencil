import { ref, shallowRef } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'
import { resolveTraceSpokenTurn } from '@open-pencil/core/rpc'

import type { EditorStore } from '@/app/editor/session'
import { readOpenPencilWorkspaceIdentity } from '@/app/workspace-document/identity'
import { persistLocalWorkspaceTraceSpokenTurns } from '@/app/workspace-document/local-authority/client'

import { saveNarratedTraceRecord } from './history'
import { scrubNarratedTraceQueryReceiptForMicTurns } from './retrieval'
import { narratedTraceRuntimeTabBindingForStore } from './runtime-binding'
import {
  appendNarratedTraceEvent,
  beginNarratedTraceEpisode,
  finishNarratedTraceEpisode,
  narratedTraceSession,
  narratedTraceStatus
} from './state'
import type { NarratedTraceScope, NarratedTraceSession } from './types'

const MIC_LANGUAGE = 'en-US'
const MIC_RESTART_DELAY_MS = 250
const MIC_TURN_RETENTION_MS = 15 * 60_000

export type NarratedTraceMicPhase =
  | 'checking'
  | 'denied'
  | 'error'
  | 'idle'
  | 'listening'
  | 'no-speech'
  | 'unsupported'

export type NarratedTraceMicLocality = 'browser-service' | 'local'

export type NarratedTraceMicScope = NarratedTraceScope & {
  workspaceId: string
}

export type NarratedTraceMicTurn = {
  endedAt: string
  endedAtEpochMs: number
  endedAtMonotonicMs: number
  expiresAtEpochMs: number
  id: string
  runtimeTabBindingId: string
  scope: NarratedTraceMicScope
  sequence: number
  startedAt: string
  startedAtEpochMs: number
  startedAtMonotonicMs: number
  text: string
  timeOriginEpochMs: number
}

export type NarratedTraceMicTurnSelector = {
  latest?: boolean
  runtimeTabBindingId?: string
  scope?: NarratedTraceScope
  text?: string
  turnId?: string
}

export type NarratedTraceMicTurnResolution =
  | {
      candidates: NarratedTraceMicTurn[]
      reason: 'ambiguous_spoken_turn'
      status: 'ambiguous'
    }
  | {
      reason:
        | 'invalid_spoken_turn_selector'
        | 'spoken_turn_runtime_binding_unavailable'
        | 'spoken_turn_scope_unavailable'
      status: 'error'
    }
  | {
      reason: 'spoken_turn_not_found'
      status: 'empty'
    }
  | {
      status: 'matched'
      turn: NarratedTraceMicTurn
    }

type ClockSample = {
  epochMs: number
  monotonicMs: number
  timeOriginEpochMs: number
}

export const narratedTraceMicPhase = ref<NarratedTraceMicPhase>('idle')
/** User pinned the mic on: it records continuously, independent of the Focus tool. */
export const narratedTraceMicPinned = ref(false)
export const narratedTraceMicLocality = ref<NarratedTraceMicLocality>('browser-service')
export const narratedTraceMicError = ref<string | null>(null)
export const narratedTraceMicInterimText = ref('')
export const narratedTraceMicTurns = shallowRef<NarratedTraceMicTurn[]>([])

let pendingScope: NarratedTraceMicScope | null = null
let pendingRuntimeTabBindingId: string | null = null
let recognition: SpeechRecognition | null = null
let recognitionRestartTimer: ReturnType<typeof setTimeout> | null = null
let retentionTimer: ReturnType<typeof setTimeout> | null = null
let sequence = 0
let speechStartedAt: ClockSample | null = null
let recognitionStartedAt: ClockSample | null = null
let stopRequested = false
let terminalRecognitionFailure = false
let startAttempt = 0

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  if (!IS_BROWSER) return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function exactScopeForStore(store: EditorStore): NarratedTraceMicScope | null {
  const identity = readOpenPencilWorkspaceIdentity(store.graph)
  const pageId = store.state.currentPageId
  if (!identity || !pageId) return null
  const page = store.graph.getNode(pageId)
  return {
    documentId: identity.documentId,
    documentName: identity.documentName,
    pageId,
    pageName: page?.name,
    workspaceId: identity.workspaceId
  }
}

function sameExactScope(
  left: NarratedTraceScope | null | undefined,
  right: NarratedTraceScope | null | undefined
) {
  if (!left?.workspaceId || !right?.workspaceId) return false
  return (
    left.workspaceId === right.workspaceId &&
    left.documentId === right.documentId &&
    left.pageId === right.pageId
  )
}

function clockSample(): ClockSample | null {
  if (!IS_BROWSER) return null
  const monotonicMs = globalThis.performance.now()
  const timeOriginEpochMs = globalThis.performance.timeOrigin
  if (!Number.isFinite(monotonicMs) || !Number.isFinite(timeOriginEpochMs)) return null
  return {
    epochMs: timeOriginEpochMs + monotonicMs,
    monotonicMs,
    timeOriginEpochMs
  }
}

function clearRecognitionRestartTimer() {
  if (recognitionRestartTimer) clearTimeout(recognitionRestartTimer)
  recognitionRestartTimer = null
}

function clearRecognition() {
  clearRecognitionRestartTimer()
  recognition = null
  pendingScope = null
  pendingRuntimeTabBindingId = null
  speechStartedAt = null
  recognitionStartedAt = null
  stopRequested = false
  terminalRecognitionFailure = false
  narratedTraceMicInterimText.value = ''
}

function scheduleRetention() {
  if (retentionTimer) clearTimeout(retentionTimer)
  retentionTimer = null
  const nextExpiry = narratedTraceMicTurns.value.reduce(
    (earliest, turn) => Math.min(earliest, turn.expiresAtEpochMs),
    Number.POSITIVE_INFINITY
  )
  if (!Number.isFinite(nextExpiry)) return
  retentionTimer = setTimeout(
    () => {
      retentionTimer = null
      pruneNarratedTraceMicTurns()
    },
    Math.max(0, nextExpiry - Date.now())
  )
}

function addTurn(turn: NarratedTraceMicTurn) {
  narratedTraceMicTurns.value = [...narratedTraceMicTurns.value, turn]
  scheduleRetention()
}

function sessionSpokenTurns(
  session: NarratedTraceSession,
  turns: readonly NarratedTraceMicTurn[]
): NarratedTraceMicTurn[] {
  if (!session.scope?.workspaceId) return []
  const startedAt = Date.parse(session.startedAt)
  if (!Number.isFinite(startedAt)) return []
  return turns.filter(
    (turn) => sameExactScope(turn.scope, session.scope) && turn.endedAtEpochMs >= startedAt
  )
}

function recordSpokenTurnInActiveTrace(turn: NarratedTraceMicTurn) {
  const session = narratedTraceSession.value
  if (
    !session ||
    narratedTraceStatus.value !== 'recording' ||
    !sameExactScope(turn.scope, session.scope)
  ) {
    return session
  }
  const sessionStartedAtMs = Date.parse(session.startedAt)
  if (!Number.isFinite(sessionStartedAtMs)) return session
  const startedAtMs = Math.max(0, turn.startedAtEpochMs - sessionStartedAtMs)
  const endedAtMs = Math.max(startedAtMs, turn.endedAtEpochMs - sessionStartedAtMs)
  const episodeId = `voice:${turn.id}`
  beginNarratedTraceEpisode({
    id: episodeId,
    kind: 'voice',
    label: 'Voice note',
    sourceSessionId: turn.id,
    startedAtMs
  })
  appendNarratedTraceEvent({
    atMs: startedAtMs,
    durationMs: endedAtMs - startedAtMs,
    kind: 'transcript',
    label: turn.text,
    origin: {
      episodeId,
      kind: 'voice',
      reference: `Voice #${String(turn.sequence)}`,
      sequence: turn.sequence,
      sourceSessionId: turn.id
    },
    text: turn.text
  })
  finishNarratedTraceEpisode(episodeId, endedAtMs)
  return narratedTraceSession.value
}

function finalizeTurn(store: EditorStore, text: string) {
  const compact = text.replace(/\s+/g, ' ').trim()
  const start = speechStartedAt ?? recognitionStartedAt
  const end = clockSample()
  const currentScope = exactScopeForStore(store)
  const currentRuntimeTabBindingId = narratedTraceRuntimeTabBindingForStore(store)
  if (
    !compact ||
    !start ||
    !end ||
    !pendingScope ||
    !pendingRuntimeTabBindingId ||
    !sameExactScope(pendingScope, currentScope) ||
    pendingRuntimeTabBindingId !== currentRuntimeTabBindingId
  ) {
    narratedTraceMicPhase.value = 'error'
    narratedTraceMicError.value =
      currentScope && currentRuntimeTabBindingId
        ? 'The spoken turn could not be aligned to the current runtime and Trace clock.'
        : 'The Board or runtime tab changed before the spoken turn finished.'
    return false
  }

  sequence += 1
  const turn: NarratedTraceMicTurn = {
    endedAt: new Date(end.epochMs).toISOString(),
    endedAtEpochMs: end.epochMs,
    endedAtMonotonicMs: end.monotonicMs,
    expiresAtEpochMs: Date.now() + MIC_TURN_RETENTION_MS,
    id: `spoken-turn-${globalThis.crypto.randomUUID()}`,
    runtimeTabBindingId: pendingRuntimeTabBindingId,
    scope: structuredClone(pendingScope),
    sequence,
    startedAt: new Date(start.epochMs).toISOString(),
    startedAtEpochMs: start.epochMs,
    startedAtMonotonicMs: start.monotonicMs,
    text: compact,
    timeOriginEpochMs: start.timeOriginEpochMs
  }
  addTurn(turn)
  // The turn itself is persisted immediately and unconditionally: workers must be able to resolve
  // it even when no Trace session is active or the app disconnects moments later.
  void persistLocalWorkspaceTraceSpokenTurns([turn]).catch((error: unknown) => {
    console.warn(
      '[Narrated Trace] Standalone spoken turn persistence failed:',
      error instanceof Error ? error.message : error
    )
  })
  const traceSession = recordSpokenTurnInActiveTrace(turn)
  const spokenTurns = traceSession
    ? sessionSpokenTurns(traceSession, narratedTraceMicTurns.value)
    : []
  if (traceSession && spokenTurns.length > 0) {
    void saveNarratedTraceRecord(traceSession, spokenTurns).catch((error: unknown) => {
      console.warn(
        '[Narrated Trace] Spoken turn persistence failed:',
        error instanceof Error ? error.message : error
      )
    })
  }
  speechStartedAt = null
  recognitionStartedAt = end
  narratedTraceMicInterimText.value = ''
  narratedTraceMicError.value = null
  return true
}

function recognitionErrorMessage(event: SpeechRecognitionErrorEvent) {
  if (event.error === 'not-allowed') {
    return {
      message: 'Microphone access was denied. Typed Chat remains available.',
      phase: 'denied' as const
    }
  }
  if (event.error === 'service-not-allowed') {
    return {
      message:
        'The browser speech recognition service is unavailable. Typed Chat remains available.',
      phase: 'error' as const
    }
  }
  if (event.error === 'no-speech') {
    return {
      message: 'No speech detected yet. The microphone is still on.',
      phase: 'listening' as const
    }
  }
  return {
    message: `Speech recognition stopped: ${event.message || event.error}`,
    phase: 'error' as const
  }
}

export function pruneNarratedTraceMicTurns(nowEpochMs = Date.now()) {
  const expiredTurnIds = narratedTraceMicTurns.value
    .filter((turn) => turn.expiresAtEpochMs <= nowEpochMs)
    .map((turn) => turn.id)
  narratedTraceMicTurns.value = narratedTraceMicTurns.value.filter(
    (turn) => turn.expiresAtEpochMs > nowEpochMs
  )
  scrubNarratedTraceQueryReceiptForMicTurns(expiredTurnIds)
  scheduleRetention()
}

export function clearNarratedTraceMicTurns() {
  narratedTraceMicTurns.value = []
  scrubNarratedTraceQueryReceiptForMicTurns()
  if (retentionTimer) clearTimeout(retentionTimer)
  retentionTimer = null
}

export function removeNarratedTraceMicTurn(turnId: string) {
  narratedTraceMicTurns.value = narratedTraceMicTurns.value.filter((turn) => turn.id !== turnId)
  scrubNarratedTraceQueryReceiptForMicTurns([turnId])
  scheduleRetention()
}

export function clearNarratedTraceMicTurnsOutsideScope(scope: NarratedTraceScope) {
  const removedTurnIds = narratedTraceMicTurns.value
    .filter((turn) => !sameExactScope(turn.scope, scope))
    .map((turn) => turn.id)
  narratedTraceMicTurns.value = narratedTraceMicTurns.value.filter((turn) =>
    sameExactScope(turn.scope, scope)
  )
  scrubNarratedTraceQueryReceiptForMicTurns(removedTurnIds)
  scheduleRetention()
}

export async function startNarratedTraceMic(store: EditorStore) {
  if (narratedTraceMicPhase.value === 'listening') return true
  if (narratedTraceMicPhase.value === 'checking') return false
  const attempt = ++startAttempt
  narratedTraceMicError.value = null
  narratedTraceMicPhase.value = 'checking'
  const scope = exactScopeForStore(store)
  const runtimeTabBindingId = narratedTraceRuntimeTabBindingForStore(store) ?? null
  pendingScope = scope
  pendingRuntimeTabBindingId = runtimeTabBindingId
  if (!scope || !runtimeTabBindingId) {
    pendingScope = null
    pendingRuntimeTabBindingId = null
    narratedTraceMicPhase.value = 'error'
    narratedTraceMicError.value =
      'Mic-linked Trace requires an exact runtime, document tab, workspace, content document, and Board.'
    return false
  }

  const constructor = recognitionConstructor()
  if (!constructor) {
    narratedTraceMicPhase.value = 'unsupported'
    narratedTraceMicError.value = 'Speech recognition is unavailable. Typed Chat remains available.'
    return false
  }

  narratedTraceMicLocality.value = 'browser-service'
  if (constructor.available) {
    try {
      const availability = await constructor.available({
        langs: [MIC_LANGUAGE],
        processLocally: true
      })
      if (availability === 'available') narratedTraceMicLocality.value = 'local'
    } catch {
      narratedTraceMicLocality.value = 'browser-service'
    }
  }
  if (attempt !== startAttempt) return false
  const currentScope = exactScopeForStore(store)
  const currentRuntimeTabBindingId = narratedTraceRuntimeTabBindingForStore(store)
  if (!sameExactScope(scope, currentScope) || runtimeTabBindingId !== currentRuntimeTabBindingId) {
    narratedTraceMicPhase.value = 'error'
    narratedTraceMicError.value = 'The Board or runtime tab changed before the microphone started.'
    pendingScope = null
    pendingRuntimeTabBindingId = null
    return false
  }

  const clock = clockSample()
  if (!clock) {
    narratedTraceMicPhase.value = 'unsupported'
    narratedTraceMicError.value = 'Speech recognition or its monotonic clock is unavailable.'
    return false
  }

  const next = new constructor()
  next.continuous = true
  next.interimResults = true
  next.lang = MIC_LANGUAGE
  next.maxAlternatives = 1
  next.processLocally = narratedTraceMicLocality.value === 'local'

  recognitionStartedAt = clock
  speechStartedAt = null
  stopRequested = false
  terminalRecognitionFailure = false
  recognition = next
  narratedTraceMicInterimText.value = ''
  narratedTraceMicError.value = null
  narratedTraceMicPhase.value = 'listening'

  next.addEventListener('speechstart', () => {
    if (recognition !== next) return
    speechStartedAt ??= clockSample()
    narratedTraceMicError.value = null
  })
  next.onresult = (event) => {
    if (recognition !== next) return
    const interim: string[] = []
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const transcript = result[0].transcript.trim()
      if (!transcript) continue
      if (result.isFinal) {
        if (finalizeTurn(store, transcript)) continue
        terminalRecognitionFailure = true
        try {
          next.abort()
        } catch {
          clearRecognition()
        }
        // A pinned mic must survive the scope change that invalidated this turn: re-anchor to
        // the current Board instead of staying dead. The in-flight turn is lost, nothing else.
        if (narratedTraceMicPinned.value) {
          setTimeout(() => {
            if (narratedTraceMicPinned.value) void startNarratedTraceMic(store)
          }, MIC_RESTART_DELAY_MS)
        }
        return
      }
      interim.push(transcript)
    }
    narratedTraceMicInterimText.value = interim.join(' ')
  }
  next.onerror = (event) => {
    if (recognition !== next || (stopRequested && event.error === 'aborted')) return
    const failure = recognitionErrorMessage(event)
    narratedTraceMicPhase.value = failure.phase
    narratedTraceMicError.value = failure.message
    terminalRecognitionFailure = failure.phase !== 'listening'
  }
  next.onend = () => {
    if (recognition !== next) return
    if (stopRequested || terminalRecognitionFailure) {
      clearRecognition()
      return
    }
    recognitionStartedAt = clockSample()
    speechStartedAt = null
    recognitionRestartTimer = setTimeout(() => {
      recognitionRestartTimer = null
      if (recognition !== next || stopRequested || terminalRecognitionFailure) return
      try {
        next.start()
      } catch (error) {
        narratedTraceMicPhase.value = 'error'
        narratedTraceMicError.value =
          error instanceof Error ? error.message : 'Speech recognition could not restart.'
        clearRecognition()
      }
    }, MIC_RESTART_DELAY_MS)
  }

  try {
    next.start()
    return true
  } catch (error) {
    narratedTraceMicPhase.value = 'error'
    narratedTraceMicError.value =
      error instanceof Error ? error.message : 'Speech recognition could not start.'
    clearRecognition()
    return false
  }
}

/**
 * Restarts recognition anchored to the store's current scope. Used when the pinned mic must keep
 * recording across a Board or page switch: the old anchor is invalid, but listening continues.
 */
export async function reanchorNarratedTraceMic(store: EditorStore) {
  if (narratedTraceMicPhase.value !== 'listening' && narratedTraceMicPhase.value !== 'checking') {
    return startNarratedTraceMic(store)
  }
  stopNarratedTraceMic()
  return startNarratedTraceMic(store)
}

export function stopNarratedTraceMic() {
  startAttempt += 1
  if (!recognition) {
    clearRecognition()
    narratedTraceMicError.value = null
    narratedTraceMicPhase.value = 'idle'
    return
  }
  stopRequested = true
  clearRecognitionRestartTimer()
  narratedTraceMicInterimText.value = ''
  narratedTraceMicError.value = null
  narratedTraceMicPhase.value = 'idle'
  try {
    recognition.stop()
  } catch {
    try {
      recognition.abort()
    } catch (error) {
      console.warn('Narrated Trace microphone could not abort after Stop:', error)
    }
    clearRecognition()
  }
}

export function disposeNarratedTraceMic() {
  startAttempt += 1
  if (recognition) {
    stopRequested = true
    terminalRecognitionFailure = true
    try {
      recognition.abort()
    } catch (error) {
      console.warn('Narrated Trace microphone could not abort during teardown:', error)
    }
  }
  clearRecognition()
  clearNarratedTraceMicTurns()
  narratedTraceMicError.value = null
  narratedTraceMicPhase.value = 'idle'
}

export function resolveNarratedTraceMicTurn(
  selector: NarratedTraceMicTurnSelector,
  turns: readonly NarratedTraceMicTurn[] = narratedTraceMicTurns.value,
  nowEpochMs = Date.now()
): NarratedTraceMicTurnResolution {
  return resolveTraceSpokenTurn(selector, turns, { nowEpochMs }) as NarratedTraceMicTurnResolution
}
