import { describe, expect, test } from 'bun:test'

import {
  computeStableT3MessagesTimelineRows,
  deriveT3MessagesTimelineRows,
  deriveT3TimelineEntries,
  MAX_VISIBLE_WORK_LOG_ENTRIES,
  summarizeT3ToolGroup,
  type StableT3MessagesTimelineRowsState
} from '@/components/ai-elements/t3-messages-timeline.logic'
import type { AiMessage } from '@/components/ai-elements/types'

function message(id: string, createdAt: string, parts: AiMessage['parts']): AiMessage {
  return { createdAt, id, parts, role: 'assistant', text: '' }
}

const activeMessages: AiMessage[] = [
  message('commentary-1', '2026-08-25T12:00:01.000Z', [
    {
      state: 'complete',
      text: "I'll inspect the project activity.",
      type: 'commentary'
    }
  ]),
  message('tools-1', '2026-08-25T12:00:02.000Z', [
    {
      input: '{"path":"one.ts"}',
      name: 'read_file',
      state: 'success',
      type: 'tool'
    },
    {
      input: '{"path":"two.ts"}',
      name: 'read_file',
      state: 'success',
      type: 'tool'
    },
    {
      input: '{"query":"activity"}',
      name: 'search',
      state: 'success',
      type: 'tool'
    }
  ]),
  message('commentary-2', '2026-08-25T12:00:03.000Z', [
    {
      state: 'complete',
      text: 'This is the installed app.',
      type: 'commentary'
    }
  ]),
  message('tools-2', '2026-08-25T12:00:04.000Z', [
    { name: 'web_search', state: 'success', type: 'tool' },
    { name: 'web_search', state: 'success', type: 'tool' },
    { name: 'web_search', state: 'success', type: 'tool' },
    { name: 'web_search', state: 'success', type: 'tool' },
    { name: 'web_search', state: 'success', type: 'tool' },
    { name: 'web_search', state: 'running', type: 'tool' }
  ])
]

function activeRows(expandedWorkGroupIds: ReadonlySet<string> = new Set()) {
  const entries = deriveT3TimelineEntries(activeMessages, 'streaming')
  return deriveT3MessagesTimelineRows({
    expandedTurn: false,
    expandedWorkGroupIds,
    isWorking: true,
    startedAt: '2026-08-25T12:00:00.000Z',
    status: 'streaming',
    timelineEntries: entries
  })
}

describe('T3 Code message timeline workflow', () => {
  test('keeps commentary chronological, summarizes settled tools, and focuses the live tool', () => {
    expect(MAX_VISIBLE_WORK_LOG_ENTRIES).toBe(1)
    const rows = activeRows()
    expect(rows.map((row) => row.kind)).toEqual([
      'message',
      'work-toggle',
      'message',
      'work-live',
      'working'
    ])
    expect(rows.map((row) => row.id)).toEqual([
      'commentary-1:0',
      'work-toggle:tools-1:0',
      'commentary-2:0',
      'work-live:tools-2:0',
      'working-indicator-row'
    ])
    expect(rows.find((row) => row.kind === 'work-toggle')).toMatchObject({
      hiddenCount: 3,
      summary: 'Read 2 files and searched code 1 time',
      summaryKind: 'mixed'
    })
    expect(rows.find((row) => row.kind === 'work-live')).toMatchObject({
      entry: { id: 'tools-2:5' },
      groupedEntries: { length: 6 }
    })
  })

  test('expands a quiet tool summary into inline detail rows', () => {
    const rows = activeRows(new Set(['work-group:tools-1:0']))
    expect(rows.slice(0, 5).map((row) => row.id)).toEqual([
      'commentary-1:0',
      'work-toggle:tools-1:0',
      'tools-1:0',
      'tools-1:1',
      'tools-1:2'
    ])
    expect(rows.slice(2, 5).every((row) => row.kind === 'work')).toBe(true)
  })

  test('builds T3-style action summaries instead of generic tool counts', () => {
    const entries = deriveT3TimelineEntries(activeMessages.slice(0, 2), 'ready').filter(
      (entry) => entry.kind === 'work'
    )
    expect(summarizeT3ToolGroup(entries)).toEqual({
      kind: 'mixed',
      text: 'Read 2 files and searched code 1 time'
    })
  })

  test('folds a settled turn behind Worked for while retaining the same expansion order', () => {
    const entries = deriveT3TimelineEntries(activeMessages, 'ready')
    const base = {
      endedAt: '2026-08-25T12:00:14.000Z',
      expandedWorkGroupIds: new Set<string>(),
      isWorking: false,
      startedAt: '2026-08-25T12:00:00.000Z',
      status: 'ready' as const,
      timelineEntries: entries
    }
    const collapsed = deriveT3MessagesTimelineRows({
      ...base,
      expandedTurn: false
    })
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]).toMatchObject({
      kind: 'turn-fold',
      label: 'Worked for 14s'
    })

    const expanded = deriveT3MessagesTimelineRows({
      ...base,
      expandedTurn: true
    })
    expect(expanded[0]).toMatchObject({ expanded: true, kind: 'turn-fold' })
    expect(expanded.slice(1).map((row) => row.kind)).toEqual([
      'message',
      'work-toggle',
      'message',
      'work-toggle'
    ])
  })

  test('reuses unchanged row objects across live timer updates', () => {
    const initial: StableT3MessagesTimelineRowsState = {
      byId: new Map(),
      result: []
    }
    const first = computeStableT3MessagesTimelineRows(activeRows(), initial)
    const second = computeStableT3MessagesTimelineRows(activeRows(), first)
    expect(second).toBe(first)
    expect(second.result[0]).toBe(first.result[0])
  })
})
