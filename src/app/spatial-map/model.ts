import { WorkspaceDomainError } from '@/app/workspace'

import type {
  SpatialMapEdgeSpec,
  SpatialMapModel,
  SpatialMapNodeKind,
  SpatialMapNodeSpec,
  SpatialMapNodeStatus,
  SpatialMapObjectIds,
  SpatialMapSpec
} from './types'

type UnknownRecord = { [key: string]: unknown }

const NODE_KINDS = new Set<SpatialMapNodeKind>([
  'capability',
  'constraint',
  'foundation',
  'intent',
  'outcome'
])
const NODE_STATUSES = new Set<SpatialMapNodeStatus>(['missing', 'partial', 'proven'])
const EDGE_TYPES = new Set<SpatialMapEdgeSpec['relationshipType']>([
  'blocks',
  'depends-on',
  'enables',
  'produces'
])
const NODE_WIDTH = 158
const NODE_HEIGHT = 108

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function strings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    return null
  }
  return value.map((item) => item.trim())
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new WorkspaceDomainError('validation_failed', `${label} is required`)
  }
  return value.trim()
}

export function spatialMapStablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) throw new WorkspaceDomainError('validation_failed', 'spatial map id is required')
  return result.slice(0, 70)
}

export function spatialMapObjectIds(spec: Pick<SpatialMapSpec, 'edges' | 'id' | 'nodes'>) {
  const mapId = spatialMapStablePart(spec.id)
  const nodeEntries = spec.nodes.map(
    (node) => [node.id, `graph-node_${mapId}-${spatialMapStablePart(node.id)}`] as const
  )
  const edgeEntries = spec.edges.map(
    (edge) => [edge.id, `graph-edge_${mapId}-${spatialMapStablePart(edge.id)}`] as const
  )
  return {
    board: `html-board_${mapId}`,
    edges: Object.fromEntries(edgeEntries),
    evidenceManifest: `evidence-manifest_${mapId}`,
    graph: `dependency-map_${mapId}`,
    intent: `intent-record_${mapId}`,
    nodes: Object.fromEntries(nodeEntries),
    surface: `surface-run_${mapId}`
  } satisfies SpatialMapObjectIds
}

function parseNode(value: unknown): SpatialMapNodeSpec {
  if (!isRecord(value)) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map node must be an object')
  }
  const kind = requiredString(value.kind, 'spatial map node kind') as SpatialMapNodeKind
  const status = requiredString(value.status, 'spatial map node status') as SpatialMapNodeStatus
  const evidenceItemIds = strings(value.evidenceItemIds)
  if (!NODE_KINDS.has(kind) || !NODE_STATUSES.has(status) || !evidenceItemIds) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map node is invalid')
  }
  return {
    evidenceItemIds,
    id: requiredString(value.id, 'spatial map node id'),
    kind,
    label: requiredString(value.label, 'spatial map node label'),
    status,
    summary: requiredString(value.summary, 'spatial map node summary')
  }
}

function parseEdge(value: unknown): SpatialMapEdgeSpec {
  if (!isRecord(value)) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map edge must be an object')
  }
  const relationshipType = requiredString(
    value.relationshipType,
    'spatial map relationship type'
  ) as SpatialMapEdgeSpec['relationshipType']
  if (
    !EDGE_TYPES.has(relationshipType) ||
    typeof value.confidence !== 'number' ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map edge is invalid')
  }
  return {
    confidence: value.confidence,
    id: requiredString(value.id, 'spatial map edge id'),
    label: requiredString(value.label, 'spatial map edge label'),
    relationshipType,
    sourceId: requiredString(value.sourceId, 'spatial map edge source'),
    targetId: requiredString(value.targetId, 'spatial map edge target')
  }
}

export function validateSpatialMapSpec(value: unknown): SpatialMapSpec {
  if (!isRecord(value) || !isRecord(value.intent)) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map spec is unavailable')
  }
  if (
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !Array.isArray(value.evidence)
  ) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map spec collections are invalid')
  }
  const nodes = value.nodes.map(parseNode)
  const edges = value.edges.map(parseEdge)
  const nodeIds = nodes.map((node) => node.id)
  const edgeIds = edges.map((edge) => edge.id)
  const evidenceItemIds = value.evidence.flatMap((item) =>
    isRecord(item) && typeof item.id === 'string' ? [item.id] : []
  )
  const constraints = strings(value.intent.constraints)
  if (
    new Set(nodeIds).size !== nodeIds.length ||
    new Set(edgeIds).size !== edgeIds.length ||
    new Set(evidenceItemIds).size !== value.evidence.length ||
    !constraints
  ) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map IDs must be unique')
  }
  const knownNodes = new Set(nodeIds)
  const knownEvidence = new Set(evidenceItemIds)
  if (
    edges.some((edge) => !knownNodes.has(edge.sourceId) || !knownNodes.has(edge.targetId)) ||
    nodes.some((node) => node.evidenceItemIds.some((id) => !knownEvidence.has(id)))
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'spatial map relationships and evidence must reference known IDs'
    )
  }
  const defaultFocusedNodeId = requiredString(
    value.defaultFocusedNodeId,
    'spatial map default focus'
  )
  if (!knownNodes.has(defaultFocusedNodeId)) {
    throw new WorkspaceDomainError('validation_failed', 'spatial map default focus is unknown')
  }
  const spec = {
    capturedAt: requiredString(value.capturedAt, 'spatial map capture time'),
    defaultFocusedNodeId,
    edges,
    evidence: value.evidence,
    id: requiredString(value.id, 'spatial map id'),
    insight: requiredString(value.insight, 'spatial map insight'),
    intent: {
      constraints,
      desiredOutcome: requiredString(value.intent.desiredOutcome, 'spatial map desired outcome'),
      statement: requiredString(value.intent.statement, 'spatial map intent')
    },
    nodes,
    question: requiredString(value.question, 'spatial map question'),
    title: requiredString(value.title, 'spatial map title')
  } as SpatialMapSpec
  deriveSpatialMapModel(spec)
  return spec
}

