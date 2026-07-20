import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  hydrateActiveKnowledgeWorkspaces,
  serializeActiveKnowledgeWorkspaces
} from '@/app/workspace'

export const KNOWLEDGE_WORKSPACE_PLUGIN_ID = 'openpencil-knowledge-workspace'
const REGISTRY_KEY = 'registry-v1'
const hydratedGraphs = new WeakSet<SceneGraph>()

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find(
    (entry) => entry.pluginId === KNOWLEDGE_WORKSPACE_PLUGIN_ID && entry.key === key
  )?.value
}

export function workspaceDocumentId(graph: SceneGraph): string {
  return graph.rootId
}

export function hydrateKnowledgeWorkspacesFromScene(graph: SceneGraph): boolean {
  const root = graph.getNode(graph.rootId)
  const serialized = root ? pluginValue(root, REGISTRY_KEY) : undefined
  if (!serialized) return false

  try {
    hydrateActiveKnowledgeWorkspaces(serialized)
    return true
  } catch (error) {
    console.warn('[Knowledge Workspace] Scene metadata restore skipped', error)
    return false
  }
}

export function ensureKnowledgeWorkspacesHydrated(graph: SceneGraph): boolean {
  if (hydratedGraphs.has(graph)) return false
  hydratedGraphs.add(graph)
  return hydrateKnowledgeWorkspacesFromScene(graph)
}

export function persistKnowledgeWorkspacesToScene(graph: SceneGraph): void {
  const root = graph.getNode(graph.rootId)
  if (!root) return
  const pluginData = root.pluginData.filter(
    (entry) => !(entry.pluginId === KNOWLEDGE_WORKSPACE_PLUGIN_ID && entry.key === REGISTRY_KEY)
  )
  pluginData.push({
    key: REGISTRY_KEY,
    pluginId: KNOWLEDGE_WORKSPACE_PLUGIN_ID,
    value: serializeActiveKnowledgeWorkspaces()
  })
  graph.updateNode(root.id, { pluginData })
}
