import type { Rect } from '@open-pencil/scene-graph/primitives'

import type { NarratedTraceContextEntry, NarratedTraceEvent, NarratedTraceSession } from './types'

const MAX_TARGET_PATH_PARTS = 5
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

function displayTargetPath(event: NarratedTraceEvent): string | null {
  const target = event.target
  if (!target) return null
  const collapsedPath = target.path.filter((part, index) => part !== target.path[index - 1])
  const visiblePath = collapsedPath.slice(-MAX_TARGET_PATH_PARTS)
  const prefix = collapsedPath.length > visiblePath.length ? '… / ' : ''
  return `${prefix}${visiblePath.join(' / ') || target.name}`
}

function targetLine(event: NarratedTraceEvent): string | null {
  const target = event.target
  if (!target) return null
  const path = displayTargetPath(event) ?? target.name
  return `- ${path} (${target.stableId})`
}

function timelineLine(session: NarratedTraceSession, event: NarratedTraceEvent): string {
  const text = eventText(session, event)
  const targetName = event.target?.name
  const targetSuffix =
    targetName && !text.toLowerCase().includes(targetName.toLowerCase()) ? ` — ${targetName}` : ''
  return `- ${formatNarratedTraceTime(event.atMs)} — ${text}${targetSuffix}`
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
    const before = change.before ?? 'unknown'
    const after = change.after ?? 'removed'
    return [`- ${target}.${change.property}: ${before} -> ${after}`]
  })
}

function roundedRect(rect: Rect): string {
  return `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
}

function evidenceLine(event: NarratedTraceEvent): string | null {
  const evidence = event.evidence
  if (!evidence) return null

  const targetPath = evidence.targetPath?.join(' / ')
  const target = targetPath || event.target?.name || 'Canvas'
  const targetId = evidence.targetStableId || event.target?.stableId
  const annotationPoints = Array.isArray(evidence.annotation?.points)
    ? evidence.annotation.points
    : []
  let annotation = 'visual annotation'
  if (evidence.annotation?.kind === 'focus') {
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

  return `- ${formatNarratedTraceTime(event.atMs)} — ${annotation} on ${target}${targetId ? ` (${targetId})` : ''}; evidence ${evidence.evidenceId}; crop ${roundedRect(evidence.cropBounds)}; ${evidence.width}x${evidence.height} PNG${omissions}`
}

export function buildNarratedContextMarkdown(session: NarratedTraceSession | null): string {
  if (!session) return '# OpenPencil Narrated Context\n\nNo narrated context was recorded.'

  const events = includedEvents(session)
  const targetLines = Array.from(
    new Set(events.map(targetLine).filter((line): line is string => line !== null))
  )
  const exactChanges = events.flatMap(changeLines)
  const evidenceLines = events.map(evidenceLine).filter((line): line is string => line !== null)
  const reviewFlags = events.flatMap((event) => {
    const text = eventText(session, event)
    if (event.kind !== 'transcript' || !CANCELLATION_PATTERN.test(text)) return []
    return [`- ${formatNarratedTraceTime(event.atMs)} — Possible cancellation: “${text}”`]
  })
  const notes = events.flatMap((event) => {
    const note = contextEntryFor(session, event.id)?.note?.trim()
    return note ? [`- ${formatNarratedTraceTime(event.atMs)} — ${note}`] : []
  })

  const sections = [
    '# OpenPencil Narrated Context',
    '',
    ...(session.title?.trim() ? [`Trace: ${session.title.trim()}`] : []),
    `Session started: ${session.startedAt}`,
    `Duration: ${formatNarratedTraceTime(session.durationMs)}`,
    '',
    '## Relevant targets',
    ...(targetLines.length > 0 ? targetLines : ['- No semantic targets were included.']),
    '',
    '## Timeline',
    ...(events.length > 0
      ? events.map((event) => timelineLine(session, event))
      : ['- No timeline entries were included.']),
    ...(reviewFlags.length > 0 ? ['', '## Review flags', ...reviewFlags] : []),
    ...(evidenceLines.length > 0
      ? [
          '',
          '## Visual evidence',
          ...evidenceLines,
          '- Image crops remain in the local Narrated Trace session; attach them separately when pixel inspection is needed.'
        ]
      : []),
    '',
    '## Exact changes',
    ...(exactChanges.length > 0 ? exactChanges : ['- No exact changes were included.'])
  ]

  if (notes.length > 0) sections.push('', '## Clarifications', ...notes)

  return `${sections.join('\n')}\n`
}
