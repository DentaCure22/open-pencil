import { useIntervalFn } from '@vueuse/core'
import { computed, ref, shallowRef } from 'vue'

import { compactNarratedTraceSession } from './compaction'
import { buildNarratedContextMarkdown } from './context'
import {
  compactNarratedTraceTitle,
  deleteNarratedTraceRecord,
  loadNarratedTraceHistory,
  narratedTraceHistory,
  narratedTraceHistoryLoaded,
  readNarratedTraceRecord,
  renameNarratedTraceRecord,
  saveNarratedTraceRecord,
  uniqueNarratedTraceTag
} from './history'
import type {
  NarratedTraceAppendOptions,
  NarratedTraceContextEntry,
  NarratedTraceEvidence,
  NarratedTraceEpisode,
  NarratedTraceEvent,
  NarratedTraceEventInput,
  NarratedTraceScope,
  NarratedTraceSession,
  NarratedTraceStatus
} from './types'

const DEFAULT_COALESCE_WINDOW_MS = 500
const PERSIST_DEBOUNCE_MS = 100

export const narratedTraceStatus = ref<NarratedTraceStatus>('idle')
export const narratedTraceElapsedMs = ref(0)
export const narratedTraceError = ref<string | null>(null)
export const narratedTraceInterimText = ref('')
export const narratedTraceSession = shallowRef<NarratedTraceSession | null>(null)

let clockStartedAt = 0
let persistTimer: ReturnType<typeof setTimeout> | null = null
const coalescedEvents = new Map<string, { eventId: string; updatedAtMs: number }>()

function monotonicNow(): number {
  return globalThis.performance.now()
}

function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function hasNarratedTraceSession() {
  return narratedTraceSession.value !== null
}

function updateClock() {
  if (narratedTraceStatus.value === 'recording') {
    narratedTraceElapsedMs.value = Math.round(monotonicNow() - clockStartedAt)
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
  const session = narratedTraceSession.value
  if (!session) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void saveNarratedTraceRecord(session).catch((error: unknown) => {
      console.warn(
        '[Narrated Trace] Canonical session persistence failed:',
        error instanceof Error ? error.message : error
      )
    })
  }, PERSIST_DEBOUNCE_MS)
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

function updateNarratedTraceEvent(
  eventId: string,
  update: (event: NarratedTraceEvent) => NarratedTraceEvent
): void {
  const session = narratedTraceSession.value
  if (!session || !session.events.some((event) => event.id === eventId)) return
  replaceSession({
    ...session,
    events: session.events.map((event) => (event.id === eventId ? update(event) : event))
  })
}

export function beginNarratedTraceSession(
  scope?: NarratedTraceScope,
  options: { tagSeed?: string; title?: string } = {}
) {
  stopClock()
  coalescedEvents.clear()
  narratedTraceElapsedMs.value = 0
  narratedTraceError.value = null
  narratedTraceInterimText.value = ''
  narratedTraceSession.value = {
    aliases: [],
    contextDraft: [],
    durationMs: 0,
    episodes: [],
    events: [],
    id: createId('trace'),
    scope: scope ? structuredClone(scope) : undefined,
    startedAt: new Date().toISOString(),
    tag: uniqueNarratedTraceTag(
      options.tagSeed ?? scope?.pageName ?? scope?.documentName ?? 'session'
    ),
    ...(options.title?.trim() ? { title: compactNarratedTraceTitle(options.title) } : {})
  }
  narratedTraceStatus.value = 'recording'
  startClock()
  schedulePersist()
}

export function beginNarratedTraceEpisode(
  input: Omit<NarratedTraceEpisode, 'startedAtMs'> & { startedAtMs?: number }
) {
  const session = narratedTraceSession.value
  if (!session || narratedTraceStatus.value !== 'recording') return null
  const existing = session.episodes?.find((episode) => episode.id === input.id)
  if (existing) return existing.id
  const episode: NarratedTraceEpisode = {
    ...structuredClone(input),
    startedAtMs: input.startedAtMs ?? narratedTraceElapsedMs.value
  }
  replaceSession({ ...session, episodes: [...(session.episodes ?? []), episode] })
  return episode.id
}

