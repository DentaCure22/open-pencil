import { shallowRef } from 'vue'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { readCacheJson, removeCacheEntry, removeCachePrefix, writeCacheJson } from '@/app/cache'

import type {
  NarratedTraceContextEntry,
  NarratedTraceEvent,
  NarratedTraceScope,
  NarratedTraceSession
} from './types'

const HISTORY_INDEX_CACHE_KEY = 'narrated-trace/history-index'
const SESSION_CACHE_PREFIX = 'narrated-trace/sessions/'
const EVIDENCE_CACHE_PREFIX = 'narrated-trace/evidence/'
const DEFAULT_TITLE_MAX_LENGTH = 56
const DEFAULT_ACTIVITY_ITEM_LIMIT = 80
const DEFAULT_ACTIVITY_SESSION_LIMIT = 24

export type NarratedTraceRecordSummary = {
  bounds?: Rect
  durationMs: number
  eventCount: number
  evidenceCount: number
  id: string
  scope?: NarratedTraceScope
  searchTerms?: string[]
  startedAt: string
  targetIds?: string[]
  title: string
  updatedAt: string
}

export type NarratedTraceActivityItem = {
  context: NarratedTraceContextEntry
  event: NarratedTraceEvent
  occurredAtMs: number
  scope?: NarratedTraceScope
  sessionId: string
  sessionStartedAt: string
  title: string
}

export type NarratedTraceActivityFeedOptions = {
  itemLimit?: number
  sessionLimit?: number
}

export const narratedTraceHistory = shallowRef<NarratedTraceRecordSummary[]>([])
export const narratedTraceHistoryLoaded = shallowRef(false)

function sessionCacheKey(sessionId: string) {
  return `${SESSION_CACHE_PREFIX}${encodeURIComponent(sessionId)}`
}

function evidenceCachePrefix(sessionId: string) {
  return `${EVIDENCE_CACHE_PREFIX}${encodeURIComponent(sessionId)}/`
}

