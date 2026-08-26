import type { BoardIconKey } from './icons'

export const SIDEBAR_WORKSPACE_PLUGIN_ID = 'openpencil-sidebar-workspace'
export const SIDEBAR_WORKSPACE_SCHEMA_VERSION = 1 as const
export const SIDEBAR_WORKSPACE_KEY = 'tree-v1'
export const DEFAULT_BOARD_LABEL = 'Main board'
export const SMYLR_PROJECT_ID = 'sidebar-project:smylr'

export type SidebarPageId = string

export type SidebarWorkspacePage = {
  id: SidebarPageId
  name: string
  order: number
  parentId: SidebarPageId | null
}

export type SidebarWorkspaceBoard = {
  icon?: BoardIconKey
  label?: string
  order: number
  pageId: string
  parentPageId: SidebarPageId
}

export type SidebarWorkspace = {
  boards: SidebarWorkspaceBoard[]
  pages: SidebarWorkspacePage[]
  schemaVersion: typeof SIDEBAR_WORKSPACE_SCHEMA_VERSION
}

export type SidebarWorkspaceResolution = {
  changed: boolean
  workspace: SidebarWorkspace
}

export function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const id = key(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function orderItems<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order - right.order)
}

function normalizePageOrders(pages: SidebarWorkspacePage[]): SidebarWorkspacePage[] {
  const groups = new Map<SidebarPageId | null, SidebarWorkspacePage[]>()
  for (const page of pages) {
    const group = groups.get(page.parentId) ?? []
    group.push(page)
    groups.set(page.parentId, group)
  }
  return [...groups.values()].flatMap((group) =>
    orderItems(group).map((page, order) => ({ ...page, order }))
  )
}

function normalizeBoardOrders(boards: SidebarWorkspaceBoard[]): SidebarWorkspaceBoard[] {
  const groups = new Map<SidebarPageId, SidebarWorkspaceBoard[]>()
  for (const board of boards) {
    const group = groups.get(board.parentPageId) ?? []
    group.push(board)
    groups.set(board.parentPageId, group)
  }
  return [...groups.values()].flatMap((group) =>
    orderItems(group).map((board, order) => ({ ...board, order }))
  )
}

export function normalizedWorkspace(workspace: SidebarWorkspace): SidebarWorkspace {
  return {
    boards: normalizeBoardOrders(workspace.boards),
    pages: normalizePageOrders(workspace.pages),
    schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION
  }
}

export function orderedSidebarPages(
  workspace: SidebarWorkspace,
  parentId: SidebarPageId | null
): SidebarWorkspacePage[] {
  return orderItems(workspace.pages.filter((page) => page.parentId === parentId))
}

export function orderedSidebarBoards(
  workspace: SidebarWorkspace,
  parentPageId: SidebarPageId
): SidebarWorkspaceBoard[] {
  return orderItems(workspace.boards.filter((board) => board.parentPageId === parentPageId))
}
