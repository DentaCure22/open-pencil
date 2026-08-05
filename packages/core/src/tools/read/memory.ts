import MiniSearch, { type SearchResult } from 'minisearch'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { defineTool } from '#core/tools/schema'

const MEMORY_PLUGIN_ID = 'openpencil.memory'
const CANONICAL_OBJECT_KEY = 'canonical-object-id'
const CANONICAL_SOURCE_NODE_KEY = 'canonical-source-node-id'
const DERIVED_FROM_CANONICAL_OBJECT_KEY = 'derived-from-canonical-object-id'
const BOARD_TEXT_LIMIT = 12_000
const OBJECT_TEXT_LIMIT = 2_000
const DEFAULT_RESULT_LIMIT = 12
const MAX_RESULT_LIMIT = 25
const MAX_BOARD_RESULTS = 8
const MAX_PLACEMENTS_PER_OBJECT = 5

type MemoryDocumentKind = 'board' | 'object'

type MemorySearchDocument = {
  boardId: string
  canonicalObjectId?: string
  id: string
  kind: MemoryDocumentKind
  nodeId?: string
  nodeType?: string
  text: string
  title: string
}

export type BoardMemoryPlacement = {
  board_id: string
  board_name: string
  bounds: Rect
  derived_from_canonical_object_id?: string
  node_id: string
  parent_id: string
  source_node_id?: string
}

export type BoardMemoryObjectResult = {
  canonical_object_id: string
  derived_from_canonical_object_id?: string
  is_variant: boolean
  match_reasons: string[]
  placements: BoardMemoryPlacement[]
  relevance: number
  summary: string
  title: string
  type: string
}

export type BoardMemoryBoardResult = {
  board_id: string
  groups: Array<{ child_count: number; id: string; name: string; type: string }>
  match_reasons: string[]
  object_count: number
  relevance: number
  representative_objects: Array<{ id: string; name: string; type: string }>
  title: string
}

export type BoardMemorySearchResult = {
  boards: BoardMemoryBoardResult[]
  index: {
    board_count: number
    canonical_object_count: number
    placement_count: number
  }
  objects: BoardMemoryObjectResult[]
  query: string
  scope: {
    current_board_id?: string
  }
}

export type BoardMemorySearchOptions = {
  currentBoardId?: string
  limit?: number
}

type IndexedBoard = {
  node: SceneNode
  objectCount: number
  topLevel: SceneNode[]
}

type IndexedPlacement = {
  board: SceneNode
  canonicalObjectId: string
  node: SceneNode
}

type MemoryIndex = {
  boards: Map<string, IndexedBoard>
  documents: MemorySearchDocument[]
  placementsByCanonicalId: Map<string, IndexedPlacement[]>
}

type RankedCandidate = {
  hit: SearchResult
  score: number
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function boundedLimit(value?: number): number {
  if (value === undefined) return DEFAULT_RESULT_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
    throw new Error(`limit must be an integer between 1 and ${MAX_RESULT_LIMIT}.`)
  }
  return value
}

function boundedText(parts: Iterable<string>, maximum: number): string {
  let result = ''
  for (const part of parts) {
    const content = part.trim()
    if (!content) continue
    const separator = result ? ' ' : ''
    const remaining = maximum - result.length - separator.length
    if (remaining <= 0) break
    result += `${separator}${content.slice(0, remaining)}`
  }
  return result
}

function directNodeText(node: SceneNode): string {
  const name = node.name || node.id
  if (node.type === 'TEXT') return boundedText([name, node.text], OBJECT_TEXT_LIMIT)
  return name
}

function subtreeText(graph: SceneGraph, node: SceneNode, maximum: number): string {
  function* parts(): Iterable<string> {
    yield directNodeText(node)
    for (const descendant of graph.getDescendants(node.id)) yield directNodeText(descendant)
  }
  return boundedText(parts(), maximum)
}

export function canonicalMemoryObjectId(node: SceneNode): string {
  const assigned = node.pluginData?.find(
    (entry) => entry.pluginId === MEMORY_PLUGIN_ID && entry.key === CANONICAL_OBJECT_KEY
  )?.value
  return assigned?.trim() || node.id
}

