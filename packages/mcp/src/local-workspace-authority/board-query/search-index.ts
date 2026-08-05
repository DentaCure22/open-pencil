import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { AuthorityBoardReadQuery } from './index'

const MAX_INDEXED_NAME_LENGTH = 1_024
const MAX_INDEXED_TEXT_LENGTH = 4_096
const MAX_NODE_SPATIAL_CELLS = 256
const MAX_QUERY_SPATIAL_CELLS = 4_096
const SPATIAL_CELL_SIZE = 512

type IdIndex = Map<string, Set<string>>

type SpatialIndex = {
  cells: IdIndex
  oversizedNodeIds: Set<string>
}

export type AuthorityBoardQueryIndex = {
  documentOrder: ReadonlyMap<string, number>
  graph: SceneGraph
  nameTrigrams: ReadonlyMap<string, ReadonlySet<string>>
  nodes: readonly SceneNode[]
  oversizedNameIds: ReadonlySet<string>
  oversizedTextIds: ReadonlySet<string>
  pageId: string
  parentIds: ReadonlyMap<string, ReadonlySet<string>>
  spatial?: SpatialIndex
  textTrigrams: ReadonlyMap<string, ReadonlySet<string>>
  typeIds: ReadonlyMap<string, ReadonlySet<string>>
}

export type AuthorityBoardQueryCandidates = {
  candidateCount: number
  nodes: SceneNode[]
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

function addId(index: IdIndex, key: string, id: string): void {
  const ids = index.get(key)
  if (ids) ids.add(id)
  else index.set(key, new Set([id]))
}

function uniqueTrigrams(value: string): Set<string> {
  const result = new Set<string>()
  for (let index = 0; index <= value.length - 3; index += 1) {
    result.add(value.slice(index, index + 3))
  }
  return result
}

function indexText(
  index: IdIndex,
  oversizedIds: Set<string>,
  id: string,
  value: string,
  maximumLength: number
): void {
  const content = normalized(value)
  if (content.length < 3) return
  if (content.length > maximumLength) {
    oversizedIds.add(id)
    return
  }
  for (const trigram of uniqueTrigrams(content)) addId(index, trigram, id)
}

export function buildAuthorityBoardQueryIndex(
  graph: SceneGraph,
  pageId: string
): AuthorityBoardQueryIndex {
  const nodes = [...graph.getDescendants(pageId)]
  const documentOrder = new Map<string, number>()
  const nameTrigrams: IdIndex = new Map()
  const oversizedNameIds = new Set<string>()
  const oversizedTextIds = new Set<string>()
  const parentIds: IdIndex = new Map()
  const textTrigrams: IdIndex = new Map()
  const typeIds: IdIndex = new Map()

  for (const [order, node] of nodes.entries()) {
    documentOrder.set(node.id, order)
    addId(parentIds, node.parentId, node.id)
    addId(typeIds, node.type, node.id)
    indexText(nameTrigrams, oversizedNameIds, node.id, node.name, MAX_INDEXED_NAME_LENGTH)
    if (node.type === 'TEXT') {
      indexText(textTrigrams, oversizedTextIds, node.id, node.text, MAX_INDEXED_TEXT_LENGTH)
    }
  }

  return {
    documentOrder,
    graph,
    nameTrigrams,
    nodes,
    oversizedNameIds,
    oversizedTextIds,
    pageId,
    parentIds,
    textTrigrams,
    typeIds
  }
}

function unionSets(sets: Iterable<ReadonlySet<string>>): Set<string> {
  const result = new Set<string>()
  for (const ids of sets) {
    for (const id of ids) result.add(id)
  }
  return result
}

function intersectSets(sets: readonly ReadonlySet<string>[]): Set<string> {
  if (sets.length === 0) return new Set()
  const ordered = [...sets].sort((left, right) => left.size - right.size)
  const result = new Set(ordered[0])
  for (const ids of ordered.slice(1)) {
    for (const id of result) {
      if (!ids.has(id)) result.delete(id)
    }
  }
  return result
}

function textCandidates(
  index: ReadonlyMap<string, ReadonlySet<string>>,
  oversizedIds: ReadonlySet<string>,
  value: string
): Set<string> | undefined {
  const content = normalized(value)
  if (content.length < 3) return undefined
  const postings: ReadonlySet<string>[] = []
  for (const trigram of uniqueTrigrams(content)) {
    const ids = index.get(trigram)
    if (!ids) return new Set(oversizedIds)
    postings.push(ids)
  }
  const candidates = intersectSets(postings)
  for (const id of oversizedIds) candidates.add(id)
  return candidates
}

function cellRange(rect: Rect): { maxX: number; maxY: number; minX: number; minY: number } {
  return {
    maxX: Math.floor((rect.x + rect.width) / SPATIAL_CELL_SIZE),
    maxY: Math.floor((rect.y + rect.height) / SPATIAL_CELL_SIZE),
    minX: Math.floor(rect.x / SPATIAL_CELL_SIZE),
    minY: Math.floor(rect.y / SPATIAL_CELL_SIZE)
  }
}

function cellCount(range: ReturnType<typeof cellRange>): number {
  return (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1)
}

function cellKey(x: number, y: number): string {
  return `${x}:${y}`
}

function addSpatialCells(cells: IdIndex, id: string, range: ReturnType<typeof cellRange>): void {
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) addId(cells, cellKey(x, y), id)
  }
}

