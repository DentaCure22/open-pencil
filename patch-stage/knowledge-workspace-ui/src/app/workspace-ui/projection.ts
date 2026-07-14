import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid, thinStroke } from '@/app/demo/colors'
import type {
  KnowledgeWorkspace,
  WorkspaceGeometry,
  WorkspaceObject,
  WorkspaceRelation,
  WorkspaceView,
  WorkspaceViewKind
} from '@/app/workspace'

import { KNOWLEDGE_WORKSPACE_PLUGIN_ID } from './persistence'

const FONT = 'Inter'
const PAGE_KIND = 'workspace-projection-page'
const OBJECT_KIND = 'workspace-object-projection'
const RELATION_KIND = 'workspace-relation-projection'
const GUIDE_KIND = 'workspace-view-guide'
const TITLE_ROLE = 'projection-title'

const COLOR = {
  canvas: { r: 0.965, g: 0.972, b: 0.985, a: 1 },
  ink: { r: 0.07, g: 0.09, b: 0.15, a: 1 },
  line: { r: 0.84, g: 0.86, b: 0.91, a: 1 },
  muted: { r: 0.38, g: 0.42, b: 0.5, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  violet: { r: 0.49, g: 0.35, b: 0.95, a: 1 },
  violetSoft: { r: 0.94, g: 0.92, b: 1, a: 1 },
  blue: { r: 0.23, g: 0.45, b: 0.96, a: 1 },
  blueSoft: { r: 0.9, g: 0.94, b: 1, a: 1 },
  green: { r: 0.12, g: 0.62, b: 0.36, a: 1 },
  greenSoft: { r: 0.9, g: 0.98, b: 0.93, a: 1 },
  amber: { r: 0.89, g: 0.51, b: 0.08, a: 1 },
  amberSoft: { r: 1, g: 0.96, b: 0.86, a: 1 },
  rose: { r: 0.85, g: 0.24, b: 0.4, a: 1 },
  roseSoft: { r: 1, g: 0.91, b: 0.94, a: 1 }
} satisfies Record<string, Color>

export type WorkspaceProjectionPageInput = {
  basePageId: string
  basePageName: string
  existingGraphPageId?: string
  kind: WorkspaceViewKind
  viewId: string
  workspaceId: string
}

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { key, pluginId: KNOWLEDGE_WORKSPACE_PLUGIN_ID, value }
}

export function workspacePluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find(
    (entry) => entry.pluginId === KNOWLEDGE_WORKSPACE_PLUGIN_ID && entry.key === key
  )?.value
}

function replaceWorkspacePluginData(
  node: SceneNode,
  values: Record<string, string>
): SceneNode['pluginData'] {
  const keys = new Set(Object.keys(values))
  return [
    ...node.pluginData.filter(
      (entry) => entry.pluginId !== KNOWLEDGE_WORKSPACE_PLUGIN_ID || !keys.has(entry.key)
    ),
    ...Object.entries(values).map(([key, value]) => pluginData(key, value))
  ]
}

export function workspaceViewKindForPage(page: SceneNode): WorkspaceViewKind | null {
  if (workspacePluginValue(page, 'kind') !== PAGE_KIND) return null
  const kind = workspacePluginValue(page, 'viewKind')
  if (
    kind === 'canvas' ||
    kind === 'document' ||
    kind === 'graph' ||
    kind === 'atlas' ||
    kind === 'review'
  ) {
    return kind
  }
  return null
}

export function workspaceBasePageIdForPage(page: SceneNode): string | null {
  return workspacePluginValue(page, 'basePageId') ?? null
}

function pageSuffix(kind: WorkspaceViewKind): string {
  if (kind === 'document') return ' — Document'
  if (kind === 'review') return ' — Review'
  if (kind === 'atlas') return ' — Atlas'
  if (kind === 'graph') return ' — Flow'
  return ''
}

function pageMatches(page: SceneNode, input: WorkspaceProjectionPageInput): boolean {
  return (
    workspacePluginValue(page, 'kind') === PAGE_KIND &&
    workspacePluginValue(page, 'basePageId') === input.basePageId &&
    workspacePluginValue(page, 'viewKind') === input.kind
  )
}

