import { useIntervalFn } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'

import { readCacheJson, removeCacheEntry, writeCacheJson } from '@/app/cache'

import { buildNarratedContextMarkdown } from './context'
import {
  compactNarratedTraceTitle,
  deleteNarratedTraceRecord,
  loadNarratedTraceHistory,
  readNarratedTraceRecord,
  renameNarratedTraceRecord,
  saveNarratedTraceRecord
} from './history'
import type {
  NarratedTraceAppendOptions,
  NarratedTraceContextEntry,
  NarratedTraceEvidence,
  NarratedTraceEvent,
  NarratedTraceEventInput,
  NarratedTraceSession,
  NarratedTraceStatus,
  NarratedTraceViewMode
} from './types'

const CURRENT_SESSION_CACHE_KEY = 'narrated-trace/current-session'
const DEFAULT_COALESCE_WINDOW_MS = 500

export const narratedTraceStatus = ref<NarratedTraceStatus>('idle')
export const narratedTraceViewMode = ref<NarratedTraceViewMode>('timeline')
export const narratedTraceElapsedMs = ref(0)
export const narratedTraceError = ref<string | null>(null)
export const narratedTraceInterimText = ref('')
export const narratedTraceSession = shallowRef<NarratedTraceSession | null>(null)

let clockStartedAt = 0
let clockAccumulatedMs = 0
let persistTimer: ReturnType<typeof setTimeout> | null = null
let fallbackId = 0
const coalescedEvents = new Map<string, { eventId: string; updatedAtMs: number }>()

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now()
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `${prefix}-${uuid}`
  fallbackId += 1
  return `${prefix}-${Date.now()}-${fallbackId}`
}

function updateClock() {
  if (narratedTraceStatus.value === 'recording') {
    narratedTraceElapsedMs.value = Math.round(
      clockAccumulatedMs + (monotonicNow() - clockStartedAt)
    )
  }
}

const clockInterval = useIntervalFn(updateClock, 100, { immediate: false })

function startClock() {
  clockStartedAt = monotonicNow()
  clockInterval.resume()
}

function stopClock() {
  updateClock()
  clockInterval.pause()
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    const session = narratedTraceSession.value
    if (!session) return
    void writeCacheJson(CURRENT_SESSION_CACHE_KEY, session)
    if (narratedTraceStatus.value === 'review') void saveNarratedTraceRecord(session)
  }, 150)
}

function replaceSession(session: NarratedTraceSession) {
  narratedTraceSession.value = session
  schedulePersist()
}

function mergeCoalescedChanges(
  existing: NarratedTraceEvent['changes'],
  incoming: NarratedTraceEvent['changes']
) {
  if (!incoming) return existing
  const merged = new Map((existing ?? []).map((change) => [change.property, change]))
  for (const change of incoming) {
    const previous = merged.get(change.property)
    merged.set(change.property, {
      ...change,
      before: previous?.before ?? change.before
    })
  }
  return [...merged.values()]
}

function joinCoalescedText(previous: string | undefined, next: string | undefined) {
  const parts = [previous?.trim(), next?.trim()].filter(
    (part): part is string => typeof part === 'string' && part.length > 0
  )
  return parts.filter((part, index) => part !== parts[index - 1]).join(' ')
}

function updateContextEntry(
  sourceEventId: string,
  update: (entry: NarratedTraceContextEntry) => NarratedTraceContextEntry
) {
  const session = narratedTraceSession.value
  if (!session) return
  const existing = session.contextDraft.find((entry) => entry.sourceEventId === sourceEventId)
  if (!existing) return
  replaceSession({
    ...session,
    contextDraft: session.contextDraft.map((entry) =>
      entry.sourceEventId === sourceEventId ? update(entry) : entry
    )
  })
}

