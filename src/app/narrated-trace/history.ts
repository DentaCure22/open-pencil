import { shallowRef } from 'vue'

import { normalizeTraceSessionTag, traceEventSearchValues } from '@open-pencil/core/rpc'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  deleteLocalWorkspaceTraceSession,
  persistLocalWorkspaceTraceSession,
  readLocalWorkspaceTraceActivityPage,
  readLocalWorkspaceTraceSession,
  readLocalWorkspaceTraceSessionSummaries
} from '@/app/workspace-document/local-authority/client'

import { persistedNarratedTraceGestures } from './persistence'
import type {
  NarratedTraceContextEntry,
  NarratedTraceEvent,
  NarratedTraceScope,
  NarratedTraceSession
} from './types'

const DEFAULT_TITLE_MAX_LENGTH = 56
const DEFAULT_ACTIVITY_ITEM_LIMIT = 80
const DEFAULT_ACTIVITY_SESSION_LIMIT = 24

export type NarratedTraceRecordSummary = {
  aliases?: string[]
  bounds?: Rect
  durationMs: number
  eventCount: number
  evidenceCount: number
  gestureCount?: number
  gestureIds?: string[]
  id: string
  latestGestureAt?: string
  scope?: NarratedTraceScope
  searchTerms?: string[]
  startedAt: string
  tag?: string
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

export type NarratedTraceActivityPage = {
  hasMore: boolean
  items: NarratedTraceActivityItem[]
  nextCursor: string | null
}

export const narratedTraceHistory = shallowRef<NarratedTraceRecordSummary[]>([])
export const narratedTraceHistoryLoaded = shallowRef(false)

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
    (record.tag === undefined || typeof record.tag === 'string') &&
    typeof record.startedAt === 'string' &&
    typeof record.title === 'string' &&
    typeof record.updatedAt === 'string'
  )
}

