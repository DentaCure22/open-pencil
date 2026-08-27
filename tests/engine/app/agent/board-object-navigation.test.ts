import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  boardObjectPageId,
  revealBoardObject,
  type BoardObjectNavigationStore
} from '@/app/agent-chat/board-object-navigation'

function fakeStore() {
  const graph = new SceneGraph()
  const pageA = graph.createNode('CANVAS', graph.rootId, { name: 'Page A' })
  const pageB = graph.createNode('CANVAS', graph.rootId, { name: 'Page B' })
  const group = graph.createNode('FRAME', pageB.id, { name: 'Group' })
  const target = graph.createNode('TEXT', group.id, { name: 'Target' })
  const calls: string[] = []
  const state = { currentPageId: pageA.id }
  const store: BoardObjectNavigationStore = {
    graph,
    requestOverlayRepaint: () => calls.push('repaint'),
    revealNode: (id: string) => calls.push(`reveal:${id}`),
    select: (ids: string[]) => calls.push(`select:${ids.join(',')}`),
    state,
    switchPage: async (id: string) => {
      calls.push(`page:${id}`)
      state.currentPageId = id
    }
  }
  return { calls, pageB, store, target }
}

describe('Board object navigation', () => {
  test('finds the owning Board page through nested frames', () => {
    const { pageB, store, target } = fakeStore()

    expect(boardObjectPageId(store, target.id)).toBe(pageB.id)
  })

  test('switches page, selects, and reveals a referenced object', async () => {
    const { calls, pageB, store, target } = fakeStore()

    expect(
      await revealBoardObject(store, target.id, {
        schedule: (callback) => callback(),
        viewportInsets: () => ({ left: 24 })
      })
    ).toBe(true)
    expect(calls).toEqual([
      `page:${pageB.id}`,
      `select:${target.id}`,
      `reveal:${target.id}`,
      'repaint'
    ])
  })

  test('does nothing when a referenced object no longer exists', async () => {
    const { calls, store } = fakeStore()

    expect(
      await revealBoardObject(store, 'missing', {
        schedule: (callback) => callback(),
        viewportInsets: () => ({})
      })
    ).toBe(false)
    expect(calls).toEqual([])
  })
})
