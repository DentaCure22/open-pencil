import { randomUUID } from 'node:crypto'

import { boardBuildTracedConnections } from '@open-pencil/core/rpc'
import { searchBoardMemory } from '@open-pencil/core/tools'
import type { SceneNode } from '@open-pencil/scene-graph'

import { pageOwnedTraceAncestor } from './agent-context'
import {
  AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX,
  authorityBoardPlanHistory,
  buildAuthorityBoardPlan
} from './board-plan'
import {
  authorityBoardReadProjection,
  authorityBoardReadSort,
  authorityBoardReadTokenBudget,
  buildAuthorityBoardQueryIndex,
  parseAuthorityBoardReadQuery,
  queryAuthorityBoard,
  type AuthorityBoardQueryIndex
} from './board-query'
import {
  assertAuthorityCodeObjectReplay,
  authorityCodeObjectReadback,
  authorityCodeObjectRequestMatches,
  createAuthorityCodeObject,
  readAuthorityCodeObject,
  refineAuthorityCodeObject
} from './code-object'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument,
  type AuthorityBoardDocument
} from './document'
import {
  addAuthorityFixtureResetReceipt,
  assertAuthorityFixtureTarget,
  authorityFixtureResetReceipts,
  authorityFixtureSemanticHash,
  authorityPageSnapshot,
  captureAuthorityBoardFixture,
  restoreAuthorityBoardFixture,
  type AuthorityBoardFixture,
  type AuthorityFixtureResetReceipt
} from './fixture'
import {
  authorityArtifactRequestMatches,
  authorityBuildIntent,
  authorityNodeSummary,
  committedAuthorityReadback,
  createAuthorityArtifact,
  replayAuthorityArtifact
} from './native-artifact'
import { readAuthorityMermaidSource } from './native-diagram'
import {
  applyAuthorityObjectEdit,
  assertAuthorityObjectEditReplay,
  authorityObjectEditReadback,
  authorityObjectEditRequestMatches,
  isAuthorityObjectEditOperation,
  parseAuthorityObjectEditIntent
} from './object-edit'
import {
  connectAuthorityObjects,
  normalizeAuthorityRpcArgs,
  verifyAuthorityConnectionRequest
} from './object-graph'
import {
  authorityPageCreationMarker,
  authorityPageCreationPluginData,
  authorityPageCreationRequestMatches,
  type AuthorityPageCreationMarker
} from './page-creation'
import type { LocalWorkspaceAuthorityStore } from './store'
import type { LocalWorkspaceTraceGestureRead } from './trace'
import { queryPersistedTraceHistory } from './trace-query'
import { LOCAL_AUTHORITY_BOARD_CAPABILITIES, type LocalWorkspaceAuthorityHead } from './types'

const EXECUTION_SURFACE = 'local_workspace_authority'
const RUNTIME_PREFIX = 'local-authority:'
const CONTEXT_LIMIT = 48
const DEFAULT_CONTEXT_LIMIT = 25
const DEFAULT_PAGE_LIMIT = 50
const FIXTURE_LIMIT = 32
const QUERY_INDEX_LIMIT = 8

type JsonRecord = Record<string, unknown>
type LocalWorkspaceBoardRpcTarget = ReturnType<typeof targetResult>

export class LocalWorkspaceBoardRpcError extends Error {
  readonly result: JsonRecord
  readonly target: LocalWorkspaceBoardRpcTarget

  constructor(message: string, result: JsonRecord, target: LocalWorkspaceBoardRpcTarget) {
    super(message)
    this.name = 'LocalWorkspaceBoardRpcError'
    this.result = result
    this.target = target
  }
}

type BoardContext = {
  authorityId: string
  contentHash: string
  contentDocumentId: string
  documentId: string
  pageId: string
  revision: number
  runtimeInstanceId: string
  token: string
  workspaceId: string
}
type BoardQueryIndexCacheEntry = {
  contentHash: string
  index: AuthorityBoardQueryIndex
  revision: number
}
type BoardQueryIndexStatus = 'built' | 'rebuilt' | 'reused'

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nativeDiagramPlanArgs(args: JsonRecord): JsonRecord | null {
  const recipe = isRecord(args.recipe) ? args.recipe : null
  if (recipe?.kind !== 'native_diagram') return null
  const ownerId = optionalString(recipe, 'owner_id')
  const anchorId = optionalString(args, 'anchor_id')
  const planRecipe: JsonRecord = {
    kind: 'native_diagram',
    source: recipe.source,
    source_format: recipe.source_format,
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(recipe.zoom_to_selection === undefined
      ? {}
      : { zoom_to_selection: recipe.zoom_to_selection }),
    ...(!ownerId && !anchorId ? { placement: { target: { kind: 'auto' } } } : {})
  }
  const { anchor_id: _anchorId, extension: _extension, recipe: _recipe, ...planArgs } = args
  return {
    ...planArgs,
    plan: {
      artifacts: [
        {
          alias: 'diagram',
          ...(anchorId ? { anchor: { object_id: anchorId } } : {}),
          recipe: planRecipe
        }
      ],
      connections: [],
      contract: 'board-build-plan/v1'
    }
  }
}

function requiredString(value: JsonRecord, field: string): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) throw new Error(`${field} is required.`)
  return result.trim()
}

function optionalString(value: JsonRecord, field: string): string | undefined {
  const result = value[field]
  return typeof result === 'string' && result.trim() ? result.trim() : undefined
}

