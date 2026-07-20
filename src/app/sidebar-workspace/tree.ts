import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { defaultBoardIcon, isBoardIconKey, type BoardIconKey } from '@/app/sidebar-workspace/icons'
import { workspaceBasePageIdForPage } from '@/app/workspace-ui/projection'

export const SIDEBAR_WORKSPACE_PLUGIN_ID = 'openpencil-sidebar-workspace'
export const SIDEBAR_WORKSPACE_SCHEMA_VERSION = 1 as const

const SIDEBAR_WORKSPACE_KEY = 'tree-v1'
const DEFAULT_BOARD_LABEL = 'Main board'
const SMYLR_PLUGIN_ID = 'smylr-production'
const SMYLR_PROJECT_ID = 'sidebar-project:smylr'
const SMYLR_PROJECT_NAME = 'Smylr'

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

type CreateSidebarPageInput = {
  name: string
  parentId?: SidebarPageId | null
}

type CreateSidebarBoardInput = {
  icon?: BoardIconKey
  label?: string
  pageId: string
  parentPageId: SidebarPageId
}

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

function parseSidebarWorkspace(root: SceneNode): SidebarWorkspace | null {
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

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const id = key(value)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function orderItems<T extends { order: number }>(items: T[]): T[] {
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

function normalizedWorkspace(workspace: SidebarWorkspace): SidebarWorkspace {
  return {
    boards: normalizeBoardOrders(workspace.boards),
    pages: normalizePageOrders(workspace.pages),
    schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION
  }
}

function deterministicSidebarPageId(scenePageId: string): SidebarPageId {
  return `sidebar-page:${scenePageId}`
}

function isSmylrWorkspacePage(page: SceneNode): boolean {
  return page.pluginData.some((entry) => entry.pluginId === SMYLR_PLUGIN_ID && entry.key === 'kind')
}

function isLegacyGeneratedSmylrWorkspace(
  stored: SidebarWorkspace | null,
  scenePages: SceneNode[]
): boolean {
  if (
    !stored ||
    stored.pages.length !== scenePages.length ||
    stored.boards.length !== scenePages.length
  )
    return false
  const scenePageIds = new Set(scenePages.map((page) => page.id))
  return (
    stored.pages.every(
      (page) =>
        page.parentId === null &&
        page.id.startsWith('sidebar-page:') &&
        scenePageIds.has(page.id.slice('sidebar-page:'.length))
    ) &&
    stored.boards.every(
      (board) =>
        scenePageIds.has(board.pageId) &&
        board.parentPageId === deterministicSidebarPageId(board.pageId) &&
        board.label === DEFAULT_BOARD_LABEL
    )
  )
}

function smylrProject(): SidebarWorkspacePage {
  return {
    id: SMYLR_PROJECT_ID,
    name: SMYLR_PROJECT_NAME,
    order: 0,
    parentId: null
  }
}

function smylrBoard(page: SceneNode, order: number): SidebarWorkspaceBoard {
  return {
    icon: defaultBoardIcon(page.name, page.id),
    label: page.name,
    order,
    pageId: page.id,
    parentPageId: SMYLR_PROJECT_ID
  }
}

function createSidebarPageId(): SidebarPageId {
  return `sidebar-page_${crypto.randomUUID()}`
}

function safeParentId(
  page: SidebarWorkspacePage,
  pageIds: Set<SidebarPageId>
): SidebarPageId | null {
  if (!page.parentId || page.parentId === page.id || !pageIds.has(page.parentId)) return null
  return page.parentId
}

function breaksPageCycle(
  page: SidebarWorkspacePage,
  pagesById: Map<SidebarPageId, SidebarWorkspacePage>
): boolean {
  const seen = new Set<SidebarPageId>([page.id])
  let parentId = page.parentId
  while (parentId) {
    if (seen.has(parentId)) return true
    seen.add(parentId)
    parentId = pagesById.get(parentId)?.parentId ?? null
  }
  return false
}

function reconcileSidebarWorkspace(
  graph: SceneGraph,
  stored: SidebarWorkspace | null
): SidebarWorkspace {
  const scenePages = graph.getPages()
  const authoredScenePages = scenePages.filter((page) => {
    const basePageId = workspaceBasePageIdForPage(page)
    return !basePageId || basePageId === page.id
  })
  const scenePageIds = new Set(authoredScenePages.map((page) => page.id))
  const derivedLogicalPageIds = new Set(
    scenePages
      .filter((page) => !scenePageIds.has(page.id))
      .map((page) => deterministicSidebarPageId(page.id))
  )
  const smylrScenePages = authoredScenePages.filter(isSmylrWorkspacePage)
  const shouldUnifySmylrWorkspace =
    smylrScenePages.length > 0 &&
    (!stored || isLegacyGeneratedSmylrWorkspace(stored, authoredScenePages))
  let pages = shouldUnifySmylrWorkspace
    ? [smylrProject()]
    : uniqueBy(stored?.pages ?? [], (page) => page.id).filter(
        (page) => !derivedLogicalPageIds.has(page.id)
      )
  const initialPageIds = new Set(pages.map((page) => page.id))
  pages = pages.map((page) => ({ ...page, parentId: safeParentId(page, initialPageIds) }))
  const pagesById = new Map(pages.map((page) => [page.id, page]))
  pages = pages.map((page) =>
    breaksPageCycle(page, pagesById) ? { ...page, parentId: null } : page
  )

  const boards = shouldUnifySmylrWorkspace
    ? smylrScenePages.map(smylrBoard)
    : uniqueBy(stored?.boards ?? [], (board) => board.pageId).filter(
        (board) =>
          scenePageIds.has(board.pageId) && pages.some((page) => page.id === board.parentPageId)
      )
  const assignedScenePageIds = new Set(boards.map((board) => board.pageId))

  const existingSmylrProject = pages.find((page) => page.id === SMYLR_PROJECT_ID)
  if (existingSmylrProject) {
    for (const scenePage of smylrScenePages) {
      if (assignedScenePageIds.has(scenePage.id)) continue
      boards.push(
        smylrBoard(
          scenePage,
          orderedSidebarBoards({ boards, pages, schemaVersion: 1 }, existingSmylrProject.id).length
        )
      )
      assignedScenePageIds.add(scenePage.id)
    }
  }

  for (const scenePage of authoredScenePages) {
    if (assignedScenePageIds.has(scenePage.id)) continue

    const logicalPageId = deterministicSidebarPageId(scenePage.id)
    let logicalPage = pages.find((page) => page.id === logicalPageId)
    if (!logicalPage) {
      logicalPage = {
        id: logicalPageId,
        name: scenePage.name,
        order: orderedSidebarPages({ boards, pages, schemaVersion: 1 }, null).length,
        parentId: null
      }
      pages.push(logicalPage)
    }
    boards.push({
      label: DEFAULT_BOARD_LABEL,
      order: orderedSidebarBoards({ boards, pages, schemaVersion: 1 }, logicalPage.id).length,
      pageId: scenePage.id,
      parentPageId: logicalPage.id
    })
    assignedScenePageIds.add(scenePage.id)
  }

  for (const scenePage of authoredScenePages) {
    if (assignedScenePageIds.has(scenePage.id)) continue
    const logicalPageId = deterministicSidebarPageId(scenePage.id)
    if (!pages.some((page) => page.id === logicalPageId)) {
      pages.push({
        id: logicalPageId,
        name: scenePage.name,
        order: orderedSidebarPages({ boards, pages, schemaVersion: 1 }, null).length,
        parentId: null
      })
    }
    boards.push({
      label: DEFAULT_BOARD_LABEL,
      order: 0,
      pageId: scenePage.id,
      parentPageId: logicalPageId
    })
  }

  const boardsWithIcons = boards.map((board) => {
    if (board.icon) return board
    const scenePageName = graph.getNode(board.pageId)?.name ?? ''
    return {
      ...board,
      icon: defaultBoardIcon(`${board.label ?? ''} ${scenePageName}`, board.pageId)
    }
  })

  return normalizedWorkspace({
    boards: boardsWithIcons,
    pages,
    schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION
  })
}

function serializedWorkspace(workspace: SidebarWorkspace): string {
  return JSON.stringify(normalizedWorkspace(workspace))
}

export function resolveSidebarWorkspace(graph: SceneGraph): SidebarWorkspaceResolution {
  const root = graph.getNode(graph.rootId)
  const stored = root ? parseSidebarWorkspace(root) : null
  const workspace = reconcileSidebarWorkspace(graph, stored)
  return {
    changed: !stored || serializedWorkspace(stored) !== serializedWorkspace(workspace),
    workspace
  }
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

export function createSidebarPage(
  workspace: SidebarWorkspace,
  input: CreateSidebarPageInput
): { page: SidebarWorkspacePage; workspace: SidebarWorkspace } {
  const parentId = input.parentId ?? null
  if (parentId && !workspace.pages.some((page) => page.id === parentId)) {
    throw new Error(`sidebar_parent_page_not_found: ${parentId}`)
  }
  const page: SidebarWorkspacePage = {
    id: createSidebarPageId(),
    name: input.name,
    order: orderedSidebarPages(workspace, parentId).length,
    parentId
  }
  return {
    page,
    workspace: normalizedWorkspace({ ...workspace, pages: [...workspace.pages, page] })
  }
}

export function createSidebarBoard(
  workspace: SidebarWorkspace,
  input: CreateSidebarBoardInput
): SidebarWorkspace {
  if (!workspace.pages.some((page) => page.id === input.parentPageId)) {
    throw new Error(`sidebar_parent_page_not_found: ${input.parentPageId}`)
  }
  if (workspace.boards.some((board) => board.pageId === input.pageId)) {
    throw new Error(`sidebar_board_already_exists: ${input.pageId}`)
  }
  const board: SidebarWorkspaceBoard = {
    icon: input.icon ?? defaultBoardIcon(input.label ?? '', input.pageId),
    label: input.label,
    order: orderedSidebarBoards(workspace, input.parentPageId).length,
    pageId: input.pageId,
    parentPageId: input.parentPageId
  }
  return normalizedWorkspace({ ...workspace, boards: [...workspace.boards, board] })
}

export function renameSidebarPage(
  workspace: SidebarWorkspace,
  pageId: SidebarPageId,
  name: string
): SidebarWorkspace {
  return {
    ...workspace,
    pages: workspace.pages.map((page) => (page.id === pageId ? { ...page, name } : page))
  }
}

export function renameSidebarBoard(
  workspace: SidebarWorkspace,
  boardPageId: string,
  label: string
): SidebarWorkspace {
  return {
    ...workspace,
    boards: workspace.boards.map((board) =>
      board.pageId === boardPageId ? { ...board, label } : board
    )
  }
}

export function setSidebarBoardIcon(
  workspace: SidebarWorkspace,
  boardPageId: string,
  icon: BoardIconKey
): SidebarWorkspace {
  return {
    ...workspace,
    boards: workspace.boards.map((board) =>
      board.pageId === boardPageId ? { ...board, icon } : board
    )
  }
}

function isPageDescendant(
  workspace: SidebarWorkspace,
  pageId: SidebarPageId,
  possibleAncestorId: SidebarPageId
): boolean {
  let current = workspace.pages.find((page) => page.id === pageId)
  while (current?.parentId) {
    if (current.parentId === possibleAncestorId) return true
    const parentId = current.parentId
    current = workspace.pages.find((page) => page.id === parentId)
  }
  return false
}

export function moveSidebarPage(
  workspace: SidebarWorkspace,
  pageId: SidebarPageId,
  parentId: SidebarPageId | null,
  index: number
): SidebarWorkspace {
  if (pageId === parentId || (parentId && isPageDescendant(workspace, parentId, pageId))) {
    throw new Error('sidebar_page_cycle')
  }
  if (parentId && !workspace.pages.some((page) => page.id === parentId)) {
    throw new Error(`sidebar_parent_page_not_found: ${parentId}`)
  }
  const moving = workspace.pages.find((page) => page.id === pageId)
  if (!moving) throw new Error(`sidebar_page_not_found: ${pageId}`)
  const remaining = workspace.pages.filter((page) => page.id !== pageId)
  const siblings = orderItems(remaining.filter((page) => page.parentId === parentId))
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, { ...moving, parentId })
  const siblingIds = new Set(siblings.map((page) => page.id))
  return normalizedWorkspace({
    ...workspace,
    pages: [
      ...remaining.filter((page) => !siblingIds.has(page.id)),
      ...siblings.map((page, order) => ({ ...page, order }))
    ]
  })
}

export function moveSidebarBoard(
  workspace: SidebarWorkspace,
  boardPageId: string,
  parentPageId: SidebarPageId,
  index: number
): SidebarWorkspace {
  if (!workspace.pages.some((page) => page.id === parentPageId)) {
    throw new Error(`sidebar_parent_page_not_found: ${parentPageId}`)
  }
  const moving = workspace.boards.find((board) => board.pageId === boardPageId)
  if (!moving) throw new Error(`sidebar_board_not_found: ${boardPageId}`)
  const remaining = workspace.boards.filter((board) => board.pageId !== boardPageId)
  const siblings = orderItems(remaining.filter((board) => board.parentPageId === parentPageId))
  siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, { ...moving, parentPageId })
  const siblingIds = new Set(siblings.map((board) => board.pageId))
  return normalizedWorkspace({
    ...workspace,
    boards: [
      ...remaining.filter((board) => !siblingIds.has(board.pageId)),
      ...siblings.map((board, order) => ({ ...board, order }))
    ]
  })
}

export function removeSidebarBoard(
  workspace: SidebarWorkspace,
  boardPageId: string
): SidebarWorkspace {
  return normalizedWorkspace({
    ...workspace,
    boards: workspace.boards.filter((board) => board.pageId !== boardPageId)
  })
}

export function removeSidebarPage(
  workspace: SidebarWorkspace,
  pageId: SidebarPageId
): SidebarWorkspace {
  if (!workspace.pages.some((page) => page.id === pageId)) {
    throw new Error(`sidebar_page_not_found: ${pageId}`)
  }
  if (
    workspace.boards.some((board) => board.parentPageId === pageId) ||
    workspace.pages.some((page) => page.parentId === pageId)
  ) {
    throw new Error(`sidebar_page_not_empty: ${pageId}`)
  }
  return normalizedWorkspace({
    ...workspace,
    pages: workspace.pages.filter((page) => page.id !== pageId)
  })
}
