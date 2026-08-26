import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { defaultBoardIcon } from './icons'
import {
  DEFAULT_BOARD_LABEL,
  SIDEBAR_WORKSPACE_SCHEMA_VERSION,
  SMYLR_PROJECT_ID,
  normalizedWorkspace,
  orderedSidebarBoards,
  orderedSidebarPages,
  uniqueBy,
  type SidebarPageId,
  type SidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage,
  type SidebarWorkspaceResolution
} from './model'
import { parseSidebarWorkspace, serializedWorkspace } from './persistence'

const SMYLR_PLUGIN_ID = 'smylr-production'
const SMYLR_PROJECT_NAME = 'Smylr'

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
  ) {
    return false
  }
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
  const authoredScenePages = scenePages
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
          orderedSidebarBoards(
            { boards, pages, schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION },
            existingSmylrProject.id
          ).length
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
        order: orderedSidebarPages(
          { boards, pages, schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION },
          null
        ).length,
        parentId: null
      }
      pages.push(logicalPage)
    }
    boards.push({
      label: DEFAULT_BOARD_LABEL,
      order: orderedSidebarBoards(
        { boards, pages, schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION },
        logicalPage.id
      ).length,
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
        order: orderedSidebarPages(
          { boards, pages, schemaVersion: SIDEBAR_WORKSPACE_SCHEMA_VERSION },
          null
        ).length,
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

  const occupiedPageIds = new Set(boards.map((board) => board.parentPageId))
  const orphanedGeneratedPages = new Map(
    pages.flatMap((page) => {
      if (!page.id.startsWith('sidebar-page:') || occupiedPageIds.has(page.id)) return []
      const scenePageId = page.id.slice('sidebar-page:'.length)
      return scenePageIds.has(scenePageId) ? [] : [[page.id, page] as const]
    })
  )
  pages = pages
    .filter((page) => !orphanedGeneratedPages.has(page.id))
    .map((page) => {
      const orphanedParent = page.parentId ? orphanedGeneratedPages.get(page.parentId) : undefined
      return orphanedParent ? { ...page, parentId: orphanedParent.parentId } : page
    })

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

export function resolveSidebarWorkspace(graph: SceneGraph): SidebarWorkspaceResolution {
  const root = graph.getNode(graph.rootId)
  const stored = root ? parseSidebarWorkspace(root) : null
  const workspace = reconcileSidebarWorkspace(graph, stored)
  return {
    changed: !stored || serializedWorkspace(stored) !== serializedWorkspace(workspace),
    workspace
  }
}

export function hasMoreOrganizedSidebarHierarchy(
  candidate: SidebarWorkspace,
  current: SidebarWorkspace
): boolean {
  const candidateBoardIds = new Set(candidate.boards.map((board) => board.pageId))
  if (
    candidateBoardIds.size !== current.boards.length ||
    current.boards.some((board) => !candidateBoardIds.has(board.pageId))
  ) {
    return false
  }
  const nestedProjectCount = (workspace: SidebarWorkspace) =>
    workspace.pages.filter((page) => page.parentId !== null).length
  return nestedProjectCount(candidate) > nestedProjectCount(current)
}