export function beginNarratedTraceSession() {
  stopClock()
  coalescedEvents.clear()
  clockAccumulatedMs = 0
  narratedTraceElapsedMs.value = 0
  narratedTraceError.value = null
  narratedTraceInterimText.value = ''
  narratedTraceViewMode.value = 'timeline'
  narratedTraceSession.value = {
    contextDraft: [],
    durationMs: 0,
    events: [],
    id: createId('trace'),
    startedAt: new Date().toISOString()
  }
  narratedTraceStatus.value = 'recording'
  startClock()
  schedulePersist()
}

export function pauseNarratedTraceSession() {
  if (narratedTraceStatus.value !== 'recording') return
  stopClock()
  clockAccumulatedMs = narratedTraceElapsedMs.value
  narratedTraceStatus.value = 'paused'
  narratedTraceInterimText.value = ''
}

export function resumeNarratedTraceSession() {
  if (narratedTraceStatus.value !== 'paused') return
  narratedTraceStatus.value = 'recording'
  startClock()
}

export function finishNarratedTraceSession() {
  if (narratedTraceStatus.value !== 'recording' && narratedTraceStatus.value !== 'paused') return
  stopClock()
  const session = narratedTraceSession.value
  if (session) {
    narratedTraceSession.value = { ...session, durationMs: narratedTraceElapsedMs.value }
  }
  narratedTraceStatus.value = 'review'
  narratedTraceInterimText.value = ''
  schedulePersist()
}

export function appendNarratedTraceEvent(
  input: NarratedTraceEventInput,
  options: NarratedTraceAppendOptions = {}
): string | null {
  const session = narratedTraceSession.value
  if (!session || narratedTraceStatus.value !== 'recording') return null

  const atMs = input.atMs ?? narratedTraceElapsedMs.value
  const coalesceKey = options.coalesceKey
  const coalesced = coalesceKey ? coalescedEvents.get(coalesceKey) : undefined
  const coalesceWindowMs = options.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS

  if (coalesced && coalesceKey && atMs - coalesced.updatedAtMs <= coalesceWindowMs) {
    const existing = session.events.find((event) => event.id === coalesced.eventId)
    if (existing) {
      const nextEvent: NarratedTraceEvent = {
        ...existing,
        ...input,
        atMs: existing.atMs,
        changes: mergeCoalescedChanges(existing.changes, input.changes),
        durationMs: Math.max(0, atMs - existing.atMs),
        id: existing.id,
        label: options.mergeText ? joinCoalescedText(existing.label, input.label) : input.label,
        text: options.mergeText
          ? joinCoalescedText(existing.text, input.text)
          : (input.text ?? existing.text)
      }
      replaceSession({
        ...session,
        events: session.events.map((event) => (event.id === existing.id ? nextEvent : event))
      })
      coalescedEvents.set(coalesceKey, { eventId: existing.id, updatedAtMs: atMs })
      return existing.id
    }
  }

  const event: NarratedTraceEvent = {
    ...input,
    atMs,
    id: createId('event')
  }
  replaceSession({
    ...session,
    contextDraft: [
      ...session.contextDraft,
      { included: true, removed: false, sourceEventId: event.id }
    ],
    durationMs: Math.max(session.durationMs, atMs),
    events: [...session.events, event]
  })
  if (coalesceKey) {
    coalescedEvents.set(coalesceKey, { eventId: event.id, updatedAtMs: atMs })
  }
  return event.id
}

export function setNarratedTraceError(message: string | null) {
  narratedTraceError.value = message
}

export function setNarratedTraceInterimText(text: string) {
  narratedTraceInterimText.value = text
}

export function attachNarratedTraceEvidence(eventId: string, evidence: NarratedTraceEvidence) {
  const session = narratedTraceSession.value
  if (!session || !session.events.some((event) => event.id === eventId)) return
  replaceSession({
    ...session,
    events: session.events.map((event) => (event.id === eventId ? { ...event, evidence } : event))
  })
}

export function setNarratedTraceEventIncluded(eventId: string, included: boolean) {
  updateContextEntry(eventId, (entry) => ({ ...entry, included }))
}

