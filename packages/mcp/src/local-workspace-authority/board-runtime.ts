import { randomUUID } from 'node:crypto'

import { searchBoardMemory } from '@open-pencil/core/tools'
import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import { pageOwnedTraceAncestor } from './agent-context'
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
  readAuthorityBoardDocument,
  type AuthorityBoardDocument
} from './document'
import { authorityNodeSummary } from './node-summary'
import { normalizeAuthorityRpcArgs } from './rpc-args'
import { renderAuthorityBoardScreenshot } from './screenshot'
import type { LocalWorkspaceAuthorityStore } from './store'
import type { LocalWorkspaceTraceGestureRead } from './trace'
import {
  queryPersistedTraceHistory,
  resolvePersistedTraceRequest,
  searchPersistedTrace
} from './trace-query'
import { LOCAL_AUTHORITY_BOARD_CAPABILITIES, type LocalWorkspaceAuthorityHead } from './types'

const EXECUTION_SURFACE = 'local_workspace_authority'
const RUNTIME_PREFIX = 'local-authority:'
const CONTEXT_LIMIT = 48
const DEFAULT_CONTEXT_LIMIT = 25
const DEFAULT_PAGE_LIMIT = 50
const QUERY_INDEX_LIMIT = 8

type JsonRecord = Record<string, unknown>

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

function navigationRegionFrom(args: JsonRecord): Rect | undefined {
  const raw = args.region
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Partial<Rect>
  const finite = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isFinite(candidate)
  if (
    !finite(record.x) ||
    !finite(record.y) ||
    !finite(record.width) ||
    record.width <= 0 ||
    !finite(record.height) ||
    record.height <= 0
  ) {
    throw new Error('A navigation region requires finite x, y and positive width, height.')
  }
  return { height: record.height, width: record.width, x: record.x, y: record.y }
}

function requestedObjectIds(args: JsonRecord): string[] {
  if (!Array.isArray(args.object_ids)) {
    throw new TypeError('board_read objects scope requires an object_ids array.')
  }
  const ids = args.object_ids.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (ids.length === 0 || ids.length > 25 || ids.some((id) => !id)) {
    throw new Error('board_read object_ids must contain from 1 to 25 non-empty strings.')
  }
  if (new Set(ids).size !== ids.length) throw new Error('board_read object_ids must be unique.')
  return ids
}

