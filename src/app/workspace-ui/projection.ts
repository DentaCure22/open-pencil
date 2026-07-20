import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid, thinStroke } from '@/app/demo/colors'
import type {
  ExperienceProjectionPurpose,
  WorkspaceGeometry,
  WorkspaceObject,
  WorkspaceView,
  WorkspaceViewKind
} from '@/app/workspace'

import type { ExperienceProjectionRole } from './experience-projections'
import { KNOWLEDGE_WORKSPACE_PLUGIN_ID } from './persistence'

export { defaultWorkspaceProjectionGeometry } from './projection-geometry'

const FONT = 'Inter'
const PAGE_KIND = 'workspace-projection-page'
const OBJECT_KIND = 'workspace-object-projection'
const GUIDE_KIND = 'workspace-view-guide'
const TITLE_ROLE = 'projection-title'
const SUBTITLE_ROLE = 'projection-subtitle'

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
  pageName?: string
  purpose?: ExperienceProjectionPurpose
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

export function clearWorkspaceExperienceProjectionPage(graph: SceneGraph, pageId: string): void {
  const page = graph.getNode(pageId)
  if (page?.type !== 'CANVAS') return
  const clearedKeys = new Set([
    'basePageId',
    'experiencePurpose',
    'kind',
    'viewId',
    'viewKind',
    'workspaceId'
  ])
  graph.updateNode(page.id, {
    pluginData: page.pluginData.filter(
      (entry) => entry.pluginId !== KNOWLEDGE_WORKSPACE_PLUGIN_ID || !clearedKeys.has(entry.key)
    )
  })
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
    workspacePluginValue(page, 'viewKind') === input.kind &&
    workspacePluginValue(page, 'viewId') === input.viewId
  )
}