function summarySearchTerms(session: NarratedTraceSession, title: string): string[] {
  const values = [
    title,
    session.tag ?? '',
    ...(session.aliases ?? []),
    ...traceEventSearchValues(session.events)
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

function parseSession(value: unknown): NarratedTraceSession | null {
  if (!value || typeof value !== 'object') return null
  const session = value as Partial<NarratedTraceSession>
  if (
    typeof session.id !== 'string' ||
    typeof session.startedAt !== 'string' ||
    typeof session.durationMs !== 'number' ||
    !Array.isArray(session.events)
  ) {
    return null
  }
  const contextDraft = Array.isArray(session.contextDraft)
    ? session.contextDraft
    : session.events.map((event) => ({
        included: true,
        removed: false,
        sourceEventId: event.id
      }))
  return { ...session, contextDraft } as NarratedTraceSession
}

function activityItem(value: unknown): NarratedTraceActivityItem {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Local workspace authority returned an invalid Trace activity item')
  }
  const candidate = value as Partial<NarratedTraceActivityItem>
  const context = candidate.context
  const event = candidate.event
  if (
    !context ||
    typeof context.sourceEventId !== 'string' ||
    typeof context.included !== 'boolean' ||
    typeof context.removed !== 'boolean' ||
    !event ||
    typeof event.atMs !== 'number' ||
    typeof event.id !== 'string' ||
    typeof event.kind !== 'string' ||
    typeof event.label !== 'string' ||
    typeof candidate.occurredAtMs !== 'number' ||
    typeof candidate.sessionId !== 'string' ||
    typeof candidate.sessionStartedAt !== 'string' ||
    typeof candidate.title !== 'string'
  ) {
    throw new TypeError('Local workspace authority returned an invalid Trace activity item')
  }
  return structuredClone(candidate) as NarratedTraceActivityItem
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
  const gestureEvents = session.events.filter((event) => event.gesture)
  const startedAtMs = Date.parse(session.startedAt)
  const latestGesture = gestureEvents.at(-1)
  return {
    ...(session.aliases?.length ? { aliases: [...session.aliases] } : {}),
    ...(bounds ? { bounds } : {}),
    durationMs: session.durationMs,
    eventCount: session.events.length,
    evidenceCount: session.events.filter((event) => event.evidence).length,
    gestureCount: gestureEvents.length,
    ...(gestureEvents.length > 0 ? { gestureIds: gestureEvents.map((event) => event.id) } : {}),
    id: session.id,
    ...(latestGesture && !Number.isNaN(startedAtMs)
      ? {
          latestGestureAt: new Date(startedAtMs + latestGesture.atMs).toISOString()
        }
      : {}),
    ...(session.scope ? { scope: structuredClone(session.scope) } : {}),
    searchTerms: summarySearchTerms(session, title),
    startedAt: session.startedAt,
    ...(session.tag ? { tag: session.tag } : {}),
    ...(targetIds.length > 0 ? { targetIds } : {}),
    title,
    updatedAt
  }
}

export function uniqueNarratedTraceTag(seed: string, sessionId?: string) {
  const base = normalizeTraceSessionTag(seed) || 'session'
  const used = new Set(
    narratedTraceHistory.value.flatMap((record) =>
      record.id === sessionId
        ? []
        : [record.tag, ...(record.aliases ?? [])].flatMap((tag) =>
            tag ? [normalizeTraceSessionTag(tag)] : []
          )
    )
  )
  if (!used.has(base)) return base
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base.slice(0, Math.max(1, 39 - String(suffix).length))}-${String(suffix)}`
    if (!used.has(candidate)) return candidate
  }
  return `${base.slice(0, 31)}-${globalThis.crypto.randomUUID().slice(0, 8)}`
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
  const summaries = await readLocalWorkspaceTraceSessionSummaries()
  return sortNarratedTraceRecords(summaries.filter(isRecordSummary))
}

async function persistHistoryIndex(records: NarratedTraceRecordSummary[]) {
  narratedTraceHistory.value = sortNarratedTraceRecords(records)
}

export async function loadNarratedTraceHistory() {
  narratedTraceHistory.value = await readHistoryIndex()
  narratedTraceHistoryLoaded.value = true
  return narratedTraceHistory.value
}

export async function saveNarratedTraceRecord(
  session: NarratedTraceSession,
  spokenTurns?: unknown[]
) {
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await readHistoryIndex()
  const existing = records.find((record) => record.id === session.id)
  const summary = summarizeNarratedTraceSession(session, existing?.title)
  const persistedSession = {
    ...session,
    title: summary.title
  }
  await persistLocalWorkspaceTraceSession({
    gestures: persistedNarratedTraceGestures(persistedSession),
    session: persistedSession,
    ...(spokenTurns ? { spokenTurns } : {}),
    summary
  })
  await persistHistoryIndex(upsertNarratedTraceRecordSummary(records, summary))
  narratedTraceHistoryLoaded.value = true
  return summary
}

export async function readNarratedTraceRecord(sessionId: string) {
  const persisted = await readLocalWorkspaceTraceSession(sessionId)
  return parseSession(persisted)
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

export async function loadNarratedTraceActivityPage(
  input: { before?: string; itemLimit?: number } = {}
): Promise<NarratedTraceActivityPage> {
  const page = await readLocalWorkspaceTraceActivityPage({
    ...(input.before ? { before: input.before } : {}),
    limit: Math.min(input.itemLimit ?? DEFAULT_ACTIVITY_ITEM_LIMIT, DEFAULT_ACTIVITY_ITEM_LIMIT)
  })
  return {
    hasMore: page.hasMore,
    items: page.items.map(activityItem),
    nextCursor: page.nextCursor
  }
}

export async function renameNarratedTraceRecord(sessionId: string, title: string) {
  const compact = compactNarratedTraceTitle(title)
  if (!compact) return false
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await readHistoryIndex()
  if (!records.some((record) => record.id === sessionId)) return false
  const session = await readNarratedTraceRecord(sessionId)
  if (!session) return false
  await saveNarratedTraceRecord({ ...session, title: compact })
  narratedTraceHistoryLoaded.value = true
  return true
}

export async function deleteNarratedTraceRecord(sessionId: string) {
  const records = narratedTraceHistoryLoaded.value
    ? narratedTraceHistory.value
    : await readHistoryIndex()
  await deleteLocalWorkspaceTraceSession(sessionId)
  await persistHistoryIndex(records.filter((record) => record.id !== sessionId))
  narratedTraceHistoryLoaded.value = true
}
