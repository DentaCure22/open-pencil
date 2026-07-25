import {
  MERMAID_DIAGRAM_REVISION,
  MERMAID_PARSER,
  createMermaidSceneSpec,
  isMermaidDiagramContainer,
  mermaidDiagramName,
  type MermaidDiagram,
  type MermaidSkeletonElement
} from '@open-pencil/core/diagram'
import {
  createMermaidDiagramInGraph,
  mermaidDiagramOwner,
  replaceMermaidDiagramInGraph
} from '@open-pencil/core/editor'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW,
  type AppScreenFlowDefinition
} from './app-flow/model'
import TECHNICAL_FLOW_MERMAID_SOURCE from './technical-flow-save-finding.mmd?raw'

const PLUGIN_ID = 'smylr-production'
const OPEN_PENCIL_PLUGIN_ID = 'open-pencil'
const TECHNICAL_FLOW_KIND = 'technical-flow-mermaid'
const TECHNICAL_FLOW_OWNER_KEY = 'technicalFlowOwnerKey'
const TECHNICAL_FLOW_OWNER_VALUE = 'technical-flow-save-finding'
const TECHNICAL_FLOW_OWNER_ID = 'smylr-technical-flow-save-finding-mermaid'
const TECHNICAL_FLOW_DIAGRAM_ID = 'technical-flow-save-finding-mermaid'
const TECHNICAL_FLOW_SOURCE_FILE = 'technical-flow-save-finding.mmd'
const TECHNICAL_FLOW_MARKDOWN_FILE = 'technical-flow-save-finding.md'
const TECHNICAL_FLOW_VISUAL_VERSION = '14'
const TECHNICAL_FLOW_MERMAID_X = 320
const TECHNICAL_FLOW_MERMAID_Y = 160

export const TECHNICAL_FLOW_SAVE_FINDING_ID = TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.id
export const TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE = TECHNICAL_FLOW_MERMAID_SOURCE.trim()
export const TECHNICAL_FLOW_SAVE_FINDING_OWNER_KEY = TECHNICAL_FLOW_OWNER_VALUE
export const TECHNICAL_FLOW_SAVE_FINDING_SOURCE_FILE = TECHNICAL_FLOW_SOURCE_FILE
type TechnicalFlowStyle = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  text?: string
}
type TechnicalFlowNode = {
  className?: string
  groupIds: string[]
  id: string
  label: string
  shape: 'ellipse' | 'rectangle'
}
type TechnicalFlowGroup = {
  body: string
  id: string
  label: string
  nodeIds: string[]
  style?: TechnicalFlowStyle
}
type TechnicalFlowEdge = {
  dashed: boolean
  id: string
  label: string
  sourceId: string
  targetId: string
}
type TechnicalFlowSourceModel = {
  edges: TechnicalFlowEdge[]
  groups: TechnicalFlowGroup[]
  nodes: TechnicalFlowNode[]
  styles: Map<string, TechnicalFlowStyle>
}
type TechnicalFlowLayout = {
  height: number
  node: TechnicalFlowNode
  width: number
  x: number
  y: number
}
type TechnicalFlowGridPosition = {
  column: number
  row: number
}