function applyPageMetadata(
  graph: SceneGraph,
  page: SceneNode,
  input: WorkspaceProjectionPageInput
): SceneNode {
  graph.updateNode(page.id, {
    pluginData: replaceWorkspacePluginData(page, {
      basePageId: input.basePageId,
      kind: PAGE_KIND,
      viewId: input.viewId,
      viewKind: input.kind,
      workspaceId: input.workspaceId
    })
  })
  return graph.getNode(page.id) ?? page
}

function addText(
  graph: SceneGraph,
  parentId: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  weight: 400 | 600 | 700,
  color: Color,
  width: number,
  role?: string
): SceneNode {
  return graph.createNode('TEXT', parentId, {
    fills: [solid(color)],
    fontFamily: FONT,
    fontSize,
    fontWeight: weight,
    height: Math.ceil(fontSize * 1.45),
    maxLines: 1,
    name: text.slice(0, 64),
    pluginData: role ? [pluginData('role', role)] : [],
    text,
    textAutoResize: 'HEIGHT',
    textTruncation: 'ENDING',
    width,
    x,
    y
  })
}

function viewGuideMessage(kind: WorkspaceViewKind): string {
  if (kind === 'document') {
    return 'Write, collect, and reference the same objects that live on the canvas.'
  }
  if (kind === 'review') return 'Decisions stay attached to exact objects and revisions.'
  return 'Explore the same workspace as a connected atlas.'
}

function ensureViewGuide(
  graph: SceneGraph,
  pageId: string,
  kind: WorkspaceViewKind,
  viewId: string
): void {
  if (kind === 'canvas' || kind === 'graph') return
  const existing = graph
    .getChildren(pageId)
    .find(
      (node) =>
        workspacePluginValue(node, 'kind') === GUIDE_KIND &&
        workspacePluginValue(node, 'viewId') === viewId
    )
  if (existing) return

  const label = kind.charAt(0).toLocaleUpperCase() + kind.slice(1)
  const guide = graph.createNode('FRAME', pageId, {
    cornerRadius: 20,
    fills: [solid(COLOR.ink)],
    height: 116,
    name: `${label} workspace guide`,
    pluginData: [pluginData('kind', GUIDE_KIND), pluginData('viewId', viewId)],
    strokes: [],
    width: 980,
    x: 96,
    y: 64
  })
  graph.createNode('RECTANGLE', guide.id, {
    cornerRadius: 4,
    fills: [solid(COLOR.violet)],
    height: 68,
    name: `${label} accent`,
    width: 8,
    x: 28,
    y: 24
  })
  addText(graph, guide.id, `${label} workspace`, 56, 24, 22, 700, COLOR.white, 560)
  addText(
    graph,
    guide.id,
    viewGuideMessage(kind),
    56,
    59,
    13,
    400,
    { ...COLOR.white, a: 0.72 },
    760
  )
  addText(graph, guide.id, 'OPENPENCIL · SHARED IDENTITY', 738, 42, 10, 700, COLOR.violetSoft, 210)
}

export function ensureWorkspaceProjectionPage(
  graph: SceneGraph,
  input: WorkspaceProjectionPageInput
): SceneNode {
  if (input.kind === 'canvas') {
    const base = graph.getNode(input.basePageId)
    if (!base) throw new Error(`workspace_base_page_not_found: ${input.basePageId}`)
    return applyPageMetadata(graph, base, input)
  }

  const pages = graph.getPages()
  const tagged = pages.find((page) => pageMatches(page, input))
  const graphPage =
    input.kind === 'graph' && input.existingGraphPageId
      ? graph.getNode(input.existingGraphPageId)
      : null
  const named = pages.find((page) => page.name === `${input.basePageName}${pageSuffix(input.kind)}`)
  const page =
    tagged ?? graphPage ?? named ?? graph.addPage(`${input.basePageName}${pageSuffix(input.kind)}`)
  const result = applyPageMetadata(graph, page, input)
  ensureViewGuide(graph, result.id, input.kind, input.viewId)
  return result
}