export function compactNarratedTraceTitle(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= DEFAULT_TITLE_MAX_LENGTH) return compact
  return `${compact.slice(0, DEFAULT_TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

function fallbackTitle(startedAt: string) {
  const date = new Date(startedAt)
  if (Number.isNaN(date.getTime())) return 'Narrated session'
  return `Session · ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)}`
}

function suggestedTitle(session: NarratedTraceSession) {
  const firstTranscript = session.events.find(
    (event) => event.kind === 'transcript' && (event.text?.trim() || event.label.trim())
  )
  const title = firstTranscript?.text?.trim() || firstTranscript?.label.trim()
  return title ? compactNarratedTraceTitle(title) : fallbackTitle(session.startedAt)
}

function isRecordSummary(value: unknown): value is NarratedTraceRecordSummary {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<NarratedTraceRecordSummary>
  return (
    typeof record.durationMs === 'number' &&
    typeof record.eventCount === 'number' &&
    typeof record.evidenceCount === 'number' &&
    typeof record.id === 'string' &&
    typeof record.startedAt === 'string' &&
    typeof record.title === 'string' &&
    typeof record.updatedAt === 'string'
  )
}

function summarySearchTerms(session: NarratedTraceSession, title: string): string[] {
  const values = [
    title,
    ...session.events.flatMap((event) => [
      event.label,
      event.text ?? '',
      event.target?.name ?? '',
      ...(event.target?.path ?? []),
      ...(event.changes?.map((change) => change.property) ?? [])
    ])
  ]
  return [
    ...new Set(
      values
        .join(' ')
        .toLowerCase()
        .match(/[\p{L}\p{N}_.:-]+/gu)
        ?.filter((term) => term.length > 1)
    )
  ].slice(0, 64)
}

function summaryBounds(session: NarratedTraceSession): Rect | undefined {
  const bounds = session.events.flatMap((event) => {
    const bounds = event.anchor?.pageRegion ?? event.target?.bounds
    return bounds ? [bounds] : []
  })
  if (bounds.length === 0) return undefined
  const minX = Math.min(...bounds.map((rect) => rect.x))
  const minY = Math.min(...bounds.map((rect) => rect.y))
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width))
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height))
  return { height: maxY - minY, width: maxX - minX, x: minX, y: minY }
}

function isSession(value: unknown): value is NarratedTraceSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<NarratedTraceSession>
  return (
    typeof session.id === 'string' &&
    typeof session.startedAt === 'string' &&
    typeof session.durationMs === 'number' &&
    Array.isArray(session.contextDraft) &&
    Array.isArray(session.events)
  )
}

export function sortNarratedTraceRecords(
  records: NarratedTraceRecordSummary[]
): NarratedTraceRecordSummary[] {
  return [...records].sort(
    (first, second) => Date.parse(second.startedAt) - Date.parse(first.startedAt)
  )
}

export function summarizeNarratedTraceSession(
  session: NarratedTraceSession,
  existingTitle?: string,
  updatedAt = new Date().toISOString()
): NarratedTraceRecordSummary {
  const title =
    compactNarratedTraceTitle(session.title ?? '') ||
    existingTitle?.trim() ||
    suggestedTitle(session)
  const bounds = summaryBounds(session)
  const targetIds = [
    ...new Set(
      session.events.flatMap((event) => (event.target?.stableId ? [event.target.stableId] : []))
    )
  ].slice(0, 32)
  return {
    ...(bounds ? { bounds } : {}),
    durationMs: session.durationMs,
    eventCount: session.events.length,
    evidenceCount: session.events.filter((event) => event.evidence).length,
    id: session.id,
    ...(session.scope ? { scope: structuredClone(session.scope) } : {}),
    searchTerms: summarySearchTerms(session, title),
    startedAt: session.startedAt,
    ...(targetIds.length > 0 ? { targetIds } : {}),
    title,
    updatedAt
  }
}

export function upsertNarratedTraceRecordSummary(
  records: NarratedTraceRecordSummary[],
  summary: NarratedTraceRecordSummary
): NarratedTraceRecordSummary[] {
  return sortNarratedTraceRecords([
    summary,
    ...records.filter((record) => record.id !== summary.id)
  ])
}

async function readHistoryIndex() {
  const cached = await readCacheJson<unknown>(HISTORY_INDEX_CACHE_KEY)
  if (!Array.isArray(cached)) return []
  return sortNarratedTraceRecords(cached.filter(isRecordSummary))
}

async function persistHistoryIndex(records: NarratedTraceRecordSummary[]) {
  narratedTraceHistory.value = sortNarratedTraceRecords(records)
  await writeCacheJson(HISTORY_INDEX_CACHE_KEY, narratedTraceHistory.value)
}

export async function loadNarratedTraceHistory() {
  narratedTraceHistory.value = await readHistoryIndex()
  narratedTraceHistoryLoaded.value = true
  return narratedTraceHistory.value
}

export async function saveNarratedTraceRecord(session: NarratedTraceSession) {
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await readHistoryIndex()
  const existing = records.find((record) => record.id === session.id)
  const summary = summarizeNarratedTraceSession(session, existing?.title)

  await writeCacheJson(sessionCacheKey(session.id), {
    ...session,
    title: summary.title
  })
  await persistHistoryIndex(upsertNarratedTraceRecordSummary(records, summary))
  narratedTraceHistoryLoaded.value = true
  return summary
}

export async function readNarratedTraceRecord(sessionId: string) {
  const cached = await readCacheJson<unknown>(sessionCacheKey(sessionId))
  return isSession(cached) ? cached : null
}

export function buildNarratedTraceActivityFeed(
  sessions: Array<{ session: NarratedTraceSession; title: string }>,
  itemLimit = DEFAULT_ACTIVITY_ITEM_LIMIT
): NarratedTraceActivityItem[] {
  return sessions
    .flatMap(({ session, title }) => {
      const startedAtMs = Date.parse(session.startedAt)
      return session.events.map((event) => {
        const context = session.contextDraft.find((entry) => entry.sourceEventId === event.id) ?? {
          included: true,
          removed: false,
          sourceEventId: event.id
        }
        return {
          context,
          event,
          occurredAtMs: (Number.isNaN(startedAtMs) ? 0 : startedAtMs) + event.atMs,
          ...(session.scope ? { scope: structuredClone(session.scope) } : {}),
          sessionId: session.id,
          sessionStartedAt: session.startedAt,
          title
        }
      })
    })
    .sort(
      (first, second) =>
        second.occurredAtMs - first.occurredAtMs ||
        second.event.atMs - first.event.atMs ||
        first.event.id.localeCompare(second.event.id)
    )
    .slice(0, Math.max(1, itemLimit))
}

export async function loadNarratedTraceActivityFeed(
  options: NarratedTraceActivityFeedOptions = {}
): Promise<NarratedTraceActivityItem[]> {
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await loadNarratedTraceHistory()
  const sessionLimit = Math.max(
    1,
    Math.min(options.sessionLimit ?? DEFAULT_ACTIVITY_SESSION_LIMIT, DEFAULT_ACTIVITY_SESSION_LIMIT)
  )
  const sessions = await Promise.all(
    records.slice(0, sessionLimit).map(async (record) => {
      const session = await readNarratedTraceRecord(record.id)
      return session ? { session, title: record.title } : null
    })
  )
  return buildNarratedTraceActivityFeed(
    sessions.filter(
      (entry): entry is { session: NarratedTraceSession; title: string } => entry !== null
    ),
    Math.min(options.itemLimit ?? DEFAULT_ACTIVITY_ITEM_LIMIT, DEFAULT_ACTIVITY_ITEM_LIMIT)
  )
}

export async function renameNarratedTraceRecord(sessionId: string, title: string) {
  const compact = compactNarratedTraceTitle(title)
  if (!compact) return false
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await readHistoryIndex()
  if (!records.some((record) => record.id === sessionId)) return false
  await persistHistoryIndex(
    records.map((record) =>
      record.id === sessionId
        ? { ...record, title: compact, updatedAt: new Date().toISOString() }
        : record
    )
  )
  const session = await readCacheJson<unknown>(sessionCacheKey(sessionId))
  if (isSession(session)) {
    await writeCacheJson(sessionCacheKey(sessionId), { ...session, title: compact })
  }
  narratedTraceHistoryLoaded.value = true
  return true
}

export async function deleteNarratedTraceRecord(sessionId: string) {
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await readHistoryIndex()
  await Promise.all([
    removeCacheEntry(sessionCacheKey(sessionId)),
    removeCachePrefix(evidenceCachePrefix(sessionId))
  ])
  await persistHistoryIndex(records.filter((record) => record.id !== sessionId))
  narratedTraceHistoryLoaded.value = true
}