const NODE_WIDTH = 228
const NODE_GAP = 52
const NODE_ROW_STEP = 192
const GROUP_PADDING_X = 28
const GROUP_PADDING_TOP = 48
const GROUP_PADDING_BOTTOM = 12
const RECOVERY_ROUTE_GUTTER = 24
const DEFAULT_NODE_FILL = '#171a22'
const DEFAULT_NODE_STROKE = '#596172'
const DEFAULT_TEXT_COLOR = '#f4f5f7'
const PRIMARY_EDGE_COLOR = '#837dc4'
const RECOVERY_EDGE_COLOR = '#e16675'
const SUCCESS_EDGE_COLOR = '#45ad70'
function normalizeLabel(value: string): string {
  return value
    .replaceAll(/<br\s*\/?\s*>/giu, '\n')
    .replaceAll('&quot;', '"')
    .trim()
}
function parseStyleDeclarations(value: string): TechnicalFlowStyle {
  const style: TechnicalFlowStyle = {}
  for (const declaration of value.split(',')) {
    const separator = declaration.indexOf(':')
    if (separator === -1) continue
    const key = declaration.slice(0, separator).trim()
    const rawValue = declaration.slice(separator + 1).trim()
    if (!rawValue) continue
    if (key === 'fill') style.fill = rawValue
    if (key === 'stroke') style.stroke = rawValue
    if (key === 'color') style.text = rawValue
    if (key === 'stroke-width') {
      const strokeWidth = Number.parseFloat(rawValue)
      if (Number.isFinite(strokeWidth)) style.strokeWidth = strokeWidth
    }
  }
  return style
}
function parseTechnicalFlowSource(source: string): TechnicalFlowSourceModel {
  if (!/^\s*flowchart\s+TB\b/imu.test(source)) {
    throw new Error('Technical Flow Mermaid source must declare a top-to-bottom flowchart')
  }
  const groups: TechnicalFlowGroup[] = [
    ...source.matchAll(/^\s*subgraph\s+([a-z][\w-]*)\["([^"]+)"\]\s*\n([\s\S]*?)^\s*end\s*$/gimu)
  ].map((match) => ({
    body: match[3] ?? '',
    id: match[1] ?? '',
    label: normalizeLabel(match[2] ?? ''),
    nodeIds: []
  }))
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  for (const match of source.matchAll(/^\s*style\s+([a-z][\w-]*)\s+(.+)$/gimu)) {
    const group = groupsById.get(match[1] ?? '')
    if (group) group.style = parseStyleDeclarations(match[2] ?? '')
  }
  const styles = new Map(
    [...source.matchAll(/^\s*classDef\s+([a-z][\w-]*)\s+(.+)$/gimu)].map((match) => [
      match[1] ?? '',
      parseStyleDeclarations(match[2] ?? '')
    ])
  )
  const nodes: TechnicalFlowNode[] = [
    ...source.matchAll(
      /^\s*([a-z][\w-]*)\s*(?:\[\("([^"]*)"\)\]|\["([^"]*)"\])(?::::([a-z][\w-]*))?\s*$/gimu
    )
  ].map((match) => {
    const id = match[1] ?? ''
    const databaseNode = match[0].includes('[(')
    const groupIds = groups
      .filter((group) => group.body.includes(`${id}[`))
      .map((group) => group.id)
    for (const groupId of groupIds) groupsById.get(groupId)?.nodeIds.push(id)
    return {
      className: match[4],
      groupIds,
      id,
      label: normalizeLabel(databaseNode ? match[2] : match[3] || id),
      shape: databaseNode ? 'ellipse' : 'rectangle'
    }
  })
  const edges: TechnicalFlowEdge[] = [
    ...source.matchAll(/^\s*([a-z][\w-]*)\s+(-\.->|-->)\s*(?:\|([^|]+)\|\s*)?([a-z][\w-]*)\s*$/gimu)
  ].map((match) => {
    const sourceId = match[1] ?? ''
    const targetId = match[4] ?? ''
    return {
      dashed: match[2] === '-.->',
      id: `${sourceId}-to-${targetId}`,
      label: normalizeLabel((match[3] ?? '').replaceAll(/^"|"$/gu, '')),
      sourceId,
      targetId
    }
  })
  if (nodes.length === 0 || edges.length === 0) {
    throw new Error('Technical Flow Mermaid source must contain nodes and edges')
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const edge of edges) {
    if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
      throw new Error(`Technical Flow edge ${edge.id} references an unknown Mermaid node`)
    }
  }
  return { edges, groups, nodes, styles }
}
function primaryRanks(model: TechnicalFlowSourceModel): Map<string, number> {
  const ranks = new Map(model.nodes.map((node) => [node.id, 0]))
  const primaryEdges = model.edges.filter((edge) => !edge.dashed)
  let pass = 0
  while (pass < model.nodes.length) {
    let changed = false
    for (const edge of primaryEdges) {
      const sourceRank = ranks.get(edge.sourceId) ?? 0
      const targetRank = ranks.get(edge.targetId) ?? 0
      if (targetRank < sourceRank + 1) {
        ranks.set(edge.targetId, sourceRank + 1)
        changed = true
      }
    }
    if (!changed) break
    pass += 1
  }
  return ranks
}
function technicalFlowLayout(model: TechnicalFlowSourceModel): TechnicalFlowLayout[] {
  const fallbackRanks = primaryRanks(model)
  const positions: Readonly<Record<string, TechnicalFlowGridPosition>> = {
    batch: { column: 1, row: 1 },
    insert: { column: 1, row: 3 },
    post: { column: 2, row: 1 },
    recovery: { column: 1, row: 2 },
    resolve: { column: 0, row: 1 },
    submit: { column: 0, row: 0 },
    update: { column: 0, row: 3 },
    write: { column: 2, row: 3 }
  }

  return model.nodes.map((node) => {
    const position = positions[node.id] ?? { column: fallbackRanks.get(node.id) ?? 0, row: 1 }
    const lineCount = node.label.split('\n').length
    const height = Math.max(84, 44 + lineCount * 20)
    return {
      height,
      node,
      width: NODE_WIDTH,
      x: position.column * (NODE_WIDTH + NODE_GAP),
      y: position.row * NODE_ROW_STEP
    }
  })
}
function nodeLayout(layout: TechnicalFlowLayout[], id: string): TechnicalFlowLayout {
  const result = layout.find((entry) => entry.node.id === id)
  if (!result) throw new Error(`Technical Flow is missing layout for ${id}`)
  return result
}
function boundaryElement(
  group: TechnicalFlowGroup,
  layout: TechnicalFlowLayout[]
): MermaidSkeletonElement | null {
  const members = group.nodeIds.map((id) => nodeLayout(layout, id))
  if (members.length === 0) return null
  const style = group.style ?? {}
  const minX = Math.min(...layout.map((entry) => entry.x))
  const minY = Math.min(...members.map((entry) => entry.y))
  const maxX = Math.max(...layout.map((entry) => entry.x + entry.width))
  const maxY = Math.max(...members.map((entry) => entry.y + entry.height))
  return {
    backgroundColor: style.fill ?? '#11151d',
    cornerRadius: 16,
    fillOpacity: 0.82,
    height: maxY - minY + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
    id: `${group.id}-boundary`,
    label: {
      fontSize: 18,
      strokeColor: style.text ?? DEFAULT_TEXT_COLOR,
      text: group.label,
      textAlign: 'left',
      verticalAlign: 'top'
    },
    groupIds: ['root'],
    strokeColor: 'none',
    type: 'rectangle',
    width: maxX - minX + GROUP_PADDING_X * 2,
    x: minX - GROUP_PADDING_X,
    y: minY - GROUP_PADDING_TOP
  }
}

