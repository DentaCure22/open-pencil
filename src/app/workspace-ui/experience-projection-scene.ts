import type { Color, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid } from '@/app/demo/colors'
import type {
  ExperienceProjectionPurpose,
  KnowledgeWorkspace,
  WorkspaceGeometry,
  WorkspaceObject,
  WorkspaceRelation,
  WorkspaceView
} from '@/app/workspace'

import type { ExperienceProjectionRole } from './experience-projections'
import { KNOWLEDGE_WORKSPACE_PLUGIN_ID } from './persistence'
import { defaultWorkspaceProjectionGeometry, workspacePluginValue } from './projection'

const FONT = 'Inter'
const OBJECT_KIND = 'workspace-object-projection'
const RELATION_KIND = 'workspace-relation-projection'
const MUTED: Color = { r: 0.38, g: 0.42, b: 0.5, a: 1 }
const VIOLET: Color = { r: 0.49, g: 0.35, b: 0.95, a: 1 }

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { key, pluginId: KNOWLEDGE_WORKSPACE_PLUGIN_ID, value }
}

function addText(
  graph: SceneGraph,
  parentId: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  weight: 600 | 700,
  color: Color,
  width: number,
  role: string
): void {
  graph.createNode('TEXT', parentId, {
    fills: [solid(color)],
    fontFamily: FONT,
    fontSize,
    fontWeight: weight,
    height: Math.ceil(fontSize * 1.45),
    maxLines: 1,
    name: text.slice(0, 64),
    pluginData: [pluginData('role', role)],
    text,
    textAutoResize: 'HEIGHT',
    textTruncation: 'ENDING',
    width,
    x,
    y
  })
}

export function experienceProjectionGeometry(
  object: WorkspaceObject,
  purpose: ExperienceProjectionPurpose,
  role: ExperienceProjectionRole,
  order: number,
  anchor?: WorkspaceGeometry
): WorkspaceGeometry {
  if (purpose === 'focus' || purpose === 'compare') {
    const supportOrder = Math.max(0, order - (purpose === 'compare' ? 2 : 1))
    const width = role === 'review-object' || role === 'action' ? 360 : 320
    const height = role === 'intent' || role === 'evidence-manifest' ? 126 : 142
    if (anchor) {
      if (purpose === 'focus') {
        return {
          height,
          width,
          x: anchor.x + anchor.width + 44,
          y: anchor.y + supportOrder * (height + 18)
        }
      }
      return {
        height,
        width,
        x: anchor.x + (supportOrder % 2) * (width + 20),
        y: anchor.y + anchor.height + 36 + Math.floor(supportOrder / 2) * (height + 18)
      }
    }
  }

  if (purpose === 'knowledge') {
    if (role === 'intent') return { height: 150, width: 360, x: 96, y: 220 }
    if (role === 'evidence-manifest') return { height: 150, width: 360, x: 516, y: 220 }
    if (role === 'root-surface') return { height: 176, width: 420, x: 306, y: 430 }
    if (role === 'companion-surface') {
      const companionOrder = Math.max(0, order - 3)
      return { height: 148, width: 340, x: 96 + companionOrder * 390, y: 660 }
    }
    const supportOrder = Math.max(0, order - 5)
    return {
      height: 142,
      width: 340,
      x: 96 + (supportOrder % 3) * 380,
      y: 872 + Math.floor(supportOrder / 3) * 170
    }
  }

  if (purpose === 'review') {
    if (role === 'root-surface') return { height: 184, width: 520, x: 96, y: 220 }
    if (role === 'companion-surface') return { height: 184, width: 420, x: 656, y: 220 }
    if (role === 'intent') return { height: 142, width: 360, x: 96, y: 442 }
    if (role === 'evidence-manifest') return { height: 142, width: 360, x: 486, y: 442 }
    const supportOrder = Math.max(0, order - 4)
    return { height: 154, width: 350, x: 876, y: 442 + supportOrder * 184 }
  }

  return defaultWorkspaceProjectionGeometry(object, 'canvas', order)
}