export function removeNarratedTraceEventFromContext(eventId: string) {
  updateContextEntry(eventId, (entry) => ({ ...entry, removed: true }))
}

export function restoreNarratedTraceEventToContext(eventId: string) {
  updateContextEntry(eventId, (entry) => ({ ...entry, removed: false }))
}

export function editNarratedTraceEventText(eventId: string, editedText: string) {
  updateContextEntry(eventId, (entry) => ({
    ...entry,
    editedText: editedText.trim() || undefined
  }))
}

export function noteNarratedTraceEvent(eventId: string, note: string) {
  updateContextEntry(eventId, (entry) => ({ ...entry, note: note.trim() || undefined }))
}

export async function renameNarratedTraceTitle(sessionId: string, title: string) {
  const compact = compactNarratedTraceTitle(title)
  if (!compact) return false

  const session = narratedTraceSession.value
  const isCurrent = session?.id === sessionId
  if (session && isCurrent) replaceSession({ ...session, title: compact })

  const renamedRecord = await renameNarratedTraceRecord(sessionId, compact)
  return isCurrent || renamedRecord
}

export const narratedTraceIncludedCount = computed(() => {
  const session = narratedTraceSession.value
  if (!session) return 0
  return session.contextDraft.filter((entry) => entry.included && !entry.removed).length
})

export const narratedTraceRemovedCount = computed(() => {
  const session = narratedTraceSession.value
  return session?.contextDraft.filter((entry) => entry.removed).length ?? 0
})

export const narratedTraceContextMarkdown = computed(() =>
  buildNarratedContextMarkdown(narratedTraceSession.value)
)

export async function openNarratedTraceRecord(sessionId: string) {
  if (narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused') {
    return false
  }
  const session = await readNarratedTraceRecord(sessionId)
  if (!session) return false
  stopClock()
  coalescedEvents.clear()
  narratedTraceSession.value = session
  narratedTraceElapsedMs.value = session.durationMs
  narratedTraceStatus.value = 'review'
  narratedTraceViewMode.value = 'timeline'
  schedulePersist()
  return true
}

export async function continueNarratedTraceRecord(sessionId: string) {
  if (narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused') {
    return false
  }
  const session = await readNarratedTraceRecord(sessionId)
  if (!session) return false
  stopClock()
  coalescedEvents.clear()
  narratedTraceSession.value = session
  narratedTraceElapsedMs.value = session.durationMs
  clockAccumulatedMs = session.durationMs
  narratedTraceError.value = null
  narratedTraceInterimText.value = ''
  narratedTraceStatus.value = 'recording'
  narratedTraceViewMode.value = 'timeline'
  startClock()
  schedulePersist()
  return true
}

export async function removeNarratedTraceRecord(sessionId: string) {
  const isCurrent = narratedTraceSession.value?.id === sessionId
  await deleteNarratedTraceRecord(sessionId)
  if (!isCurrent) return
  stopClock()
  coalescedEvents.clear()
  narratedTraceSession.value = null
  narratedTraceElapsedMs.value = 0
  narratedTraceStatus.value = 'idle'
  narratedTraceViewMode.value = 'history'
  await removeCacheEntry(CURRENT_SESSION_CACHE_KEY)
}

export async function restoreNarratedTraceSession() {
  if (narratedTraceSession.value) return
  const cached = await readCacheJson<NarratedTraceSession>(CURRENT_SESSION_CACHE_KEY)
  if (narratedTraceSession.value) return
  if (!cached || !Array.isArray(cached.events) || !Array.isArray(cached.contextDraft)) return
  narratedTraceSession.value = cached
  narratedTraceElapsedMs.value = cached.durationMs
  narratedTraceStatus.value = 'review'
  void saveNarratedTraceRecord(cached)
}

async function restoreNarratedTraceState() {
  await loadNarratedTraceHistory()
  await restoreNarratedTraceSession()
}

void restoreNarratedTraceState()