function nodeElement(
  entry: TechnicalFlowLayout,
  model: TechnicalFlowSourceModel
): MermaidSkeletonElement {
  const style = model.styles.get(entry.node.className ?? '') ?? {}
  return {
    backgroundColor: style.fill ?? DEFAULT_NODE_FILL,
    cornerRadius: 14,
    height: entry.height,
    id: entry.node.id,
    label: {
      fontSize: 20,
      strokeColor: style.text ?? DEFAULT_TEXT_COLOR,
      text: entry.node.label,
      textAlign: 'center',
      verticalAlign: 'middle'
    },
    groupIds: ['root', ...entry.node.groupIds],
    strokeColor: style.stroke ?? DEFAULT_NODE_STROKE,
    strokeWidth: style.strokeWidth ?? 2,
    type: entry.node.shape,
    width: entry.width,
    x: entry.x,
    y: entry.y
  }
}

function edgeElement(
  edge: TechnicalFlowEdge,
  layout: TechnicalFlowLayout[]
): MermaidSkeletonElement {
  const source = nodeLayout(layout, edge.sourceId)
  const target = nodeLayout(layout, edge.targetId)
  const sourceCenter = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  const vertical =
    Math.abs(targetCenter.y - sourceCenter.y) > Math.abs(targetCenter.x - sourceCenter.x)
  const sourcePoint: readonly [number, number] = vertical
    ? [sourceCenter.x, targetCenter.y >= sourceCenter.y ? source.y + source.height : source.y]
    : [targetCenter.x >= sourceCenter.x ? source.x + source.width : source.x, sourceCenter.y]
  const targetPoint: readonly [number, number] = vertical
    ? [targetCenter.x, targetCenter.y >= sourceCenter.y ? target.y : target.y + target.height]
    : [targetCenter.x >= sourceCenter.x ? target.x : target.x + target.width, targetCenter.y]
  const points: readonly (readonly [number, number])[] =
    edge.id === 'post-to-recovery'
      ? [
          [source.x, sourceCenter.y],
          [source.x - RECOVERY_ROUTE_GUTTER, sourceCenter.y],
          [source.x - RECOVERY_ROUTE_GUTTER, targetCenter.y],
          [target.x + target.width, targetCenter.y]
        ]
      : edge.id === 'recovery-to-batch'
        ? [
            [sourceCenter.x, source.y],
            [targetCenter.x, target.y + target.height]
          ]
        : vertical
          ? sourcePoint[0] === targetPoint[0]
            ? [sourcePoint, targetPoint]
            : [
                sourcePoint,
                [sourcePoint[0], (sourcePoint[1] + targetPoint[1]) / 2],
                [targetPoint[0], (sourcePoint[1] + targetPoint[1]) / 2],
                targetPoint
              ]
          : sourcePoint[1] === targetPoint[1]
            ? [sourcePoint, targetPoint]
            : [
                sourcePoint,
                [(sourcePoint[0] + targetPoint[0]) / 2, sourcePoint[1]],
                [(sourcePoint[0] + targetPoint[0]) / 2, targetPoint[1]],
                targetPoint
              ]
  const strokeColor = edge.dashed
    ? RECOVERY_EDGE_COLOR
    : edge.id === 'insert-to-update'
      ? SUCCESS_EDGE_COLOR
      : PRIMARY_EDGE_COLOR
  return {
    endArrowhead: 'arrow',
    id: edge.id,
    label: edge.label
      ? {
          fontSize: 16,
          strokeColor,
          text: edge.label,
          verticalAlign: 'middle'
        }
      : undefined,
    points,
    strokeColor,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeStyle: edge.dashed ? 'dashed' : 'solid',
    strokeWidth: edge.dashed ? 2.25 : 2.5,
    type: 'arrow'
  }
}