export function removeStaleWorkspaceProjectionScene(
  graph: SceneGraph,
  pageId: string,
  viewId: string,
  allowedObjectIds: Set<string>,
  protectedNodeIds: Set<string> = new Set()
): void {
  for (const node of graph.getChildren(pageId)) {
    if (protectedNodeIds.has(node.id)) continue
    const kind = workspacePluginValue(node, 'kind')
    if (kind === OBJECT_KIND) {
      const belongsToView = workspacePluginValue(node, 'viewId') === viewId
      const objectId = workspacePluginValue(node, 'objectId')
      if (!belongsToView || !objectId || !allowedObjectIds.has(objectId)) graph.deleteNode(node.id)
      continue
    }
    if (kind === RELATION_KIND && workspacePluginValue(node, 'viewId') !== viewId) {
      graph.deleteNode(node.id)
    }
  }
}

function experienceRelationProjection(
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

  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height / 2
  const targetX = target.x + target.width / 2
  const targetY = target.y + target.height / 2
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const distance = Math.max(1, Math.hypot(dx, dy))
  const rotation = (Math.atan2(dy, dx) * 180) / Math.PI
  const x = (sourceX + targetX - distance) / 2
  const y = (sourceY + targetY - 30) / 2
  const existing = nodes.find(
    (node) =>
      workspacePluginValue(node, 'kind') === RELATION_KIND &&
      workspacePluginValue(node, 'relationId') === relation.id &&
      workspacePluginValue(node, 'viewId') === viewId
  )
  if (existing) {
    graph.updateNode(existing.id, { height: 30, rotation, width: distance, x, y })
    graph.reorderChild(existing.id, pageId, 0)
    return graph.getNode(existing.id) ?? existing
  }

  const connector = graph.createNode('FRAME', pageId, {
    fills: [],
    height: 30,
    name: relation.label || relation.relationType,
    pluginData: [
      pluginData('kind', RELATION_KIND),
      pluginData('relationId', relation.id),
      pluginData('sourceId', relation.sourceId),
      pluginData('targetId', relation.targetId),
      pluginData('viewId', viewId),
      pluginData('workspaceId', relation.workspaceId)
    ],
    rotation,
    strokes: [],
    width: distance,
    x,
    y
  })
  graph.createNode('RECTANGLE', connector.id, {
    cornerRadius: 1,
    fills: [solid(VIOLET, 0.36)],
    height: 2,
    name: 'Relation line',
    width: distance,
    x: 0,
    y: 14
  })
  addText(
    graph,
    connector.id,
    relation.label || relation.relationType,
    Math.max(8, distance / 2 - 70),
    0,
    9,
    600,
    MUTED,
    Math.min(140, Math.max(60, distance - 40)),
    'relation-label'
  )
  addText(
    graph,
    connector.id,
    relation.direction === 'undirected' ? '↔' : '→',
    Math.max(0, distance - 20),
    4,
    12,
    700,
    VIOLET,
    20,
    'relation-direction'
  )
  graph.reorderChild(connector.id, pageId, 0)
  return connector
}

export function syncExperienceRelationProjections(
  graph: SceneGraph,
  pageId: string,
  workspace: KnowledgeWorkspace,
  view: WorkspaceView,
  allowedObjectIds: Set<string>
): void {
  const activeRelations = Object.values(workspace.relations).filter(
    (relation) =>
      relation.lifecycle === 'active' &&
      allowedObjectIds.has(relation.sourceId) &&
      allowedObjectIds.has(relation.targetId)
  )
  const activeRelationIds = new Set(activeRelations.map((relation) => relation.id))
  for (const node of graph.getChildren(pageId)) {
    if (
      workspacePluginValue(node, 'kind') === RELATION_KIND &&
      workspacePluginValue(node, 'viewId') === view.id &&
      !activeRelationIds.has(workspacePluginValue(node, 'relationId') ?? '')
    ) {
      graph.deleteNode(node.id)
    }
  }
  activeRelations.forEach((relation) =>
    experienceRelationProjection(graph, pageId, relation, view.id)
  )
}
