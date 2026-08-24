import { describe, expect, test } from 'bun:test'

import { shallowRef } from 'vue'

import {
  createEditorNodeOverlayStyleCache,
  type EditorOverlayGeometryRevision
} from '@/app/editor/presentation'
import { createEditorStore } from '@/app/editor/session'

describe('DOM overlay style cache', () => {
  test('recomputes only the previewed overlay and its descendants', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const parent = store.graph.createNode('FRAME', pageId, { name: 'Parent' })
    const child = store.graph.createNode('RECTANGLE', parent.id, { name: 'Child' })
    const sibling = store.graph.createNode('RECTANGLE', pageId, { name: 'Sibling' })
    const unrelated = store.graph.createNode('RECTANGLE', pageId, { name: 'Unrelated' })
    const geometry = shallowRef<EditorOverlayGeometryRevision>({ nodeId: null, revision: 0 })
    const calls: string[] = []
    const cache = createEditorNodeOverlayStyleCache(store, geometry, (node) => {
      calls.push(node.id)
      return { opacity: node.opacity }
    })

    cache.resolve(child)
    cache.resolve(sibling)
    expect(calls).toEqual([child.id, sibling.id])

    geometry.value = { nodeId: unrelated.id, revision: 1 }
    cache.resolve(child)
    cache.resolve(sibling)
    expect(calls).toHaveLength(2)

    geometry.value = { nodeId: parent.id, revision: 2 }
    cache.resolve(child)
    cache.resolve(sibling)
    expect(calls).toEqual([child.id, sibling.id, child.id])

    store.requestRender()
    cache.resolve(child)
    cache.resolve(sibling)
    expect(calls.slice(-2)).toEqual([child.id, sibling.id])
  })

  test('recomputes every overlay whose presented position changed', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const first = store.graph.createNode('FRAME', pageId, { name: 'First', x: 0, y: 0 })
    const second = store.graph.createNode('FRAME', pageId, { name: 'Second', x: 120, y: 40 })
    const geometry = shallowRef<EditorOverlayGeometryRevision>({ nodeId: null, revision: 0 })
    const calls: string[] = []
    const cache = createEditorNodeOverlayStyleCache(store, geometry, (node) => {
      calls.push(node.id)
      return { transform: `${node.id}:${store.graph.getPresentedNodePosition(node.id).x}` }
    })

    cache.resolve(first)
    cache.resolve(second)
    expect(calls).toEqual([first.id, second.id])

    store.graph.updateNodePositionPreview(first.id, 48, 12)
    store.graph.updateNodePositionPreview(second.id, 168, 52)
    geometry.value = { nodeId: second.id, revision: 1 }
    cache.resolve(first)
    cache.resolve(second)
    expect(calls).toEqual([first.id, second.id, first.id, second.id])
  })

  test('does not resync the presentation camera for overlay-only chrome', async () => {
    const presentation = await Bun.file('src/app/editor/presentation/index.ts').text()
    expect(presentation).toContain("store.onEditorEvent('viewport:changed', shared.scheduleSync)")
    expect(presentation).toContain("store.onEditorEvent('render:requested', shared.scheduleSync)")
    expect(presentation).toContain("store.onEditorEvent('repaint:requested', shared.scheduleSync)")
    expect(presentation).not.toContain(
      "store.onEditorEvent('overlay:requested', shared.scheduleSync)"
    )
  })
})
