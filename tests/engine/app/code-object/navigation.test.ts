import { describe, expect, test } from 'bun:test'

import { createCodeObject, createUserCodeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import { connectedObjectGraphNodeInDirection, connectObjects } from '@/app/object-graph'

function codeObject(
  store: ReturnType<typeof createEditorStore>,
  name: string,
  x: number,
  y: number
) {
  return createCodeObject(store, {
    document: createUserCodeObjectDocument({ name }),
    height: 200,
    name,
    width: 300,
    x,
    y
  })
}

describe('Code Object connected navigation', () => {
  test('uses deterministic screen directions and ignores unconnected objects', () => {
    const store = createEditorStore()
    const source = codeObject(store, 'Source', 200, 200)
    const alignedRight = codeObject(store, 'Aligned right', 900, 200)
    const nearerDiagonal = codeObject(store, 'Nearer diagonal', 600, 450)
    const below = codeObject(store, 'Below', 200, 800)
    codeObject(store, 'Unconnected nearest', 520, 200)
    for (const target of [alignedRight, nearerDiagonal, below]) {
      expect(
        connectObjects(store, {
          kind: 'visual',
          sourceNodeId: source.id,
          targetNodeId: target.id
        })
      ).not.toBeNull()
    }

    expect(
      connectedObjectGraphNodeInDirection(
        store.graph,
        store.state.currentPageId,
        source.id,
        'right'
      )
    ).toBe(alignedRight.id)
    expect(
      connectedObjectGraphNodeInDirection(store.graph, store.state.currentPageId, source.id, 'down')
    ).toBe(below.id)
    expect(
      connectedObjectGraphNodeInDirection(store.graph, store.state.currentPageId, source.id, 'left')
    ).toBeNull()
    expect(
      connectedObjectGraphNodeInDirection(
        store.graph,
        store.state.currentPageId,
        alignedRight.id,
        'left'
      )
    ).toBe(source.id)
  })
})
