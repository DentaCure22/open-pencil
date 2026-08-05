import DENTAL_CHART_JOURNEY_SOURCE from './dental-chart-journey.md?raw'
import DENTAL_CHART_SCREEN_STATES_SOURCE from './dental-chart-screen-states.md?raw'
import PRODUCT_MAP_DENTAL_CHART_SOURCE from './product-map.md?raw'
import SAVE_FINDING_RECOVERY_SOURCE from './save-finding-recovery.md?raw'
import TASK_FLOW_RECORD_FINDING_SOURCE from './task-flow-record-finding.md?raw'
import TECHNICAL_FLOW_SAVE_FINDING_SOURCE from './technical-flow-save-finding.md?raw'
import USER_JOURNEY_COMPLETE_DENTAL_EXAM_SOURCE from './user-journey-complete-dental-exam.md?raw'

export type AppScreenFlowLane = 'alternate' | 'feedback' | 'primary'
export type AppScreenFlowNodeKind = 'entry' | 'exit' | 'feedback' | 'screen'
export type AppScreenFlowEdgeKind = 'alternate' | 'entry' | 'exit' | 'feedback' | 'primary'

export type AppScreenFlowNode = {
  author?: string
  body?: string
  captureSrc?: string
  column?: number
  id: string
  kind: AppScreenFlowNodeKind
  label: string
  lane: AppScreenFlowLane
  pageId?: string
  route?: string
  status?: string
  state?: string
}

export type AppScreenFlowEdge = {
  id: string
  kind: AppScreenFlowEdgeKind
  label: string
  sourceId: string
  targetId: string
}

export type AppScreenFlowDefinition = {
  edges: AppScreenFlowEdge[]
  id: string
  label: string
  nodes: AppScreenFlowNode[]
  pageId: string
  route: string
  schemaVersion: string
  source: string
  sourceFile: string
}

type JsonRecord = Record<string, unknown>

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: JsonRecord, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${context} requires a non-empty ${key}`)
  }
  return value.trim()
}

function optionalString(record: JsonRecord, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalNumber(record: JsonRecord, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function fencedSources(source: string, language: string): string[] {
  const escaped = language.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const fence = '```'
  const pattern = new RegExp(`${fence}${escaped}\\s*\\n([\\s\\S]*?)\\n${fence}`, 'gi')
  return [...source.matchAll(pattern)].map((match) => match[1]?.trim() ?? '')
}

function parseJsonFence(source: string, context: string): JsonRecord {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON'
    throw new Error(`${context} could not be parsed: ${message}`)
  }
  if (!isJsonRecord(value)) throw new Error(`${context} must contain a JSON object`)
  return value
}

function parseLane(record: JsonRecord, context: string): AppScreenFlowLane {
  const lane = requiredString(record, 'lane', context)
  if (lane === 'alternate' || lane === 'feedback' || lane === 'primary') return lane
  throw new Error(`${context} has unsupported lane ${lane}`)
}

function parseNodeKind(record: JsonRecord, context: string): AppScreenFlowNodeKind {
  const kind = requiredString(record, 'kind', context)
  if (kind === 'entry' || kind === 'exit' || kind === 'feedback' || kind === 'screen') {
    return kind
  }
  throw new Error(`${context} has unsupported kind ${kind}`)
}

