import { defaultBoardIcon, type BoardIconKey } from './icons'
import {
  normalizedWorkspace,
  orderedSidebarBoards,
  orderedSidebarPages,
  orderItems,
  type SidebarPageId,
  type SidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage
} from './model'

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

function createSidebarPageId(): SidebarPageId {
  return `sidebar-page_${crypto.randomUUID()}`
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
