/*
 * Adapted from T3 Code's MessagesTimeline row derivation at
 * 5d7665396083d285132d67038813862a93337ca5 (MIT, T3 Tools Inc.).
 *
 * OpenPencil's provider-neutral transcript has a smaller event model, but the
 * timeline contract is intentionally the same: chronological narrative and
 * work, one visible item per adjacent work run, overflow inserted above its
 * anchor, a settled turn fold, and the working row at the live bottom.
 */
import {
  formatElapsedDuration,
  isMediaGenerationTool,
  isRetiredMemoryTool,
  messageParts,
  resolveCommentaryActivityState,
  resolveToolActivityState,
  toolCallKind,
  type AiToolKind
} from './model'
import type { AiConversationStatus, AiMessage, AiMessagePart, AiToolState } from './types'

export const MAX_VISIBLE_WORK_LOG_ENTRIES = 1

type NarrativePart = Extract<AiMessagePart, { type: 'commentary' | 'reasoning' }>
export type T3ToolPart = Extract<AiMessagePart, { type: 'tool' }>
export type T3RenderedToolState = AiToolState | 'stopped'
export type T3ToolGroupSummaryKind = AiToolKind | 'mixed'

export type T3TimelineNarrativeEntry = {
  createdAt: string
  id: string
  kind: 'message'
  narrativeKind: NarrativePart['type']
  state: 'complete' | 'stopped' | 'streaming'
  text: string
}

export type T3TimelineWorkEntry = {
  createdAt: string
  id: string
  kind: 'work'
  part: T3ToolPart
  state: T3RenderedToolState
}

export type T3TimelineEntry = T3TimelineNarrativeEntry | T3TimelineWorkEntry

export type T3MessagesTimelineRow =
  | {
      createdAt: string
      groupedEntries: T3TimelineWorkEntry[]
      id: string
      isExpandedToolGroupEntry: boolean
      kind: 'work'
    }
  | {
      createdAt: string
      entry: T3TimelineWorkEntry
      expanded: boolean
      groupedEntries: T3TimelineWorkEntry[]
      groupId: string
      id: string
      kind: 'work-live'
    }
  | {
      createdAt: string
      expanded: boolean
      groupId: string
      hasFailure: boolean
      hiddenCount: number
      id: string
      kind: 'work-toggle'
      onlyToolEntries: true
      summary: string
      summaryKind: T3ToolGroupSummaryKind
    }
  | {
      createdAt: string
      id: string
      kind: 'message'
      message: T3TimelineNarrativeEntry
    }
  | {
      createdAt: string | null
      id: 'working-indicator-row'
      kind: 'working'
      live: boolean
      prefix: string
      stepLabel?: string
    }
  | {
      createdAt: string | null
      expanded: boolean
      id: 'turn-fold-row'
      kind: 'turn-fold'
      label: string
    }

export interface StableT3MessagesTimelineRowsState {
  byId: Map<string, T3MessagesTimelineRow>
  result: T3MessagesTimelineRow[]
}

function narrativeState(input: {
  index: number
  part: NarrativePart
  status: AiConversationStatus
  total: number
}): 'complete' | 'stopped' | 'streaming' {
  return resolveCommentaryActivityState(input.part.state, input.index, input.total, input.status)
}

export function deriveT3TimelineEntries(
  messages: readonly AiMessage[],
  status: AiConversationStatus
): T3TimelineEntry[] {
  const candidates: Array<{
    createdAt: string
    id: string
    part: NarrativePart | T3ToolPart
  }> = []
  for (const message of messages) {
    for (const [partIndex, part] of messageParts(message).entries()) {
      if (
        (part.type === 'commentary' || part.type === 'reasoning') &&
        part.text.trim().length > 0
      ) {
        candidates.push({
          createdAt: message.createdAt,
          id: `${message.id}:${String(partIndex)}`,
          part
        })
        continue
      }
      if (
        part.type === 'tool' &&
        !isRetiredMemoryTool(part.name) &&
        !isMediaGenerationTool(part.name, part.input)
      ) {
        candidates.push({
          createdAt: message.createdAt,
          id: `${message.id}:${String(partIndex)}`,
          part
        })
      }
    }
  }

  return candidates.map((candidate, index): T3TimelineEntry => {
    if (candidate.part.type === 'tool') {
      return {
        createdAt: candidate.createdAt,
        id: candidate.id,
        kind: 'work',
        part: candidate.part,
        state: resolveToolActivityState(candidate.part.state, index, candidates.length, status)
      }
    }
    return {
      createdAt: candidate.createdAt,
      id: candidate.id,
      kind: 'message',
      narrativeKind: candidate.part.type,
      state: narrativeState({
        index,
        part: candidate.part,
        status,
        total: candidates.length
      }),
      text: candidate.part.text
    }
  })
}

