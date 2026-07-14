import { computeAllLayouts } from '@open-pencil/core/layout'

import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  applyKnowledgeWorkspaceMutations,
  getKnowledgeWorkspaceContext,
  queryKnowledgeWorkspaceItems
} from '@/app/automation/bridge/workspace-semantic-adapter'
import {
  createHtmlBoardFrame,
  htmlBoardFrameProperties,
  htmlBoardInteractionFrameId,
  isHtmlBoardFrame
} from '@/app/html-board/workspace'
import { normalizeLiveInspectorStylePatch } from '@/app/smylr-live-inspector/patch'
import type { LiveInspectorPatchDraft } from '@/app/smylr-live-inspector/patch'
import {
  liveInspectorInteractionMode,
  liveInspectorPatchDraftFor,
  liveInspectorPatchDrafts,
  liveInspectorRoute,
  previewLiveInspectorDraft,
  selectLiveInspectorNode,
  selectedLiveInspectorNode,
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import {
  addLiveWorkspaceItemToFlow,
  approveLiveWorkspaceItemForMerge,
  liveWorkspaceItems,
  liveWorkspaceItemsForSync,
  replaceLiveWorkspaceItemsFromSync,
  saveLiveWorkspaceItem,
  selectLiveWorkspaceItem,
  sendLiveWorkspaceItemToReview,
  snapshotLiveWorkspace,
  startLiveWorkspaceBranch,
  updateLiveWorkspaceItem,
  workspaceItemPatches
} from '@/app/smylr-live-inspector/workspace'
import type { LiveWorkspaceItem } from '@/app/smylr-live-inspector/workspace'
import { ensureSmylrBoardGuide, findSmylrBoardGuide } from '@/app/smylr-production/board-guide'
import {
  ensureSmylrAlternateLiveAppFrame,
  findCurrentSmylrLiveAppFrame,
  smylrLiveAppFrameRoute
} from '@/app/smylr-production/workspace'

type UnknownRecord = Record<string, unknown>

type SemanticResultScope =
  | 'board'
  | 'live-preview'
  | 'workspace-metadata'
  | 'proposed-source-patch'
  | 'source'

const idempotencyResults = new Map<string, unknown>()

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  const strings: string[] = []
  for (const item of value) {
    const string = readString(item)
    if (string) strings.push(string)
  }
  return strings
}

function readRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

function sceneRevision(target: AutomationTarget) {
  return target.store.state.sceneVersion
}

function assertExpectedRevision(target: AutomationTarget, args: UnknownRecord) {
  if (args.expected_revision === undefined) return
  const expected = Number(args.expected_revision)
  if (!Number.isInteger(expected) || expected !== sceneRevision(target)) {
    throw new Error(`revision_conflict: expected ${expected}, current ${sceneRevision(target)}`)
  }
}

function currentRoute(target: AutomationTarget) {
  const frame = findCurrentSmylrLiveAppFrame(target.store)
  return liveInspectorRoute.value ?? (frame ? smylrLiveAppFrameRoute(frame) : null)
}

function contextSelection() {
  const node = selectedLiveInspectorNode.value
  if (!node) return null
  const draft = liveInspectorPatchDraftFor(node.id)
  return {
    id: node.id,
    label: node.label,
    tagName: node.tagName,
    component: node.source?.componentName,
    sourceFile: node.source?.filePath,
    classes: node.className?.split(/\s+/).filter(Boolean) ?? [],
    tokenHints: node.tokenHints ?? [],
    bounds: node.rect,
    effectiveStyles: { ...node.computedStyle, ...draft?.styles },
    liveChanges: draft ?? null
  }
}

function result(target: AutomationTarget, scope: SemanticResultScope, value: UnknownRecord) {
  return {
    ok: true,
    result: {
      ...value,
      scope,
      revision: sceneRevision(target)
    }
  }
}

function restoreSemanticState(
  target: AutomationTarget,
  pageSnapshot: ReturnType<AutomationTarget['store']['snapshotPage']>,
  workspaceSnapshot: LiveWorkspaceItem[]
) {
  target.store.restorePageFromSnapshot(pageSnapshot)
  replaceLiveWorkspaceItemsFromSync(workspaceSnapshot)
  computeAllLayouts(target.store.graph, target.pageId)
  target.store.requestRender()
}