export function finishNarratedTraceEpisode(
  episodeId: string,
  endedAtMs = narratedTraceElapsedMs.value
) {
  const session = narratedTraceSession.value
  if (!session?.episodes?.some((episode) => episode.id === episodeId)) return false
  replaceSession({
    ...session,
    episodes: session.episodes.map((episode) =>
      episode.id === episodeId
        ? { ...episode, endedAtMs: Math.max(episode.startedAtMs, endedAtMs) }
        : episode
    )
  })
  return true
}

export function finishNarratedTraceSession() {
  if (narratedTraceStatus.value !== 'recording') return
  stopClock()
  const session = narratedTraceSession.value
  if (session) {
    narratedTraceSession.value = {
      ...session,
      durationMs: narratedTraceElapsedMs.value,
      episodes: session.episodes?.map((episode) =>
        episode.endedAtMs === undefined
          ? { ...episode, endedAtMs: narratedTraceElapsedMs.value }
          : episode
      )
    }
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
      const nextSession = {
        ...session,
        durationMs: Math.max(session.durationMs, atMs + Math.max(0, nextEvent.durationMs ?? 0)),
        events: session.events.map((event) => (event.id === existing.id ? nextEvent : event))
      }
      replaceSession(nextSession)
      coalescedEvents.set(coalesceKey, { eventId: existing.id, updatedAtMs: atMs })
      return existing.id
    }
  }

  const event: NarratedTraceEvent = {
    ...input,
    atMs,
    id: createId('event')
  }
  const nextSession = compactNarratedTraceSession({
    ...session,
    contextDraft: [
      ...session.contextDraft,
      { included: true, removed: false, sourceEventId: event.id }
    ],
    durationMs: Math.max(session.durationMs, atMs + Math.max(0, event.durationMs ?? 0)),
    events: [...session.events, event]
  })
  replaceSession(nextSession)
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
  updateNarratedTraceEvent(eventId, (event) => ({
    ...event,
    evidence,
    evidenceStatus: 'ready'
  }))
}

export function markNarratedTraceEvidenceFailed(eventId: string) {
  updateNarratedTraceEvent(eventId, (event) => ({ ...event, evidenceStatus: 'failed' }))
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

export function setNarratedTraceSessionTag(value: string) {
  const session = narratedTraceSession.value
  if (!session) return null
  const tag = uniqueNarratedTraceTag(value, session.id)
  const previous = session.tag
  if (previous === tag) return tag
  replaceSession({
    ...session,
    aliases: previous
      ? [...new Set([...(session.aliases ?? []), previous])].filter((alias) => alias !== tag)
      : (session.aliases ?? []),
    tag
  })
  return tag
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

async function loadNarratedTraceRecord(sessionId: string) {
  if (narratedTraceStatus.value === 'recording') return null
  const session = await readNarratedTraceRecord(sessionId)
  if (!session) return null
  stopClock()
  coalescedEvents.clear()
  const compacted = compactNarratedTraceSession(session)
  narratedTraceSession.value = compacted
  narratedTraceElapsedMs.value = compacted.durationMs
  return compacted
}

export async function openNarratedTraceRecord(sessionId: string) {
  const session = await loadNarratedTraceRecord(sessionId)
  if (!session) return false
  narratedTraceStatus.value = 'review'
  schedulePersist()
  return true
}

export async function removeNarratedTraceRecord(sessionId: string) {
  const isCurrent = narratedTraceSession.value?.id === sessionId
  await deleteNarratedTraceRecord(sessionId)
  if (!isCurrent) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = null
  stopClock()
  coalescedEvents.clear()
  narratedTraceSession.value = null
  narratedTraceElapsedMs.value = 0
  narratedTraceStatus.value = 'idle'
}

export async function restoreNarratedTraceSession() {
  if (hasNarratedTraceSession()) return
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await loadNarratedTraceHistory()
  if (records.length === 0) return
  const latest = records[0]
  const persisted = await readNarratedTraceRecord(latest.id)
  if (hasNarratedTraceSession() || !persisted) return
  const compacted = compactNarratedTraceSession(persisted)
  narratedTraceSession.value = compacted
  narratedTraceElapsedMs.value = compacted.durationMs
  narratedTraceStatus.value = 'review'
}

async function restoreNarratedTraceState() {
  await loadNarratedTraceHistory()
  await restoreNarratedTraceSession()
}

void restoreNarratedTraceState()
