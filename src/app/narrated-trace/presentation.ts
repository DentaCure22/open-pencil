import type { NarratedTraceEvent, NarratedTraceEventKind } from './types'

const SUPPORTING_EVENT_KINDS = new Set<NarratedTraceEventKind>(['selection', 'tool', 'viewport'])

export function isNarratedTraceSupportingEvent(event: NarratedTraceEvent): boolean {
  return SUPPORTING_EVENT_KINDS.has(event.kind)
}

function targetName(event: NarratedTraceEvent, fallback: string) {
  return event.target?.name?.trim() || fallback
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