function technicalMermaidDiagram(): MermaidDiagram {
  const model = parseTechnicalFlowSource(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
  const layout = technicalFlowLayout(model)
  const boundaries = model.groups
    .map((group) => boundaryElement(group, layout))
    .filter((element): element is MermaidSkeletonElement => element !== null)
  return {
    appearance: 'dark',
    elements: [
      ...boundaries,
      ...model.edges.map((edge) => edgeElement(edge, layout)),
      ...layout.map((entry) => nodeElement(entry, model))
    ],
    files: {},
    parser: MERMAID_PARSER,
    revision: MERMAID_DIAGRAM_REVISION,
    source: TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE
  }
}

const TECHNICAL_FLOW_MERMAID_SCENE = createMermaidSceneSpec(technicalMermaidDiagram())

function pluginData(key: string, value: string) {
  return { key, pluginId: PLUGIN_ID, value }
}

function pluginValue(node: SceneNode | null | undefined, key: string): string | undefined {
  return node?.pluginData.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)?.value
}

function openPencilValue(node: SceneNode | null | undefined, key: string): string | undefined {
  return node?.pluginData.find(
    (entry) => entry.pluginId === OPEN_PENCIL_PLUGIN_ID && entry.key === key
  )?.value
}

function mergePluginData(
  node: SceneNode,
  managedKeys: readonly string[],
  values: SceneNode['pluginData']
) {
  const managed = new Set(managedKeys)
  return [
    ...node.pluginData.filter((entry) => !(entry.pluginId === PLUGIN_ID && managed.has(entry.key))),
    ...values
  ]
}

function technicalOwnerPluginData(ownerId: string): SceneNode['pluginData'] {
  return [
    pluginData('kind', TECHNICAL_FLOW_KIND),
    pluginData('flowId', TECHNICAL_FLOW_OWNER_VALUE),
    pluginData(TECHNICAL_FLOW_OWNER_KEY, TECHNICAL_FLOW_OWNER_VALUE),
    pluginData('technicalFlowOwnerId', ownerId),
    pluginData('technicalFlowSourceFile', TECHNICAL_FLOW_SOURCE_FILE),
    pluginData('technicalFlowVisualVersion', TECHNICAL_FLOW_VISUAL_VERSION)
  ]
}

function stampTechnicalOwner(graph: SceneGraph, owner: SceneNode): boolean {
  const nextPluginData = mergePluginData(
    owner,
    [
      'kind',
      'flowId',
      TECHNICAL_FLOW_OWNER_KEY,
      'technicalFlowOwnerId',
      'technicalFlowSourceFile',
      'technicalFlowVisualVersion'
    ],
    technicalOwnerPluginData(owner.id)
  )
  if (JSON.stringify(owner.pluginData) === JSON.stringify(nextPluginData)) return false
  graph.updateNode(owner.id, { pluginData: nextPluginData })
  return true
}

