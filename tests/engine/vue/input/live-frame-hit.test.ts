import { describe, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

import { resolveHit } from '#vue/shared/input/select'

describe('live frame hit testing', () => {
  test('selects a transparent live component frame from its visible bounds', () => {
    const editor = createEditor()
    const frame = editor.graph.createNode('FRAME', editor.state.currentPageId, {
      x: 120,
      y: 80,
      width: 132,
      height: 44,
      name: 'Button / Default',
      fills: [],
      strokes: [],
      pluginData: [
        {
          pluginId: 'smylr-production',
          key: 'kind',
          value: 'live-app-frame'
        }
      ]
    })

    const hit = resolveHit(160, 100, editor, {
      hitTestInScope: () => null,
      isInsideContainerBounds: (cx, cy, containerId) => {
        const node = editor.graph.getNode(containerId)
        return Boolean(
          node &&
          cx >= node.x &&
          cx <= node.x + node.width &&
          cy >= node.y &&
          cy <= node.y + node.height
        )
      },
      hitTestSectionTitle: () => null,
      hitTestComponentLabel: () => null,
      hitTestFrameTitle: () => null
    })

    expect(hit?.id).toBe(frame.id)
  })
})
