import { describe, expect, test } from 'bun:test'

import {
  activityExploreLabel,
  groupActivityTimeline,
  toolGroupIsOpen,
  type ActivityItem
} from '@/components/ai-elements/activity-timeline'

function commentary(id: string, text: string): ActivityItem {
  return {
    index: 0,
    key: id,
    part: { state: 'complete', text, type: 'commentary' }
  }
}

function reasoning(id: string, text: string): ActivityItem {
  return {
    index: 0,
    key: id,
    part: { state: 'complete', text, type: 'reasoning' }
  }
}

function tool(id: string, name: string, state: 'success' | 'running' = 'success'): ActivityItem {
  return {
    index: 0,
    key: id,
    part: { name, state, type: 'tool' }
  }
}

describe('activity timeline', () => {
  test('summarizes explored files, searches, and commands', () => {
    expect(
      activityExploreLabel([
        { name: 'read_file' },
        { name: 'read_file' },
        { name: 'search' },
        { name: 'bash' },
        { name: 'bash' }
      ])
    ).toBe('Explored 2 files, 1 search, ran 2 commands')
    expect(activityExploreLabel([{ name: 'read_file' }])).toBe('Explored 1 file')
  })

  test('keeps every tool group compact until the user opens it', () => {
    expect(
      toolGroupIsOpen({
        followedByNarrative: false,
        hasRunningTool: true,
        status: 'streaming'
      })
    ).toBe(false)
    expect(
      toolGroupIsOpen({
        followedByNarrative: false,
        hasRunningTool: false,
        status: 'streaming'
      })
    ).toBe(false)
    expect(
      toolGroupIsOpen({
        followedByNarrative: true,
        hasRunningTool: true,
        status: 'streaming'
      })
    ).toBe(false)
    expect(
      toolGroupIsOpen({
        followedByNarrative: true,
        hasRunningTool: false,
        status: 'streaming'
      })
    ).toBe(false)
    expect(
      toolGroupIsOpen({
        followedByNarrative: false,
        hasRunningTool: false,
        status: 'ready'
      })
    ).toBe(false)
  })

  test('keeps narrative and adjacent tool blocks in chronological order', () => {
    const groups = groupActivityTimeline(
      [
        tool('read-1', 'read_file'),
        tool('read-2', 'read_file'),
        tool('search-1', 'search'),
        commentary('thought-1', 'Next I will edit the header.'),
        tool('edit-1', 'write_file', 'running')
      ],
      'streaming',
      (item) => item.part.state
    )

    expect(groups.map((group) => group.type)).toEqual(['tools', 'commentary', 'tools'])
    expect(groups[0]).toMatchObject({ open: false, type: 'tools' })
    expect(groups[0]?.type === 'tools' ? groups[0].items.length : 0).toBe(3)
    expect(groups[2]).toMatchObject({ open: false, type: 'tools' })
  })

  test('summarizes adjacent mixed tools in one activity row', () => {
    const groups = groupActivityTimeline(
      [
        tool('read-1', 'read_file'),
        tool('search-1', 'search'),
        tool('read-2', 'read_file'),
        tool('search-2', 'search')
      ],
      'ready',
      (item) => item.part.state
    )

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ type: 'tools' })
    expect(groups[0]?.type === 'tools' ? groups[0].items.length : 0).toBe(4)
  })

  test('does not pull connected-app tools across later commentary', () => {
    const groups = groupActivityTimeline(
      [
        tool('connect-1', 'mcp'),
        commentary('thought-1', 'Gmail is available. I will pull todays messages next.'),
        tool('mail-1', 'codex_apps_gmail_search_emails')
      ],
      'ready',
      (item) => item.part.state
    )

    expect(groups.map((group) => group.type)).toEqual(['tools', 'commentary', 'tools'])
    expect(groups[0]?.type === 'tools' ? groups[0].items.length : 0).toBe(1)
    expect(groups[2]?.type === 'tools' ? groups[2].items.length : 0).toBe(1)
  })

  test('keeps reasoning at its exact boundary in the activity stream', () => {
    const groups = groupActivityTimeline(
      [
        commentary('note-1', 'I will inspect the files.'),
        tool('read-1', 'read_file'),
        reasoning('reason-1', 'The next step is an edit.'),
        tool('edit-1', 'write_file')
      ],
      'ready',
      (item) => item.part.state
    )

    expect(groups.map((group) => group.type)).toEqual(['commentary', 'tools', 'reasoning', 'tools'])
  })
})
