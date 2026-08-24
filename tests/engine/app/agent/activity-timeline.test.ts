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

  test('keeps the latest tool group open until the next thought, then closes it', () => {
    expect(
      toolGroupIsOpen({
        followedByCommentary: false,
        hasRunningTool: true,
        status: 'streaming'
      })
    ).toBe(true)
    expect(
      toolGroupIsOpen({
        followedByCommentary: false,
        hasRunningTool: false,
        status: 'streaming'
      })
    ).toBe(true)
    expect(
      toolGroupIsOpen({
        followedByCommentary: true,
        hasRunningTool: false,
        status: 'streaming'
      })
    ).toBe(false)
    expect(
      toolGroupIsOpen({
        followedByCommentary: false,
        hasRunningTool: false,
        status: 'ready'
      })
    ).toBe(false)
  })

  test('splits tools by kind and closes a group once a later thought arrives', () => {
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

    expect(groups.map((group) => group.type)).toEqual(['commentary', 'tools', 'tools', 'tools'])
    expect(groups[1]).toMatchObject({ kind: 'read', open: false, type: 'tools' })
    expect(groups[1]?.type === 'tools' ? groups[1].items.length : 0).toBe(2)
    expect(groups[2]).toMatchObject({ kind: 'search', open: false, type: 'tools' })
    expect(groups[3]).toMatchObject({ kind: 'edit', open: true, type: 'tools' })
  })

  test('merges the same tool kind even when other kinds sit in between', () => {
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

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({ kind: 'read', type: 'tools' })
    expect(groups[0]?.type === 'tools' ? groups[0].items.length : 0).toBe(2)
    expect(groups[1]).toMatchObject({ kind: 'search', type: 'tools' })
    expect(groups[1]?.type === 'tools' ? groups[1].items.length : 0).toBe(2)
  })

  test('folds a generic connected-app call into Read mail when the turn also reads mail', () => {
    const groups = groupActivityTimeline(
      [
        tool('connect-1', 'mcp'),
        commentary('thought-1', 'Gmail is available. I will pull todays messages next.'),
        tool('mail-1', 'codex_apps_gmail_search_emails')
      ],
      'ready',
      (item) => item.part.state
    )

    expect(groups.map((group) => group.type)).toEqual(['commentary', 'tools'])
    expect(groups[1]).toMatchObject({ kind: 'mail', type: 'tools' })
    expect(groups[1]?.type === 'tools' ? groups[1].items.length : 0).toBe(2)
  })

  test('keeps app lookup separate from Read mail', () => {
    const groups = groupActivityTimeline(
      [tool('lookup-1', 'connected_app_search'), tool('mail-1', 'codex_apps_gmail_search_emails')],
      'ready',
      (item) => item.part.state
    )

    expect(groups.map((group) => (group.type === 'tools' ? group.kind : group.type))).toEqual([
      'connected-app',
      'mail'
    ])
  })
})
