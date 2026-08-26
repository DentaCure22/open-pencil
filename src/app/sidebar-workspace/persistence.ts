import type { SceneNode } from '@open-pencil/scene-graph'

import { isBoardIconKey } from './icons'
import {
  SIDEBAR_WORKSPACE_KEY,
  SIDEBAR_WORKSPACE_PLUGIN_ID,
  SIDEBAR_WORKSPACE_SCHEMA_VERSION,
  normalizedWorkspace,
  type SidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage
} from './model'

function pluginValue(node: SceneNode, key: string): string | undefined {
  return node.pluginData.find(
    (entry) => entry.pluginId === SIDEBAR_WORKSPACE_PLUGIN_ID && entry.key === key
  )?.value
}

function isSidebarPage(value: unknown): value is SidebarWorkspacePage {
  if (!value || typeof value !== 'object') return false
  const page = value as Partial<SidebarWorkspacePage>
  return (
    typeof page.id === 'string' &&
    typeof page.name === 'string' &&
    typeof page.order === 'number' &&
    (page.parentId === null || typeof page.parentId === 'string')
  )
}

function isSidebarBoard(value: unknown): value is SidebarWorkspaceBoard {
  if (!value || typeof value !== 'object') return false
  const board = value as Partial<SidebarWorkspaceBoard>
  return (
    typeof board.pageId === 'string' &&
    typeof board.parentPageId === 'string' &&
    typeof board.order === 'number' &&
    (board.icon === undefined || isBoardIconKey(board.icon)) &&
    (board.label === undefined || typeof board.label === 'string')
  )
}

export function parseSidebarWorkspace(root: SceneNode): SidebarWorkspace | null {
  const serialized = pluginValue(root, SIDEBAR_WORKSPACE_KEY)
  if (!serialized) return null

  try {
    const value = JSON.parse(serialized) as Partial<SidebarWorkspace>
    if (
      value.schemaVersion !== SIDEBAR_WORKSPACE_SCHEMA_VERSION ||
      !Array.isArray(value.pages) ||
      !Array.isArray(value.boards) ||
      !value.pages.every(isSidebarPage) ||
      !value.boards.every(isSidebarBoard)
    ) {
      return null
    }
    return structuredClone(value as SidebarWorkspace)
  } catch {
    return null
  }
}

export function serializedWorkspace(workspace: SidebarWorkspace): string {
  return JSON.stringify(normalizedWorkspace(workspace))
}

export function sidebarWorkspacePluginData(
  root: SceneNode,
  workspace: SidebarWorkspace
): SceneNode['pluginData'] {
  return [
    ...root.pluginData.filter(
      (entry) =>
        !(entry.pluginId === SIDEBAR_WORKSPACE_PLUGIN_ID && entry.key === SIDEBAR_WORKSPACE_KEY)
    ),
    {
      key: SIDEBAR_WORKSPACE_KEY,
      pluginId: SIDEBAR_WORKSPACE_PLUGIN_ID,
      value: serializedWorkspace(workspace)
    }
  ]
}