function mutateWithUndo<T>(target: AutomationTarget, label: string, mutation: () => T) {
  const beforePage = target.store.snapshotPage()
  const beforeWorkspace = liveWorkspaceItemsForSync()
  const mutationResult = mutation()
  computeAllLayouts(target.store.graph, target.pageId)
  target.store.requestRender()
  const afterPage = target.store.snapshotPage()
  const afterWorkspace = liveWorkspaceItemsForSync()
  target.store.pushUndoEntry({
    label: `MCP: ${label}`,
    forward: () => restoreSemanticState(target, afterPage, afterWorkspace),
    inverse: () => restoreSemanticState(target, beforePage, beforeWorkspace)
  })
  return mutationResult
}

function withIdempotency(
  target: AutomationTarget,
  toolName: string,
  args: UnknownRecord,
  operation: () => unknown
) {
  const key = readString(args.idempotency_key)
  if (!key) return operation()
  const cacheKey = `${target.documentId}:${toolName}:${key}`
  if (idempotencyResults.has(cacheKey)) return idempotencyResults.get(cacheKey)
  const operationResult = operation()
  idempotencyResults.set(cacheKey, operationResult)
  return operationResult
}

function selectedPatches() {
  return [...liveInspectorPatchDrafts.value.values()].map((patch) => structuredClone(patch))
}

function requireItem(id: string | undefined) {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item) throw new Error(`workspace_item_not_found: ${id ?? 'missing id'}`)
  return item
}

function createVersion(
  target: AutomationTarget,
  args: UnknownRecord,
  kind: 'draft' | 'variant' | 'flow'
) {
  const node = selectedLiveInspectorNode.value
  if (!node) throw new Error('No live Smylr container is selected.')
  const patches = selectedPatches()
  if (patches.length === 0) throw new Error('Make a live edit before saving a version.')
  if (!Object.hasOwn(patches, 0)) {
    throw new Error('Make a live edit before saving a version.')
  }
  const primaryPatch = patches[0]
  const route = readString(args.route) ?? currentRoute(target)
  if (!route) throw new Error('No live Smylr route is active.')
  const name = readString(args.name) ?? `${node.label} ${kind === 'variant' ? 'Alternate' : kind}`
  const note = readString(args.note)
  if (kind === 'variant') {
    return snapshotLiveWorkspace({
      baseRevision: String(sceneRevision(target)),
      name,
      nodeId: node.id,
      note,
      patches,
      route
    })
  }
  return saveLiveWorkspaceItem({
    baseRevision: String(sceneRevision(target)),
    kind,
    name,
    nodeId: node.id,
    note,
    patch: primaryPatch,
    patches,
    route,
    status: 'active'
  })
}

function patchSummary(item: LiveWorkspaceItem) {
  return workspaceItemPatches(item).map((patch) => ({
    nodeId: patch.nodeId,
    add: patch.add,
    remove: patch.remove,
    styles: patch.styles ?? {},
    source: patch.source
  }))
}

function addItemToFlow(item: LiveWorkspaceItem, args: UnknownRecord) {
  addLiveWorkspaceItemToFlow(item.id)
  updateLiveWorkspaceItem(item.id, {
    flow: {
      flowId: readString(args.flow_id) ?? `flow-${item.route.replace(/[^a-z0-9]+/gi, '-')}`,
      index: Number.isInteger(Number(args.index)) ? Number(args.index) : undefined
    }
  })
}

function connectWorkspaceStates(item: LiveWorkspaceItem, args: UnknownRecord) {
  const targetItem = requireItem(readString(args.target_item_id))
  const flowId = readString(args.flow_id) ?? item.flow?.flowId ?? targetItem.flow?.flowId
  if (!flowId) throw new Error('flow_id is required to connect states.')
  updateLiveWorkspaceItem(item.id, {
    flow: {
      ...item.flow,
      flowId,
      nextIds: [...new Set([...(item.flow?.nextIds ?? []), targetItem.id])],
      transition: readString(args.transition) ?? item.flow?.transition
    },
    kind: 'flow'
  })
  updateLiveWorkspaceItem(targetItem.id, {
    flow: { ...targetItem.flow, flowId, previousId: item.id },
    kind: 'flow'
  })
}

