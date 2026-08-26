import type { Rect } from '@open-pencil/scene-graph/primitives'

import { compactNarratedTraceSession } from './compaction'
import type { NarratedTraceContextEntry, NarratedTraceEvent, NarratedTraceSession } from './types'

const MAX_TARGET_PATH_PARTS = 5
const MAX_CHANGE_VALUE_LENGTH = 180
const MAX_CONTEXT_BYTES = 32_768
const MAX_CONTEXT_FIELD_LENGTH = 360
const MAX_CONTEXT_LINES = 256
const MAX_EXACT_CHANGE_LINES = 80
const MAX_TARGET_LINES = 40
const MAX_TIMELINE_LINES = 120
const CANCELLATION_PATTERN =
  /\b(never mind|move it back|put it back|undo that|revert that|cancel that)\b/i

export function formatNarratedTraceTime(atMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(atMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function contextEntryFor(
  session: NarratedTraceSession,
  eventId: string
): NarratedTraceContextEntry | undefined {
  return session.contextDraft.find((entry) => entry.sourceEventId === eventId)
}

function includedEvents(session: NarratedTraceSession): NarratedTraceEvent[] {
  return session.events.filter((event) => {
    const entry = contextEntryFor(session, event.id)
    return entry?.included !== false && entry?.removed !== true
  })
}

function eventText(session: NarratedTraceSession, event: NarratedTraceEvent): string {
  const entry = contextEntryFor(session, event.id)
  return entry?.editedText?.trim() || event.text?.trim() || event.label
}

function compactContextField(value: string, maximum = MAX_CONTEXT_FIELD_LENGTH) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maximum) return compact
  return `${compact.slice(0, maximum - 1).trimEnd()}…`
}

function displayTargetPath(event: NarratedTraceEvent): string | null {
  const target = event.target
  if (!target) return null
  const collapsedPath = target.path.filter((part, index) => part !== target.path[index - 1])
  const visiblePath = collapsedPath.slice(-MAX_TARGET_PATH_PARTS)
  const prefix = collapsedPath.length > visiblePath.length ? '… / ' : ''
  return compactContextField(`${prefix}${visiblePath.join(' / ') || target.name}`)
}

function targetLine(event: NarratedTraceEvent): string | null {
  const target = event.target
  if (!target) return null
  const path = displayTargetPath(event) ?? target.name
  return `- ${path} (${compactContextField(target.stableId)})`
}

function timelineLine(session: NarratedTraceSession, event: NarratedTraceEvent): string {
  const text = compactContextField(eventText(session, event))
  const reference = event.origin?.reference ? `${event.origin.reference} — ` : ''
  const targetName = event.target?.name
  const targetSuffix =
    targetName && !text.toLowerCase().includes(targetName.toLowerCase()) ? ` — ${targetName}` : ''
  return `- ${formatNarratedTraceTime(event.atMs)} — ${reference}${text}${targetSuffix}`
}

function episodeLine(session: NarratedTraceSession, episodeIndex: number) {
  const episode = session.episodes?.[episodeIndex]
  if (!episode) return null
  const label = episode.label?.trim() || `${episode.kind} activity`
  const duration =
    episode.endedAtMs === undefined
      ? 'active'
      : formatNarratedTraceTime(Math.max(0, episode.endedAtMs - episode.startedAtMs))
  return `- ${episode.kind} — ${compactContextField(label)} — ${duration}`
}

function isMeaningfulChange(event: NarratedTraceEvent, changeIndex: number): boolean {
  const change = event.changes?.[changeIndex]
  if (!change || change.property === 'pluginData') return false
  const before = change.before?.trim()
  const after = change.after?.trim()
  if (before === after) return false
  return Boolean(before || after)
}

function changeLines(event: NarratedTraceEvent): string[] {
  const target = displayTargetPath(event) ?? event.target?.name ?? 'Canvas'
  return (event.changes ?? []).flatMap((change, index) => {
    if (!isMeaningfulChange(event, index)) return []
    const before = compactChangeValue(change.before ?? 'unknown')
    const after = compactChangeValue(change.after ?? 'removed')
    return [`- ${target}.${change.property}: ${before} -> ${after}`]
  })
}

function compactChangeValue(value: string) {
  return compactContextField(value, MAX_CHANGE_VALUE_LENGTH)
}

function boundedLines(lines: string[], maximum: number, noun: string) {
  if (lines.length <= maximum) return lines
  const omitted = lines.length - maximum
  return [
    ...lines.slice(0, maximum),
    `- … ${omitted} additional ${noun}${omitted === 1 ? '' : 's'} omitted.`
  ]
}