export function workspaceObjectTitle(object: WorkspaceObject): string {
  if (object.type === 'document-block') return object.text || 'Untitled block'
  if (object.type === 'collection' || object.type === 'saved-view') return object.name
  if (object.type === 'collection-record') return object.title
  if (object.type === 'graph-node' || object.type === 'design-artifact') return object.label
  if (object.type === 'graph-edge') return object.label || object.relationshipType
  if (object.type === 'live-app-block') return object.route
  if (object.type === 'review-object') return object.body || object.reviewKind
  return object.label || object.canvasKind
}

function objectSubtitle(object: WorkspaceObject, view: WorkspaceView): string {
  if (object.type === 'document-block') return `${object.blockKind} · ${view.kind} projection`
  if (object.type === 'collection') {
    return `${object.recordIds.length} records · ${object.properties.length} properties`
  }
  if (object.type === 'collection-record') return 'Collection record'
  if (object.type === 'saved-view') return `${object.viewKind} collection view`
  if (object.type === 'graph-node') return `${object.graphKind} · connected knowledge`
  if (object.type === 'graph-edge') return object.relationshipType
  if (object.type === 'design-artifact') return `${object.artifactKind} · ${object.ownership}`
  if (object.type === 'live-app-block') {
    return `${object.runtime.status} · ${object.environment} · opens on Canvas`
  }
  if (object.type === 'review-object') return `${object.reviewKind} · ${object.reviewStatus}`
  return object.canvasKind
}

function objectAccent(object: WorkspaceObject): { accent: Color; soft: Color } {
  if (object.type === 'live-app-block') return { accent: COLOR.green, soft: COLOR.greenSoft }
  if (object.type === 'review-object') return { accent: COLOR.rose, soft: COLOR.roseSoft }
  if (
    object.type === 'collection' ||
    object.type === 'collection-record' ||
    object.type === 'saved-view'
  ) {
    return { accent: COLOR.blue, soft: COLOR.blueSoft }
  }
  if (object.type === 'design-artifact') return { accent: COLOR.amber, soft: COLOR.amberSoft }
  return { accent: COLOR.violet, soft: COLOR.violetSoft }
}

function cardSize(
  object: WorkspaceObject,
  viewKind: WorkspaceViewKind
): { height: number; width: number } {
  if (viewKind === 'document') {
    if (object.type === 'collection') return { height: 240, width: 780 }
    if (object.type === 'live-app-block') return { height: 156, width: 780 }
    return {
      height: object.type === 'document-block' && object.blockKind === 'heading' ? 96 : 118,
      width: 780
    }
  }
  if (viewKind === 'review') return { height: 150, width: 460 }
  if (object.type === 'collection') return { height: 196, width: 360 }
  if (object.type === 'live-app-block') return { height: 138, width: 360 }
  return { height: 112, width: 300 }
}

export function defaultWorkspaceProjectionGeometry(
  object: WorkspaceObject,
  viewKind: WorkspaceViewKind,
  ordinal: number
): WorkspaceGeometry {
  const size = cardSize(object, viewKind)
  if (viewKind === 'canvas') {
    return {
      height: size.height,
      width: size.width,
      x: 1480 + (ordinal % 2) * 390,
      y: 88 + Math.floor(ordinal / 2) * 230
    }
  }
  if (viewKind === 'document' || viewKind === 'atlas') {
    return { height: size.height, width: size.width, x: 96, y: 220 + ordinal * 280 }
  }
  if (viewKind === 'review') {
    return {
      height: size.height,
      width: size.width,
      x: 96 + (ordinal % 2) * 500,
      y: 220 + Math.floor(ordinal / 2) * 184
    }
  }
  return {
    height: size.height,
    width: size.width,
    x: 96 + (ordinal % 4) * 340,
    y: 1080 + Math.floor(ordinal / 4) * 230
  }
}