function renameWorkspaceItem(item: LiveWorkspaceItem, args: UnknownRecord) {
  const name = readString(args.name)
  if (!name) throw new Error('name is required to rename a workspace item.')
  updateLiveWorkspaceItem(item.id, { name })
}

function updateExistingWorkspaceItem(
  target: AutomationTarget,
  operation: string,
  args: UnknownRecord
) {
  const item = requireItem(readString(args.item_id))
  switch (operation) {
    case 'add_to_flow':
      addItemToFlow(item, args)
      break
    case 'connect_states':
      connectWorkspaceStates(item, args)
      break
    case 'start_branch':
      if (!startLiveWorkspaceBranch(item.id)) throw new Error('Unable to start branch.')
      break
    case 'send_review':
      if (!sendLiveWorkspaceItemToReview(item.id)) throw new Error('Unable to send review.')
      break
    case 'approve':
      if (!approveLiveWorkspaceItemForMerge(item.id)) {
        throw new Error('approval_requires_ready_for_review')
      }
      break
    case 'prefer':
      updateLiveWorkspaceItem(item.id, { status: 'preferred' })
      break
    case 'archive':
      updateLiveWorkspaceItem(item.id, { kind: 'archived', status: 'archived' })
      break
    case 'rename':
      renameWorkspaceItem(item, args)
      break
    default:
      throw new Error(`Unsupported workspace operation: ${operation}`)
  }
  const updated = requireItem(item.id)
  ensureSmylrAlternateLiveAppFrame(target.store, updated)
  return updated
}

function applyLegacyWorkspaceOperation(
  target: AutomationTarget,
  operation: string,
  args: UnknownRecord
) {
  if (operation === 'create_version') {
    const kind = readString(args.kind)
    return createVersion(target, args, kind === 'draft' ? 'draft' : 'variant')
  }
  if (operation === 'create_flow_state') return createVersion(target, args, 'flow')
  return updateExistingWorkspaceItem(target, operation, args)
}

function handleWorkspaceMutation(target: AutomationTarget, args: UnknownRecord) {
  const operation = readString(args.operation)
  if (!operation) throw new Error('Missing workspace operation.')
  if (args.dry_run === true) {
    return result(target, 'workspace-metadata', {
      dryRun: true,
      operation,
      itemId: readString(args.item_id) ?? null,
      targetItemId: readString(args.target_item_id) ?? null
    })
  }
  assertExpectedRevision(target, args)
  return withIdempotency(target, 'mutate_workspace_graph', args, () => {
    const value = mutateWithUndo(target, operation, () =>
      applyLegacyWorkspaceOperation(target, operation, args)
    )
    return result(target, 'workspace-metadata', {
      affectedStableIds: [value.id],
      operation
    })
  })
}

type SemanticToolHandler = (target: AutomationTarget, args: UnknownRecord) => unknown

async function handleGetContext(target: AutomationTarget) {
  const route = currentRoute(target)
  const knowledgeWorkspace = await getKnowledgeWorkspaceContext(target)
  const htmlBoards = target.store.graph
    .getChildren(target.pageId)
    .filter(isHtmlBoardFrame)
    .map((board) => ({
      height: board.height,
      id: board.id,
      interactionMode: htmlBoardInteractionFrameId.value === board.id ? 'interact' : 'design',
      name: board.name,
      width: board.width
    }))
  return result(target, 'board', {
    canvasMode: liveInspectorInteractionMode.value,
    document: { id: target.documentId, name: target.documentName },
    htmlBoards,
    knowledgeWorkspace,
    liveSelection: contextSelection(),
    page: { id: target.pageId, name: target.pageName },
    route,
    runtimeModel: 'scenario-canvas-single-shared-runtime',
    sceneRevision: sceneRevision(target),
    workspaceGraph: liveWorkspaceItemsForSync().filter((item) => !route || item.route === route),
    workspaceRevision: knowledgeWorkspace.revision
  })
}