function optionalStringArray(value: JsonRecord, field: string): string[] {
  const result = value[field]
  if (!Array.isArray(result)) return []
  return result
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

function requestedObjectIds(args: JsonRecord): string[] {
  if (!Array.isArray(args.object_ids)) {
    throw new Error('board_read objects scope requires an object_ids array.')
  }
  const ids = args.object_ids.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (ids.length === 0 || ids.length > 25 || ids.some((id) => !id)) {
    throw new Error('board_read object_ids must contain from 1 to 25 non-empty strings.')
  }
  if (new Set(ids).size !== ids.length) throw new Error('board_read object_ids must be unique.')
  return ids
}

function objectReadCandidates(
  document: AuthorityBoardDocument,
  pageId: string,
  ids: string[]
): SceneNode[] {
  const seen = new Set<string>()
  return ids.flatMap((id) => {
    const node = document.graph.getNode(id)
    if (!node || node.type === 'CANVAS' || !document.graph.isDescendant(id, pageId)) {
      throw new Error(`board_read object_id "${id}" is missing or outside the target page.`)
    }
    return [node, ...document.graph.getDescendants(id)].filter((candidate) => {
      if (seen.has(candidate.id)) return false
      seen.add(candidate.id)
      return true
    })
  })
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  return value
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (value === undefined) return fallback
  const result = finiteNumber(value, field)
  if (result < minimum || result > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return result
}

function runtimeInstanceId(head: LocalWorkspaceAuthorityHead): string {
  return `${RUNTIME_PREFIX}${head.authorityId}`
}

function pageFrom(document: AuthorityBoardDocument, pageId: string): SceneNode {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS' || page.parentId !== document.graph.rootId) {
    throw new Error(`Board page "${pageId}" does not exist in the local workspace authority.`)
  }
  return page
}

function targetResult(head: LocalWorkspaceAuthorityHead, page: SceneNode) {
  return {
    boardRevision: head.revision,
    contentDocumentId: head.identity.documentId,
    documentId: head.identity.documentId,
    documentName: head.identity.documentName,
    pageId: page.id,
    pageName: page.name,
    runtimeInstanceId: runtimeInstanceId(head),
    workspaceId: head.identity.workspaceId
  }
}

function preMutationBoardError(options: {
  args: JsonRecord
  error: unknown
  head: LocalWorkspaceAuthorityHead
  page: SceneNode
}): LocalWorkspaceBoardRpcError {
  const message = options.error instanceof Error ? options.error.message : String(options.error)
  const code = message.includes('No collision-free placement')
    ? 'no_collision_free_placement'
    : 'board_preflight_refused'
  const requestId = optionalString(options.args, 'request_id')
  const traceId = optionalString(options.args, 'trace_id')
  const target = targetResult(options.head, options.page)
  return new LocalWorkspaceBoardRpcError(
    message,
    {
      current_revision: options.head.revision,
      error: { code, message },
      failure_scope: 'pre_mutation',
      ...(requestId ? { next_action: { request_id: requestId, retry_mutation: false } } : {}),
      status: {
        attention_required: true,
        command: 'refused',
        mutation: 'not_applied',
        reason: code
      },
      target: {
        content_document_id: target.contentDocumentId,
        document_id: target.documentId,
        document_name: target.documentName,
        page_id: target.pageId,
        page_name: target.pageName,
        runtime_instance_id: target.runtimeInstanceId,
        workspace_id: target.workspaceId
      },
      ...(traceId ? { trace: { gesture_id: traceId } } : {})
    },
    target
  )
}

function traceRegion(args: JsonRecord) {
  if (!isRecord(args.region)) throw new Error('board_prepare_edit requires a page-space region.')
  const region = {
    height: finiteNumber(args.region.height, 'region.height'),
    width: finiteNumber(args.region.width, 'region.width'),
    x: finiteNumber(args.region.x, 'region.x'),
    y: finiteNumber(args.region.y, 'region.y')
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new Error('board_prepare_edit region width and height must be positive.')
  }
  return region
}

function traceCandidateIds(args: JsonRecord, primaryTargetId?: string): string[] {
  const requested = optionalStringArray(args, 'candidate_object_ids')
  return [...new Set([...(primaryTargetId ? [primaryTargetId] : []), ...requested])].slice(0, 25)
}

function traceConnectionSummary(
  connection: ReturnType<typeof boardBuildTracedConnections>[number]
) {
  return {
    connection_id: connection.id,
    kind: connection.kind,
    source_id: connection.sourceNodeId,
    source_port: connection.sourcePortId ?? connection.sourcePort,
    target_id: connection.targetNodeId,
    target_port: connection.targetPortId ?? connection.targetPort
  }
}

function traceCandidateSummary(document: AuthorityBoardDocument, node: SceneNode) {
  return {
    bounds: document.graph.getAbsoluteBounds(node.id),
    name: node.name,
    stableId: node.id,
    type: node.type,
    visible: node.visible
  }
}

function compactTraceGesture(
  gesture: LocalWorkspaceTraceGestureRead,
  head: LocalWorkspaceAuthorityHead | null
) {
  const recordedIds = gesture.candidates.items.map(({ stableId }) => stableId)
  const requestedIds = [
    ...new Set([
      ...(gesture.candidates.primaryTargetId ? [gesture.candidates.primaryTargetId] : []),
      ...recordedIds
    ])
  ]
  let document: AuthorityBoardDocument | null = null
  let page: SceneNode | null = null
  let resolutionStatus: 'document_unavailable' | 'page_missing' | 'resolved' =
    'document_unavailable'
  if (head) {
    try {
      document = readAuthorityBoardDocument(head.document)
      const candidatePage = document.graph.getNode(gesture.boardOrigin.pageId)
      if (candidatePage?.type === 'CANVAS' && candidatePage.parentId === document.graph.rootId) {
        page = candidatePage
        resolutionStatus = 'resolved'
      } else {
        resolutionStatus = 'page_missing'
      }
    } catch {
      document = null
    }
  }

  const resolved =
    document && page
      ? requestedIds.flatMap((id) => {
          const node = document?.graph.getNode(id)
          return node && node.type !== 'CANVAS' && document?.graph.isDescendant(node.id, page.id)
            ? [node]
            : []
        })
      : []
  const resolvedIds = new Set(resolved.map(({ id }) => id))
  const ownerIds = new Set<string>()
  const owners =
    document && page
      ? resolved.flatMap((node) => {
          const owner = pageOwnedTraceAncestor(document, page.id, node.id)
          if (!owner || ownerIds.has(owner.id)) return []
          ownerIds.add(owner.id)
          return [owner]
        })
      : []
  const primaryOwner =
    document && page && gesture.candidates.primaryTargetId
      ? pageOwnedTraceAncestor(document, page.id, gesture.candidates.primaryTargetId)
      : undefined
  const region = gesture.geometry.pageRegion
  const connections =
    document && page
      ? boardBuildTracedConnections(document.graph, page.id, {
          kind: 'connection.delete_traced',
          object_ids: owners.map(({ id }) => id),
          orientation: 'any',
          region
        })
      : []
  const knownOmittedCount = Math.max(0, gesture.candidates.count - gesture.candidates.items.length)

  return {
    boardOrigin: gesture.boardOrigin,
    candidates: {
      collapsedCount: Math.max(0, resolved.length - owners.length),
      count: owners.length,
      items: document ? owners.map((owner) => traceCandidateSummary(document, owner)) : [],
      knownOmittedCount,
      missingCount: requestedIds.filter((id) => !resolvedIds.has(id)).length,
      ...(primaryOwner ? { primaryTargetId: primaryOwner.id } : {}),
      recordedCount: gesture.candidates.count,
      recordedItemCount: gesture.candidates.items.length,
      truncated: gesture.candidates.truncated
    },
    capturedAt: gesture.capturedAt,
    connections: {
      count: connections.length,
      ids: connections.map(({ id }) => id),
      limit: 32,
      truncated: connections.length === 32
    },
    contract: 'trace_context/v1' as const,
    ...(gesture.evidence ? { evidence: gesture.evidence } : {}),
    geometry: { kind: gesture.geometry.kind, pageRegion: region },
    gestureId: gesture.gestureId,
    imageStatus: gesture.imageStatus,
    resolution: { status: resolutionStatus },
    sessionId: gesture.sessionId
  }
}

export class LocalWorkspaceBoardRuntime {
  private readonly contexts = new Map<string, BoardContext>()
  private readonly fixtures = new Map<string, AuthorityBoardFixture>()
  private readonly queryIndexes = new Map<string, BoardQueryIndexCacheEntry>()

  constructor(private readonly store: LocalWorkspaceAuthorityStore) {}

  private queryIndexFor(
    head: LocalWorkspaceAuthorityHead,
    document: AuthorityBoardDocument,
    pageId: string
  ): { index: AuthorityBoardQueryIndex; status: BoardQueryIndexStatus } {
    const key = `${head.authorityId}:${head.identity.documentId}:${pageId}`
    const existing = this.queryIndexes.get(key)
    if (existing?.contentHash === head.contentHash && existing.revision === head.revision) {
      this.queryIndexes.delete(key)
      this.queryIndexes.set(key, existing)
      return { index: existing.index, status: 'reused' }
    }
    const index = buildAuthorityBoardQueryIndex(document.graph, pageId)
    this.queryIndexes.set(key, {
      contentHash: head.contentHash,
      index,
      revision: head.revision
    })
    while (this.queryIndexes.size > QUERY_INDEX_LIMIT) {
      const oldest = this.queryIndexes.keys().next().value
      if (typeof oldest !== 'string') break
      this.queryIndexes.delete(oldest)
    }
    return { index, status: existing ? 'rebuilt' : 'built' }
  }

  isPinnedRequest(body: Record<string, unknown>): boolean {
    const args = normalizeAuthorityRpcArgs(body)
    return optionalString(args, 'runtime_instance_id')?.startsWith(RUNTIME_PREFIX) === true
  }

  private async head(): Promise<LocalWorkspaceAuthorityHead> {
    const head = await this.store.head()
    if (!head) throw new Error('Local workspace authority has no saved Board document.')
    return head
  }

  private validatedTarget(head: LocalWorkspaceAuthorityHead, args: JsonRecord) {
    const workspaceId = optionalString(args, 'workspace_id')
    if (workspaceId && workspaceId !== head.identity.workspaceId) {
      throw new Error(
        `Local authority owns workspace "${head.identity.workspaceId}", received "${workspaceId}".`
      )
    }
    const contentDocumentId = optionalString(args, 'content_document_id')
    if (contentDocumentId && contentDocumentId !== head.identity.documentId) {
      throw new Error(`Content document "${contentDocumentId}" is not owned by this authority.`)
    }
    const documentId = optionalString(args, 'document_id')
    if (documentId && documentId !== head.identity.documentId) {
      throw new Error(`Document "${documentId}" is not owned by this authority.`)
    }
    const requestedRuntime = optionalString(args, 'runtime_instance_id')
    if (requestedRuntime && requestedRuntime !== runtimeInstanceId(head)) {
      throw new Error(
        `Runtime "${requestedRuntime}" is unavailable; no live request was retargeted.`
      )
    }
    const document = readAuthorityBoardDocument(head.document)
    const page = pageFrom(document, requiredString(args, 'page_id'))
    return { document, page }
  }

  private contextFor(
    head: LocalWorkspaceAuthorityHead,
    page: SceneNode,
    document: AuthorityBoardDocument
  ) {
    const token = `board-context:${randomUUID()}`
    const context: BoardContext = {
      authorityId: head.authorityId,
      contentDocumentId: head.identity.documentId,
      contentHash: head.contentHash,
      documentId: head.identity.documentId,
      pageId: page.id,
      revision: head.revision,
      runtimeInstanceId: runtimeInstanceId(head),
      token,
      workspaceId: head.identity.workspaceId
    }
    this.contexts.set(token, context)
    while (this.contexts.size > CONTEXT_LIMIT) {
      const oldest = this.contexts.keys().next().value
      if (typeof oldest !== 'string') break
      this.contexts.delete(oldest)
    }
    const children = page.childIds
      .map((id) => document.graph.getNode(id))
      .filter((node): node is SceneNode => node !== undefined)
    const neighborhood = children
      .slice(0, DEFAULT_CONTEXT_LIMIT)
      .map((node) => authorityNodeSummary(document.graph, node))
    const mutationBase = {
      content_document_id: head.identity.documentId,
      context_token: token,
      document_id: head.identity.documentId,
      expected_revision: head.revision,
      page_id: page.id,
      runtime_instance_id: runtimeInstanceId(head),
      workspace_id: head.identity.workspaceId
    }
    return {
      appearance: { status: 'unavailable', reason: 'no_live_runtime' },
      board_build_base: {
        contract: 'board-build/v1',
        ...mutationBase
      },
      connect_objects_base: mutationBase,
      capabilities: [...LOCAL_AUTHORITY_BOARD_CAPABILITIES],
      context_token: token,
      execution_surface: EXECUTION_SURFACE,
      neighborhood: {
        count: children.length,
        nodes: neighborhood,
        returned: neighborhood.length,
        truncated: neighborhood.length < children.length
      },
      request_ledger: {
        recent_transactions: authorityBoardPlanHistory(page),
        status: 'authority_receipts'
      },
      revisions: { authority: head.revision, board: head.revision },
      runtime: {
        instance_id: runtimeInstanceId(head),
        visibility: 'headless',
        write_authority: 'writer'
      },
      selection: [],
      selection_summary: {
        count: 0,
        nodes: [],
        reason: 'no_live_runtime',
        status: 'unavailable'
      },
      target: {
        content_document_id: head.identity.documentId,
        document_id: head.identity.documentId,
        page_id: page.id,
        page_name: page.name,
        workspace_id: head.identity.workspaceId
      },
      viewport: { status: 'unavailable', reason: 'no_live_runtime' }
    }
  }

  private async resolveContext(args: JsonRecord) {
    const token = requiredString(args, 'context_token')
    const context = this.contexts.get(token)
    if (!context) throw new Error('Board context is missing or expired. Call board_context again.')
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    if (
      context.authorityId !== head.authorityId ||
      context.contentDocumentId !== head.identity.documentId ||
      context.documentId !== head.identity.documentId ||
      context.pageId !== page.id ||
      context.runtimeInstanceId !== runtimeInstanceId(head) ||
      context.workspaceId !== head.identity.workspaceId
    ) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    return {
      context,
      current: context.contentHash === head.contentHash && context.revision === head.revision,
      document,
      head,
      page
    }
  }

  private async requireContext(args: JsonRecord) {
    const resolved = await this.resolveContext(args)
    if (!resolved.current) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    return resolved
  }

  private async listDocuments() {
    const head = await this.head()
    const document = readAuthorityBoardDocument(head.document)
    return {
      ok: true,
      result: {
        documents: [
          {
            active: false,
            content_document_id: head.identity.documentId,
            current_page_id: '',
            current_page_name: '',
            execution_surface: EXECUTION_SURFACE,
            id: head.identity.documentId,
            kind: 'workspace',
            name: head.identity.documentName,
            pages: document.graph.getPages().map((page) => ({ id: page.id, name: page.name })),
            workspace_id: head.identity.workspaceId
          }
        ],
        runtime_instance_id: runtimeInstanceId(head)
      }
    }
  }

  private async workspaceSearch(args: JsonRecord) {
    const query = requiredString(args, 'query')
    const limit = boundedNumber(args.limit, 20, 1, 100, 'limit')
    return { ok: true, result: await this.store.searchWorkspace(query, limit) }
  }

  private async context(args: JsonRecord) {
    if (args.target === 'current_visible') {
      throw new Error('no_live_runtime: current_visible requires an open OpenPencil Board.')
    }
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    return {
      ok: true,
      result: this.contextFor(head, page, document),
      target: targetResult(head, page)
    }
  }

  private async traceGesture(args: JsonRecord) {
    const persisted = await this.store.traceGesture({
      gestureId: optionalString(args, 'gesture_id'),
      includeImage: args.include_image === true,
      latest: args.latest === true
    })
    if (persisted.status !== 'matched' || args.raw === true) {
      return { ok: true, result: persisted }
    }
    const head = await this.store.head()
    return {
      ok: true,
      result: {
        gesture: compactTraceGesture(persisted.gesture, head),
        scanned: persisted.scanned,
        status: persisted.status
      }
    }
  }

  private async traceQuery(args: JsonRecord) {
    return { ok: true, result: await queryPersistedTraceHistory(this.store, args) }
  }

  private async prepareTraceEdit(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const gestureId = requiredString(args, 'gesture_id')
    const intent = requiredString(args, 'intent')
    const region = traceRegion(args)
    const primaryTargetId = optionalString(args, 'primary_target_id')
    const requestedIds = traceCandidateIds(args, primaryTargetId)
    const rawCandidates = requestedIds.flatMap((id) => {
      const node = document.graph.getNode(id)
      return node && node.type !== 'CANVAS' && document.graph.isDescendant(node.id, page.id)
        ? [node]
        : []
    })
    const rawCandidateIds = new Set(rawCandidates.map((candidate) => candidate.id))
    const ownerIds = new Set<string>()
    const candidates = rawCandidates.flatMap((candidate) => {
      const owner = pageOwnedTraceAncestor(document, page.id, candidate.id)
      if (!owner || ownerIds.has(owner.id)) return []
      ownerIds.add(owner.id)
      return [owner]
    })
    const primaryOwner = primaryTargetId
      ? pageOwnedTraceAncestor(document, page.id, primaryTargetId)
      : undefined
    const selected =
      (primaryOwner ? candidates.find((candidate) => candidate.id === primaryOwner.id) : null) ??
      (candidates.length === 1 ? candidates[0] : undefined)
    const currentIds = candidates.map((candidate) => candidate.id)
    const traceConnections = boardBuildTracedConnections(document.graph, page.id, {
      kind: 'connection.delete_traced',
      object_ids: currentIds,
      orientation: 'any',
      region
    })
    const context = this.contextFor(head, page, document)
    return {
      ok: true,
      result: {
        board_build_base: context.board_build_base,
        code_object: null,
        contract: 'board-edit-context/v1',
        gesture_id: gestureId,
        intent,
        readback: {
          board_revision: head.revision,
          count: candidates.length,
          nodes: candidates.map((candidate) => authorityNodeSummary(document.graph, candidate)),
          scope: 'objects'
        },
        resolution: {
          candidate_object_ids: currentIds,
          missing_object_ids: requestedIds.filter((id) => !rawCandidateIds.has(id)),
          ...(selected ? { selected_object_id: selected.id } : {}),
          status: selected ? 'resolved' : candidates.length > 1 ? 'ambiguous' : 'none'
        },
        trace_connections: {
          count: traceConnections.length,
          items: traceConnections.map(traceConnectionSummary),
          limit: 32,
          truncated: traceConnections.length === 32
        },
        trace_region: region
      },
      target: targetResult(head, page)
    }
  }

  private async open(args: JsonRecord) {
    const head = await this.head()
    const { page } = this.validatedTarget(head, args)
    const editorNavigationStatus = optionalString(args, 'editor_navigation_status')
    const editorRuntimeInstanceId = optionalString(args, 'editor_runtime_instance_id')
    const candidateRuntimeIds = optionalStringArray(args, 'editor_candidate_runtime_ids')
    const resultTarget = {
      content_document_id: head.identity.documentId,
      editor_candidate_runtime_ids: candidateRuntimeIds,
      page_id: page.id,
      page_name: page.name,
      workspace_id: head.identity.workspaceId
    }
    if (editorNavigationStatus === 'needs_editor') {
      return {
        ok: true,
        result: {
          ...resultTarget,
          action: 'not_queued',
          reason: optionalString(args, 'editor_navigation_reason') ?? 'no_matching_editor',
          status: 'needs_editor'
        },
        target: targetResult(head, page)
      }
    }
    if (editorNavigationStatus === 'ambiguous_editor') {
      return {
        ok: true,
        result: {
          ...resultTarget,
          action: 'not_queued',
          status: 'ambiguous_editor'
        },
        target: targetResult(head, page)
      }
    }
    if (editorNavigationStatus === 'ready' && !editorRuntimeInstanceId) {
      throw new Error('Ready Board navigation requires one exact editor runtime.')
    }
    const intent = await this.store.queueNavigationIntent({
      contentDocumentId: head.identity.documentId,
      pageId: page.id,
      ...(editorRuntimeInstanceId ? { runtimeInstanceId: editorRuntimeInstanceId } : {}),
      workspaceId: head.identity.workspaceId
    })
    return {
      ok: true,
      result: {
        action: 'queued',
        active: false,
        content_document_id: head.identity.documentId,
        editor_candidate_runtime_ids: candidateRuntimeIds,
        expires_at: intent.expiresAt,
        ...(intent.runtimeInstanceId
          ? { editor_runtime_instance_id: intent.runtimeInstanceId }
          : {}),
        intent_id: intent.intentId,
        page_id: page.id,
        page_name: page.name,
        sequence: intent.sequence,
        status: 'queued_for_editor',
        workspace_id: head.identity.workspaceId
      },
      target: targetResult(head, page)
    }
  }

  private async read(args: JsonRecord) {
    const { document, head, page } = await this.requireContext(args)
    const scope = optionalString(args, 'scope') ?? 'selection'
    if (scope === 'selection') {
      return {
        ok: true,
        result: {
          count: 0,
          execution_surface: EXECUTION_SURFACE,
          nodes: [],
          reason: 'no_live_runtime',
          scope,
          status: 'unavailable'
        },
        target: targetResult(head, page)
      }
    }
    if (scope === 'query') {
      const limit = boundedNumber(args.limit, DEFAULT_PAGE_LIMIT, 1, 100, 'limit')
      const projection = authorityBoardReadProjection(args.projection)
      const query = parseAuthorityBoardReadQuery(args.query)
      const sort = authorityBoardReadSort(args.sort)
      const tokenBudget = authorityBoardReadTokenBudget(args.token_budget)
      const queryIndex = this.queryIndexFor(head, document, page.id)
      const result = queryAuthorityBoard(
        queryIndex.index.graph,
        page.id,
        {
          limit,
          projection,
          query,
          sort,
          tokenBudget
        },
        queryIndex.index
      )
      return {
        ok: true,
        result: {
          completeness: result.truncated ? 'truncated' : 'complete',
          count: result.matchedCount,
          estimated_payload_tokens: result.estimatedPayloadTokens,
          execution_surface: EXECUTION_SURFACE,
          index_candidates: result.candidateCount,
          index_nodes: result.indexedNodeCount,
          index_revision: head.revision,
          index_scanned: result.scannedCount,
          index_status: queryIndex.status,
          limit,
          nodes: result.nodes,
          projection,
          query,
          returned: result.nodes.length,
          scope,
          sort,
          status: result.matchedCount === 0 ? 'empty' : 'matched',
          token_budget: result.tokenBudget,
          truncated: result.truncated,
          ...(result.truncationReason ? { truncation_reason: result.truncationReason } : {})
        },
        target: targetResult(head, page)
      }
    }
    if (scope !== 'page' && scope !== 'objects') {
      throw new Error('board_read scope must be selection, page, objects, or query.')
    }
    const limit = boundedNumber(args.limit, DEFAULT_PAGE_LIMIT, 1, 100, 'limit')
    const objectIds = scope === 'objects' ? requestedObjectIds(args) : undefined
    const candidates = objectIds
      ? objectReadCandidates(document, page.id, objectIds)
      : [...document.graph.getDescendants(page.id)]
    const nodes = candidates
      .slice(0, limit)
      .map((node) => authorityNodeSummary(document.graph, node))
    return {
      ok: true,
      result: {
        count: candidates.length,
        execution_surface: EXECUTION_SURFACE,
        limit,
        nodes,
        ...(objectIds ? { requested_object_ids: objectIds } : {}),
        returned: nodes.length,
        scope,
        status: 'matched',
        truncated: nodes.length < candidates.length
      },
      target: targetResult(head, page)
    }
  }

  private async searchMemory(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const toolArgs = isRecord(args.args) ? args.args : {}
    const query = requiredString(toolArgs, 'query')
    const limit = boundedNumber(
      toolArgs.limit,
      DEFAULT_CONTEXT_LIMIT,
      1,
      DEFAULT_CONTEXT_LIMIT,
      'limit'
    )
    return {
      ok: true,
      result: {
        ...searchBoardMemory(document.graph, query, {
          currentBoardId: page.id,
          limit
        }),
        execution_surface: EXECUTION_SURFACE,
        index_revision: head.revision,
        status: 'matched'
      },
      target: targetResult(head, page)
    }
  }

  private requireExactFixtureTarget(args: JsonRecord): void {
    for (const field of [
      'runtime_instance_id',
      'workspace_id',
      'document_id',
      'content_document_id',
      'page_id'
    ]) {
      requiredString(args, field)
    }
  }

  private fixtureTarget(fixture: AuthorityBoardFixture, head: LocalWorkspaceAuthorityHead): void {
    assertAuthorityFixtureTarget(fixture, {
      authorityId: head.authorityId,
      contentDocumentId: head.identity.documentId,
      pageId: fixture.pageId,
      workspaceId: head.identity.workspaceId
    })
  }

  private storedFixture(
    args: JsonRecord,
    head: LocalWorkspaceAuthorityHead
  ): AuthorityBoardFixture {
    const fixtureId = requiredString(args, 'fixture_id')
    const fixture = this.fixtures.get(fixtureId)
    if (!fixture) {
      throw new Error(
        `Board fixture "${fixtureId}" is unavailable. Capture it again from the clean exact Board; fixture tokens do not survive server restart.`
      )
    }
    this.fixtureTarget(fixture, head)
    if (fixture.pageId !== requiredString(args, 'page_id')) {
      throw new Error(`Board fixture "${fixtureId}" belongs to a different page.`)
    }
    return fixture
  }

  private fixtureSummary(fixture: AuthorityBoardFixture) {
    return {
      connection_count: fixture.connectionCount,
      fixture_id: fixture.fixtureId,
      node_count: fixture.snapshot.size - 1,
      page_id: fixture.pageId,
      semantic_hash: fixture.semanticHash,
      source_content_hash: fixture.sourceContentHash,
      source_revision: fixture.sourceRevision,
      top_level_count: (fixture.snapshot.get(fixture.pageId)?.childIds ?? []).length
    }
  }

  private async captureFixture(args: JsonRecord) {
    this.requireExactFixtureTarget(args)
    const { document, head, page } = await this.requireContext(args)
    const fixture = captureAuthorityBoardFixture({
      authorityId: head.authorityId,
      contentDocumentId: head.identity.documentId,
      document,
      pageId: page.id,
      sourceContentHash: head.contentHash,
      sourceRevision: head.revision,
      workspaceId: head.identity.workspaceId
    })
    this.fixtures.set(fixture.fixtureId, fixture)
    while (this.fixtures.size > FIXTURE_LIMIT) {
      const oldest = this.fixtures.keys().next().value
      if (typeof oldest !== 'string') break
      this.fixtures.delete(oldest)
    }
    return {
      ok: true,
      result: {
        execution_surface: EXECUTION_SURFACE,
        fixture: this.fixtureSummary(fixture),
        proof: {
          authority_owned_token: 'passed',
          graph_readback: 'passed',
          normal_editor_undo: 'not_applicable',
          pixels: 'not_evaluated'
        },
        status: 'captured'
      },
      target: targetResult(head, page)
    }
  }

  private async assertFixture(args: JsonRecord) {
    this.requireExactFixtureTarget(args)
    const { document, head, page } = await this.requireContext(args)
    const fixture = this.storedFixture(args, head)
    if (fixture.pageId !== page.id) this.fixtureTarget(fixture, head)
    const actualHash = authorityFixtureSemanticHash(authorityPageSnapshot(document, page.id))
    const matched = actualHash === fixture.semanticHash
    return {
      ok: true,
      result: {
        actual_semantic_hash: actualHash,
        execution_surface: EXECUTION_SURFACE,
        expected_semantic_hash: fixture.semanticHash,
        fixture: this.fixtureSummary(fixture),
        matched,
        status: matched ? 'matched' : 'diverged'
      },
      target: targetResult(head, page)
    }
  }

  private fixtureResetReplay(
    args: JsonRecord,
    document: AuthorityBoardDocument,
    head: LocalWorkspaceAuthorityHead,
    page: SceneNode,
    receipt: AuthorityFixtureResetReceipt
  ) {
    const fixtureId = requiredString(args, 'fixture_id')
    if (receipt.fixtureId !== fixtureId || receipt.pageId !== page.id) {
      throw new Error(`Request "${receipt.requestId}" was already used for a different reset.`)
    }
    const actualHash = authorityFixtureSemanticHash(authorityPageSnapshot(document, page.id))
    const current = actualHash === receipt.semanticHash
    return {
      ok: true,
      result: {
        actual_semantic_hash: actualHash,
        execution_surface: EXECUTION_SURFACE,
        expected_semantic_hash: receipt.semanticHash,
        proof: {
          durable_readback: current ? 'passed' : 'historical_only',
          normal_editor_undo: 'unavailable',
          pixels: 'not_evaluated',
          reset_boundary: 'external_evaluator_control'
        },
        receipt: { ...receipt, idempotent_replay: true },
        status: {
          command: current ? 'completed' : 'unavailable',
          mutation: 'replayed',
          reason: current ? 'idempotent_replay' : 'historical_receipt_only'
        }
      },
      target: targetResult(head, page)
    }
  }

  private async resetFixture(args: JsonRecord) {
    this.requireExactFixtureTarget(args)
    const requestId = requiredString(args, 'request_id')
    const resolved = await this.resolveContext(args)
    const matches = authorityFixtureResetReceipts(resolved.document, requestId)
    if (matches.length > 1) throw new Error(`Fixture reset request "${requestId}" is ambiguous.`)
    if (matches.length === 1) {
      return this.fixtureResetReplay(
        args,
        resolved.document,
        resolved.head,
        resolved.page,
        matches[0]
      )
    }
    if (!resolved.current) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the reset.')
    }
    const expectedRevision = finiteNumber(args.expected_revision, 'expected_revision')
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('expected_revision must be a non-negative integer.')
    }
    if (expectedRevision !== resolved.head.revision) {
      throw new Error(
        `Expected revision ${expectedRevision}, current revision is ${resolved.head.revision}.`
      )
    }
    const fixture = this.storedFixture(args, resolved.head)
    if (fixture.pageId !== resolved.page.id) {
      throw new Error(`Board fixture "${fixture.fixtureId}" belongs to a different page.`)
    }
    restoreAuthorityBoardFixture(resolved.document, fixture)
    const receipt: AuthorityFixtureResetReceipt = {
      appliedRevision: resolved.head.revision + 1,
      baseRevision: resolved.head.revision,
      fixtureId: fixture.fixtureId,
      pageId: fixture.pageId,
      requestId,
      route: 'board_fixture:reset',
      semanticHash: fixture.semanticHash,
      version: 1
    }
    addAuthorityFixtureResetReceipt(resolved.document, fixture.pageId, receipt)
    const mutationReceipt = await this.store.commit({
      document: writeAuthorityBoardDocument(resolved.document),
      expectedContentHash: resolved.head.contentHash,
      expectedRevision: resolved.head.revision,
      requestId,
      workspaceId: resolved.head.identity.workspaceId
    })
    const nextHead = await this.head()
    const nextDocument = readAuthorityBoardDocument(nextHead.document)
    const nextPage = pageFrom(nextDocument, fixture.pageId)
    const actualHash = authorityFixtureSemanticHash(
      authorityPageSnapshot(nextDocument, nextPage.id)
    )
    if (actualHash !== fixture.semanticHash) {
      throw new Error('Committed Board fixture reset diverged from semantic readback.')
    }
    return {
      ok: true,
      result: {
        actual_semantic_hash: actualHash,
        context: this.contextFor(nextHead, nextPage, nextDocument),
        execution_surface: EXECUTION_SURFACE,
        expected_semantic_hash: fixture.semanticHash,
        persistence: {
          authority_id: nextHead.authorityId,
          authority_revision: nextHead.revision,
          content_hash: nextHead.contentHash,
          status: 'durable',
          target: EXECUTION_SURFACE
        },
        proof: {
          durable_readback: 'passed',
          normal_editor_undo: 'unavailable',
          pixels: 'not_evaluated',
          reset_boundary: 'external_evaluator_control'
        },
        receipt: { ...receipt, authority_commit: mutationReceipt, idempotent_replay: false },
        status: { command: 'completed', mutation: 'applied' }
      },
      target: targetResult(nextHead, nextPage)
    }
  }

  private fixture(args: JsonRecord) {
    const operation = requiredString(args, 'operation')
    if (operation === 'capture') return this.captureFixture(args)
    if (operation === 'assert') return this.assertFixture(args)
    if (operation === 'reset') return this.resetFixture(args)
    throw new Error('board_fixture operation must be capture, assert, or reset.')
  }

  private async createPage(args: JsonRecord) {
    const { current, document, head, page } = await this.resolveContext(args)
    const mutation = isRecord(args.mutation) ? args.mutation : {}
    const toolArgs = isRecord(args.args) ? args.args : {}
    const requestId = requiredString(mutation, 'requestId')
    const name = requiredString(toolArgs, 'name')
    const matches = authorityPageCreationRequestMatches(document, requestId)
    if (matches.length > 1) throw new Error(`Request "${requestId}" is ambiguous.`)
    if (matches.length === 1) {
      const existing = matches[0]
      const marker = authorityPageCreationMarker(existing)
      if (!marker || marker.name !== name || marker.sourcePageId !== page.id) {
        throw new Error(`Request "${requestId}" was already used for a different mutation.`)
      }
      return {
        ok: true,
        result: {
          execution_surface: EXECUTION_SURFACE,
          id: existing.id,
          mutation_receipt: {
            appliedRevision: marker.appliedRevision,
            baseRevision: marker.baseRevision,
            idempotentReplay: true,
            requestId,
            status: 'applied'
          },
          name: existing.name,
          persistence: {
            authority_id: head.authorityId,
            authority_revision: head.revision,
            content_hash: head.contentHash,
            status: 'durable',
            target: EXECUTION_SURFACE
          },
          presentation: { reason: 'no_live_runtime', status: 'unavailable' },
          readback: { page: authorityNodeSummary(document.graph, existing) },
          status: { attention_required: false, command: 'completed', mutation: 'replayed' }
        },
        target: targetResult(head, page)
      }
    }
    if (!current) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    const expectedRevision = finiteNumber(mutation.expectedRevision, 'mutation.expectedRevision')
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('mutation.expectedRevision must be a non-negative integer.')
    }
    if (expectedRevision !== head.revision) {
      throw new Error(
        `Expected revision ${expectedRevision}, current revision is ${head.revision}.`
      )
    }
    const created = document.graph.addPage(name)
    const marker: AuthorityPageCreationMarker = {
      appliedRevision: head.revision + 1,
      baseRevision: head.revision,
      name,
      requestId,
      route: 'tool:create_page',
      sourcePageId: page.id,
      version: 1
    }
    document.graph.updateNode(created.id, {
      pluginData: [...created.pluginData, authorityPageCreationPluginData(marker)]
    })
    const receipt = await this.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId,
      workspaceId: head.identity.workspaceId
    })
    const committedHead = await this.head()
    const committedDocument = readAuthorityBoardDocument(committedHead.document)
    const committedSourcePage = pageFrom(committedDocument, page.id)
    const committedPage = pageFrom(committedDocument, created.id)
    return {
      ok: true,
      result: {
        execution_surface: EXECUTION_SURFACE,
        id: committedPage.id,
        mutation_receipt: {
          ...receipt,
          expectedRevision,
          idempotentReplay: false,
          requestId,
          status: 'applied'
        },
        name: committedPage.name,
        persistence: {
          authority_id: committedHead.authorityId,
          authority_revision: committedHead.revision,
          content_hash: committedHead.contentHash,
          status: 'durable',
          target: EXECUTION_SURFACE
        },
        presentation: { reason: 'no_live_runtime', status: 'unavailable' },
        proof: {
          durable_readback: 'passed',
          normal_editor_undo: 'unavailable',
          pixels: 'not_evaluated',
          reason: 'no_live_runtime'
        },
        readback: { page: authorityNodeSummary(committedDocument.graph, committedPage) },
        status: { attention_required: false, command: 'completed', mutation: 'applied' }
      },
      target: targetResult(committedHead, committedSourcePage)
    }
  }

  private async build(args: JsonRecord, command: 'board_build' | 'board_change') {
    const resolved = await this.resolveContext(args)
    const { current, document, head, page } = resolved
    const requestId = requiredString(args, 'request_id')
    if (requestId.startsWith(AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX)) {
      throw new Error('request_id uses a reserved internal Board plan prefix.')
    }
    let planArgs: JsonRecord | null = null
    if (command === 'board_build') {
      planArgs = args.plan === undefined ? nativeDiagramPlanArgs(args) : args
    }
    if (planArgs) {
      try {
        const outcome = await buildAuthorityBoardPlan({
          args: planArgs,
          issueContext: (nextHead, nextPage, nextDocument) =>
            this.contextFor(nextHead, nextPage, nextDocument),
          resolved,
          store: this.store
        })
        return {
          ok: true,
          result: outcome.result,
          target: targetResult(outcome.head, outcome.page)
        }
      } catch (error) {
        const currentHead = await this.store.head()
        if (
          currentHead?.authorityId === head.authorityId &&
          currentHead.contentHash === head.contentHash &&
          currentHead.revision === head.revision
        ) {
          throw preMutationBoardError({ args: planArgs, error, head: currentHead, page })
        }
        throw error
      }
    }
    const intent = await authorityBuildIntent(args, command)
    if (intent.kind === 'code_object') {
      const matches = authorityCodeObjectRequestMatches(document, page.id, requestId)
      if (matches.length > 1) throw new Error(`Request "${requestId}" is ambiguous.`)
      if (matches.length === 1) {
        const existing = matches[0]
        assertAuthorityCodeObjectReplay(existing, intent, requestId)
        const readback = await authorityCodeObjectReadback(document, page.id, existing)
        const reconciliation = readback.reconciliation.status
        return {
          ok: true,
          result: {
            context: this.contextFor(head, page, document),
            execution_surface: EXECUTION_SURFACE,
            owner_id: existing.ownerId,
            persistence: {
              authority_id: head.authorityId,
              authority_revision: head.revision,
              content_hash: head.contentHash,
              status: 'durable',
              target: EXECUTION_SURFACE
            },
            presentation: {
              reason: 'code_object_runtime_unavailable',
              status: 'unavailable'
            },
            proof: {
              durable_readback:
                reconciliation === 'current'
                  ? 'passed'
                  : reconciliation === 'missing'
                    ? 'historical_only'
                    : 'diverged',
              normal_editor_undo: 'unavailable',
              pixels: 'not_evaluated',
              presentation: 'unavailable',
              reason: 'code_object_runtime_unavailable',
              reconciliation,
              runtime: 'unavailable',
              static_preflight: 'passed'
            },
            readback: { code_object: readback },
            receipt: {
              appliedRevision: existing.appliedRevision,
              baseRevision: existing.baseRevision,
              idempotent_replay: true,
              requestId,
              status: 'applied'
            },
            status: {
              attention_required: false,
              command: 'completed',
              mutation: 'replayed'
            }
          },
          target: targetResult(head, page)
        }
      }
      if (!current) {
        throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
      }
      const expectedRevision = args.expected_revision
      if (expectedRevision !== head.revision) {
        throw new Error(
          `Expected revision ${String(expectedRevision)}, current revision is ${head.revision}.`
        )
      }
      const created =
        intent.operation.operation === 'create'
          ? createAuthorityCodeObject(document, page.id, intent, requestId, head.revision)
          : await refineAuthorityCodeObject(document, page.id, intent, requestId, head.revision)
      const receipt = await this.store.commit({
        document: writeAuthorityBoardDocument(document),
        expectedContentHash: head.contentHash,
        expectedRevision: head.revision,
        requestId,
        workspaceId: head.identity.workspaceId
      })
      const committedHead = await this.head()
      const committedDocument = readAuthorityBoardDocument(committedHead.document)
      const committedPage = pageFrom(committedDocument, page.id)
      const committedReceipts = authorityCodeObjectRequestMatches(
        committedDocument,
        committedPage.id,
        requestId
      )
      if (committedReceipts.length !== 1) {
        throw new Error('Committed Code Object receipt is missing or ambiguous.')
      }
      const committedReceipt = committedReceipts[0]
      const committedOwner = committedDocument.graph.getNode(committedReceipt.ownerId)
      if (!committedOwner)
        throw new Error('Committed Code Object is missing from authority readback.')
      const readback = await authorityCodeObjectReadback(
        committedDocument,
        committedPage.id,
        committedReceipt
      )
      if (readback.reconciliation.status !== 'current') {
        throw new Error(
          `Committed Code Object readback ${readback.reconciliation.status}: ${readback.reconciliation.reasons.join(', ')}.`
        )
      }
      return {
        ok: true,
        result: {
          context: this.contextFor(committedHead, committedPage, committedDocument),
          execution_surface: EXECUTION_SURFACE,
          owner_id: committedOwner.id,
          persistence: {
            authority_id: committedHead.authorityId,
            authority_revision: committedHead.revision,
            content_hash: committedHead.contentHash,
            status: 'durable',
            target: EXECUTION_SURFACE
          },
          presentation: { reason: 'code_object_runtime_unavailable', status: 'unavailable' },
          proof: {
            durable_readback: 'passed',
            normal_editor_undo: 'unavailable',
            pixels: 'not_evaluated',
            presentation: 'unavailable',
            reason: 'code_object_runtime_unavailable',
            runtime: 'unavailable',
            static_preflight: 'passed'
          },
          readback: { code_object: readback },
          receipt: {
            ...receipt,
            idempotent_replay: false,
            ...('placement' in created ? { placement: created.placement } : {}),
            ...('receipt' in created && created.receipt.version === 2
              ? {
                  refinement: {
                    expected_source_hash: created.receipt.expectedSourceHash,
                    preservation: {
                      geometry: true,
                      other_plugin_data: true,
                      state: true
                    },
                    source_hash: created.receipt.sourceHash
                  }
                }
              : {}),
            requestId
          },
          status: {
            attention_required: false,
            command: 'completed',
            mutation: 'applied'
          }
        },
        target: targetResult(committedHead, committedPage)
      }
    }
    const matches = authorityArtifactRequestMatches(document.graph, page.id, requestId)
    if (matches.length > 1) throw new Error(`Request "${requestId}" is ambiguous.`)
    if (matches.length === 1) {
      const existing = matches[0]
      const readback = replayAuthorityArtifact(document.graph, page.id, existing, intent, requestId)
      return {
        ok: true,
        result: {
          context: this.contextFor(head, page, document),
          execution_surface: EXECUTION_SURFACE,
          persistence: {
            authority_id: head.authorityId,
            authority_revision: head.revision,
            content_hash: head.contentHash,
            status: 'durable',
            target: EXECUTION_SURFACE
          },
          owner_id: existing.id,
          presentation: { reason: 'no_live_runtime', status: 'unavailable' },
          readback,
          receipt: { idempotent_replay: true, requestId, status: 'applied' },
          status: { attention_required: false, command: 'completed', mutation: 'replayed' }
        },
        target: targetResult(head, page)
      }
    }
    if (!current) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    const expectedRevision = args.expected_revision
    if (expectedRevision !== head.revision) {
      throw new Error(
        `Expected revision ${String(expectedRevision)}, current revision is ${head.revision}.`
      )
    }
    const created = createAuthorityArtifact(document, page.id, intent, requestId)
    const receipt = await this.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId,
      workspaceId: head.identity.workspaceId
    })
    const committedHead = await this.head()
    const committedDocument = readAuthorityBoardDocument(committedHead.document)
    const committedPage = pageFrom(committedDocument, page.id)
    const committedOwner = committedDocument.graph.getNode(created.owner.id)
    if (!committedOwner)
      throw new Error('Committed native artifact is missing from authority readback.')
    const readback = committedAuthorityReadback(
      committedDocument,
      committedPage.id,
      committedOwner,
      created
    )
    return {
      ok: true,
      result: {
        context: this.contextFor(committedHead, committedPage, committedDocument),
        execution_surface: EXECUTION_SURFACE,
        owner_id: committedOwner.id,
        persistence: {
          authority_id: committedHead.authorityId,
          authority_revision: committedHead.revision,
          content_hash: committedHead.contentHash,
          status: 'durable',
          target: EXECUTION_SURFACE
        },
        presentation: { reason: 'no_live_runtime', status: 'unavailable' },
        proof: {
          durable_readback: 'passed',
          normal_editor_undo: 'unavailable',
          pixels: 'not_evaluated',
          reason: 'no_live_runtime'
        },
        readback,
        receipt: {
          ...receipt,
          idempotent_replay: false,
          placement: created.placement,
          requestId
        },
        status: { attention_required: false, command: 'completed', mutation: 'applied' }
      },
      target: targetResult(committedHead, committedPage)
    }
  }

  private async editObject(args: JsonRecord) {
    const { current, document, head, page } = await this.resolveContext(args)
    const requestId = requiredString(args, 'request_id')
    const intent = parseAuthorityObjectEditIntent(
      args.operation,
      optionalString(args, 'task_id'),
      optionalString(args, 'trace_id')
    )
    const matches = authorityObjectEditRequestMatches(document, page.id, requestId)
    if (matches.length > 1) throw new Error(`Request "${requestId}" is ambiguous.`)
    if (matches.length === 1) {
      const existing = matches[0]
      assertAuthorityObjectEditReplay(existing, intent, requestId)
      const readback = authorityObjectEditReadback(document, page.id, existing)
      const reconciliation = (readback.reconciliation as { status: string }).status
      return {
        ok: true,
        result: {
          context: this.contextFor(head, page, document),
          execution_surface: EXECUTION_SURFACE,
          owner_id: existing.resultObjectId,
          persistence: {
            authority_id: head.authorityId,
            authority_revision: head.revision,
            content_hash: head.contentHash,
            status: 'durable',
            target: EXECUTION_SURFACE
          },
          presentation: { reason: 'no_live_runtime', status: 'unavailable' },
          proof: {
            durable_readback:
              reconciliation === 'current'
                ? 'passed'
                : reconciliation === 'missing'
                  ? 'historical_only'
                  : 'diverged',
            normal_editor_undo: 'unavailable',
            pixels: 'not_evaluated',
            reconciliation,
            reason: 'no_live_runtime'
          },
          readback: { object_edit: readback },
          receipt: {
            appliedRevision: existing.appliedRevision,
            baseRevision: existing.baseRevision,
            idempotent_replay: true,
            operation: existing.operation,
            requestId,
            status: 'applied'
          },
          status: {
            attention_required: reconciliation !== 'current',
            command: reconciliation === 'current' ? 'completed' : 'unavailable',
            mutation: 'replayed',
            ...(reconciliation === 'current' ? {} : { reason: `object_edit_${reconciliation}` })
          }
        },
        target: targetResult(head, page)
      }
    }
    if (!current) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    const expectedRevision = finiteNumber(args.expected_revision, 'expected_revision')
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('expected_revision must be a non-negative integer.')
    }
    if (expectedRevision !== head.revision) {
      throw new Error(
        `Expected revision ${expectedRevision}, current revision is ${head.revision}.`
      )
    }
    const applied = applyAuthorityObjectEdit(document, page.id, intent, requestId, head.revision)
    if (applied.outcome === 'no_change') {
      return {
        ok: true,
        result: {
          context: this.contextFor(head, page, document),
          execution_surface: EXECUTION_SURFACE,
          owner_id: intent.operation.objectId,
          persistence: {
            authority_id: head.authorityId,
            authority_revision: head.revision,
            content_hash: head.contentHash,
            status: 'unchanged',
            target: EXECUTION_SURFACE
          },
          presentation: { reason: 'no_live_runtime', status: 'unavailable' },
          proof: {
            durable_readback: 'not_applicable',
            normal_editor_undo: 'unavailable',
            pixels: 'not_evaluated',
            reason: 'no_change'
          },
          receipt: {
            idempotent_replay: false,
            operation: intent.operation.kind,
            requestId,
            status: 'no_change'
          },
          status: { attention_required: false, command: 'completed', mutation: 'no_change' }
        },
        target: targetResult(head, page)
      }
    }
    const receipt = await this.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId,
      workspaceId: head.identity.workspaceId
    })
    const committedHead = await this.head()
    const committedDocument = readAuthorityBoardDocument(committedHead.document)
    const committedPage = pageFrom(committedDocument, page.id)
    const committedMatches = authorityObjectEditRequestMatches(
      committedDocument,
      committedPage.id,
      requestId
    )
    if (committedMatches.length !== 1) {
      throw new Error('Committed object edit receipt is missing or ambiguous.')
    }
    const semanticReceipt = committedMatches[0]
    const readback = authorityObjectEditReadback(
      committedDocument,
      committedPage.id,
      semanticReceipt
    )
    const reconciliation = (readback.reconciliation as { status: string }).status
    if (reconciliation !== 'current') {
      throw new Error(`Committed object edit readback is ${reconciliation}.`)
    }
    return {
      ok: true,
      result: {
        context: this.contextFor(committedHead, committedPage, committedDocument),
        execution_surface: EXECUTION_SURFACE,
        owner_id: semanticReceipt.resultObjectId,
        persistence: {
          authority_id: committedHead.authorityId,
          authority_revision: committedHead.revision,
          content_hash: committedHead.contentHash,
          status: 'durable',
          target: EXECUTION_SURFACE
        },
        presentation: { reason: 'no_live_runtime', status: 'unavailable' },
        proof: {
          durable_readback: 'passed',
          normal_editor_undo: 'unavailable',
          pixels: 'not_evaluated',
          reason: 'no_live_runtime'
        },
        readback: { object_edit: readback },
        receipt: {
          ...receipt,
          idempotent_replay: false,
          operation: semanticReceipt.operation,
          requestId
        },
        status: { attention_required: false, command: 'completed', mutation: 'applied' }
      },
      target: targetResult(committedHead, committedPage)
    }
  }

  private async verify(args: JsonRecord) {
    const { document, head, page } = await this.requireContext(args)
    const requestId = requiredString(args, 'request_id')
    const matches = authorityArtifactRequestMatches(document.graph, page.id, requestId)
    const codeObjectReceipts = authorityCodeObjectRequestMatches(document, page.id, requestId)
    const codeObjects = await Promise.all(
      codeObjectReceipts.map((receipt) => authorityCodeObjectReadback(document, page.id, receipt))
    )
    const connections = verifyAuthorityConnectionRequest(document, page.id, requestId)
    const objectEdits = authorityObjectEditRequestMatches(document, page.id, requestId)
    const objectEditReadbacks = objectEdits.map((receipt) =>
      authorityObjectEditReadback(document, page.id, receipt)
    )
    const matchCount =
      matches.length + codeObjectReceipts.length + connections.length + objectEdits.length
    let status = 'ambiguous'
    if (matchCount === 0) status = 'empty'
    else if (matchCount === 1) status = 'matched'
    return {
      ok: true,
      result: {
        execution_surface: EXECUTION_SURFACE,
        nodes: matches.map((node) => authorityNodeSummary(document.graph, node)),
        ...(codeObjects.length > 0 ? { code_objects: codeObjects } : {}),
        ...(connections.length > 0 ? { object_graph_connections: connections } : {}),
        ...(objectEditReadbacks.length > 0 ? { object_edits: objectEditReadbacks } : {}),
        request_id: requestId,
        status
      },
      target: targetResult(head, page)
    }
  }

  private async readCodeObject(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const result = await readAuthorityCodeObject(
      document,
      page.id,
      requiredString(args, 'owner_id')
    )
    return {
      ok: true,
      result: {
        ...result,
        board_build_refine_recipe_base: {
          expected_source_hash: result.component.source_hash,
          kind: 'code_object',
          object_key: result.component.definition_id,
          operation: 'refine',
          owner_id: result.frame.id,
          source_format: 'tsx'
        },
        execution_surface: EXECUTION_SURFACE,
        refinement: {
          execution: 'staged',
          normal_editor_undo: 'unavailable',
          pixels: 'not_evaluated',
          status: 'available'
        }
      },
      target: targetResult(head, page)
    }
  }

  private async readMermaidSource(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    return {
      ok: true,
      result: {
        ...readAuthorityMermaidSource(document, page.id, requiredString(args, 'owner_id')),
        execution_surface: EXECUTION_SURFACE
      },
      target: targetResult(head, page)
    }
  }

  async sendRpc(body: Record<string, unknown>): Promise<unknown> {
    const command = optionalString(body, 'command')
    if (!command) throw new Error('RPC command is required.')
    const args = normalizeAuthorityRpcArgs(body)
    if (command === 'list_documents') return this.listDocuments()
    if (command === 'workspace_search') return this.workspaceSearch(args)
    if (command === 'board_context') return this.context(args)
    if (command === 'trace_get_gesture') return this.traceGesture(args)
    if (command === 'trace_query') return this.traceQuery(args)
    if (command === 'board_prepare_edit') return this.prepareTraceEdit(args)
    if (command === 'board_open') return this.open(args)
    if (command === 'board_read') return this.read(args)
    if (command === 'board_change' && isAuthorityObjectEditOperation(args.operation)) {
      return this.editObject(args)
    }
    if (command === 'board_build' || command === 'board_change') return this.build(args, command)
    if (command === 'connect_objects') {
      const outcome = await connectAuthorityObjects({
        args,
        issueContext: (head, page, document) => this.contextFor(head, page, document),
        resolved: await this.resolveContext(args),
        store: this.store
      })
      return { ok: true, result: outcome.result, target: targetResult(outcome.head, outcome.page) }
    }
    if (command === 'board_verify') return this.verify(args)
    if (command === 'board_fixture') return this.fixture(args)
    if (command === 'get_code_object') return this.readCodeObject(args)
    if (command === 'get_mermaid_source') return this.readMermaidSource(args)
    if (command === 'tool' && optionalString(args, 'name') === 'search_board_memory') {
      return this.searchMemory(args)
    }
    if (command === 'tool' && optionalString(args, 'name') === 'create_page') {
      return this.createPage(args)
    }
    throw new Error(
      `no_live_runtime: "${command}" requires a live OpenPencil runtime and was not applied.`
    )
  }
}
