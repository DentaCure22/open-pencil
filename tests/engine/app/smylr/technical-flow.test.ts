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

function connectorStroke(graph: SceneGraph, ownerId: string, elementId: string) {
  const stroke = connectorNode(graph, ownerId, elementId).strokes[0]
  if (!stroke) throw new Error(`Missing ${elementId} stroke`)
  return stroke
}

function connectorVertices(graph: SceneGraph, ownerId: string, elementId: string) {
  const vertices = connectorNode(graph, ownerId, elementId).vectorNetwork?.vertices
  if (!vertices) throw new Error(`Missing ${elementId} vertices`)
  return vertices.map(({ x, y }) => ({
    x,
    y
  }))
}

function absoluteConnectorVertices(graph: SceneGraph, ownerId: string, elementId: string) {
  const connector = connectorNode(graph, ownerId, elementId)
  const origin = absolutePosition(graph, connector)
  const vertices = connector.vectorNetwork?.vertices
  if (!vertices) throw new Error(`Missing ${elementId} vertices`)
  return vertices.map(({ x, y }) => ({
    x: x + origin.x,
    y: y + origin.y
  }))
}

function elementLabel(graph: SceneGraph, ownerId: string, node: SceneNode): string | undefined {
  const id = pluginValue(node, OPEN_PENCIL_PLUGIN_ID, 'mermaid/element-id')
  if (!id) throw new Error(`Missing Mermaid element id for ${node.id}`)
  return elementNode(graph, ownerId, id, 'TEXT').text
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

    const nodes = {
      submit: elementNode(graph, owner.id, 'submit', 'RECTANGLE'),
      resolve: elementNode(graph, owner.id, 'resolve', 'RECTANGLE'),
      batch: elementNode(graph, owner.id, 'batch', 'RECTANGLE'),
      post: elementNode(graph, owner.id, 'post', 'RECTANGLE'),
      write: elementNode(graph, owner.id, 'write', 'RECTANGLE'),
      insert: elementNode(graph, owner.id, 'insert', 'ELLIPSE'),
      update: elementNode(graph, owner.id, 'update', 'RECTANGLE')
    }
    const nodeList = Object.values(nodes)
    const at = (node: SceneNode) => absolutePosition(graph, node)

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
    expect(new Set(nodeList.map((node) => absolutePosition(graph, node).y)).size).toBe(3)
    expect(at(nodes.submit).y).toBeLessThan(at(nodes.resolve).y)
    expect(at(nodes.submit).x).toBe(at(nodes.resolve).x)
    expect(at(nodes.resolve).y).toBe(at(nodes.batch).y)
    expect(at(nodes.batch).y).toBe(at(nodes.post).y)
    expect(
      absolutePosition(graph, elementNode(graph, owner.id, 'recovery', 'RECTANGLE')).y
    ).toBeGreaterThan(at(nodes.post).y)
    expect(at(nodes.write).y).toBe(at(nodes.insert).y)
    expect(at(nodes.insert).y).toBe(at(nodes.update).y)
    expect(at(nodes.write).x).toBeGreaterThan(at(nodes.insert).x)
    expect(at(nodes.insert).x).toBeGreaterThan(at(nodes.update).x)
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
    expect(at(nodes.resolve).y - serviceBoundaryPosition.y).toBe(48)
    expect(at(nodes.write).y - persistenceBoundaryPosition.y).toBe(48)
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
    expect(nodeList.map((node) => elementLabel(graph, owner.id, node))).toEqual([
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
      const stroke = connectorStroke(graph, owner.id, id)
      expect(stroke).toMatchObject({ cap: 'ROUND', dashPattern: [], join: 'ROUND', weight: 2.5 })
    }
    expect(connectorStroke(graph, owner.id, 'resolve-to-batch').color).toEqual(
      parseColor('#837dc4')
    )
    expect(connectorStroke(graph, owner.id, 'insert-to-update').color).toEqual(
      parseColor('#45ad70')
    )

    const recovery = elementNode(graph, owner.id, 'recovery', 'RECTANGLE')
    expect(absolutePosition(graph, recovery).y).toBeGreaterThan(
      absolutePosition(graph, nodes.submit).y
    )
    expect(elementNode(graph, owner.id, 'recovery', 'TEXT').text).toBe(
      'Save failed\nPreserve & retry'
    )
    for (const id of ['post-to-recovery', 'recovery-to-batch']) {
      const stroke = connectorStroke(graph, owner.id, id)
      expect(stroke).toMatchObject({
        cap: 'ROUND',
        dashPattern: [8, 6],
        join: 'ROUND',
        weight: 2.25
      })
      expect(stroke.color).toEqual(parseColor('#e16675'))
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
    const failureBend = failureVertices[1]
    const retryStart = retryVertices[0]
    if (!failureBend || !retryStart) throw new Error('Missing failure connector bend')
    expect(Math.abs(failureBend.x - retryStart.x)).toBeGreaterThan(48)

    const clientFill = parseColor('#1d2130')
    const neutralFill = parseColor('#191d26')
    const requestFill = parseColor('#272345')
    const dataFill = parseColor('#16232c')
    const successFill = parseColor('#153027')
    expect(nodeList.map((node) => node.fills[0]?.color)).toEqual([
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
        .filter((node) => pluginValue(node, SMYLR_PLUGIN_ID, 'kind') === 'smylr-code-object-frame')
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