function optionalViewportDimension(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isInteger(number) && number >= 240 && number <= 3840 ? number : undefined
}

function handleUpsertHtmlBoard(target: AutomationTarget, args: UnknownRecord) {
  assertExpectedRevision(target, args)
  const html = typeof args.html === 'string' ? args.html : ''
  const css = typeof args.css === 'string' ? args.css : ''
  if (!html.trim()) throw new Error('html is required to create or update an HTML board.')
  const boardId = readString(args.board_id)
  const existing = boardId ? target.store.graph.getNode(boardId) : null
  if (boardId && (!existing || !isHtmlBoardFrame(existing))) {
    throw new Error(`html_board_not_found: ${boardId}`)
  }
  const width = optionalViewportDimension(args.width)
  const height = optionalViewportDimension(args.height)
  const name = readString(args.name)

  if (args.dry_run === true) {
    return result(target, 'board', {
      boardId: existing?.id ?? null,
      dryRun: true,
      interactionMode: readString(args.interaction_mode) ?? 'design',
      wouldCreate: !existing
    })
  }

  return withIdempotency(target, 'upsert_html_board', args, () => {
    const frame = mutateWithUndo(target, existing ? 'update HTML board' : 'create HTML board', () => {
      const board = existing ?? createHtmlBoardFrame(target.store, html, css)
      const properties = htmlBoardFrameProperties(board, html, css)
      target.store.graph.updateNode(board.id, {
        ...properties,
        ...(height ? { height } : {}),
        ...(name ? { name } : {}),
        ...(width ? { width } : {})
      })
      return target.store.graph.getNode(board.id) ?? board
    })
    htmlBoardInteractionFrameId.value =
      readString(args.interaction_mode) === 'interact' ? frame.id : null
    return result(target, 'board', {
      affectedStableIds: [frame.id],
      board: {
        height: frame.height,
        id: frame.id,
        interactionMode: htmlBoardInteractionFrameId.value === frame.id ? 'interact' : 'design',
        name: frame.name,
        width: frame.width
      },
      created: !existing
    })
  })
}

function handleInspectLiveContainer(target: AutomationTarget) {
  const selection = contextSelection()
  if (!selection) throw new Error('No live Smylr container is selected.')
  return result(target, 'live-preview', { selection })
}

function handleEditLiveContainer(target: AutomationTarget, args: UnknownRecord) {
  assertExpectedRevision(target, args)
  const node = selectedLiveInspectorNode.value
  if (!node) throw new Error('No live Smylr container is selected.')
  const current = liveInspectorPatchDraftFor(node.id)
  const added = new Set(current?.add)
  const removed = new Set(current?.remove)
  for (const token of readStringArray(args.add)) {
    removed.delete(token)
    added.add(token)
  }
  for (const token of readStringArray(args.remove)) {
    added.delete(token)
    removed.add(token)
  }
  const styles = normalizeLiveInspectorStylePatch({
    ...current?.styles,
    ...readRecord(args.styles)
  })
  if (added.size === 0 && removed.size === 0 && Object.keys(styles).length === 0) {
    throw new Error('No live style or token changes were provided.')
  }
  const draft: LiveInspectorPatchDraft = {
    add: [...added],
    nodeId: node.id,
    note: readString(args.note) ?? node.label,
    remove: [...removed],
    source: node.source,
    styles
  }
  if (args.dry_run === true) return result(target, 'live-preview', { draft, dryRun: true })
  const updatedOnCanvas = previewLiveInspectorDraft(draft, { label: 'MCP: edit live container' })
  return result(target, 'live-preview', { affectedStableIds: [node.id], draft, updatedOnCanvas })
}