function stampTechnicalPage(graph: SceneGraph, page: SceneNode, ownerId: string): boolean {
  const nextPluginData = mergePluginData(
    page,
    [
      'kind',
      'pageId',
      'route',
      'flowId',
      'flowSchemaVersion',
      'flowSource',
      'flowSourceFile',
      'flowSourceFormat',
      'technicalFlowOwnerId',
      'technicalFlowDiagramId',
      'technicalFlowSourceFile',
      'technicalFlowSourceFormat',
      'technicalFlowVisualVersion'
    ],
    [
      pluginData('kind', 'smylr-flow-page'),
      pluginData('pageId', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.pageId),
      pluginData('route', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.route),
      pluginData('flowId', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.id),
      pluginData('flowSchemaVersion', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.schemaVersion),
      pluginData('flowSource', TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW.source),
      pluginData('flowSourceFile', TECHNICAL_FLOW_MARKDOWN_FILE),
      pluginData('flowSourceFormat', 'markdown'),
      pluginData('technicalFlowOwnerId', ownerId),
      pluginData('technicalFlowDiagramId', TECHNICAL_FLOW_DIAGRAM_ID),
      pluginData('technicalFlowSourceFile', TECHNICAL_FLOW_SOURCE_FILE),
      pluginData('technicalFlowSourceFormat', 'mermaid'),
      pluginData('technicalFlowVisualVersion', TECHNICAL_FLOW_VISUAL_VERSION)
    ]
  )
  if (JSON.stringify(page.pluginData) === JSON.stringify(nextPluginData)) return false
  graph.updateNode(page.id, { pluginData: nextPluginData })
  return true
}

function mermaidOwners(graph: SceneGraph, pageId: string): SceneNode[] {
  return graph
    .getChildren(pageId)
    .filter((child) => mermaidDiagramOwner(graph, child.id)?.id === child.id)
}

function findTechnicalOwner(graph: SceneGraph, pageId: string): SceneNode | null {
  const owners = mermaidOwners(graph, pageId)
  const page = graph.getNode(pageId)
  const persistedOwnerId = pluginValue(page, 'technicalFlowOwnerId')
  const persistedOwner = owners.find((owner) => owner.id === persistedOwnerId)
  if (persistedOwner) return persistedOwner
  const tagged = owners.filter(
    (owner) =>
      pluginValue(owner, TECHNICAL_FLOW_OWNER_KEY) === TECHNICAL_FLOW_OWNER_VALUE ||
      pluginValue(owner, 'kind') === TECHNICAL_FLOW_KIND ||
      pluginValue(owner, 'technicalFlowSourceFile') === TECHNICAL_FLOW_SOURCE_FILE ||
      pluginValue(owner, 'technicalFlowDiagramId') === TECHNICAL_FLOW_DIAGRAM_ID
  )
  if (tagged.length > 1) return tagged[0] ?? null
  if (tagged.length === 1) return tagged[0] ?? null
  const sourceMatches = owners.filter(
    (owner) =>
      openPencilValue(owner, 'mermaid/source') === TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE
  )
  return sourceMatches.length === 1 ? (sourceMatches[0] ?? null) : null
}

function removeTechnicalOwnedProjection(
  graph: SceneGraph,
  pageId: string,
  resolvedOwnerId: string | null
): boolean {
  let changed = false
  for (const child of graph.getChildren(pageId)) {
    if (child.id === resolvedOwnerId) continue
    const flowId = pluginValue(child, 'flowId')
    const kind = pluginValue(child, 'kind')
    const sourceFile = pluginValue(child, 'sourceFile')
    const isTechnicalFlowObject = flowId === TECHNICAL_FLOW_OWNER_VALUE
    const isTechnicalGuide =
      kind === 'smylr-board-guide' && sourceFile === TECHNICAL_FLOW_MARKDOWN_FILE
    if (!isTechnicalFlowObject && !isTechnicalGuide) continue
    graph.deleteNode(child.id)
    changed = true
  }
  return changed
}