export function canonicalMemorySourceNodeId(node: SceneNode): string | undefined {
  return node.pluginData
    ?.find(
      (entry) => entry.pluginId === MEMORY_PLUGIN_ID && entry.key === CANONICAL_SOURCE_NODE_KEY
    )
    ?.value.trim()
}

export function canonicalMemoryDerivedFromId(node: SceneNode): string | undefined {
  return node.pluginData
    ?.find(
      (entry) =>
        entry.pluginId === MEMORY_PLUGIN_ID && entry.key === DERIVED_FROM_CANONICAL_OBJECT_KEY
    )
    ?.value.trim()
}

export type CanonicalMemoryObjectMetadata = {
  canonicalObjectId?: string
  derivedFromCanonicalObjectId?: string
  sourceNodeId?: string
}

export function canonicalMemoryObjectPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  metadata: CanonicalMemoryObjectMetadata
): SceneNode['pluginData'] {
  const pluginData = node.pluginData.filter(
    (entry) =>
      !(
        entry.pluginId === MEMORY_PLUGIN_ID &&
        (entry.key === CANONICAL_OBJECT_KEY ||
          entry.key === CANONICAL_SOURCE_NODE_KEY ||
          entry.key === DERIVED_FROM_CANONICAL_OBJECT_KEY)
      )
  )
  if (metadata.canonicalObjectId) {
    pluginData.push({
      key: CANONICAL_OBJECT_KEY,
      pluginId: MEMORY_PLUGIN_ID,
      value: metadata.canonicalObjectId
    })
  }
  if (metadata.sourceNodeId) {
    pluginData.push({
      key: CANONICAL_SOURCE_NODE_KEY,
      pluginId: MEMORY_PLUGIN_ID,
      value: metadata.sourceNodeId
    })
  }
  if (metadata.derivedFromCanonicalObjectId) {
    pluginData.push({
      key: DERIVED_FROM_CANONICAL_OBJECT_KEY,
      pluginId: MEMORY_PLUGIN_ID,
      value: metadata.derivedFromCanonicalObjectId
    })
  }
  return pluginData
}

function indexBoardMemory(graph: SceneGraph): MemoryIndex {
  const boards = new Map<string, IndexedBoard>()
  const documents: MemorySearchDocument[] = []
  const placementsByCanonicalId = new Map<string, IndexedPlacement[]>()

  for (const board of graph.getPages()) {
    const topLevel = board.childIds.flatMap((id) => {
      const node = graph.getNode(id)
      return node ? [node] : []
    })
    const descendants = [...graph.getDescendants(board.id)]
    boards.set(board.id, { node: board, objectCount: descendants.length, topLevel })
    documents.push({
      boardId: board.id,
      id: `board:${board.id}`,
      kind: 'board',
      text: boundedText(descendants.map(directNodeText), BOARD_TEXT_LIMIT),
      title: board.name
    })

    for (const node of descendants) {
      const canonicalObjectId = canonicalMemoryObjectId(node)
      const placement: IndexedPlacement = { board, canonicalObjectId, node }
      const placements = placementsByCanonicalId.get(canonicalObjectId)
      if (placements) placements.push(placement)
      else placementsByCanonicalId.set(canonicalObjectId, [placement])
      documents.push({
        boardId: board.id,
        canonicalObjectId,
        id: `object:${node.id}`,
        kind: 'object',
        nodeId: node.id,
        nodeType: node.type,
        text: subtreeText(graph, node, OBJECT_TEXT_LIMIT),
        title: node.name
      })
    }
  }
  return { boards, documents, placementsByCanonicalId }
}

function searchDocuments(documents: MemorySearchDocument[], query: string): RankedCandidate[] {
  const search = new MiniSearch<MemorySearchDocument>({
    fields: ['title', 'text'],
    idField: 'id',
    storeFields: ['boardId', 'canonicalObjectId', 'kind', 'nodeId', 'nodeType', 'title']
  })
  search.addAll(documents)
  const hits = search.search(query, {
    boost: { text: 1, title: 3 },
    combineWith: 'OR',
    fuzzy: 0.15,
    prefix: true
  })
  const maximum = hits[0]?.score ?? 1
  return hits.map((hit) => ({ hit, score: hit.score / maximum }))
}

