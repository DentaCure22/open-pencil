import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  isSmylrReadOnlyReferenceFrame,
  normalizeLocalReferenceBaseUrl,
  smylrRuntimeBaseUrlForFrame,
  upsertSmylrHistoricalReferenceFrame
} from '@/app/smylr-production/live/reference-runtime'

const PLUGIN_ID = 'smylr-production'

function pluginData(key: string, value: string) {
  return { pluginId: PLUGIN_ID, key, value }
}

describe('Smylr historical reference runtime', () => {
  test('accepts only loopback HTTP reference builds', () => {
    expect(normalizeLocalReferenceBaseUrl('http://127.0.0.1:3001/dental-chart')).toBe(
      'http://127.0.0.1:3001'
    )
    expect(normalizeLocalReferenceBaseUrl('http://localhost:3001')).toBe('http://localhost:3001')
    expect(normalizeLocalReferenceBaseUrl('https://example.com')).toBeNull()
    expect(normalizeLocalReferenceBaseUrl('file:///tmp/reference')).toBeNull()
  })

  test('upserts one read-only frame beside Current without changing Current', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Dental Board')
    const current = graph.createNode('FRAME', page.id, {
      x: -1350,
      y: -1079,
      width: 1440,
      height: 900,
      name: 'Dental Chart / Current',
      pluginData: [
        pluginData('kind', 'live-app-frame'),
        pluginData('pageId', 'dental-chart'),
        pluginData('route', '/dental-chart'),
        pluginData('state', 'current')
      ]
    })
    const store = { graph, requestRender: () => undefined }
    const input = {
      baseUrl: 'http://127.0.0.1:3001',
      revision: '2678f25f9263ac663a6d6235aabb2e17042b57ff',
      route: '/dental-chart'
    }

    const first = upsertSmylrHistoricalReferenceFrame(store, page.id, input)
    const second = upsertSmylrHistoricalReferenceFrame(store, page.id, input)

    expect(first.created).toBe(true)
    expect(first.currentCreated).toBe(false)
    expect(second.created).toBe(false)
    expect(second.frame.id).toBe(first.frame.id)
    expect(second.frame.x).toBe(current.x + current.width + 120)
    expect(second.frame.y).toBe(current.y)
    expect(isSmylrReadOnlyReferenceFrame(second.frame)).toBe(true)
    expect(smylrRuntimeBaseUrlForFrame(second.frame, 'http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3001'
    )
    expect(graph.getNode(current.id)?.name).toBe('Dental Chart / Current')
    expect(graph.getChildren(page.id)).toHaveLength(2)
  })

  test('creates a missing Current frame above existing board content before adding reference', () => {
    const graph = new SceneGraph()
    const page = graph.addPage('Dental Board')
    graph.createNode('FRAME', page.id, {
      x: -2066,
      y: 200,
      width: 1437,
      height: 1194,
      name: 'Existing board content'
    })
    const store = { graph, requestRender: () => undefined }

    const result = upsertSmylrHistoricalReferenceFrame(store, page.id, {
      baseUrl: 'http://127.0.0.1:3001',
      revision: '2678f25f9263ac663a6d6235aabb2e17042b57ff',
      route: '/dental-chart'
    })

    expect(result.currentCreated).toBe(true)
    expect(result.currentFrame.name).toBe('Dental Chart / Current')
    expect(result.currentFrame.x).toBe(-2066)
    expect(result.currentFrame.y).toBe(-940)
    expect(result.frame.x).toBe(-666)
    expect(result.frame.y).toBe(-940)
    expect(graph.getChildren(page.id)).toHaveLength(3)
  })
})
