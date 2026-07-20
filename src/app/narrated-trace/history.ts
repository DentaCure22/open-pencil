import { shallowRef } from 'vue'

import { readCacheJson, removeCacheEntry, removeCachePrefix, writeCacheJson } from '@/app/cache'

import type { NarratedTraceSession } from './types'

const HISTORY_INDEX_CACHE_KEY = 'narrated-trace/history-index'
const SESSION_CACHE_PREFIX = 'narrated-trace/sessions/'
const EVIDENCE_CACHE_PREFIX = 'narrated-trace/evidence/'
const DEFAULT_TITLE_MAX_LENGTH = 56

export type NarratedTraceRecordSummary = {
  durationMs: number
  eventCount: number
  evidenceCount: number
  id: string
  startedAt: string
  title: string
  updatedAt: string
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
  return {
    durationMs: session.durationMs,
    eventCount: session.events.length,
    evidenceCount: session.events.filter((event) => event.evidence).length,
    id: session.id,
    startedAt: session.startedAt,
    title:
      compactNarratedTraceTitle(session.title ?? '') ||
      existingTitle?.trim() ||
      suggestedTitle(session),
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
