import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { solid } from '@/app/demo/colors'
import type { KnowledgeWorkspace, WorkspaceRelation, WorkspaceView } from '@/app/workspace'

import { KNOWLEDGE_WORKSPACE_PLUGIN_ID } from './persistence'
import { workspacePluginValue } from './projection'

const RELATION_KIND = 'workspace-relation-projection'
const VIOLET = { r: 0.49, g: 0.35, b: 0.95, a: 1 }

function pluginData(key: string, value: string): SceneNode['pluginData'][number] {
  return { key, pluginId: KNOWLEDGE_WORKSPACE_PLUGIN_ID, value }
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
    fills: [solid(VIOLET, 0.55)],
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