function exactTitleBoost(title: string, query: string): number {
  const candidate = normalized(title)
  const target = normalized(query)
  if (candidate === target) return 0.35
  return candidate.includes(target) ? 0.15 : 0
}

function matchReasons(
  title: string,
  query: string,
  hit: SearchResult,
  currentBoard: boolean
): string[] {
  const reasons: string[] = []
  const candidate = normalized(title)
  const target = normalized(query)
  if (candidate === target) reasons.push('exact title')
  else if (candidate.includes(target)) reasons.push('title')
  const fields = new Set(Object.values(hit.match).flat())
  if (fields.has('text')) reasons.push('content')
  if (currentBoard) reasons.push('current Board')
  return reasons.length > 0 ? reasons : ['lexical match']
}

function relevance(score: number): number {
  return Number(Math.min(1, score).toFixed(4))
}

function placementResult(graph: SceneGraph, placement: IndexedPlacement): BoardMemoryPlacement {
  const derivedFromCanonicalObjectId = canonicalMemoryDerivedFromId(placement.node)
  const sourceNodeId = canonicalMemorySourceNodeId(placement.node)
  return {
    board_id: placement.board.id,
    board_name: placement.board.name,
    bounds: graph.getAbsoluteBounds(placement.node.id),
    ...(derivedFromCanonicalObjectId
      ? { derived_from_canonical_object_id: derivedFromCanonicalObjectId }
      : {}),
    node_id: placement.node.id,
    parent_id: placement.node.parentId ?? placement.board.id,
    ...(sourceNodeId ? { source_node_id: sourceNodeId } : {})
  }
}

function orderedPlacements(
  graph: SceneGraph,
  placements: IndexedPlacement[],
  matchedNodeId: string | undefined,
  currentBoardId: string | undefined
): BoardMemoryPlacement[] {
  return [...placements]
    .sort((left, right) => {
      const leftMatched = left.node.id === matchedNodeId ? 1 : 0
      const rightMatched = right.node.id === matchedNodeId ? 1 : 0
      if (leftMatched !== rightMatched) return rightMatched - leftMatched
      const leftCurrent = left.board.id === currentBoardId ? 1 : 0
      const rightCurrent = right.board.id === currentBoardId ? 1 : 0
      return rightCurrent - leftCurrent || left.node.id.localeCompare(right.node.id)
    })
    .slice(0, MAX_PLACEMENTS_PER_OBJECT)
    .map((placement) => placementResult(graph, placement))
}

function boardResult(
  board: IndexedBoard,
  query: string,
  candidate: RankedCandidate,
  promotedScore: number,
  currentBoardId: string | undefined
): BoardMemoryBoardResult {
  const current = board.node.id === currentBoardId
  const score = candidate.score + exactTitleBoost(board.node.name, query) + (current ? 0.1 : 0)
  const groups = board.topLevel
    .filter((node) => node.childIds.length > 0)
    .slice(0, 5)
    .map((node) => ({
      child_count: node.childIds.length,
      id: node.id,
      name: node.name,
      type: node.type
    }))
  return {
    board_id: board.node.id,
    groups,
    match_reasons: matchReasons(board.node.name, query, candidate.hit, current),
    object_count: board.objectCount,
    relevance: relevance(Math.max(score, promotedScore)),
    representative_objects: board.topLevel.slice(0, 8).map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type
    })),
    title: board.node.name
  }
}