function screenshotObjectIds(args: JsonRecord): string[] {
  if (!Array.isArray(args.object_ids)) {
    throw new TypeError('board_screenshot requires an object_ids array.')
  }
  const ids = args.object_ids.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (ids.length === 0 || ids.length > 8 || ids.some((id) => !id)) {
    throw new Error('board_screenshot object_ids must contain from 1 to 8 non-empty strings.')
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('board_screenshot object_ids must be unique.')
  }
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
  // Recorded hits inside a container (e.g. Code Object internals) are grouped under their owner
  // instead of being discarded, so the compact view keeps the precise pointing evidence.
  const internalIdsByOwner = new Map<string, string[]>()
  const owners =
    document && page
      ? resolved.flatMap((node) => {
          const owner = pageOwnedTraceAncestor(document, page.id, node.id)
          if (!owner) return []
          if (node.id !== owner.id) {
            internalIdsByOwner.set(owner.id, [...(internalIdsByOwner.get(owner.id) ?? []), node.id])
          }
          if (ownerIds.has(owner.id)) return []
          ownerIds.add(owner.id)
          return [owner]
        })
      : []
  const primaryOwner =
    document && page && gesture.candidates.primaryTargetId
      ? pageOwnedTraceAncestor(document, page.id, gesture.candidates.primaryTargetId)
      : undefined
  const region = gesture.geometry.pageRegion
  const knownOmittedCount = Math.max(0, gesture.candidates.count - gesture.candidates.items.length)

  return {
    boardOrigin: gesture.boardOrigin,
    candidates: {
      collapsedCount: Math.max(0, resolved.length - owners.length),
      count: owners.length,
      items: document
        ? owners.map((owner) => {
            const recordedInternalIds = internalIdsByOwner.get(owner.id)
            return {
              ...traceCandidateSummary(document, owner),
              ...(recordedInternalIds?.length ? { recordedInternalIds } : {})
            }
          })
        : [],
      knownOmittedCount,
      missingCount: requestedIds.filter((id) => !resolvedIds.has(id)).length,
      ...(primaryOwner ? { primaryTargetId: primaryOwner.id } : {}),
      recordedCount: gesture.candidates.count,
      recordedItemCount: gesture.candidates.items.length,
      truncated: gesture.candidates.truncated
    },
    capturedAt: gesture.capturedAt,
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
    return {
      appearance: { status: 'unavailable', reason: 'no_live_runtime' },
      capabilities: [...LOCAL_AUTHORITY_BOARD_CAPABILITIES],
      context_token: token,
      execution_surface: EXECUTION_SURFACE,
      neighborhood: {
        count: children.length,
        nodes: neighborhood,
        returned: neighborhood.length,
        truncated: neighborhood.length < children.length
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

  private async screenshot(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const result = await renderAuthorityBoardScreenshot(
      document,
      page.id,
      screenshotObjectIds(args),
      boundedNumber(args.scale, 1, 0.1, 2, 'scale')
    )
    return { ok: true, result, target: targetResult(head, page) }
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

  private async traceResolve(args: JsonRecord) {
    return { ok: true, result: await resolvePersistedTraceRequest(this.store, args) }
  }

  private async traceSearch(args: JsonRecord) {
    return { ok: true, result: await searchPersistedTrace(this.store, args) }
  }

  private async open(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const objectIds = optionalStringArray(args, 'object_ids')
    if (objectIds && objectIds.length > 0) {
      const missing = objectIds.filter((id) => {
        const node = document.graph.getNode(id)
        return !node || node.type === 'CANVAS' || !document.graph.isDescendant(id, page.id)
      })
      if (missing.length > 0) {
        throw new Error(`Objects are not on Board "${page.name}": ${missing.join(', ')}.`)
      }
    }
    const region = navigationRegionFrom(args)
    const intent = await this.store.queueNavigationIntent({
      contentDocumentId: head.identity.documentId,
      ...(objectIds && objectIds.length > 0 ? { objectIds } : {}),
      pageId: page.id,
      ...(region ? { region } : {}),
      workspaceId: head.identity.workspaceId
    })
    return {
      ok: true,
      result: {
        action: 'queued',
        active: false,
        content_document_id: head.identity.documentId,
        expires_at: intent.expiresAt,
        intent_id: intent.intentId,
        ...(intent.objectIds ? { object_ids: intent.objectIds } : {}),
        page_id: page.id,
        page_name: page.name,
        ...(intent.region ? { region: intent.region } : {}),
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

  async sendRpc(body: Record<string, unknown>): Promise<unknown> {
    const command = optionalString(body, 'command')
    if (!command) throw new Error('RPC command is required.')
    const args = normalizeAuthorityRpcArgs(body)
    if (command === 'list_documents') return this.listDocuments()
    if (command === 'workspace_search') return this.workspaceSearch(args)
    if (command === 'board_context') return this.context(args)
    if (command === 'board_screenshot') return this.screenshot(args)
    if (command === 'trace_get_gesture') return this.traceGesture(args)
    if (command === 'trace_query') return this.traceQuery(args)
    if (command === 'trace_resolve') return this.traceResolve(args)
    if (command === 'trace_search') return this.traceSearch(args)
    if (command === 'board_open') return this.open(args)
    if (command === 'board_read') return this.read(args)
    if (command === 'tool' && optionalString(args, 'name') === 'search_board_memory') {
      return this.searchMemory(args)
    }
    throw new Error(
      `no_live_runtime: "${command}" requires a live OpenPencil runtime and was not applied.`
    )
  }
}
