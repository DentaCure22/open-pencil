import { describe, expect, test } from 'bun:test'

import { updateRecentBoardIds, updateWarmBoardIds } from '@/app/sidebar-workspace/recent'

const validIds = ['board-a', 'board-b', 'board-c', 'board-d']

describe('recent Board dock history', () => {
  test('keeps recent history in most-recent order without duplicates', () => {
    expect(
      updateRecentBoardIds({
        boardIds: ['board-b', 'board-a', 'missing'],
        currentId: 'board-a',
        limit: 3,
        validIds
      })
    ).toEqual(['board-a', 'board-b'])
  })

  test('keeps warm Board slots stable while revisiting them', () => {
    expect(
      updateWarmBoardIds({
        boardIds: ['board-a', 'board-b', 'board-c'],
        currentId: 'board-a',
        limit: 3,
        pinnedIds: [],
        recentIds: ['board-a', 'board-c', 'board-b'],
        validIds
      })
    ).toEqual(['board-a', 'board-b', 'board-c'])
  })

  test('replaces only the least-recent warm slot for a newly opened Board', () => {
    expect(
      updateWarmBoardIds({
        boardIds: ['board-a', 'board-b', 'board-c'],
        currentId: 'board-d',
        limit: 3,
        pinnedIds: [],
        recentIds: ['board-d', 'board-a', 'board-c', 'board-b'],
        validIds
      })
    ).toEqual(['board-a', 'board-d', 'board-c'])
  })

  test('reuses a slot hidden by a pinned Board before replacing a warm Board', () => {
    expect(
      updateWarmBoardIds({
        boardIds: ['board-a', 'board-b', 'board-c'],
        currentId: 'board-d',
        limit: 3,
        pinnedIds: ['board-b'],
        recentIds: ['board-d', 'board-c', 'board-a'],
        validIds
      })
    ).toEqual(['board-a', 'board-d', 'board-c'])
  })
})
