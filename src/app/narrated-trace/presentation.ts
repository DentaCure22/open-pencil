import { narratedTracePointsPath } from './annotation'
import type { NarratedTraceEvent, NarratedTraceEventKind, NarratedTraceRow } from './types'

const SUPPORTING_EVENT_KINDS = new Set<NarratedTraceEventKind>([
  'selection',
  'sync',
  'tool',
  'viewport'
])

export function isNarratedTraceSupportingEvent(event: NarratedTraceEvent): boolean {
  return SUPPORTING_EVENT_KINDS.has(event.kind)
}

function targetName(event: NarratedTraceEvent, fallback: string) {
  return event.target?.name.trim() || fallback
}

function outcomePhrase(event: NarratedTraceEvent) {
  switch (event.kind) {
    case 'shape':
      return `Created ${targetName(event, 'a canvas object')}`
    case 'ink':
      return 'Marked the intended revision'
    case 'screenshot':
      return `Highlighted ${targetName(event, 'a canvas area')}`
    case 'edit':
      return `Updated ${targetName(event, 'the design')}`
    case 'navigation':
      return `Opened ${targetName(event, 'a view')}`
    case 'transcript':
      return 'Captured the spoken intent'
    case 'note':
      return 'Added a clarification'
    case 'undo':
      return 'Undid a change'
    case 'redo':
      return 'Restored a change'
    default:
      return event.label.trim()
  }
}

function lowerFirst(value: string) {
  return value.charAt(0).toLocaleLowerCase() + value.slice(1)
}

export function buildNarratedTraceReviewSummary(events: NarratedTraceEvent[]): string {
  const outcomes = events
    .filter((event) => !isNarratedTraceSupportingEvent(event))
    .map(outcomePhrase)
  const first = outcomes[0]
  if (!first) return 'No key moments yet.'
  const second = outcomes[1]
  if (!second) return `${first}.`
  if (outcomes.length === 2) return `${first} and ${lowerFirst(second)}.`
  return `${first}, ${lowerFirst(second)}, and ${outcomes.length - 2} more key ${
    outcomes.length - 2 === 1 ? 'moment' : 'moments'
  }.`
}

export function narratedTraceEvidenceAnnotationPath(row: NarratedTraceRow): string {
  const evidence = row.event.evidence
  if (!evidence || !Array.isArray(evidence.annotation.points)) return ''
  if (evidence.annotation.points.length === 1) {
    const point = evidence.annotation.points[0]
    const x = point.x - evidence.cropBounds.x
    const y = point.y - evidence.cropBounds.y
    const radius = Math.max(3, evidence.annotation.strokeWidth * 2)
    return [
      `M ${(x - radius).toFixed(2)} ${y.toFixed(2)}`,
      `a ${radius} ${radius} 0 1 0 ${radius * 2} 0`,
      `a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`
    ].join(' ')
  }
  return narratedTracePointsPath(evidence.annotation.points, {
    x: evidence.cropBounds.x,
    y: evidence.cropBounds.y
  })
}