function roundedRect(rect: Rect): string {
  return `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
}

function evidenceLine(event: NarratedTraceEvent): string | null {
  const evidence = event.evidence
  if (!evidence) return null

  const targetPath = evidence.targetPath?.join(' / ')
  const target = compactContextField(targetPath || event.target?.name || 'Canvas')
  const targetId = compactContextField(evidence.targetStableId || event.target?.stableId || '')
  const annotationPoints = Array.isArray(evidence.annotation.points)
    ? evidence.annotation.points
    : []
  let annotation = 'visual annotation'
  if (evidence.annotation.kind === 'focus') {
    annotation =
      annotationPoints.length > 0
        ? `focus trail with ${annotationPoints.length} points`
        : 'focus marker'
  } else if (annotationPoints.length > 0) {
    annotation = `ink stroke with ${annotationPoints.length} points`
  }
  const omissions =
    evidence.omissions.length > 0
      ? `; ${evidence.omissions.length} privacy region${evidence.omissions.length === 1 ? '' : 's'} omitted`
      : ''
  const anchor = event.anchor
    ? `; page ${Math.round(event.anchor.pagePoint.x)},${Math.round(event.anchor.pagePoint.y)}; region ${roundedRect(event.anchor.pageRegion)}${
        event.anchor.targetRelativePoint
          ? `; target-relative ${event.anchor.targetRelativePoint.x.toFixed(3)},${event.anchor.targetRelativePoint.y.toFixed(3)}`
          : ''
      }`
    : ''

  return `- ${formatNarratedTraceTime(event.atMs)} — ${annotation} on ${target}${targetId ? ` (${targetId})` : ''}; evidence ${compactContextField(evidence.evidenceId)}; crop ${roundedRect(evidence.cropBounds)}; ${evidence.width}x${evidence.height} PNG${anchor}${omissions}`
}

function finalizeContextMarkdown(lines: string[]) {
  const encoder = new TextEncoder()
  const marker = '- … Additional context omitted to keep this clipboard handoff focused.'
  const output = [...lines]
  let truncated = false
  while (output.length > MAX_CONTEXT_LINES - 2) {
    output.pop()
    truncated = true
  }
  const fitsByteBudget = () =>
    encoder.encode(`${[...output, ...(truncated ? ['', marker] : [])].join('\n')}\n`).byteLength <=
    MAX_CONTEXT_BYTES
  while (output.length > 1 && !fitsByteBudget()) {
    output.pop()
    truncated = true
  }
  return `${[...output, ...(truncated ? ['', marker] : [])].join('\n')}\n`
}

export function buildNarratedContextMarkdown(session: NarratedTraceSession | null): string {
  if (!session) return '# OpenPencil Narrated Context\n\nNo narrated context was recorded.'

  const compactedSession = compactNarratedTraceSession(session)
  const events = includedEvents(compactedSession)
  const targetLines = boundedLines(
    Array.from(new Set(events.map(targetLine).filter((line): line is string => line !== null))),
    MAX_TARGET_LINES,
    'target'
  )
  const exactChanges = boundedLines(
    events.flatMap(changeLines),
    MAX_EXACT_CHANGE_LINES,
    'exact change'
  )
  const timelineLines = boundedLines(
    events.map((event) => timelineLine(compactedSession, event)),
    MAX_TIMELINE_LINES,
    'timeline moment'
  )
  const evidenceLines = events.map(evidenceLine).filter((line): line is string => line !== null)
  const episodeLines = (session.episodes ?? [])
    .map((_, index) => episodeLine(session, index))
    .filter((line): line is string => line !== null)
  const reviewFlags = events.flatMap((event) => {
    const text = eventText(compactedSession, event)
    if (event.kind !== 'transcript' || !CANCELLATION_PATTERN.test(text)) return []
    return [`- ${formatNarratedTraceTime(event.atMs)} — Possible cancellation: “${text}”`]
  })
  const notes = events.flatMap((event) => {
    const note = contextEntryFor(compactedSession, event.id)?.note?.trim()
    return note ? [`- ${formatNarratedTraceTime(event.atMs)} — ${compactContextField(note)}`] : []
  })

  const sections = [
    '# OpenPencil Narrated Context',
    '',
    ...(session.title?.trim() ? [`Trace: ${compactContextField(session.title)}`] : []),
    ...(session.tag ? [`Session tag: #${session.tag}`] : []),
    `Session started: ${session.startedAt}`,
    `Duration: ${formatNarratedTraceTime(session.durationMs)}`,
    ...(episodeLines.length > 0 ? ['', '## Episodes', ...episodeLines] : []),
    '',
    '## Relevant targets',
    ...(targetLines.length > 0 ? targetLines : ['- No semantic targets were included.']),
    '',
    '## Timeline',
    ...(events.length > 0 ? timelineLines : ['- No timeline entries were included.']),
    ...(reviewFlags.length > 0 ? ['', '## Review flags', ...reviewFlags] : []),
    ...(evidenceLines.length > 0
      ? [
          '',
          '## Visual evidence',
          ...evidenceLines,
          '- Image crops remain in the local Narrated Trace session; attach them separately when pixel inspection is needed.'
        ]
      : []),
    ...(notes.length > 0 ? ['', '## Clarifications', ...notes] : []),
    '',
    '## Exact changes',
    ...(exactChanges.length > 0 ? exactChanges : ['- No exact changes were included.'])
  ]

  return finalizeContextMarkdown(sections)
}