export function bindWorkspaceObjectToSceneNode(
  graph: SceneGraph,
  node: SceneNode,
  object: WorkspaceObject,
  view: WorkspaceView
): SceneNode {
  graph.updateNode(node.id, {
    pluginData: replaceWorkspacePluginData(node, {
      kind: OBJECT_KIND,
      objectId: object.id,
      objectType: object.type,
      viewId: view.id,
      workspaceId: object.workspaceId
    })
  })
  return graph.getNode(node.id) ?? node
}

function createCollectionRows(graph: SceneGraph, card: SceneNode, object: WorkspaceObject): void {
  if (object.type !== 'collection') return
  const rows = object.properties.slice(0, 3)
  const labels =
    rows.length > 0 ? rows.map((property) => property.label) : ['Name', 'Status', 'Owner']
  labels.forEach((label, index) => {
    const y = 100 + index * 32
    graph.createNode('RECTANGLE', card.id, {
      fills: [solid(index % 2 === 0 ? COLOR.canvas : COLOR.white)],
      height: 28,
      name: `${label} row`,
      width: card.width - 48,
      x: 24,
      y
    })
    addText(graph, card.id, label, 36, y + 6, 11, 600, COLOR.muted, 180)
    addText(
      graph,
      card.id,
      index === 0 ? 'Workspace field' : '—',
      220,
      y + 6,
      11,
      400,
      COLOR.ink,
      180
    )
  })
}

function existingProjection(
  graph: SceneGraph,
  pageId: string,
  objectId: string,
  viewId: string
): SceneNode | null {
  return (
    graph
      .getChildren(pageId)
      .find(
        (node) =>
          workspacePluginValue(node, 'kind') === OBJECT_KIND &&
          workspacePluginValue(node, 'objectId') === objectId &&
          workspacePluginValue(node, 'viewId') === viewId
      ) ?? null
  )
}

export function createWorkspaceObjectProjection(
  graph: SceneGraph,
  pageId: string,
  object: WorkspaceObject,
  view: WorkspaceView,
  geometry: WorkspaceGeometry
): SceneNode {
  const existing = existingProjection(graph, pageId, object.id, view.id)
  if (existing) {
    updateWorkspaceObjectProjection(graph, existing, object)
    return existing
  }

  const colors = objectAccent(object)
  const card = graph.createNode('FRAME', pageId, {
    cornerRadius: 16,
    fills: [solid(COLOR.white)],
    height: geometry.height,
    name: workspaceObjectTitle(object),
    pluginData: [
      pluginData('kind', OBJECT_KIND),
      pluginData('objectId', object.id),
      pluginData('objectType', object.type),
      pluginData('viewId', view.id),
      pluginData('workspaceId', object.workspaceId)
    ],
    rotation: geometry.rotation ?? 0,
    strokes: thinStroke(COLOR.line),
    width: geometry.width,
    x: geometry.x,
    y: geometry.y
  })
  graph.createNode('RECTANGLE', card.id, {
    cornerRadius: 4,
    fills: [solid(colors.accent)],
    height: geometry.height,
    name: 'Object accent',
    width: 7,
    x: 0,
    y: 0
  })
  const typeLabel = object.type.replaceAll('-', ' ').toLocaleUpperCase()
  const pillWidth = Math.min(184, Math.max(92, typeLabel.length * 7 + 24))
  graph.createNode('FRAME', card.id, {
    cornerRadius: 12,
    fills: [solid(colors.soft)],
    height: 24,
    name: `${typeLabel} badge`,
    strokes: [],
    width: pillWidth,
    x: 24,
    y: 18
  })
  addText(graph, card.id, typeLabel, 36, 24, 9, 700, colors.accent, pillWidth - 24)
  const headingSize =
    object.type === 'document-block' && object.blockKind === 'heading' && view.kind === 'document'
      ? 22
      : 15
  addText(
    graph,
    card.id,
    workspaceObjectTitle(object),
    24,
    55,
    headingSize,
    700,
    COLOR.ink,
    geometry.width - 48,
    TITLE_ROLE
  )
  addText(
    graph,
    card.id,
    objectSubtitle(object, view),
    24,
    78,
    11,
    400,
    COLOR.muted,
    geometry.width - 48
  )
  createCollectionRows(graph, card, object)
  return card
}