function applyPageMetadata(
  graph: SceneGraph,
  page: SceneNode,
  input: WorkspaceProjectionPageInput
): SceneNode {
  const metadataTarget = input.purpose
    ? page
    : {
        ...page,
        pluginData: page.pluginData.filter(
          (entry) =>
            !(entry.pluginId === KNOWLEDGE_WORKSPACE_PLUGIN_ID && entry.key === 'experiencePurpose')
        )
      }
  graph.updateNode(page.id, {
    pluginData: replaceWorkspacePluginData(metadataTarget, {
      basePageId: input.basePageId,
      kind: PAGE_KIND,
      viewId: input.viewId,
      viewKind: input.kind,
      ...(input.purpose ? { experiencePurpose: input.purpose } : {}),
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
  role?: string,
  maxLines = 1
): SceneNode {
  return graph.createNode('TEXT', parentId, {
    fills: [solid(color)],
    fontFamily: FONT,
    fontSize,
    fontWeight: weight,
    height: Math.ceil(fontSize * 1.45 * maxLines),
    maxLines,
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

function viewGuideMessage(kind: WorkspaceViewKind, purpose?: ExperienceProjectionPurpose): string {
  if (purpose === 'knowledge') {
    return 'Trace intent, evidence, surfaces, and outcomes without losing exact identity.'
  }
  if (purpose === 'review') {
    return 'Judge the focused result against its evidence, gates, and latest decision trail.'
  }
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
  viewId: string,
  purpose?: ExperienceProjectionPurpose
): SceneNode | null {
  if (kind === 'canvas' || kind === 'graph') return null
  const existing = graph
    .getChildren(pageId)
    .find(
      (node) =>
        workspacePluginValue(node, 'kind') === GUIDE_KIND &&
        workspacePluginValue(node, 'viewId') === viewId
    )
  if (existing) return existing

  const label = purpose
    ? purpose.charAt(0).toLocaleUpperCase() + purpose.slice(1)
    : kind.charAt(0).toLocaleUpperCase() + kind.slice(1)
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
    viewGuideMessage(kind, purpose),
    56,
    59,
    13,
    400,
    { ...COLOR.white, a: 0.72 },
    760
  )
  addText(graph, guide.id, 'OPENPENCIL · SHARED IDENTITY', 728, 18, 10, 700, COLOR.violetSoft, 224)
  return guide
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
  const requestedName = input.pageName ?? `${input.basePageName}${pageSuffix(input.kind)}`
  const named = pages.find(
    (page) =>
      page.name === requestedName &&
      (!workspacePluginValue(page, 'kind') || workspacePluginValue(page, 'viewId') === input.viewId)
  )
  const page = tagged ?? graphPage ?? named ?? graph.addPage(requestedName)
  const result = applyPageMetadata(graph, page, input)
  ensureViewGuide(graph, result.id, input.kind, input.viewId, input.purpose)
  return result
}

function lifecycleObjectTitle(object: WorkspaceObject): string | null {
  if (object.type === 'decision-receipt') return `Decision · ${object.outcome.status}`
  if (object.type === 'learning-receipt') return `Learning · ${object.outcome}`
  if (object.type === 'action-proposal') return object.name
  if (object.type === 'action-execution-receipt') return `Execution · ${object.status}`
  if (object.type === 'action-verification-receipt') return `Verification · ${object.outcome}`
  if (object.type === 'action-rollback-receipt') return `Rollback · ${object.status}`
  return null
}

export function workspaceObjectTitle(object: WorkspaceObject): string {
  const lifecycleTitle = lifecycleObjectTitle(object)
  if (lifecycleTitle) return lifecycleTitle
  if (object.type === 'document-block') return object.text || 'Untitled block'
  if (object.type === 'collection' || object.type === 'saved-view') return object.name
  if (object.type === 'collection-record') return object.title
  if (object.type === 'graph-node' || object.type === 'design-artifact') return object.label
  if (object.type === 'graph-edge') return object.label || object.relationshipType
  if (object.type === 'live-app-block') return object.route
  if (object.type === 'review-object') return object.body || object.reviewKind
  if (object.type === 'intent-record') return object.statement || 'Intent'
  if (object.type === 'evidence-manifest') return `Evidence · ${object.items.length} items`
  if (object.type === 'surface-run') return object.name
  if (object.type === 'canvas-object') return object.label || object.canvasKind
  return object.id
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
  if (object.type === 'intent-record') return `${object.inputMode} intent · locked`
  if (object.type === 'evidence-manifest') return `${object.status} · immutable snapshot`
  if (object.type === 'surface-run') return `${object.form.kind} · ${object.status}`
  if (object.type === 'decision-receipt') return `${object.outcome.status} · immutable receipt`
  if (object.type === 'learning-receipt') {
    return `${object.executionKind} · ${object.formId} · immutable learning`
  }
  if (object.type === 'action-proposal') return `${object.status} · action proposal`
  if (object.type === 'action-execution-receipt') return `${object.status} · execution receipt`
  if (object.type === 'action-verification-receipt')
    return `${object.outcome} · verification receipt`
  if (object.type === 'action-rollback-receipt') return `${object.status} · rollback receipt`
  return object.canvasKind
}

function objectAccent(object: WorkspaceObject): { accent: Color; soft: Color } {
  if (object.type === 'live-app-block') return { accent: COLOR.green, soft: COLOR.greenSoft }
  if (object.type === 'review-object') return { accent: COLOR.rose, soft: COLOR.roseSoft }
  if (
    object.type === 'surface-run' ||
    object.type === 'decision-receipt' ||
    object.type === 'learning-receipt' ||
    object.type === 'action-proposal' ||
    object.type === 'action-execution-receipt' ||
    object.type === 'action-verification-receipt' ||
    object.type === 'action-rollback-receipt'
  ) {
    return { accent: COLOR.blue, soft: COLOR.blueSoft }
  }
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
  geometry: WorkspaceGeometry,
  options: { order?: number; role?: ExperienceProjectionRole } = {}
): SceneNode {
  const existing = existingProjection(graph, pageId, object.id, view.id)
  if (existing) {
    graph.updateNode(existing.id, {
      height: geometry.height,
      pluginData: replaceWorkspacePluginData(existing, {
        ...(options.order === undefined ? {} : { experienceOrder: String(options.order) }),
        ...(options.role ? { experienceRole: options.role } : {}),
        kind: OBJECT_KIND,
        objectId: object.id,
        objectType: object.type,
        viewId: view.id,
        workspaceId: object.workspaceId
      }),
      rotation: geometry.rotation ?? 0,
      width: geometry.width,
      x: geometry.x,
      y: geometry.y
    })
    updateWorkspaceObjectProjection(graph, existing, object)
    return graph.getNode(existing.id) ?? existing
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
      pluginData('workspaceId', object.workspaceId),
      ...(options.role ? [pluginData('experienceRole', options.role)] : []),
      ...(options.order === undefined ? [] : [pluginData('experienceOrder', String(options.order))])
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
  const isExperienceCard = options.role !== undefined
  let headingSize = 15
  if (isExperienceCard) headingSize = 14
  else if (
    object.type === 'document-block' &&
    object.blockKind === 'heading' &&
    view.kind === 'document'
  ) {
    headingSize = 22
  }
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
    TITLE_ROLE,
    isExperienceCard ? 2 : 1
  )
  addText(
    graph,
    card.id,
    objectSubtitle(object, view),
    24,
    isExperienceCard ? 101 : 78,
    11,
    400,
    COLOR.muted,
    geometry.width - 48,
    SUBTITLE_ROLE
  )
  if (!isExperienceCard) createCollectionRows(graph, card, object)
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
