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
})
