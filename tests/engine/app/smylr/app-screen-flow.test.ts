import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  appScreenFlowPluginValue,
  syncDentalChartAppFlowGeometry,
  syncDentalChartAppFlowScene
} from '@/app/smylr-production/app-flow/scene'

function createFlowFixture() {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    name: 'Dental Chart — Flow',
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-flow-page' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'dental-chart' }
    ]
  })
  return { graph, page }
}

describe('Dental Chart app-screen flow', () => {
  test('builds real screen states with semantic paths, entry, exit, and a loop', () => {
    const { graph, page } = createFlowFixture()
    const result = syncDentalChartAppFlowScene(graph, page.id)
    const children = graph.getChildren(page.id)
    const screens = children.filter(
      (node) => appScreenFlowPluginValue(node, 'appFlowNodeKind') === 'screen'
    )
    const edges = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-edge'
    )
    const markers = children.filter(
      (node) => appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-marker'
    )

    expect(result.changed).toBe(true)
    expect(screens.map((node) => appScreenFlowPluginValue(node, 'appFlowNodeId'))).toEqual([
      'current',
      'exam-setup',
      'active-charting',
      'review'
    ])
    expect(edges).toHaveLength(6)
    expect(markers.map((node) => appScreenFlowPluginValue(node, 'appFlowNodeKind'))).toEqual([
      'entry',
      'exit'
    ])
    expect(
      edges.find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'edit-chart')
        ?.pluginData
    ).toEqual(
      expect.arrayContaining([
        { key: 'sourceFlowNodeId', pluginId: 'smylr-production', value: 'review' },
        { key: 'targetFlowNodeId', pluginId: 'smylr-production', value: 'active-charting' },
        { key: 'edgeKind', pluginId: 'smylr-production', value: 'loop' }
      ])
    )
    expect(edges.every((edge) => graph.getChildren(edge.id).length > 0)).toBe(true)
  })

  test('keeps stable screen identity and avoids duplicate generated flow objects', () => {
    const { graph, page } = createFlowFixture()
    const first = syncDentalChartAppFlowScene(graph, page.id)
    const childCount = graph.getChildren(page.id).length
    const second = syncDentalChartAppFlowScene(graph, page.id)

    expect(second.changed).toBe(false)
    expect(second.screenIds).toEqual(first.screenIds)
    expect(graph.getChildren(page.id)).toHaveLength(childCount)
  })

  test('reattaches labels and paths after a screen moves', () => {
    const { graph, page } = createFlowFixture()
    syncDentalChartAppFlowScene(graph, page.id)
    const current = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'current')
    if (!current) throw new Error('Current screen was not created')

    graph.updateNode(current.id, { x: current.x + 96, y: current.y + 48 })
    expect(syncDentalChartAppFlowGeometry(graph, page.id)).toBe(true)

    const label = graph
      .getChildren(page.id)
      .find(
        (node) =>
          appScreenFlowPluginValue(node, 'kind') === 'app-screen-flow-state-label' &&
          appScreenFlowPluginValue(node, 'appFlowNodeId') === 'current'
      )
    const nextEdge = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowEdgeId') === 'set-up-exam')
    const entryMarker = graph
      .getChildren(page.id)
      .find((node) => appScreenFlowPluginValue(node, 'appFlowNodeId') === 'entry')

    expect(label?.x).toBe(current.x)
    expect(label?.y).toBe(current.y - 300)
    expect(nextEdge?.x).toBe(current.x + current.width)
    expect(entryMarker?.x).toBe(current.x - 250)
  })
})
