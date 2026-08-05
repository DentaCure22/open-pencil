import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { connectObjects } from '@/app/object-graph/actions'

describe('live Object Graph connection eligibility', () => {
  test('prevents resolved-port duplicates through the shared SceneGraph helper', () => {
    const store = createEditorStore()
    const source = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 160,
      name: 'Rotated source',
      rotation: 90,
      width: 240,
      x: 100,
      y: 120
    })
    const target = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 160,
      name: 'Target',
      width: 240,
      x: 720,
      y: 120
    })

    const first = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
    if (!first) throw new Error('Initial connection was not created')
    expect(
      connectObjects(store, {
        kind: 'visual',
        sourceNodeId: source.id,
        sourcePort: 'top',
        targetNodeId: target.id,
        targetPort: 'left'
      })
    ).toBeNull()
    expect(
      connectObjects(store, {
        kind: 'data',
        sourceNodeId: source.id,
        sourcePort: 'top',
        targetNodeId: target.id,
        targetPort: 'left'
      })
    ).toMatchObject({ kind: 'data', sourcePort: 'top', targetPort: 'left' })
  })
})
