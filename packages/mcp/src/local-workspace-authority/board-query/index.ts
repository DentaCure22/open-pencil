import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { authorityNodeSummary } from '#mcp/local-workspace-authority/node-summary'

import {
  authorityBoardQueryCandidates,
  buildAuthorityBoardQueryIndex,
  type AuthorityBoardQueryIndex
} from './search-index'

const DEFAULT_QUERY_TOKEN_BUDGET = 1_500
const MAX_QUERY_TOKEN_BUDGET = 6_000
const MIN_QUERY_TOKEN_BUDGET = 256
const SUMMARY_TEXT_LIMIT = 240
const PAYLOAD_OVERHEAD_TOKENS = 96

type JsonRecord = Record<string, unknown>

export type AuthorityBoardReadProjection = 'detail' | 'geometry' | 'id_only' | 'summary'
export type AuthorityBoardReadSort = 'document' | 'name' | 'x' | 'y'

export type AuthorityBoardReadQuery = {
  name?: string
  parent_id?: string
  region?: Rect
  text?: string
  types?: string[]
}

export type AuthorityBoardQueryOptions = {
  limit: number
  projection: AuthorityBoardReadProjection
  query: AuthorityBoardReadQuery
  sort: AuthorityBoardReadSort
  tokenBudget: number
}

export type AuthorityBoardQueryResult = {
  candidateCount: number
  estimatedPayloadTokens: number
  indexedNodeCount: number
  matchedCount: number
  nodes: JsonRecord[]
  scannedCount: number
  tokenBudget: number
  truncated: boolean
  truncationReason?: 'limit' | 'token_budget'
}

export { buildAuthorityBoardQueryIndex, type AuthorityBoardQueryIndex }

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function exactKeys(value: JsonRecord, allowed: readonly string[], field: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length > 0)
    throw new Error(`${field} contains unsupported fields: ${unknown.join(', ')}.`)
}

function optionalBoundedString(
  value: JsonRecord,
  field: string,
  maximum: number
): string | undefined {
  const candidate = value[field]
  if (candidate === undefined) return undefined
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.trim().length > maximum) {
    throw new Error(`${field} must be a non-empty string up to ${maximum} characters.`)
  }
  return candidate.trim()
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  return value
}

function parseRegion(value: unknown): Rect | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('query.region must be an object.')
  exactKeys(value, ['height', 'width', 'x', 'y'], 'query.region')
  const width = finiteNumber(value.width, 'query.region.width')
  const height = finiteNumber(value.height, 'query.region.height')
  if (width <= 0 || height <= 0) throw new Error('query.region width and height must be positive.')
  return {
    height,
    width,
    x: finiteNumber(value.x, 'query.region.x'),
    y: finiteNumber(value.y, 'query.region.y')
  }
}

function parseTypes(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 16 ||
    value.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    throw new Error('query.types must contain from 1 to 16 non-empty strings.')
  }
  const types = value.map((entry) => String(entry).trim().toUpperCase())
  if (new Set(types).size !== types.length) throw new Error('query.types must be unique.')
  return types
}

export function parseAuthorityBoardReadQuery(value: unknown): AuthorityBoardReadQuery {
  if (!isRecord(value)) throw new Error('board_read query scope requires a query object.')
  exactKeys(value, ['name', 'parent_id', 'region', 'text', 'types'], 'query')
  const name = optionalBoundedString(value, 'name', 240)
  const parentId = optionalBoundedString(value, 'parent_id', 240)
  const region = parseRegion(value.region)
  const text = optionalBoundedString(value, 'text', 240)
  const types = parseTypes(value.types)
  if (!name && !parentId && !region && !text && !types) {
    throw new Error('board_read query requires at least one filter.')
  }
  return {
    ...(name ? { name } : {}),
    ...(parentId ? { parent_id: parentId } : {}),
    ...(region ? { region } : {}),
    ...(text ? { text } : {}),
    ...(types ? { types } : {})
  }
}

export function authorityBoardReadProjection(value: unknown): AuthorityBoardReadProjection {
  if (value === undefined) return 'summary'
  if (value === 'detail' || value === 'geometry' || value === 'id_only' || value === 'summary') {
    return value
  }
  throw new Error('projection must be detail, geometry, id_only, or summary.')
}

export function authorityBoardReadSort(value: unknown): AuthorityBoardReadSort {
  if (value === undefined) return 'document'
  if (value === 'document' || value === 'name' || value === 'x' || value === 'y') return value
  throw new Error('sort must be document, name, x, or y.')
}