function ensureSpatialIndex(index: AuthorityBoardQueryIndex): SpatialIndex {
  if (index.spatial) return index.spatial
  const spatial: SpatialIndex = { cells: new Map(), oversizedNodeIds: new Set() }
  for (const node of index.nodes) {
    const bounds = index.graph.getAbsoluteBounds(node.id)
    if (bounds.width <= 0 || bounds.height <= 0) continue
    const range = cellRange(bounds)
    if (cellCount(range) > MAX_NODE_SPATIAL_CELLS) spatial.oversizedNodeIds.add(node.id)
    else addSpatialCells(spatial.cells, node.id, range)
  }
  index.spatial = spatial
  return spatial
}

function spatialCandidates(index: AuthorityBoardQueryIndex, region: Rect): Set<string> | undefined {
  const range = cellRange(region)
  if (cellCount(range) > MAX_QUERY_SPATIAL_CELLS) return undefined
  const spatial = ensureSpatialIndex(index)
  const postings: ReadonlySet<string>[] = []
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      const ids = spatial.cells.get(cellKey(x, y))
      if (ids) postings.push(ids)
    }
  }
  const candidates = unionSets(postings)
  for (const id of spatial.oversizedNodeIds) candidates.add(id)
  return candidates
}

function indexedCandidateSets(
  index: AuthorityBoardQueryIndex,
  query: AuthorityBoardReadQuery
): Set<string>[] {
  const sets: Set<string>[] = []
  if (query.parent_id) sets.push(new Set(index.parentIds.get(query.parent_id)))
  if (query.types) {
    sets.push(unionSets(query.types.map((type) => index.typeIds.get(type) ?? new Set())))
  }
  if (query.name) {
    const candidates = textCandidates(index.nameTrigrams, index.oversizedNameIds, query.name)
    if (candidates) sets.push(candidates)
  }
  if (query.text) {
    const candidates = textCandidates(index.textTrigrams, index.oversizedTextIds, query.text)
    if (candidates) sets.push(candidates)
  }
  if (query.region) {
    const candidates = spatialCandidates(index, query.region)
    if (candidates) sets.push(candidates)
  }
  return sets
}

export function authorityBoardQueryCandidates(
  index: AuthorityBoardQueryIndex,
  query: AuthorityBoardReadQuery
): AuthorityBoardQueryCandidates {
  const sets = indexedCandidateSets(index, query)
  if (sets.length === 0) {
    return { candidateCount: index.nodes.length, nodes: [...index.nodes] }
  }
  const ids = intersectSets(sets)
  const nodes: SceneNode[] = []
  for (const id of ids) {
    const node = index.graph.getNode(id)
    if (node) nodes.push(node)
  }
  return { candidateCount: ids.size, nodes }
}