export function updateWorkspaceObjectProjection(
  graph: SceneGraph,
  projection: SceneNode,
  object: WorkspaceObject
): void {
  graph.updateNode(projection.id, { name: workspaceObjectTitle(object) })
  const title = graph
    .getChildren(projection.id)
    .find((node) => workspacePluginValue(node, 'role') === TITLE_ROLE)
  if (title) {
    const text = workspaceObjectTitle(object)
    graph.updateNode(title.id, { name: text.slice(0, 64), text })
  }
}

export function workspaceObjectIdForSceneNode(
  graph: SceneGraph,
  sceneNodeId: string
): string | null {
  let node = graph.getNode(sceneNodeId)
  while (node) {
    const objectId = workspacePluginValue(node, 'objectId')
    if (objectId) return objectId
    node = node.parentId ? graph.getNode(node.parentId) : undefined
  }
  return null
}

export function sceneNodesForWorkspaceObject(graph: SceneGraph, objectId: string): SceneNode[] {
  return [...graph.getAllNodes()].filter(
    (node) => workspacePluginValue(node, 'objectId') === objectId
  )
}

export function removeWorkspaceObjectSceneBindings(graph: SceneGraph, objectId: string): void {
  for (const node of sceneNodesForWorkspaceObject(graph, objectId)) {
    const isNativeLiveFrame = node.pluginData.some(
      (entry) =>
        entry.pluginId === 'smylr-production' &&
        entry.key === 'kind' &&
        entry.value === 'live-app-frame'
    )
    if (isNativeLiveFrame) {
      graph.updateNode(node.id, {
        pluginData: node.pluginData.filter(
          (entry) => entry.pluginId !== KNOWLEDGE_WORKSPACE_PLUGIN_ID
        )
      })
    } else if (graph.getNode(node.id)) {
      graph.deleteNode(node.id)
    }
  }
}

function relationProjection(
  graph: SceneGraph,
  pageId: string,
  relation: WorkspaceRelation,
  viewId: string
): SceneNode | null {
  const nodes = graph.getChildren(pageId)
  const source = nodes.find(
    (node) =>
      workspacePluginValue(node, 'objectId') === relation.sourceId &&
      workspacePluginValue(node, 'viewId') === viewId
  )
  const target = nodes.find(
    (node) =>
      workspacePluginValue(node, 'objectId') === relation.targetId &&
      workspacePluginValue(node, 'viewId') === viewId
  )
  if (!source || !target) return null
  const existing = nodes.find(
    (node) =>
      workspacePluginValue(node, 'kind') === RELATION_KIND &&
      workspacePluginValue(node, 'relationId') === relation.id &&
      workspacePluginValue(node, 'viewId') === viewId
  )
  if (existing) return existing

  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height / 2
  const targetX = target.x + target.width / 2
  const targetY = target.y + target.height / 2
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const distance = Math.hypot(dx, dy)
  return graph.createNode('RECTANGLE', pageId, {
    cornerRadius: 2,
    fills: [solid(COLOR.violet, 0.55)],
    height: 4,
    name: relation.label || relation.relationType,
    pluginData: [
      pluginData('kind', RELATION_KIND),
      pluginData('relationId', relation.id),
      pluginData('viewId', viewId),
      pluginData('workspaceId', relation.workspaceId)
    ],
    rotation: (Math.atan2(dy, dx) * 180) / Math.PI,
    width: distance,
    x: sourceX,
    y: sourceY
  })
}

export function syncWorkspaceRelationProjections(
  graph: SceneGraph,
  pageId: string,
  workspace: KnowledgeWorkspace,
  view: WorkspaceView
): void {
  if (view.kind !== 'graph' && view.kind !== 'atlas' && view.kind !== 'canvas') return
  Object.values(workspace.relations)
    .filter((relation) => relation.lifecycle === 'active')
    .forEach((relation) => relationProjection(graph, pageId, relation, view.id))
}