export function searchBoardMemory(
  graph: SceneGraph,
  rawQuery: string,
  options: BoardMemorySearchOptions = {}
): BoardMemorySearchResult {
  const query = rawQuery.trim()
  if (!query) throw new Error('query is required.')
  const limit = boundedLimit(options.limit)
  const index = indexBoardMemory(graph)
  const candidates = searchDocuments(index.documents, query)
  const boardCandidates = new Map<string, RankedCandidate>()
  const objectCandidates = new Map<string, RankedCandidate>()
  const promotedBoards = new Map<string, number>()

  for (const candidate of candidates) {
    const kind = candidate.hit.kind
    const boardId = candidate.hit.boardId
    if (typeof boardId !== 'string') continue
    if (kind === 'board') {
      boardCandidates.set(boardId, candidate)
      continue
    }
    const canonicalObjectId = candidate.hit.canonicalObjectId
    if (typeof canonicalObjectId !== 'string') continue
    const existing = objectCandidates.get(canonicalObjectId)
    if (!existing || candidate.score > existing.score) {
      objectCandidates.set(canonicalObjectId, candidate)
    }
    promotedBoards.set(boardId, Math.max(promotedBoards.get(boardId) ?? 0, candidate.score * 0.6))
  }

  for (const [boardId, promotedScore] of promotedBoards) {
    if (boardCandidates.has(boardId)) continue
    const boardDocument = index.documents.find((item) => item.id === `board:${boardId}`)
    if (!boardDocument) continue
    boardCandidates.set(boardId, {
      hit: {
        ...boardDocument,
        id: boardDocument.id,
        match: {},
        queryTerms: [],
        score: promotedScore,
        terms: []
      },
      score: promotedScore
    })
  }

  const boards = [...boardCandidates.entries()]
    .flatMap(([boardId, candidate]) => {
      const board = index.boards.get(boardId)
      if (!board) return []
      return [
        boardResult(
          board,
          query,
          candidate,
          promotedBoards.get(boardId) ?? 0,
          options.currentBoardId
        )
      ]
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance || left.board_id.localeCompare(right.board_id)
    )
    .slice(0, Math.min(MAX_BOARD_RESULTS, limit))

  const objects = [...objectCandidates.entries()]
    .flatMap(([canonicalObjectId, candidate]) => {
      const placements = index.placementsByCanonicalId.get(canonicalObjectId)
      if (!placements || placements.length === 0) return []
      const matchedNodeId =
        typeof candidate.hit.nodeId === 'string' ? candidate.hit.nodeId : undefined
      const matched =
        placements.find((placement) => placement.node.id === matchedNodeId) ?? placements[0]
      const current = placements.some((placement) => placement.board.id === options.currentBoardId)
      const score =
        candidate.score + exactTitleBoost(matched.node.name, query) + (current ? 0.1 : 0)
      const derivedFromCanonicalObjectId = placements
        .map(({ node }) => canonicalMemoryDerivedFromId(node))
        .find((value) => value !== undefined)
      return [
        {
          canonical_object_id: canonicalObjectId,
          ...(derivedFromCanonicalObjectId
            ? { derived_from_canonical_object_id: derivedFromCanonicalObjectId }
            : {}),
          is_variant: derivedFromCanonicalObjectId !== undefined,
          match_reasons: matchReasons(matched.node.name, query, candidate.hit, current),
          placements: orderedPlacements(graph, placements, matchedNodeId, options.currentBoardId),
          relevance: relevance(score),
          summary: directNodeText(matched.node).slice(0, 240),
          title: matched.node.name,
          type: matched.node.type
        } satisfies BoardMemoryObjectResult
      ]
    })
    .sort(
      (left, right) =>
        right.relevance - left.relevance ||
        left.canonical_object_id.localeCompare(right.canonical_object_id)
    )
    .slice(0, limit)

  return {
    boards,
    index: {
      board_count: index.boards.size,
      canonical_object_count: index.placementsByCanonicalId.size,
      placement_count: [...index.placementsByCanonicalId.values()].reduce(
        (total, placements) => total + placements.length,
        0
      )
    },
    objects,
    query,
    scope: options.currentBoardId ? { current_board_id: options.currentBoardId } : {}
  }
}

export const searchMemory = defineTool({
  name: 'search_board_memory',
  description:
    'Search all Boards and reusable objects in the current OpenPencil document before resuming or composing prior work. Returns ranked Board capsules, canonical object IDs, and every matching Board placement without mutating the document. Canonical identity defaults to the SceneNode ID and may be shared across placements with openpencil.memory/canonical-object-id.',
  params: {
    query: {
      description: 'Words or remembered phrase describing the prior Board or object',
      required: true,
      type: 'string'
    },
    limit: {
      default: DEFAULT_RESULT_LIMIT,
      description: `Maximum object results from 1 to ${MAX_RESULT_LIMIT}`,
      max: MAX_RESULT_LIMIT,
      min: 1,
      type: 'number'
    }
  },
  execute: (figma, args) =>
    searchBoardMemory(figma.graph, args.query, {
      currentBoardId: figma.currentPageId,
      limit: args.limit
    })
})
