import type { NarratedTraceContextEntry, NarratedTraceEvent, NarratedTraceSession } from './types'

const BULK_MUTATION_WINDOW_MS = 1000
const MIN_BULK_EVENT_COUNT = 12
const MIN_BULK_TARGET_COUNT = 8

function contextEntryFor(
  entries: Map<string, NarratedTraceContextEntry>,
  event: NarratedTraceEvent
) {
  return entries.get(event.id)
}

function isCuratedEntry(entry: NarratedTraceContextEntry | undefined) {
  return Boolean(entry?.editedText?.trim() || entry?.note?.trim())
}

function isBulkMutationCandidate(
  event: NarratedTraceEvent,
  entry: NarratedTraceContextEntry | undefined
) {
  if (isCuratedEntry(entry) || event.evidence || event.ink) return false
  if (event.kind === 'sync') {
    return Boolean(event.groupedEventCount && event.groupedTargetCount)
  }
  return (event.kind === 'edit' || event.kind === 'shape') && Boolean(event.target?.stableId)
}

function groupedEventCount(event: NarratedTraceEvent) {
  return event.groupedEventCount ?? 1
}

function groupedTargetCount(event: NarratedTraceEvent) {
  return event.groupedTargetCount ?? (event.target?.stableId ? 1 : 0)
}

function summaryLabel(eventCount: number, targetCount: number) {
  return `Grouped ${eventCount} canvas changes across ${targetCount} layers`
}

function groupCounts(events: NarratedTraceEvent[]) {
  const directTargetIds = new Set(
    events.flatMap((event) => (event.target?.stableId ? [event.target.stableId] : []))
  )
  return {
    eventCount: events.reduce((sum, event) => sum + groupedEventCount(event), 0),
    targetCount:
      directTargetIds.size +
      events.reduce(
        (sum, event) => sum + (event.kind === 'sync' ? groupedTargetCount(event) : 0),
        0
      )
  }
}

function compactGroup(events: NarratedTraceEvent[]): NarratedTraceEvent {
  const first = events[0]
  const last = events.at(-1) ?? first
  const { eventCount, targetCount } = groupCounts(events)
  return {
    atMs: first.atMs,
    durationMs: Math.max(0, last.atMs - first.atMs),
    groupedEventCount: eventCount,
    groupedTargetCount: targetCount,
    id: first.id,
    kind: 'sync',
    label: summaryLabel(eventCount, targetCount)
  }
}

function shouldCompactGroup(events: NarratedTraceEvent[]) {
  const { eventCount, targetCount } = groupCounts(events)
  return eventCount >= MIN_BULK_EVENT_COUNT && targetCount >= MIN_BULK_TARGET_COUNT
}

function compactEvents(
  events: NarratedTraceEvent[],
  entries: Map<string, NarratedTraceContextEntry>
) {
  const compacted: NarratedTraceEvent[] = []
  const groups = new Map<string, NarratedTraceEvent[]>()
  let changed = false

  for (let index = 0; index < events.length; ) {
    const first = events[index]
    if (!isBulkMutationCandidate(first, contextEntryFor(entries, first))) {
      compacted.push(first)
      index += 1
      continue
    }

    const group = [first]
    let cursor = index + 1
    while (cursor < events.length) {
      const event = events[cursor]
      if (
        event.atMs - first.atMs > BULK_MUTATION_WINDOW_MS ||
        !isBulkMutationCandidate(event, contextEntryFor(entries, event))
      ) {
        break
      }
      group.push(event)
      cursor += 1
    }

    if (shouldCompactGroup(group)) {
      const summary = compactGroup(group)
      compacted.push(summary)
      groups.set(summary.id, group)
      changed = changed || group.length > 1 || first.kind !== 'sync'
      index = cursor
      continue
    }

    compacted.push(first)
    index += 1
  }

  return { changed, compacted, groups }
}

function compactContextDraft(
  events: NarratedTraceEvent[],
  entries: Map<string, NarratedTraceContextEntry>,
  groups: Map<string, NarratedTraceEvent[]>
) {
  return events.map((event) => {
    const group = groups.get(event.id)
    if (!group) {
      return (
        entries.get(event.id) ?? {
          included: true,
          removed: false,
          sourceEventId: event.id
        }
      )
    }

    const groupedEntries = group.flatMap((item) => {
      const entry = entries.get(item.id)
      return entry ? [entry] : []
    })
    const included = groupedEntries.some((entry) => entry.included && !entry.removed)
    return {
      included,
      removed: !included,
      sourceEventId: event.id
    }
  })
}

/** Collapse generated refreshes, imports, and batch edits into intent-level background events. */
export function compactNarratedTraceSession(session: NarratedTraceSession): NarratedTraceSession {
  const entries = new Map(session.contextDraft.map((entry) => [entry.sourceEventId, entry]))
  const result = compactEvents(session.events, entries)
  if (!result.changed) return session
  return {
    ...session,
    contextDraft: compactContextDraft(result.compacted, entries, result.groups),
    events: result.compacted
  }
}