export function authorityBoardReadTokenBudget(value: unknown): number {
  if (value === undefined) return DEFAULT_QUERY_TOKEN_BUDGET
  const budget = finiteNumber(value, 'token_budget')
  if (
    !Number.isInteger(budget) ||
    budget < MIN_QUERY_TOKEN_BUDGET ||
    budget > MAX_QUERY_TOKEN_BUDGET
  ) {
    throw new Error(
      `token_budget must be an integer between ${MIN_QUERY_TOKEN_BUDGET} and ${MAX_QUERY_TOKEN_BUDGET}.`
    )
  }
  return budget
}

function intersects(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function matchesQuery(graph: SceneGraph, node: SceneNode, query: AuthorityBoardReadQuery): boolean {
  if (query.parent_id && node.parentId !== query.parent_id) return false
  if (query.types && !query.types.includes(node.type)) return false
  if (query.name && !normalized(node.name).includes(normalized(query.name))) return false
  if (
    query.text &&
    (node.type !== 'TEXT' || !normalized(node.text).includes(normalized(query.text)))
  ) {
    return false
  }
  if (query.region && !intersects(graph.getAbsoluteBounds(node.id), query.region)) return false
  return true
}

function compareNodes(
  graph: SceneGraph,
  sort: AuthorityBoardReadSort,
  left: SceneNode,
  right: SceneNode
): number {
  if (sort === 'document') return 0
  if (sort === 'name') {
    const compared = normalized(left.name).localeCompare(normalized(right.name))
    return compared === 0 ? left.id.localeCompare(right.id) : compared
  }
  const leftBounds = graph.getAbsoluteBounds(left.id)
  const rightBounds = graph.getAbsoluteBounds(right.id)
  const primary = sort === 'x' ? leftBounds.x - rightBounds.x : leftBounds.y - rightBounds.y
  if (primary !== 0) return primary
  const secondary = sort === 'x' ? leftBounds.y - rightBounds.y : leftBounds.x - rightBounds.x
  return secondary === 0 ? left.id.localeCompare(right.id) : secondary
}

function summaryText(node: SceneNode): JsonRecord {
  if (node.type !== 'TEXT') return {}
  const truncated = node.text.length > SUMMARY_TEXT_LIMIT
  return {
    text_preview: truncated ? node.text.slice(0, SUMMARY_TEXT_LIMIT) : node.text,
    ...(truncated ? { text_truncated: true } : {})
  }
}

export function projectAuthorityBoardNode(
  graph: SceneGraph,
  node: SceneNode,
  projection: AuthorityBoardReadProjection
): JsonRecord {
  if (projection === 'detail') return authorityNodeSummary(graph, node)
  if (projection === 'id_only') {
    return { id: node.id, parent_id: node.parentId, type: node.type }
  }
  const geometry = {
    bounds: graph.getAbsoluteBounds(node.id),
    id: node.id,
    parent_id: node.parentId,
    type: node.type,
    visible: node.visible
  }
  if (projection === 'geometry') return geometry
  return {
    ...geometry,
    child_count: node.childIds.length,
    name: node.name,
    ...summaryText(node)
  }
}

export function estimatedJsonTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4)
}

export function queryAuthorityBoard(
  graph: SceneGraph,
  pageId: string,
  options: AuthorityBoardQueryOptions,
  index: AuthorityBoardQueryIndex = buildAuthorityBoardQueryIndex(graph, pageId)
): AuthorityBoardQueryResult {
  if (index.graph !== graph || index.pageId !== pageId) {
    throw new Error('Board query index does not match the requested graph and page.')
  }
  const candidates = authorityBoardQueryCandidates(index, options.query)
  const matches = candidates.nodes.filter((node) => matchesQuery(graph, node, options.query))
  if (options.sort === 'document') {
    matches.sort(
      (left, right) =>
        (index.documentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (index.documentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    )
  } else {
    matches.sort((left, right) => compareNodes(graph, options.sort, left, right))
  }

  const nodes: JsonRecord[] = []
  let estimatedPayloadTokens = PAYLOAD_OVERHEAD_TOKENS
  let tokenLimited = false
  for (const node of matches.slice(0, options.limit)) {
    const projected = projectAuthorityBoardNode(graph, node, options.projection)
    const projectedTokens = estimatedJsonTokens(projected)
    if (estimatedPayloadTokens + projectedTokens > options.tokenBudget) {
      tokenLimited = true
      break
    }
    nodes.push(projected)
    estimatedPayloadTokens += projectedTokens
  }

  const limitLimited = matches.length > options.limit
  let truncationReason: AuthorityBoardQueryResult['truncationReason']
  if (tokenLimited) truncationReason = 'token_budget'
  else if (limitLimited) truncationReason = 'limit'
  return {
    candidateCount: candidates.candidateCount,
    estimatedPayloadTokens,
    indexedNodeCount: index.nodes.length,
    matchedCount: matches.length,
    nodes,
    scannedCount: candidates.nodes.length,
    tokenBudget: options.tokenBudget,
    truncated: tokenLimited || limitLimited,
    ...(truncationReason ? { truncationReason } : {})
  }
}