function usableOwnerId(graph: SceneGraph, page: SceneNode): string {
  const persisted = pluginValue(page, 'technicalFlowOwnerId')
  if (persisted && !graph.getNode(persisted)) return persisted
  return TECHNICAL_FLOW_OWNER_ID
}

function syncTechnicalMermaid(graph: SceneGraph, page: SceneNode): boolean {
  const owner = findTechnicalOwner(graph, page.id)
  let changed = false

  let currentOwner = owner
  if (currentOwner) {
    const currentSource = openPencilValue(currentOwner, 'mermaid/source')
    const visualChanged =
      pluginValue(currentOwner, 'technicalFlowVisualVersion') !== TECHNICAL_FLOW_VISUAL_VERSION
    const positionChanged =
      currentOwner.x !== TECHNICAL_FLOW_MERMAID_X || currentOwner.y !== TECHNICAL_FLOW_MERMAID_Y
    if (!isMermaidDiagramContainer(currentOwner)) {
      const ownerId = currentOwner.id
      const diagramId =
        openPencilValue(currentOwner, 'mermaid/diagram-id') ?? TECHNICAL_FLOW_DIAGRAM_ID
      graph.deleteNode(ownerId)
      const created = createMermaidDiagramInGraph(
        graph,
        page.id,
        TECHNICAL_FLOW_MERMAID_SCENE,
        { x: TECHNICAL_FLOW_MERMAID_X, y: TECHNICAL_FLOW_MERMAID_Y },
        { diagramId, ownerId }
      )
      currentOwner = graph.getNode(created.ownerId) ?? null
      changed = true
    } else if (
      currentSource !== TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE ||
      positionChanged ||
      visualChanged
    ) {
      replaceMermaidDiagramInGraph(graph, page.id, currentOwner.id, TECHNICAL_FLOW_MERMAID_SCENE, {
        x: TECHNICAL_FLOW_MERMAID_X,
        y: TECHNICAL_FLOW_MERMAID_Y
      })
      currentOwner = graph.getNode(currentOwner.id) ?? null
      changed = true
    } else if (
      currentOwner.name !== mermaidDiagramName(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
    ) {
      graph.updateNode(currentOwner.id, {
        name: mermaidDiagramName(TECHNICAL_FLOW_SAVE_FINDING_MERMAID_SOURCE)
      })
      changed = true
    }
  } else {
    const created = createMermaidDiagramInGraph(
      graph,
      page.id,
      TECHNICAL_FLOW_MERMAID_SCENE,
      { x: TECHNICAL_FLOW_MERMAID_X, y: TECHNICAL_FLOW_MERMAID_Y },
      {
        diagramId: TECHNICAL_FLOW_DIAGRAM_ID,
        ownerId: usableOwnerId(graph, page)
      }
    )
    currentOwner = graph.getNode(created.ownerId) ?? null
    changed = true
  }

  if (!currentOwner) return changed
  if (stampTechnicalOwner(graph, currentOwner)) changed = true
  if (stampTechnicalPage(graph, page, currentOwner.id)) changed = true
  return changed
}

export type TechnicalFlowSceneResult = {
  changed: boolean
  ownerId: string | null
  screenIds: string[]
}

export function syncTechnicalFlowScene(
  graph: SceneGraph,
  pageId: string,
  definition: AppScreenFlowDefinition = TECHNICAL_FLOW_SAVE_FINDING_APP_FLOW
): TechnicalFlowSceneResult {
  const page = graph.getNode(pageId)
  if (!page) return { changed: false, ownerId: null, screenIds: [] }
  let owner = findTechnicalOwner(graph, pageId)
  let changed = removeTechnicalOwnedProjection(graph, pageId, owner?.id ?? null)
  owner = findTechnicalOwner(graph, pageId)
  const mermaidChanged = syncTechnicalMermaid(graph, page)
  owner = findTechnicalOwner(graph, pageId)
  if (!owner) return { changed: changed || mermaidChanged, ownerId: null, screenIds: [] }
  if (definition.id !== TECHNICAL_FLOW_SAVE_FINDING_ID) {
    throw new Error(`Technical Flow sync received unexpected definition ${definition.id}`)
  }
  if (stampTechnicalPage(graph, page, owner.id)) changed = true
  return {
    changed: changed || mermaidChanged,
    ownerId: owner.id,
    screenIds: []
  }
}