function settledTurnLabel(input: {
  endedAt?: string
  startedAt?: string
  status: AiConversationStatus
}): string {
  const start = Date.parse(input.startedAt ?? '')
  const end = Date.parse(input.endedAt ?? '')
  const duration =
    Number.isFinite(start) && Number.isFinite(end)
      ? formatElapsedDuration(Math.max(0, end - start))
      : ''
  if (input.status === 'stopped') {
    return duration ? `You stopped after ${duration}` : 'You stopped this response'
  }
  if (input.status === 'error') return duration ? `Failed after ${duration}` : 'Failed'
  if (input.status === 'needs_attention') {
    return duration ? `Needs attention after ${duration}` : 'Needs attention'
  }
  return duration ? `Worked for ${duration}` : 'Worked'
}

function toolSummaryLabel(kind: AiToolKind, count: number): string {
  const plural = (one: string, many = `${one}s`) => (count === 1 ? one : many)
  switch (kind) {
    case 'read':
      return `Read ${String(count)} ${plural('file')}`
    case 'edit':
      return `Changed ${String(count)} ${plural('file')}`
    case 'command':
      return `Ran ${String(count)} ${plural('command')}`
    case 'search':
      return `Searched code ${String(count)} ${plural('time')}`
    case 'web':
      return `Searched the web ${String(count)} ${plural('time')}`
    case 'list':
      return `Listed ${String(count)} ${plural('path')}`
    case 'connected-app':
      return `Used ${String(count)} connected ${plural('app')}`
    case 'mail':
      return `Used mail ${String(count)} ${plural('time')}`
    case 'handoff':
      return `Handed off ${String(count)} ${plural('task')}`
    case 'image':
      return `Generated ${String(count)} ${plural('image')}`
    case 'video':
      return `Generated ${String(count)} ${plural('video')}`
    case 'message':
      return `Sent ${String(count)} ${plural('message')}`
    case 'tool':
      return `Used ${String(count)} ${plural('tool')}`
  }
}

