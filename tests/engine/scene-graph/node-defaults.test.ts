import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'
import {
  createDefaultNode,
  hasSceneNodeRuntimeDefaults,
  hydrateSceneNodeDefaults
} from '@open-pencil/scene-graph/node-defaults'

describe('scene node defaults', () => {
  test('reuses a complete persisted node instead of allocating defaults', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Patient card', x: 12, y: 24 })

    expect(hasSceneNodeRuntimeDefaults(frame)).toBe(true)
    expect(hydrateSceneNodeDefaults(frame)).toBe(frame)
  })

  test('fills omitted fields on compact records', () => {
    const hydrated = hydrateSceneNodeDefaults({
      id: '0:compact',
      type: 'FRAME',
      name: 'Compact card',
      x: 8,
      y: 16
    })

    expect(hydrated.id).toBe('0:compact')
    expect(hydrated.name).toBe('Compact card')
    expect(hydrated.x).toBe(8)
    expect(hydrated.y).toBe(16)
    expect(hydrated.childIds).toEqual([])
    expect(hydrated.visible).toBe(true)
    expect(hydrated.pluginData).toEqual([])
    expect(createDefaultNode(() => '0:other', 'FRAME').visible).toBe(true)
  })
})