export function deriveSpatialMapModel(
  spec: SpatialMapSpec,
  focusedNodeId = spec.defaultFocusedNodeId
): SpatialMapModel {
  const nodeIndex = new Map(spec.nodes.map((node, index) => [node.id, index]))
  if (!nodeIndex.has(focusedNodeId)) {
    throw new WorkspaceDomainError('validation_failed', `unknown spatial map node ${focusedNodeId}`)
  }
  const incoming = new Map(spec.nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(spec.nodes.map((node) => [node.id, [] as SpatialMapEdgeSpec[]]))
  for (const edge of spec.edges) {
    if (!incoming.has(edge.sourceId) || !incoming.has(edge.targetId)) {
      throw new WorkspaceDomainError('validation_failed', `invalid spatial map edge ${edge.id}`)
    }
    incoming.set(edge.targetId, (incoming.get(edge.targetId) ?? 0) + 1)
    outgoing.get(edge.sourceId)?.push(edge)
  }
  const remaining = new Map(incoming)
  const queue = spec.nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id)
  const order: string[] = []
  const layer = new Map(spec.nodes.map((node) => [node.id, 0]))
  while (queue.length > 0) {
    queue.sort((left, right) => (nodeIndex.get(left) ?? 0) - (nodeIndex.get(right) ?? 0))
    const current = queue.shift()
    if (!current) break
    order.push(current)
    for (const edge of outgoing.get(current) ?? []) {
      layer.set(
        edge.targetId,
        Math.max(layer.get(edge.targetId) ?? 0, (layer.get(current) ?? 0) + 1)
      )
      const next = (remaining.get(edge.targetId) ?? 0) - 1
      remaining.set(edge.targetId, next)
      if (next === 0) queue.push(edge.targetId)
    }
  }
  if (order.length !== spec.nodes.length) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'dependency maps must expose cycles instead of silently laying them out'
    )
  }
  const groups = new Map<number, SpatialMapNodeSpec[]>()
  for (const node of spec.nodes) {
    const nodeLayer = layer.get(node.id) ?? 0
    groups.set(nodeLayer, [...(groups.get(nodeLayer) ?? []), node])
  }
  const maxRows = Math.max(...[...groups.values()].map((group) => group.length))
  const ids = spatialMapObjectIds(spec)
  const nodes = spec.nodes.map((node) => {
    const nodeLayer = layer.get(node.id) ?? 0
    const group = groups.get(nodeLayer) ?? []
    const row = group.findIndex((candidate) => candidate.id === node.id)
    return {
      ...node,
      layer: nodeLayer,
      workspaceObjectId: ids.nodes[node.id] ?? '',
      x: 32 + nodeLayer * 174,
      y: 112 + row * 146 + (maxRows - group.length) * 48
    }
  })
  const layoutById = new Map(nodes.map((node) => [node.id, node]))
  const edges = spec.edges.map((edge) => {
    const source = layoutById.get(edge.sourceId)
    const target = layoutById.get(edge.targetId)
    if (!source || !target) {
      throw new WorkspaceDomainError('validation_failed', `invalid spatial map edge ${edge.id}`)
    }
    const startX = source.x + NODE_WIDTH
    const startY = source.y + NODE_HEIGHT / 2
    const endX = target.x
    const endY = target.y + NODE_HEIGHT / 2
    const bend = Math.max(34, (endX - startX) * 0.48)
    return {
      ...edge,
      path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`,
      workspaceObjectId: ids.edges[edge.id] ?? ''
    }
  })
  const distance = new Map(spec.nodes.map((node) => [node.id, 1]))
  const predecessor = new Map<string, string>()
  for (const sourceId of order) {
    for (const edge of outgoing.get(sourceId) ?? []) {
      const candidate = (distance.get(sourceId) ?? 1) + 1
      if (candidate > (distance.get(edge.targetId) ?? 1)) {
        distance.set(edge.targetId, candidate)
        predecessor.set(edge.targetId, sourceId)
      }
    }
  }
  const terminal = [...order].sort((left, right) => {
    const difference = (distance.get(right) ?? 1) - (distance.get(left) ?? 1)
    return difference || (nodeIndex.get(left) ?? 0) - (nodeIndex.get(right) ?? 0)
  })[0]
  const criticalPathNodeIds: string[] = []
  let cursor = terminal
  while (cursor) {
    criticalPathNodeIds.unshift(cursor)
    cursor = predecessor.get(cursor) ?? ''
  }
  return {
    criticalPathNodeIds,
    edges,
    focusedNodeId,
    leafNodeIds: spec.nodes
      .filter((node) => (outgoing.get(node.id) ?? []).length === 0)
      .map((node) => node.id),
    nodes,
    rootNodeIds: spec.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)
  }
}