function handleUpsertBoardGuide(target: AutomationTarget, args: UnknownRecord) {
  assertExpectedRevision(target, args)
  const existing = findSmylrBoardGuide(target.store.graph, target.pageId)
  if (args.dry_run === true) {
    return result(target, 'board', {
      dryRun: true,
      guideId: existing?.id ?? null,
      wouldCreate: !existing
    })
  }
  if (existing) return result(target, 'board', { affectedStableIds: [existing.id], created: false })
  const guide = mutateWithUndo(target, 'upsert board guide', () =>
    ensureSmylrBoardGuide(target.store.graph, target.pageId, {
      route: currentRoute(target) ?? undefined,
      title: readString(args.title)
    })
  )
  return result(target, 'board', { affectedStableIds: [guide.id], created: true })
}

async function handleMutateWorkspaceGraph(target: AutomationTarget, args: UnknownRecord) {
  if (readString(args.operation) === 'apply_knowledge_mutations') {
    const mutation = await applyKnowledgeWorkspaceMutations(target, args)
    return result(target, 'workspace-metadata', mutation)
  }
  return handleWorkspaceMutation(target, args)
}

async function handleQueryWorkspaceItems(target: AutomationTarget, args: UnknownRecord) {
  const query = await queryKnowledgeWorkspaceItems(target, args)
  return result(target, 'workspace-metadata', query)
}

function handleActivateWorkspaceItem(target: AutomationTarget, args: UnknownRecord) {
  const item = requireItem(readString(args.item_id))
  const frame = ensureSmylrAlternateLiveAppFrame(target.store, item)
  selectLiveWorkspaceItem(item.id)
  selectLiveInspectorNode(item.nodeId)
  for (const patch of workspaceItemPatches(item)) previewLiveInspectorDraft(patch)
  setLiveInspectorActiveFrame(frame?.id ?? null)
  setLiveInspectorInteractionMode(readString(args.mode) === 'interact' ? 'interact' : 'select')
  return result(target, 'live-preview', {
    affectedStableIds: [item.id, ...(frame ? [frame.id] : [])],
    mode: liveInspectorInteractionMode.value,
    runtimeModel: 'shared-runtime'
  })
}

function handleCompareWorkspaceItems(target: AutomationTarget, args: UnknownRecord) {
  const left = requireItem(readString(args.left_item_id))
  const right = requireItem(readString(args.right_item_id))
  return result(target, 'workspace-metadata', {
    left: { id: left.id, name: left.name, patches: patchSummary(left), status: left.status },
    right: { id: right.id, name: right.name, patches: patchSummary(right), status: right.status }
  })
}

function handleCreateChangeSet(target: AutomationTarget, args: UnknownRecord) {
  assertExpectedRevision(target, args)
  const sourceItems = readStringArray(args.item_ids).map((id) => requireItem(id))
  if (sourceItems.length === 0)
    throw new Error('item_ids must contain approved or preferred items.')
  if (sourceItems.some((item) => !['approved', 'preferred'].includes(item.status))) {
    throw new Error('change_set_requires_approved_or_preferred_items')
  }
  const patches = sourceItems.flatMap(workspaceItemPatches)
  if (args.dry_run === true) {
    return result(target, 'workspace-metadata', {
      dryRun: true,
      patchCount: patches.length,
      sourceItemIds: sourceItems.map((item) => item.id)
    })
  }
  const changeSet = mutateWithUndo(target, 'create change set', () => {
    if (!Object.hasOwn(patches, 0) || !Object.hasOwn(sourceItems, 0)) {
      throw new Error('change_set_requires_workspace_patches')
    }
    const primaryPatch = patches[0]
    const primarySourceItem = sourceItems[0]
    return saveLiveWorkspaceItem({
      baseRevision: String(sceneRevision(target)),
      changeSet: {
        acceptanceCriteria: readStringArray(args.acceptance_criteria),
        sourceItemIds: sourceItems.map((item) => item.id),
        verificationStatus: 'not-checked'
      },
      kind: 'change-set',
      name: readString(args.name) ?? 'OpenPencil Change Set',
      nodeId: primaryPatch.nodeId,
      note: readString(args.note),
      patch: primaryPatch,
      patches,
      route: primarySourceItem.route,
      status: 'approved'
    })
  })
  ensureSmylrAlternateLiveAppFrame(target.store, changeSet)
  return result(target, 'workspace-metadata', {
    affectedStableIds: [changeSet.id],
    changeSet
  })
}

