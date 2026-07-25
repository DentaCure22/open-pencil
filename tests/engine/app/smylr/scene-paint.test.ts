import { describe, expect, test } from 'bun:test'

import { SceneGraph, type Effect, type SceneNode } from '@open-pencil/scene-graph'

import { clearLiveFrameScenePaint } from '@/app/smylr-production/live/paint'

const DROP_SHADOW: Effect = {
  type: 'DROP_SHADOW',
  color: { r: 0, g: 0, b: 0, a: 0.25 },
  offset: { x: 0, y: 4 },
  radius: 4,
  spread: 0,
  visible: true
}

function liveFrame(graph: SceneGraph, page: SceneNode) {
  return graph.createNode('FRAME', page.id, {
    effects: [DROP_SHADOW, structuredClone(DROP_SHADOW)],
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    height: 900,
    name: 'Dental Chart / Current',
    pluginData: [
      { pluginId: 'smylr-production', key: 'kind', value: 'live-app-frame' },
      { pluginId: 'smylr-production', key: 'route', value: '/dental-chart' }
    ],
    strokes: [
      {
        align: 'CENTER',
        color: { r: 0.23, g: 0.51, b: 0.96, a: 1 },
        opacity: 1,
        weight: 1,
        visible: true
      }
    ],
    width: 1280,
    x: 96,
    y: 88
  })
}

describe('Smylr live frame scene paint', () => {
  test('removes persisted paint and duplicate shadows from a live Dental Chart frame', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = liveFrame(graph, page)

    expect(clearLiveFrameScenePaint(graph, frame)).toBe(true)
    expect(graph.getNode(frame.id)).toMatchObject({
      effects: [],
      fills: [],
      height: 900,
      strokes: [],
      width: 1280,
      x: 96,
      y: 88
    })
  })

  test('does not strip paint from an ordinary OpenPencil frame', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      effects: [DROP_SHADOW],
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
      name: 'Review card'
    })

    expect(clearLiveFrameScenePaint(graph, frame)).toBe(false)
    expect(graph.getNode(frame.id)?.effects).toHaveLength(1)
    expect(graph.getNode(frame.id)?.fills).toHaveLength(1)
  })
})
