import { describe, expect, test } from 'bun:test'

import { parseColor } from '@open-pencil/core/color'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  syncTechnicalFlowScene,
  TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE
} from '@/app/smylr-production/technical-flow'

const OPEN_PENCIL_PLUGIN_ID = 'open-pencil'
const SMYLR_PLUGIN_ID = 'smylr-production'
type AbsolutePosition = Pick<SceneNode, 'x' | 'y'>

function pluginValue(node: SceneNode, pluginId: string, key: string): string | undefined {
  return node.pluginData.find((entry) => entry.pluginId === pluginId && entry.key === key)?.value
}

function descendants(graph: SceneGraph, parentId: string): SceneNode[] {
  return graph.getChildren(parentId).flatMap((child) => [child, ...descendants(graph, child.id)])
}

function elementNode(
  graph: SceneGraph,
  ownerId: string,
  elementId: string,
  type: SceneNode['type']
): SceneNode {
  const node = descendants(graph, ownerId).find(
    (candidate) =>
      candidate.type === type &&
      pluginValue(candidate, OPEN_PENCIL_PLUGIN_ID, 'mermaid/element-id') === elementId
  )
  if (!node) throw new Error(`Missing ${type} for Technical Flow element ${elementId}`)
  return node
}

function connectorNode(graph: SceneGraph, ownerId: string, elementId: string): SceneNode {
  const node = descendants(graph, ownerId).find(
    (candidate) =>
      candidate.type === 'VECTOR' &&
      candidate.name === 'Diagram connector' &&
      pluginValue(candidate, OPEN_PENCIL_PLUGIN_ID, 'mermaid/element-id') === elementId
  )
  if (!node) throw new Error(`Missing connector for Technical Flow element ${elementId}`)
  return node
}

function connectorVertices(graph: SceneGraph, ownerId: string, elementId: string) {
  return connectorNode(graph, ownerId, elementId).vectorNetwork?.vertices.map(({ x, y }) => ({
    x,
    y
  }))
}

function absoluteConnectorVertices(graph: SceneGraph, ownerId: string, elementId: string) {
  const connector = connectorNode(graph, ownerId, elementId)
  const origin = absolutePosition(graph, connector)
  return connector.vectorNetwork?.vertices.map(({ x, y }) => ({
    x: x + origin.x,
    y: y + origin.y
  }))
}

function absolutePosition(graph: SceneGraph, node: SceneNode): AbsolutePosition {
  let x = node.x
  let y = node.y
  let current = node
  while (current.parentId) {
    const parent = graph.getNode(current.parentId)
    if (!parent) break
    x += parent.x
    y += parent.y
    current = parent
  }
  return { x, y }
}

