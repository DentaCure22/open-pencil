import { createMermaidSceneSpec, type MermaidSceneSpec } from '@open-pencil/core/diagram'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import { parseMermaidInBrowser } from '@/app/diagram/mermaid/parse'
import { ensureGraphFonts } from '@/app/editor/fonts'
import {
  createSidebarBoard,
  createSidebarPage,
  resolveSidebarWorkspace,
  sidebarWorkspacePluginData,
  type SidebarWorkspace,
  type SidebarWorkspaceBoard,
  type SidebarWorkspacePage
} from '@/app/sidebar-workspace/tree'

type InsertMermaidArgs = {
  board_name?: string
  project_name?: string
  source: string
}

function readArgs(value: unknown): InsertMermaidArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Mermaid arguments must be an object.')
  }
  const args = value as Record<string, unknown>
  const source = typeof args.source === 'string' ? args.source.trim() : ''
  const boardName = typeof args.board_name === 'string' ? args.board_name.trim() : ''
  const projectName = typeof args.project_name === 'string' ? args.project_name.trim() : ''
  if (!source) throw new Error('Mermaid source is required.')
  if (projectName && !boardName) {
    throw new Error('board_name is required when project_name is provided.')
  }
  return {
    source,
    ...(boardName ? { board_name: boardName } : {}),
    ...(projectName ? { project_name: projectName } : {})
  }
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function boardLabel(target: AutomationTarget, board: SidebarWorkspaceBoard): string {
  return board.label ?? target.store.graph.getNode(board.pageId)?.name ?? 'Untitled board'
}

function findProject(
  workspace: SidebarWorkspace,
  projectName: string
): SidebarWorkspacePage | undefined {
  const expected = normalizedName(projectName)
  return workspace.pages.find((page) => normalizedName(page.name) === expected)
}

function findBoard(
  target: AutomationTarget,
  workspace: SidebarWorkspace,
  project: SidebarWorkspacePage,
  boardName: string
): SidebarWorkspaceBoard | undefined {
  const expected = normalizedName(boardName)
  return workspace.boards.find(
    (board) =>
      board.parentPageId === project.id && normalizedName(boardLabel(target, board)) === expected
  )
}

function commitWorkspace(target: AutomationTarget, workspace: SidebarWorkspace): void {
  const root = target.store.graph.getNode(target.store.graph.rootId)
  if (!root) throw new Error('OpenPencil document root is unavailable.')
  target.store.updateNodeWithUndo(
    root.id,
    { pluginData: sidebarWorkspacePluginData(root, workspace) },
    'Create Mermaid board'
  )
}

async function resolveBoard(
  target: AutomationTarget,
  boardName: string | undefined,
  projectName: string | undefined
): Promise<{ boardName: string; pageId: string; projectName?: string }> {
  if (!boardName) {
    await target.store.switchPage(target.pageId)
    return { boardName: target.pageName, pageId: target.pageId }
  }

  let workspace = resolveSidebarWorkspace(target.store.graph).workspace
  let project = projectName ? findProject(workspace, projectName) : undefined
  if (!project) {
    const created = createSidebarPage(workspace, {
      name: projectName ?? 'Mermaid diagrams'
    })
    workspace = created.workspace
    project = created.page
  }

  const existing = findBoard(target, workspace, project, boardName)
  if (existing) {
    await target.store.switchPage(existing.pageId)
    target.pageId = existing.pageId
    target.pageName = boardLabel(target, existing)
    return { boardName: target.pageName, pageId: existing.pageId, projectName: project.name }
  }

  const pageId = target.store.addPage(boardName)
  workspace = createSidebarBoard(workspace, {
    label: boardName,
    pageId,
    parentPageId: project.id
  })
  commitWorkspace(target, workspace)
  await target.store.switchPage(pageId)
  target.pageId = pageId
  target.pageName = boardName
  return { boardName, pageId, projectName: project.name }
}

function insertionPosition(target: AutomationTarget, diagram: MermaidSceneSpec) {
  const center = target.store.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2)
  return {
    x: center.x - diagram.width / 2,
    y: center.y - diagram.height / 2
  }
}

export function createAutomationMermaidHandler() {
  return async function handleMermaid(target: AutomationTarget, value: unknown): Promise<unknown> {
    const args = readArgs(value)
    const board = await resolveBoard(target, args.board_name, args.project_name)
    const diagram = createMermaidSceneSpec(await parseMermaidInBrowser(args.source))
    const nodeIds = target.store.insertMermaidDiagram(diagram, insertionPosition(target, diagram))
    const ownerId = [...target.store.state.selectedIds][0]
    if (await ensureGraphFonts(target.store.graph, nodeIds)) target.store.requestRender()
    target.store.zoomToSelection()
    return {
      ok: true,
      result: {
        board,
        editable_layers: nodeIds.length,
        node_ids: nodeIds,
        ...(ownerId ? { owner_id: ownerId } : {}),
        parser: diagram.parser,
        source_attached: true
      }
    }
  }
}