export function summarizeT3ToolGroup(entries: readonly T3TimelineWorkEntry[]): {
  kind: T3ToolGroupSummaryKind
  text: string
} {
  const counts = new Map<AiToolKind, number>()
  for (const entry of entries) {
    const kind = toolCallKind(entry.part.name, entry.part.input)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const labels = [...counts].map(([kind, count]) => toolSummaryLabel(kind, count))
  const sentenceLabels = labels.map((label, index) =>
    index === 0 ? label : `${label.charAt(0).toLowerCase()}${label.slice(1)}`
  )
  const text =
    sentenceLabels.length < 2
      ? (sentenceLabels[0] ?? 'Used tools')
      : sentenceLabels.length === 2
        ? sentenceLabels.join(' and ')
        : `${sentenceLabels.slice(0, -1).join(', ')}, and ${sentenceLabels.at(-1)}`
  return {
    kind: counts.size === 1 ? (counts.keys().next().value ?? 'tool') : 'mixed',
    text
  }
}

function deriveExpandedRows(
  timelineEntries: readonly T3TimelineEntry[],
  expandedWorkGroupIds: ReadonlySet<string>,
  isWorking: boolean
): T3MessagesTimelineRow[] {
  const rows: T3MessagesTimelineRow[] = []
  for (let index = 0; index < timelineEntries.length; index += 1) {
    const timelineEntry = timelineEntries[index]

    if (timelineEntry.kind === 'message') {
      rows.push({
        createdAt: timelineEntry.createdAt,
        id: timelineEntry.id,
        kind: 'message',
        message: timelineEntry
      })
      continue
    }

    const groupedEntries = [timelineEntry]
    let cursor = index + 1
    while (cursor < timelineEntries.length) {
      const nextEntry = timelineEntries[cursor]
      if (nextEntry.kind !== 'work') break
      groupedEntries.push(nextEntry)
      cursor += 1
    }

    const groupId = `work-group:${timelineEntry.id}`
    const expanded = expandedWorkGroupIds.has(groupId)
    const activeEntry = isWorking
      ? groupedEntries.findLast((entry) => entry.state === 'pending' || entry.state === 'running')
      : undefined

    if (activeEntry) {
      rows.push({
        createdAt: timelineEntry.createdAt,
        entry: activeEntry,
        expanded,
        groupedEntries,
        groupId,
        id: `work-live:${timelineEntry.id}`,
        kind: 'work-live'
      })
      if (expanded) {
        for (const workEntry of groupedEntries) {
          rows.push({
            createdAt: workEntry.createdAt,
            groupedEntries: [workEntry],
            id: workEntry.id,
            isExpandedToolGroupEntry: true,
            kind: 'work'
          })
        }
      }
    } else {
      const summary = summarizeT3ToolGroup(groupedEntries)
      rows.push({
        createdAt: timelineEntry.createdAt,
        expanded,
        groupId,
        hasFailure: groupedEntries.at(-1)?.state === 'error',
        hiddenCount: groupedEntries.length,
        id: `work-toggle:${timelineEntry.id}`,
        kind: 'work-toggle',
        onlyToolEntries: true,
        summary: summary.text,
        summaryKind: summary.kind
      })
      if (expanded) {
        for (const workEntry of groupedEntries) {
          rows.push({
            createdAt: workEntry.createdAt,
            groupedEntries: [workEntry],
            id: workEntry.id,
            isExpandedToolGroupEntry: true,
            kind: 'work'
          })
        }
      }
    }
    index = cursor - 1
  }
  return rows
}

export function deriveT3MessagesTimelineRows(input: {
  endedAt?: string
  expandedTurn: boolean
  expandedWorkGroupIds: ReadonlySet<string>
  isWorking: boolean
  startedAt?: string
  status: AiConversationStatus
  timelineEntries: readonly T3TimelineEntry[]
  workingPrefix?: string
  workingLabel?: string
}): T3MessagesTimelineRow[] {
  const activityRows = deriveExpandedRows(
    input.timelineEntries,
    input.expandedWorkGroupIds,
    input.isWorking
  )

  if (!input.isWorking && input.timelineEntries.length > 0) {
    const fold: T3MessagesTimelineRow = {
      createdAt: input.startedAt ?? input.timelineEntries[0].createdAt,
      expanded: input.expandedTurn,
      id: 'turn-fold-row',
      kind: 'turn-fold',
      label: settledTurnLabel(input)
    }
    return input.expandedTurn ? [fold, ...activityRows] : [fold]
  }

  const rows = [...activityRows]
  if (input.isWorking) {
    rows.push({
      createdAt: input.startedAt ?? null,
      id: 'working-indicator-row',
      kind: 'working',
      live: input.status === 'streaming' || input.status === 'submitted',
      prefix: input.workingPrefix?.trim() || 'Working',
      stepLabel: input.workingLabel?.trim() || undefined
    })
  }
  return rows
}

function toolsEqual(a: T3TimelineWorkEntry, b: T3TimelineWorkEntry): boolean {
  return (
    a.id === b.id &&
    a.state === b.state &&
    a.part.name === b.part.name &&
    a.part.input === b.part.input &&
    a.part.output === b.part.output &&
    a.part.error === b.part.error &&
    a.part.images === b.part.images
  )
}

function messageRowUnchanged(
  a: Extract<T3MessagesTimelineRow, { kind: 'message' }>,
  b: T3MessagesTimelineRow
): boolean {
  return (
    b.kind === 'message' &&
    a.message.id === b.message.id &&
    a.message.text === b.message.text &&
    a.message.state === b.message.state &&
    a.message.narrativeKind === b.message.narrativeKind
  )
}

function workRowUnchanged(
  a: Extract<T3MessagesTimelineRow, { kind: 'work' }>,
  b: T3MessagesTimelineRow
): boolean {
  if (b.kind !== 'work' || a.groupedEntries.length !== b.groupedEntries.length) return false
  return a.groupedEntries.every((entry, index) => toolsEqual(entry, b.groupedEntries[index]))
}

function rowUnchanged(a: T3MessagesTimelineRow, b: T3MessagesTimelineRow): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.createdAt !== b.createdAt) return false
  if (a.kind === 'message') return messageRowUnchanged(a, b)
  if (a.kind === 'work') return workRowUnchanged(a, b)
  if (a.kind === 'work-live') {
    return (
      b.kind === 'work-live' &&
      a.groupId === b.groupId &&
      a.expanded === b.expanded &&
      toolsEqual(a.entry, b.entry) &&
      a.groupedEntries.length === b.groupedEntries.length &&
      a.groupedEntries.every((entry, index) => toolsEqual(entry, b.groupedEntries[index]))
    )
  }
  if (a.kind === 'work-toggle') {
    return (
      b.kind === 'work-toggle' &&
      a.groupId === b.groupId &&
      a.hiddenCount === b.hiddenCount &&
      a.expanded === b.expanded &&
      a.summary === b.summary &&
      a.summaryKind === b.summaryKind &&
      a.hasFailure === b.hasFailure
    )
  }
  if (a.kind === 'working') {
    return (
      b.kind === 'working' &&
      a.prefix === b.prefix &&
      a.stepLabel === b.stepLabel &&
      a.live === b.live
    )
  }
  return b.kind === 'turn-fold' && a.label === b.label && a.expanded === b.expanded
}

export function computeStableT3MessagesTimelineRows(
  rows: T3MessagesTimelineRow[],
  previous: StableT3MessagesTimelineRowsState
): StableT3MessagesTimelineRowsState {
  const byId = new Map<string, T3MessagesTimelineRow>()
  let changed = rows.length !== previous.result.length
  const result = rows.map((row, index) => {
    const before = previous.byId.get(row.id)
    const stable = before !== undefined && rowUnchanged(before, row) ? before : row
    byId.set(row.id, stable)
    if (previous.result[index] !== stable) changed = true
    return stable
  })
  return changed ? { byId, result } : previous
}