describe('Technical Flow visual projection', () => {
  test('compiles the source Mermaid flow into boundary-aware editable pieces', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    const first = syncTechnicalFlowScene(graph, page.id)
    const owner = first.ownerId ? graph.getNode(first.ownerId) : null
    if (!owner) throw new Error('Expected a Technical Flow Mermaid owner')

    const nodeTypes: Array<[string, SceneNode['type']]> = [
      ['submit', 'RECTANGLE'],
      ['resolve', 'RECTANGLE'],
      ['batch', 'RECTANGLE'],
      ['post', 'RECTANGLE'],
      ['write', 'RECTANGLE'],
      ['insert', 'ELLIPSE'],
      ['update', 'RECTANGLE']
    ]
    const nodes = nodeTypes.map(([id, type]) => elementNode(graph, owner.id, id, type))
    const positions = new Map(
      nodeTypes.map(([id, type]) => [
        id,
        absolutePosition(graph, elementNode(graph, owner.id, id, type))
      ])
    )

    expect(first.ownerId).toBe('smylr-technical-flow-save-finding-mermaid')
    expect(first.screenIds).toEqual([])
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain('subgraph client["UI"]')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toStartWith('flowchart TB')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain('subgraph service["Application"]')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain(
      'subgraph persistence["Persistence"]'
    )
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain('post --> write')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain('post -.-> recovery')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain('recovery -.-> batch')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).toContain('insert --> update')
    expect(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE).not.toContain('insert -->|201| update')
    expect(new Set(nodes.map((node) => absolutePosition(graph, node).y)).size).toBe(3)
    expect(positions.get('submit')?.y).toBeLessThan(positions.get('resolve')?.y ?? 0)
    expect(positions.get('submit')?.x).toBe(positions.get('resolve')?.x)
    expect(positions.get('resolve')?.y).toBe(positions.get('batch')?.y)
    expect(positions.get('batch')?.y).toBe(positions.get('post')?.y)
    expect(
      absolutePosition(graph, elementNode(graph, owner.id, 'recovery', 'RECTANGLE')).y
    ).toBeGreaterThan(positions.get('post')?.y ?? 0)
    expect(positions.get('write')?.y).toBe(positions.get('insert')?.y)
    expect(positions.get('insert')?.y).toBe(positions.get('update')?.y)
    expect(positions.get('write')?.x).toBeGreaterThan(positions.get('insert')?.x ?? 0)
    expect(positions.get('insert')?.x).toBeGreaterThan(positions.get('update')?.x ?? 0)
    expect(owner.width).toBeGreaterThan(800)
    expect(owner.width).toBeLessThan(1_000)
    expect(owner.height).toBeGreaterThanOrEqual(700)
    expect(owner.height).toBeLessThanOrEqual(760)

    expect(elementNode(graph, owner.id, 'client-boundary', 'TEXT').text).toBe('UI')
    expect(elementNode(graph, owner.id, 'service-boundary', 'TEXT').text).toBe('Application')
    expect(elementNode(graph, owner.id, 'persistence-boundary', 'TEXT').text).toBe('Persistence')
    const clientBoundary = elementNode(graph, owner.id, 'client-boundary', 'RECTANGLE')
    const serviceBoundary = elementNode(graph, owner.id, 'service-boundary', 'RECTANGLE')
    const persistenceBoundary = elementNode(graph, owner.id, 'persistence-boundary', 'RECTANGLE')
    const clientBoundaryPosition = absolutePosition(graph, clientBoundary)
    const serviceBoundaryPosition = absolutePosition(graph, serviceBoundary)
    const persistenceBoundaryPosition = absolutePosition(graph, persistenceBoundary)
    expect(serviceBoundaryPosition.y - (clientBoundaryPosition.y + clientBoundary.height)).toBe(48)
    expect(
      persistenceBoundaryPosition.y - (serviceBoundaryPosition.y + serviceBoundary.height)
    ).toBe(48)
    expect((positions.get('resolve')?.y ?? 0) - serviceBoundaryPosition.y).toBe(48)
    expect((positions.get('write')?.y ?? 0) - persistenceBoundaryPosition.y).toBe(48)
    expect(clientBoundary.width).toBe(serviceBoundary.width)
    expect(serviceBoundary.width).toBe(persistenceBoundary.width)
    expect(clientBoundary.strokes).toEqual([])
    expect(serviceBoundary.strokes).toEqual([])
    expect(persistenceBoundary.strokes).toEqual([])
    const serviceTitle = elementNode(graph, owner.id, 'service-boundary', 'TEXT')
    expect(serviceTitle.fontSize).toBe(18)
    expect(serviceTitle.textAlignHorizontal).toBe('LEFT')
    expect(elementNode(graph, owner.id, 'submit', 'TEXT').fontSize).toBe(20)
    expect(
      descendants(graph, owner.id).some(
        (node) =>
          node.type === 'TEXT' &&
          pluginValue(node, OPEN_PENCIL_PLUGIN_ID, 'mermaid/element-id') === 'post-to-recovery'
      )
    ).toBe(false)
    expect(
      descendants(graph, owner.id).some(
        (node) =>
          node.type === 'TEXT' &&
          pluginValue(node, OPEN_PENCIL_PLUGIN_ID, 'mermaid/element-id') === 'insert-to-update'
      )
    ).toBe(false)
    expect(
      nodes.map(
        (node) =>
          elementNode(
            graph,
            owner.id,
            node.pluginData.find(
              (entry) =>
                entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === 'mermaid/element-id'
            )?.value ?? '',
            'TEXT'
          ).text
      )
    ).toEqual([
      'Save finding\nDental Chart',
      'Resolve chart codes\nConditional resolver',
      'Build payload\nBatch conditions',
      'POST conditions\n/api/patients/:id',
      'Write rows\nPersistence adapter',
      'patient_conditions\nCommit rows',
      'Saved\nPatient store updated'
    ])

    const primaryConnectorIds = [
      'submit-to-resolve',
      'resolve-to-batch',
      'batch-to-post',
      'post-to-write',
      'write-to-insert',
      'insert-to-update'
    ]
    for (const id of primaryConnectorIds) {
      const stroke = connectorNode(graph, owner.id, id).strokes[0]
      expect(stroke).toMatchObject({ cap: 'ROUND', dashPattern: [], join: 'ROUND', weight: 2.5 })
    }
    expect(connectorNode(graph, owner.id, 'resolve-to-batch').strokes[0]?.color).toEqual(
      parseColor('#837dc4')
    )
    expect(connectorNode(graph, owner.id, 'insert-to-update').strokes[0]?.color).toEqual(
      parseColor('#45ad70')
    )

    const recovery = elementNode(graph, owner.id, 'recovery', 'RECTANGLE')
    expect(absolutePosition(graph, recovery).y).toBeGreaterThan(
      absolutePosition(graph, nodes[0] ?? recovery).y
    )
    expect(elementNode(graph, owner.id, 'recovery', 'TEXT').text).toBe(
      'Save failed\nPreserve & retry'
    )
    for (const id of ['post-to-recovery', 'recovery-to-batch']) {
      const stroke = connectorNode(graph, owner.id, id).strokes[0]
      expect(stroke).toMatchObject({
        cap: 'ROUND',
        dashPattern: [8, 6],
        join: 'ROUND',
        weight: 2.25
      })
      expect(stroke?.color).toEqual(parseColor('#e16675'))
    }
    expect(connectorVertices(graph, owner.id, 'post-to-recovery')).toEqual([
      { x: 52, y: 0 },
      { x: 28, y: 0 },
      { x: 28, y: 192 },
      { x: 0, y: 192 }
    ])
    expect(connectorVertices(graph, owner.id, 'recovery-to-batch')).toEqual([
      { x: 0, y: 108 },
      { x: 0, y: 0 }
    ])
    expect(connectorVertices(graph, owner.id, 'post-to-write')).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 300 }
    ])
    const failureVertices = absoluteConnectorVertices(graph, owner.id, 'post-to-recovery')
    const retryVertices = absoluteConnectorVertices(graph, owner.id, 'recovery-to-batch')
    expect(Math.abs((failureVertices?.[1]?.x ?? 0) - (retryVertices?.[0]?.x ?? 0))).toBeGreaterThan(
      48
    )

    const clientFill = parseColor('#1d2130')
    const neutralFill = parseColor('#191d26')
    const requestFill = parseColor('#272345')
    const dataFill = parseColor('#16232c')
    const successFill = parseColor('#153027')
    expect(nodes.map((node) => node.fills[0]?.color)).toEqual([
      clientFill,
      neutralFill,
      neutralFill,
      requestFill,
      dataFill,
      dataFill,
      successFill
    ])

    expect(pluginValue(owner, OPEN_PENCIL_PLUGIN_ID, 'mermaid/source')).toBe(
      TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE
    )
    expect(pluginValue(owner, OPEN_PENCIL_PLUGIN_ID, 'mermaid/diagram-id')).toBe(
      'technical-flow-save-finding-mermaid'
    )
    expect(pluginValue(owner, SMYLR_PLUGIN_ID, 'technicalFlowVisualVersion')).toBe('14')
    expect(
      graph
        .getChildren(page.id)
        .filter((node) => pluginValue(node, SMYLR_PLUGIN_ID, 'kind') === 'live-app-frame')
    ).toHaveLength(0)

    const second = syncTechnicalFlowScene(graph, page.id)
    expect(second.changed).toBe(false)
    expect(second.ownerId).toBe(first.ownerId)
  })

  test('redraws an older visual projection without changing its owner or source identity', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    const first = syncTechnicalFlowScene(graph, page.id)
    const owner = first.ownerId ? graph.getNode(first.ownerId) : null
    if (!owner) throw new Error('Expected a Technical Flow Mermaid owner')
    const source = pluginValue(owner, OPEN_PENCIL_PLUGIN_ID, 'mermaid/source')
    const diagramId = pluginValue(owner, OPEN_PENCIL_PLUGIN_ID, 'mermaid/diagram-id')
    const previousChildIds = descendants(graph, owner.id).map((node) => node.id)

    graph.updateNode(owner.id, {
      pluginData: owner.pluginData.filter(
        (entry) =>
          !(entry.pluginId === SMYLR_PLUGIN_ID && entry.key === 'technicalFlowVisualVersion')
      )
    })

    const migrated = syncTechnicalFlowScene(graph, page.id)
    const migratedOwner = graph.getNode(owner.id)
    if (!migratedOwner) throw new Error('Expected the migrated Technical Flow owner')

    expect(migrated.changed).toBe(true)
    expect(migrated.ownerId).toBe(owner.id)
    expect(pluginValue(migratedOwner, OPEN_PENCIL_PLUGIN_ID, 'mermaid/source')).toBe(source)
    expect(pluginValue(migratedOwner, OPEN_PENCIL_PLUGIN_ID, 'mermaid/diagram-id')).toBe(diagramId)
    expect(descendants(graph, migratedOwner.id).map((node) => node.id)).not.toEqual(
      previousChildIds
    )
    expect(syncTechnicalFlowScene(graph, page.id).changed).toBe(false)
  })
})