function parseNode(source: string, index: number, language: string): AppScreenFlowNode {
  const context = `${language} block ${index + 1}`
  const record = parseJsonFence(source, context)
  const node: AppScreenFlowNode = {
    author: optionalString(record, 'author'),
    body: optionalString(record, 'body'),
    captureSrc: optionalString(record, 'captureSrc'),
    column: optionalNumber(record, 'column'),
    id: requiredString(record, 'id', context),
    kind: parseNodeKind(record, context),
    label: requiredString(record, 'label', context),
    lane: parseLane(record, context),
    pageId: optionalString(record, 'pageId'),
    route: optionalString(record, 'route'),
    status: optionalString(record, 'status'),
    state: optionalString(record, 'state')
  }
  if (node.kind === 'screen' && !node.state) {
    throw new Error(`${context} screen requires a state`)
  }
  if (language === 'openpencil-feedback' && node.kind !== 'feedback') {
    throw new Error(`${context} must use kind feedback`)
  }
  return node
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

function edgeKind(source: AppScreenFlowNode, target: AppScreenFlowNode): AppScreenFlowEdgeKind {
  if (source.kind === 'entry') return 'entry'
  if (target.kind === 'exit') return 'exit'
  if (source.lane === 'feedback' || target.lane === 'feedback') return 'feedback'
  if (source.lane === 'alternate' || target.lane === 'alternate') return 'alternate'
  return 'primary'
}

function parseMermaidEdges(source: string, nodes: AppScreenFlowNode[]): AppScreenFlowEdge[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const ids = new Set<string>()
  const edges: AppScreenFlowEdge[] = []
  const edgePattern = /^\s*([a-z0-9-]+)\s+(-->|-\.->)\|([^|]+)\|\s+([a-z0-9-]+)\s*$/i
  for (const line of source.split('\n')) {
    const match = edgePattern.exec(line)
    if (!match) continue
    const [, sourceId = '', , rawLabel = '', targetId = ''] = match
    const sourceNode = nodesById.get(sourceId)
    const targetNode = nodesById.get(targetId)
    if (!sourceNode || !targetNode) {
      throw new Error(`Mermaid edge ${sourceId} to ${targetId} references an unknown view`)
    }
    const label = rawLabel.trim()
    const baseId = slug(label) || `${sourceId}-to-${targetId}`
    const id = ids.has(baseId) ? `${baseId}-${sourceId}-${targetId}` : baseId
    ids.add(id)
    edges.push({
      id,
      kind: edgeKind(sourceNode, targetNode),
      label,
      sourceId,
      targetId
    })
  }
  if (edges.length === 0) throw new Error('Journey Markdown requires at least one Mermaid edge')
  return edges
}

export function parseAppScreenFlowMarkdown(source: string): AppScreenFlowDefinition {
  const manifestSources = fencedSources(source, 'openpencil-journey')
  if (manifestSources.length !== 1) {
    throw new Error('Journey Markdown requires exactly one openpencil-journey block')
  }
  const manifestSource = manifestSources[0]
  if (!manifestSource) throw new Error('Journey Markdown manifest is empty')
  const manifest = parseJsonFence(manifestSource, 'openpencil-journey block')
  const nodes = [
    ...fencedSources(source, 'openpencil-view').map((block, index) =>
      parseNode(block, index, 'openpencil-view')
    ),
    ...fencedSources(source, 'openpencil-feedback').map((block, index) =>
      parseNode(block, index, 'openpencil-feedback')
    )
  ]
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id)) throw new Error(`Journey Markdown repeats view id ${node.id}`)
    nodeIds.add(node.id)
  }
  const mermaidSources = fencedSources(source, 'mermaid')
  if (mermaidSources.length !== 1 || !mermaidSources[0]) {
    throw new Error('Journey Markdown requires exactly one Mermaid block')
  }
  return {
    edges: parseMermaidEdges(mermaidSources[0], nodes),
    id: requiredString(manifest, 'id', 'openpencil-journey block'),
    label: requiredString(manifest, 'label', 'openpencil-journey block'),
    nodes,
    pageId: requiredString(manifest, 'pageId', 'openpencil-journey block'),
    route: requiredString(manifest, 'route', 'openpencil-journey block'),
    schemaVersion: requiredString(manifest, 'schemaVersion', 'openpencil-journey block'),
    source,
    sourceFile: requiredString(manifest, 'sourceFile', 'openpencil-journey block')
  }
}

export const DENTAL_CHART_APP_FLOW = parseAppScreenFlowMarkdown(DENTAL_CHART_JOURNEY_SOURCE)

export const PRODUCT_MAP_DENTAL_CHART_APP_FLOW = parseAppScreenFlowMarkdown(
  PRODUCT_MAP_DENTAL_CHART_SOURCE
)

export const USER_JOURNEY_COMPLETE_DENTAL_EXAM_APP_FLOW = parseAppScreenFlowMarkdown(
  USER_JOURNEY_COMPLETE_DENTAL_EXAM_SOURCE
)

export const TASK_FLOW_RECORD_FINDING_APP_FLOW = parseAppScreenFlowMarkdown(
  TASK_FLOW_RECORD_FINDING_SOURCE
)

export const SCREEN_STATES_DENTAL_CHART_APP_FLOW = parseAppScreenFlowMarkdown(
  DENTAL_CHART_SCREEN_STATES_SOURCE
)

export const SAVE_FINDING_RECOVERY_APP_FLOW = parseAppScreenFlowMarkdown(
  SAVE_FINDING_RECOVERY_SOURCE
)

export const TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW = parseAppScreenFlowMarkdown(
  TECHNICAL_FLOW_SAVE_FINDING_SOURCE
)

export const SMYLR_DURABLE_APP_FLOW_DEFINITIONS = [
  USER_JOURNEY_COMPLETE_DENTAL_EXAM_APP_FLOW,
  TASK_FLOW_RECORD_FINDING_APP_FLOW,
  SCREEN_STATES_DENTAL_CHART_APP_FLOW,
  SAVE_FINDING_RECOVERY_APP_FLOW,
  TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW
] as const

const APP_SCREEN_FLOW_DEFINITIONS = [
  DENTAL_CHART_APP_FLOW,
  PRODUCT_MAP_DENTAL_CHART_APP_FLOW,
  ...SMYLR_DURABLE_APP_FLOW_DEFINITIONS
] as const

export function appScreenFlowDefinitionById(
  flowId: string | undefined
): AppScreenFlowDefinition | undefined {
  return APP_SCREEN_FLOW_DEFINITIONS.find((definition) => definition.id === flowId)
}