function handleProposeSourcePatch(target: AutomationTarget, args: UnknownRecord) {
  const itemIds = readStringArray(args.item_ids)
  const items =
    itemIds.length > 0
      ? itemIds.map((id) => requireItem(id))
      : [requireItem(readString(args.change_set_id))]
  const patches = items.flatMap(workspaceItemPatches)
  const unresolved = patches.filter((patch) => !patch.source?.filePath)
  if (unresolved.length > 0) {
    throw new Error(
      `source_target_unresolved: ${unresolved.map((patch) => patch.nodeId).join(', ')}`
    )
  }
  return result(target, 'proposed-source-patch', {
    proposalOnly: true,
    targets: patches.map((patch) => ({
      add: patch.add,
      component: patch.source?.componentName,
      filePath: patch.source?.filePath,
      nodeId: patch.nodeId,
      note: patch.note,
      remove: patch.remove,
      styles: patch.styles ?? {}
    }))
  })
}

function handleVerifyChangeSet(target: AutomationTarget, args: UnknownRecord) {
  const item = requireItem(readString(args.change_set_id))
  if (item.kind !== 'change-set' || !item.changeSet) throw new Error('Not a change set.')
  const sourceItems = item.changeSet.sourceItemIds.map((id) => requireItem(id))
  const patches = sourceItems.flatMap(workspaceItemPatches)
  const changeSet = item.changeSet
  const checks = {
    acceptanceCriteriaPresent: item.changeSet.acceptanceCriteria.length > 0,
    patchesPresent: patches.length > 0,
    sourceItemsPresent: sourceItems.length === item.changeSet.sourceItemIds.length,
    sourceTargetsResolved: patches.every((patch) => Boolean(patch.source?.filePath))
  }
  const passed = Object.values(checks).every(Boolean)
  if (passed && args.dry_run !== true) {
    mutateWithUndo(target, 'verify change set workspace', () =>
      updateLiveWorkspaceItem(item.id, {
        changeSet: { ...changeSet, verificationStatus: 'workspace-checked' }
      })
    )
  }
  return result(target, 'workspace-metadata', {
    changeSetId: item.id,
    checks,
    nextRequiredStep:
      'Codex must apply the proposed source patch, run tests, and verify the real app.',
    passed,
    verificationStatus: passed ? 'workspace-checked' : 'not-checked'
  })
}

const semanticToolHandlers = {
  activate_workspace_item: handleActivateWorkspaceItem,
  compare_workspace_items: handleCompareWorkspaceItems,
  create_change_set: handleCreateChangeSet,
  edit_live_container: handleEditLiveContainer,
  get_openpencil_context: handleGetContext,
  inspect_live_container: handleInspectLiveContainer,
  mutate_workspace_graph: handleMutateWorkspaceGraph,
  propose_source_patch: handleProposeSourcePatch,
  query_workspace_items: handleQueryWorkspaceItems,
  upsert_board_guide: handleUpsertBoardGuide,
  upsert_html_board: handleUpsertHtmlBoard,
  verify_change_set: handleVerifyChangeSet
} satisfies Readonly<Record<string, SemanticToolHandler>>

function hasSemanticToolHandler(toolName: string): toolName is keyof typeof semanticToolHandlers {
  return Object.hasOwn(semanticToolHandlers, toolName)
}

export function createSmylrSemanticToolHandler() {
  return async function handleSmylrSemanticTool(
    target: AutomationTarget,
    payload: unknown
  ): Promise<unknown> {
    const toolName = readString(isRecord(payload) ? payload.name : undefined)
    const args = isRecord(payload) && isRecord(payload.args) ? payload.args : {}
    if (!toolName) throw new Error('Missing semantic tool name.')
    if (!hasSemanticToolHandler(toolName)) {
      throw new Error(`Unknown Smylr semantic tool: ${toolName}`)
    }
    return semanticToolHandlers[toolName](target, args)
  }
}
