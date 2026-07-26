import { createMermaidSceneSpec, type MermaidSceneSpec } from '@open-pencil/core/diagram'
import { mermaidDiagramOwner, reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  enqueueAutomationMutation,
  type AutomationMutationMetadata,
  type AutomationMutationReceipt
} from '@/app/automation/bridge/mutation-queue'
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

const GROUNDED_PLACEMENT_GAP = 96

type InsertMermaidArgs = {
  allow_additional_owner: boolean
  anchor_id?: string
  board_name?: string
  mutation?: AutomationMutationMetadata
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

function readMutation(value: unknown): AutomationMutationMetadata | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) throw new Error('mutation must be an object.')
  return {
    ...(typeof value.expectedRevision === 'number'
      ? { expectedRevision: value.expectedRevision }
      : {}),
    ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {}),
    ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}),
    ...(typeof value.traceId === 'string' ? { traceId: value.traceId } : {})
  }
}

function readArgs(value: unknown): InsertMermaidArgs {
  if (!isUnknownRecord(value)) {
    throw new Error('Mermaid arguments must be an object.')
  }
  const source = readTrimmedString(value.source)
  const anchorId = readTrimmedString(value.anchor_id)
  const boardName = readTrimmedString(value.board_name)
  const ownerId = readTrimmedString(value.owner_id)
  const projectName = readTrimmedString(value.project_name)
  if (!source) throw new Error('Mermaid source is required.')
  if (projectName && !boardName) {
    throw new Error('board_name is required when project_name is provided.')
  }
  const position = readPosition(value)
  if (anchorId && (ownerId || boardName || position.x !== undefined)) {
    throw new Error('anchor_id cannot be combined with owner_id, board_name, x, or y.')
  }
  return {
    allow_additional_owner: value.allow_additional_owner === true,
    source,
    zoom_to_selection: value.zoom_to_selection !== false,
    ...(anchorId ? { anchor_id: anchorId } : {}),
    ...(boardName ? { board_name: boardName } : {}),
    ...(value.mutation === undefined ? {} : { mutation: readMutation(value.mutation) }),
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(projectName ? { project_name: projectName } : {}),
    ...position
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
  fallback?: Pick<SceneNode, 'x' | 'y'>,
  anchorBounds?: Rect
) {
  if (position.x !== undefined && position.y !== undefined) {
    return { x: position.x, y: position.y }
  }
  if (anchorBounds) {
    return {
      x: anchorBounds.x + anchorBounds.width + GROUNDED_PLACEMENT_GAP,
      y: anchorBounds.y
    }
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

type ResolvedMermaidBoard = Awaited<ReturnType<typeof resolveBoard>>

function assertAdditionalOwnerAllowed(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  board: ResolvedMermaidBoard
): void {
  if (args.owner_id || args.allow_additional_owner || board.created) return
  const ownerIds = mermaidOwnerIdsOnBoard(target, board.pageId)
  if (ownerIds.length === 0) return
  throw new Error(
    `Board "${board.boardName}" already contains Mermaid owner(s): ${ownerIds.join(', ')}. ` +
      'Provide one of these owner_id values to update in place, or set ' +
      'allow_additional_owner: true to intentionally create another diagram.'
  )
}

function resolveExistingOwner(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  board: ResolvedMermaidBoard
): SceneNode | null {
  if (!args.owner_id) return null
  const owner = mermaidDiagramOwner(target.store.graph, args.owner_id)
  if (!owner || owner.id !== args.owner_id || owner.parentId !== board.pageId) {
    throw new Error(`Mermaid owner "${args.owner_id}" was not found on board "${board.boardName}".`)
  }
  const reconciliation = reconcileMermaidDiagramSource(target.store.graph, owner.id)
  if (reconciliation?.status !== 'current') {
    throw new Error(
      `Mermaid owner "${owner.id}" cannot be regenerated because source reconciliation is "${reconciliation?.status ?? 'unknown'}".`
    )
  }
  return owner
}

function selectedAnchorBounds(target: AutomationTarget, anchorId: string): Rect {
  const selectedIds = [...target.store.state.selectedIds]
  if (
    target.store.state.currentPageId !== target.pageId ||
    selectedIds.length !== 1 ||
    selectedIds[0] !== anchorId
  ) {
    throw new Error(
      `Mermaid anchor "${anchorId}" must remain the singleton selection on page "${target.pageName}".`
    )
  }
  const anchor = target.store.graph.getNode(anchorId)
  if (
    !anchor ||
    anchor.type === 'CANVAS' ||
    !target.store.graph.isDescendant(anchor.id, target.pageId)
  ) {
    throw new Error(`Mermaid anchor "${anchorId}" is not a native object on the target page.`)
  }
  return target.store.graph.getAbsoluteBounds(anchor.id)
}

type MermaidReadback = {
  appearance: string | null
  bounds: Rect
  diagram_id: string | null
  editable_layers: number
  node_ids: string[]
  owner_id: string
  parser: string | null
  reconciliation: {
    message: string
    revision: number
    status: string
  }
  source: string
  source_revision: string | null
}

function readMermaidSource(target: AutomationTarget, ownerId: string): MermaidReadback {
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
    bounds: target.store.graph.getAbsoluteBounds(owner.id)
  }
}

function resultWithReceipt(
  value: Record<string, unknown>,
  receipt: AutomationMutationReceipt
): Record<string, unknown> {
  return { ...value, mutation_receipt: receipt }
}

async function applyMermaidMutation(
  target: AutomationTarget,
  args: InsertMermaidArgs,
  diagram: MermaidSceneSpec
): Promise<Record<string, unknown>> {
  const anchorBounds = args.anchor_id ? selectedAnchorBounds(target, args.anchor_id) : undefined
  const board = await resolveBoard(
    target,
    args.board_name,
    args.project_name,
    Boolean(args.owner_id)
  )
  assertAdditionalOwnerAllowed(target, args, board)
  const existingOwner = resolveExistingOwner(target, args, board)
  const position = insertionPosition(
    target,
    diagram,
    args,
    existingOwner ?? undefined,
    anchorBounds
  )
  const nodeIds = existingOwner
    ? target.store.replaceMermaidDiagram(existingOwner.id, diagram, position)
    : target.store.insertMermaidDiagram(diagram, position)
  const ownerId = existingOwner?.id ?? [...target.store.state.selectedIds][0]
  if (!ownerId) throw new Error('Mermaid owner identity was not returned after insertion.')
  if (await ensureGraphFonts(target.store.graph, nodeIds)) target.store.requestRender()
  if (args.zoom_to_selection) target.store.zoomToSelection(editorViewportInsets())
  const readback = readMermaidSource(target, ownerId)
  return {
    board,
    operation: existingOwner ? 'updated' : 'created',
    editable_layers: readback.editable_layers,
    node_ids: readback.node_ids,
    owner_id: readback.owner_id,
    diagram_id: readback.diagram_id,
    parser: readback.parser,
    appearance: readback.appearance,
    position,
    source_attached: true,
    readback
  }
}

export function createAutomationMermaidHandler(
  parseMermaid: typeof parseMermaidInBrowser = parseMermaidInBrowser
) {
  return async function handleMermaid(target: AutomationTarget, value: unknown): Promise<unknown> {
    const args = readArgs(value)
    if (args.anchor_id) selectedAnchorBounds(target, args.anchor_id)
    const diagram = createMermaidSceneSpec(await parseMermaid(args.source))
    const outcome = await enqueueAutomationMutation({
      metadata: args.mutation,
      target,
      toolArgs: {
        id: args.owner_id ?? target.pageId,
        source: args.source
      },
      toolName: 'insert_mermaid_diagram',
      run: () => applyMermaidMutation(target, args, diagram)
    })

    if (outcome.status === 'rejected') {
      return {
        ok: true,
        result: {
          applied: false,
          mutation_receipt: outcome.receipt
        }
      }
    }
    return {
      ok: true,
      result: resultWithReceipt(outcome.value, outcome.receipt)
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
    return {
      ok: true,
      result: readMermaidSource(target, ownerId)
    }
  }
}
