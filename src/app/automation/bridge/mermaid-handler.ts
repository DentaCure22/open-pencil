import { createMermaidSceneSpec, type MermaidSceneSpec } from '@open-pencil/core/diagram'
import { mermaidDiagramOwner, reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import { parseMermaidInBrowser } from '@/app/diagram/mermaid/parse'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
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
  allow_additional_owner: boolean
  board_name?: string
  owner_id?: string
  project_name?: string
  source: string
  x?: number
  y?: number
  zoom_to_selection: boolean
}

function readTrimmedString(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

function readPosition(args: UnknownRecord): Pick<InsertMermaidArgs, 'x' | 'y'> {
  const hasX = Object.hasOwn(args, 'x')
  const hasY = Object.hasOwn(args, 'y')
  if (hasX !== hasY) throw new Error('x and y must be provided together.')
  if (!hasX) return {}
  if (typeof args.x !== 'number' || !Number.isFinite(args.x)) {
    throw new TypeError('x must be a finite canvas coordinate.')
  }
  if (typeof args.y !== 'number' || !Number.isFinite(args.y)) {
    throw new TypeError('y must be a finite canvas coordinate.')
  }
  return { x: args.x, y: args.y }
}

function readArgs(value: unknown): InsertMermaidArgs {
  if (!isUnknownRecord(value)) {
    throw new Error('Mermaid arguments must be an object.')
  }
  const source = readTrimmedString(value.source)
  const boardName = readTrimmedString(value.board_name)
  const ownerId = readTrimmedString(value.owner_id)
  const projectName = readTrimmedString(value.project_name)
  if (!source) throw new Error('Mermaid source is required.')
  if (projectName && !boardName) {
    throw new Error('board_name is required when project_name is provided.')
  }
  return {
    allow_additional_owner: value.allow_additional_owner === true,
    source,
    zoom_to_selection: value.zoom_to_selection !== false,
    ...(boardName ? { board_name: boardName } : {}),
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(projectName ? { project_name: projectName } : {}),
    ...readPosition(value)
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
  const matches = workspace.pages.filter((page) => normalizedName(page.name) === expected)
  if (matches.length > 1) throw new Error(`Project name "${projectName}" is ambiguous.`)
  return matches[0]
}

function findBoard(
  target: AutomationTarget,
  workspace: SidebarWorkspace,
  project: SidebarWorkspacePage,
  boardName: string
): SidebarWorkspaceBoard | undefined {
  const expected = normalizedName(boardName)
  const matches = workspace.boards.filter(
    (board) =>
      board.parentPageId === project.id && normalizedName(boardLabel(target, board)) === expected
  )
  if (matches.length > 1) {
    throw new Error(`Board name "${boardName}" is ambiguous in project "${project.name}".`)
  }
  return matches[0]
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
  projectName: string | undefined,
  requireExisting: boolean
): Promise<{ boardName: string; created: boolean; pageId: string; projectName?: string }> {
  if (!boardName) {
    await target.store.switchPage(target.pageId)
    return { boardName: target.pageName, created: false, pageId: target.pageId }
  }

  let workspace = resolveSidebarWorkspace(target.store.graph).workspace
  const resolvedProjectName = projectName ?? 'Mermaid diagrams'
  let project = findProject(workspace, resolvedProjectName)
  if (!project) {
    if (requireExisting) throw new Error(`Project "${resolvedProjectName}" was not found.`)
    const created = createSidebarPage(workspace, {
      name: resolvedProjectName
    })
    workspace = created.workspace
    project = created.page
  }

  const existing = findBoard(target, workspace, project, boardName)
  if (existing) {
    await target.store.switchPage(existing.pageId)
    target.pageId = existing.pageId
    target.pageName = boardLabel(target, existing)
    return {
      boardName: target.pageName,
      created: false,
      pageId: existing.pageId,
      projectName: project.name
    }
  }
  if (requireExisting) {
    throw new Error(`Board "${boardName}" was not found in project "${project.name}".`)
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
  return { boardName, created: true, pageId, projectName: project.name }
}

function insertionPosition(
  target: AutomationTarget,
  diagram: MermaidSceneSpec,
  position: Pick<InsertMermaidArgs, 'x' | 'y'>,
  fallback?: Pick<SceneNode, 'x' | 'y'>
) {
  if (position.x !== undefined && position.y !== undefined) {
    return { x: position.x, y: position.y }
  }
  if (fallback) return { x: fallback.x, y: fallback.y }
  const center = target.store.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2)
  return {
    x: center.x - diagram.width / 2,
    y: center.y - diagram.height / 2
  }
}

function mermaidOwnerIdsOnBoard(target: AutomationTarget, pageId: string): string[] {
  return target.store.graph
    .getChildren(pageId)
    .filter((node) => mermaidDiagramOwner(target.store.graph, node.id)?.id === node.id)
    .map((node) => node.id)
}

export function createAutomationMermaidHandler(
  parseMermaid: typeof parseMermaidInBrowser = parseMermaidInBrowser
) {
  return async function handleMermaid(target: AutomationTarget, value: unknown): Promise<unknown> {
    const args = readArgs(value)
    const board = await resolveBoard(
      target,
      args.board_name,
      args.project_name,
      Boolean(args.owner_id)
    )
    if (!args.owner_id && !args.allow_additional_owner && !board.created) {
      const ownerIds = mermaidOwnerIdsOnBoard(target, board.pageId)
      if (ownerIds.length > 0) {
        throw new Error(
          `Board "${board.boardName}" already contains Mermaid owner(s): ${ownerIds.join(', ')}. ` +
            'Provide one of these owner_id values to update in place, or set ' +
            'allow_additional_owner: true to intentionally create another diagram.'
        )
      }
    }
    const diagram = createMermaidSceneSpec(await parseMermaid(args.source))
    const existingOwner = args.owner_id
      ? mermaidDiagramOwner(target.store.graph, args.owner_id)
      : null
    if (
      args.owner_id &&
      (!existingOwner ||
        existingOwner.id !== args.owner_id ||
        existingOwner.parentId !== board.pageId)
    ) {
      throw new Error(
        `Mermaid owner "${args.owner_id}" was not found on board "${board.boardName}".`
      )
    }
    const position = insertionPosition(target, diagram, args, existingOwner ?? undefined)
    const nodeIds = existingOwner
      ? target.store.replaceMermaidDiagram(existingOwner.id, diagram, position)
      : target.store.insertMermaidDiagram(diagram, position)
    const ownerId = existingOwner?.id ?? [...target.store.state.selectedIds][0]
    if (await ensureGraphFonts(target.store.graph, nodeIds)) target.store.requestRender()
    if (args.zoom_to_selection) target.store.zoomToSelection(editorViewportInsets())
    const owner = ownerId ? target.store.graph.getNode(ownerId) : undefined
    return {
      ok: true,
      result: {
        board,
        operation: existingOwner ? 'updated' : 'created',
        editable_layers: nodeIds.length,
        node_ids: nodeIds,
        ...(ownerId ? { owner_id: ownerId } : {}),
        ...(owner ? { diagram_id: pluginValue(owner, 'mermaid/diagram-id') } : {}),
        parser: diagram.parser,
        appearance: diagram.appearance,
        position,
        source_attached: true
      }
    }
  }
}

function pluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

export function createAutomationMermaidSourceHandler() {
  return async function handleMermaidSource(
    target: AutomationTarget,
    value: unknown
  ): Promise<unknown> {
    if (!isUnknownRecord(value)) {
      throw new Error('Mermaid source arguments must be an object.')
    }
    const ownerId = readTrimmedString(value.owner_id)
    if (!ownerId) throw new Error('owner_id is required.')
    const owner = mermaidDiagramOwner(target.store.graph, ownerId)
    if (!owner || owner.id !== ownerId || owner.parentId !== target.pageId) {
      throw new Error(`Mermaid owner "${ownerId}" was not found on page "${target.pageName}".`)
    }
    const reconciliation = reconcileMermaidDiagramSource(target.store.graph, ownerId)
    const source = pluginValue(owner, 'mermaid/source')
    if (!source || !reconciliation) {
      throw new Error(`Mermaid source metadata is unavailable for "${ownerId}".`)
    }
    return {
      ok: true,
      result: {
        owner_id: owner.id,
        diagram_id: pluginValue(owner, 'mermaid/diagram-id'),
        source,
        parser: pluginValue(owner, 'mermaid/parser'),
        appearance: pluginValue(owner, 'mermaid/appearance'),
        source_revision: pluginValue(owner, 'mermaid/revision'),
        reconciliation: {
          status: reconciliation.status,
          revision: reconciliation.revision,
          message: reconciliation.message
        },
        editable_layers: owner.childIds.length,
        node_ids: [...owner.childIds],
        bounds: { x: owner.x, y: owner.y, width: owner.width, height: owner.height }
      }
    }
  }
}
