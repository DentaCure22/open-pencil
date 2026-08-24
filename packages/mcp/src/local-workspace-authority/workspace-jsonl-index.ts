import { Buffer } from 'node:buffer'
import { open, readFile } from 'node:fs/promises'
import path from 'node:path'

import { canonicalMemoryObjectId, canonicalMemorySourceNodeId } from '@open-pencil/core/tools'
import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { readAuthorityBoardDocument } from './document'
import { writeBinaryFile } from './json-file'
import { nodePairs } from './mermaid-presence'
import type { LocalWorkspaceAuthorityHead } from './types'

export const WORKSPACE_JSONL_INDEX_CONTRACT = 'workspace-jsonl-index/v1'
export const WORKSPACE_JSONL_INDEX_FILE = 'workspace.index.jsonl'
export const WORKSPACE_JSONL_INDEX_PROJECTION_VERSION = 2

const MAX_SHORT_TEXT_BYTES = 512
const MAX_SEARCHABLE_BYTES = 1_024
const MAX_STRING_SCAN_CODE_UNITS = 8_192
const UTF8_ENCODER = new TextEncoder()

export type WorkspaceJsonlIndexSource = Pick<
  LocalWorkspaceAuthorityHead,
  'contentHash' | 'document' | 'identity' | 'revision'
>

export type WorkspaceJsonlIndexMetadata = {
  contentHash: string
  contract: typeof WORKSPACE_JSONL_INDEX_CONTRACT
  documentId: string
  kind: 'meta'
  pageCount: number
  projectionVersion: typeof WORKSPACE_JSONL_INDEX_PROJECTION_VERSION
  recordCount: number
  revision: number
  rootId: string
  workspaceId: string
}

export type WorkspaceJsonlIndexRecord = {
  bounds: Rect
  canonicalObjectId: string
  id: string
  kind: 'node' | 'page'
  name: string
  ownerId: string
  pageId: string
  pageName: string
  parentId: string | null
  prototypeIds?: Partial<Record<SceneNode['type'], string>>
  searchable: string
  sourceNodeId?: string
  text?: string
  type: SceneNode['type']
}

export type WorkspaceJsonlIndex = {
  metadata: WorkspaceJsonlIndexMetadata
  records: WorkspaceJsonlIndexRecord[]
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value)
}

function boundedUtf8(value: string, byteLimit: number): string {
  const scanWindow =
    value.length > MAX_STRING_SCAN_CODE_UNITS ? value.slice(0, MAX_STRING_SCAN_CODE_UNITS) : value
  if (Buffer.byteLength(scanWindow) <= byteLimit) return scanWindow
  const result: string[] = []
  let bytes = 0
  for (const scalar of scanWindow) {
    const scalarBytes = utf8Bytes(scalar)
    if (bytes + scalarBytes > byteLimit) break
    result.push(scalar)
    bytes += scalarBytes
  }
  return result.join('')
}

function compactText(value: string): string | undefined {
  const compact = value.slice(0, MAX_STRING_SCAN_CODE_UNITS).replace(/\s+/gu, ' ').trim()
  const result = boundedUtf8(compact, MAX_SHORT_TEXT_BYTES)
  return result || undefined
}

function nodeText(node: SceneNode): string | undefined {
  if (node.type === 'TEXT') return compactText(node.text)
  if ('mermaidSource' in node && typeof node.mermaidSource === 'string') {
    return compactText(node.mermaidSource)
  }
  return undefined
}

function searchableText(node: SceneNode, text: string | undefined): string {
  return boundedUtf8(
    [node.id, node.name || node.id, node.type, text]
      .filter((value): value is string => typeof value === 'string' && Boolean(value))
      .join(' ')
      .normalize('NFKC')
      .toLocaleLowerCase('en-US'),
    MAX_SEARCHABLE_BYTES
  )
}

function finiteBounds(graph: SceneGraph, nodeId: string): Rect {
  const bounds = graph.getAbsoluteBounds(nodeId)
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    throw new TypeError(`Workspace JSONL index node "${nodeId}" has non-finite bounds.`)
  }
  return bounds
}

function unionBounds(bounds: readonly Rect[]): Rect | null {
  const first = bounds.at(0)
  if (!first) return null
  let minX = Math.min(first.x, first.x + first.width)
  let minY = Math.min(first.y, first.y + first.height)
  let maxX = Math.max(first.x, first.x + first.width)
  let maxY = Math.max(first.y, first.y + first.height)
  for (const bound of bounds.slice(1)) {
    minX = Math.min(minX, bound.x, bound.x + bound.width)
    minY = Math.min(minY, bound.y, bound.y + bound.height)
    maxX = Math.max(maxX, bound.x, bound.x + bound.width)
    maxY = Math.max(maxY, bound.y, bound.y + bound.height)
  }
  return { height: maxY - minY, width: maxX - minX, x: minX, y: minY }
}

function indexRecord(
  graph: SceneGraph,
  node: SceneNode,
  page: SceneNode,
  ownerId: string
): WorkspaceJsonlIndexRecord {
  const text = nodeText(node)
  const sourceNodeId = canonicalMemorySourceNodeId(node)
  return {
    bounds: finiteBounds(graph, node.id),
    canonicalObjectId: canonicalMemoryObjectId(node),
    id: node.id,
    kind: node.id === page.id ? 'page' : 'node',
    name: node.name || node.id,
    ownerId,
    pageId: page.id,
    pageName: page.name || page.id,
    parentId: node.parentId,
    searchable: searchableText(node, text),
    ...(sourceNodeId ? { sourceNodeId } : {}),
    ...(text ? { text } : {}),
    type: node.type
  }
}

function canonicalPageRecords(graph: SceneGraph): {
  pageCount: number
  records: WorkspaceJsonlIndexRecord[]
} {
  const root = graph.getNode(graph.rootId)
  if (!root) throw new TypeError('Workspace JSONL index root is missing.')

  const pages = root.childIds.flatMap((id) => {
    const node = graph.getNode(id)
    return node?.type === 'CANVAS' && node.parentId === root.id ? [node] : []
  })
  const indexed = new Set<string>()
  const records: WorkspaceJsonlIndexRecord[] = []

  for (const page of pages) {
    const pageRecordIndex = records.length
    const pending = [{ id: page.id, ownerId: page.id }]
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current || indexed.has(current.id)) continue
      const node = graph.getNode(current.id)
      if (!node) continue
      indexed.add(current.id)
      records.push(indexRecord(graph, node, page, current.ownerId))
      for (let index = node.childIds.length - 1; index >= 0; index--) {
        const childId = node.childIds[index]
        if (!childId) continue
        pending.push({
          id: childId,
          ownerId: node.id === page.id ? childId : current.ownerId
        })
      }
    }
    const contentRecords = records.slice(pageRecordIndex + 1)
    const contentBounds = unionBounds(contentRecords.map((record) => record.bounds))
    const pageRecord = records[pageRecordIndex]
    if (contentBounds) pageRecord.bounds = contentBounds

    const prototypeIds = new Map<string, string>()
    for (const record of contentRecords) {
      if (!prototypeIds.has(record.type)) prototypeIds.set(record.type, record.id)
    }
    if (prototypeIds.size > 0) {
      pageRecord.prototypeIds = Object.fromEntries(
        [...prototypeIds.entries()].sort(([left], [right]) => left.localeCompare(right))
      )
    }
  }

  return { pageCount: pages.length, records }
}

export type WorkspaceJsonlIndexPrevious = {
  document: unknown
  index: WorkspaceJsonlIndex
}

type IndexableNode = {
  childIds?: unknown
  flipX?: unknown
  flipY?: unknown
  height?: unknown
  mermaidSource?: unknown
  name?: unknown
  parentId?: unknown
  pluginData?: unknown
  rotation?: unknown
  text?: unknown
  type?: unknown
  width?: unknown
  x?: unknown
  y?: unknown
}

function nodeMap(document: unknown): Map<string, IndexableNode> | null {
  const pairs = nodePairs(document)
  if (!pairs) return null
  return new Map(pairs)
}

function sameIdList(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function localDelta(previous: IndexableNode, next: IndexableNode): { dx: number; dy: number } {
  return {
    dx: (finiteNumber(next.x) ?? 0) - (finiteNumber(previous.x) ?? 0),
    dy: (finiteNumber(next.y) ?? 0) - (finiteNumber(previous.y) ?? 0)
  }
}

function hasNonTranslationTransform(node: IndexableNode): boolean {
  const rotation = finiteNumber(node.rotation)
  return (rotation !== null && rotation !== 0) || node.flipX === true || node.flipY === true
}

function structureEquals(previous: IndexableNode, next: IndexableNode): boolean {
  return (
    previous.parentId === next.parentId &&
    previous.type === next.type &&
    previous.rotation === next.rotation &&
    previous.flipX === next.flipX &&
    previous.flipY === next.flipY &&
    sameIdList(previous.childIds, next.childIds)
  )
}

function indexNode(id: string, node: IndexableNode): SceneNode {
  return {
    id,
    mermaidSource: typeof node.mermaidSource === 'string' ? node.mermaidSource : undefined,
    name: typeof node.name === 'string' ? node.name : id,
    pluginData: Array.isArray(node.pluginData) ? node.pluginData : [],
    text: typeof node.text === 'string' ? node.text : '',
    type: typeof node.type === 'string' ? node.type : 'FRAME'
  } as SceneNode
}

function patchedRecord(
  record: WorkspaceJsonlIndexRecord,
  node: IndexableNode,
  dx: number,
  dy: number
): WorkspaceJsonlIndexRecord {
  const next = indexNode(record.id, node)
  const text = nodeText(next)
  const sourceNodeId = canonicalMemorySourceNodeId(next)
  const width = finiteNumber(node.width)
  const height = finiteNumber(node.height)
  const patched: WorkspaceJsonlIndexRecord = {
    ...record,
    bounds: {
      height: height ?? record.bounds.height,
      width: width ?? record.bounds.width,
      x: record.bounds.x + dx,
      y: record.bounds.y + dy
    },
    canonicalObjectId: canonicalMemoryObjectId(next),
    name: next.name || record.id,
    parentId:
      typeof node.parentId === 'string' || node.parentId === null ? node.parentId : record.parentId,
    searchable: searchableText(next, text),
    type: next.type
  }
  if (sourceNodeId) patched.sourceNodeId = sourceNodeId
  else delete patched.sourceNodeId
  if (text) patched.text = text
  else delete patched.text
  return patched
}

export function patchWorkspaceJsonlIndex(
  source: WorkspaceJsonlIndexSource,
  previous: WorkspaceJsonlIndexPrevious | null | undefined
): WorkspaceJsonlIndex | null {
  if (!previous) return null
  const previousMetadata = previous.index.metadata
  if (
    previousMetadata.contract !== WORKSPACE_JSONL_INDEX_CONTRACT ||
    previousMetadata.projectionVersion !== WORKSPACE_JSONL_INDEX_PROJECTION_VERSION ||
    previousMetadata.documentId !== source.identity.documentId ||
    previousMetadata.workspaceId !== source.identity.workspaceId ||
    previous.index.records.length !== previousMetadata.recordCount
  ) {
    return null
  }

  const previousNodes = nodeMap(previous.document)
  const nextNodes = nodeMap(source.document)
  const nextRootId =
    source.document && typeof source.document === 'object' && !Array.isArray(source.document)
      ? (source.document as { rootId?: unknown }).rootId
      : null
  if (
    !previousNodes ||
    !nextNodes ||
    typeof nextRootId !== 'string' ||
    nextRootId !== previousMetadata.rootId
  ) {
    return null
  }

  const records = previous.index.records
  const parentById = new Map(records.map((record) => [record.id, record.parentId] as const))
  for (const record of records) {
    const previousNode = previousNodes.get(record.id)
    const nextNode = nextNodes.get(record.id)
    if (!previousNode || !nextNode || !structureEquals(previousNode, nextNode)) return null
  }

  const ancestorDelta = new Map<string, { dx: number; dy: number }>()
  const deltaFor = (id: string): { dx: number; dy: number } => {
    const cached = ancestorDelta.get(id)
    if (cached) return cached
    const previousNode = previousNodes.get(id)
    const nextNode = nextNodes.get(id)
    if (!previousNode || !nextNode) {
      const empty = { dx: 0, dy: 0 }
      ancestorDelta.set(id, empty)
      return empty
    }
    if (
      (finiteNumber(nextNode.x) !== finiteNumber(previousNode.x) ||
        finiteNumber(nextNode.y) !== finiteNumber(previousNode.y) ||
        finiteNumber(nextNode.width) !== finiteNumber(previousNode.width) ||
        finiteNumber(nextNode.height) !== finiteNumber(previousNode.height)) &&
      (hasNonTranslationTransform(previousNode) || hasNonTranslationTransform(nextNode))
    ) {
      ancestorDelta.set(id, { dx: Number.NaN, dy: Number.NaN })
      return { dx: Number.NaN, dy: Number.NaN }
    }
    const local = localDelta(previousNode, nextNode)
    const parentId = parentById.get(id)
    const parent = parentId ? deltaFor(parentId) : { dx: 0, dy: 0 }
    const next = { dx: local.dx + parent.dx, dy: local.dy + parent.dy }
    ancestorDelta.set(id, next)
    return next
  }

  const nextRecords: WorkspaceJsonlIndexRecord[] = []
  const dirtyPageIds = new Set<string>()
  for (const record of records) {
    const nextNode = nextNodes.get(record.id)
    if (!nextNode) return null
    const delta = deltaFor(record.id)
    if (!Number.isFinite(delta.dx) || !Number.isFinite(delta.dy)) return null
    const patched = patchedRecord(record, nextNode, delta.dx, delta.dy)
    if (record.kind === 'page') patched.pageName = patched.name
    nextRecords.push(patched)
    if (
      patched.bounds.x !== record.bounds.x ||
      patched.bounds.y !== record.bounds.y ||
      patched.bounds.width !== record.bounds.width ||
      patched.bounds.height !== record.bounds.height ||
      patched.name !== record.name ||
      patched.searchable !== record.searchable
    ) {
      dirtyPageIds.add(record.pageId)
    }
  }

  for (const record of nextRecords) {
    if (record.kind === 'page' && dirtyPageIds.has(record.id)) {
      const contentBounds = unionBounds(
        nextRecords
          .filter((entry) => entry.pageId === record.id && entry.kind === 'node')
          .map((entry) => entry.bounds)
      )
      if (contentBounds) record.bounds = contentBounds
    }
    if (record.kind === 'node') {
      const page = nextRecords.find((entry) => entry.id === record.pageId)
      if (page) record.pageName = page.pageName
    }
  }

  return {
    metadata: {
      ...previousMetadata,
      contentHash: source.contentHash,
      recordCount: nextRecords.length,
      revision: source.revision
    },
    records: nextRecords
  }
}

export function prepareWorkspaceJsonlIndex(
  source: WorkspaceJsonlIndexSource,
  previous?: WorkspaceJsonlIndexPrevious | null
): WorkspaceJsonlIndex {
  return patchWorkspaceJsonlIndex(source, previous) ?? buildWorkspaceJsonlIndex(source)
}

export function buildWorkspaceJsonlIndex(source: WorkspaceJsonlIndexSource): WorkspaceJsonlIndex {
  const { graph } = readAuthorityBoardDocument(source.document, { hydrate: false })
  const { pageCount, records } = canonicalPageRecords(graph)
  return {
    metadata: {
      contentHash: source.contentHash,
      contract: WORKSPACE_JSONL_INDEX_CONTRACT,
      documentId: source.identity.documentId,
      kind: 'meta',
      pageCount,
      projectionVersion: WORKSPACE_JSONL_INDEX_PROJECTION_VERSION,
      recordCount: records.length,
      revision: source.revision,
      rootId: graph.rootId,
      workspaceId: source.identity.workspaceId
    },
    records
  }
}

export function serializeWorkspaceJsonlIndex(index: WorkspaceJsonlIndex): string {
  return `${[index.metadata, ...index.records].map((record) => JSON.stringify(record)).join('\n')}\n`
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isWorkspaceJsonlIndexMetadata(value: unknown): value is WorkspaceJsonlIndexMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const metadata = value as Partial<WorkspaceJsonlIndexMetadata>
  return (
    metadata.contract === WORKSPACE_JSONL_INDEX_CONTRACT &&
    metadata.kind === 'meta' &&
    isNonEmptyString(metadata.contentHash) &&
    isNonEmptyString(metadata.documentId) &&
    isNonEmptyString(metadata.rootId) &&
    isNonEmptyString(metadata.workspaceId) &&
    isNonNegativeInteger(metadata.pageCount) &&
    metadata.projectionVersion === WORKSPACE_JSONL_INDEX_PROJECTION_VERSION &&
    isNonNegativeInteger(metadata.recordCount) &&
    isNonNegativeInteger(metadata.revision)
  )
}

export function parseWorkspaceJsonlIndexMetadata(
  value: string
): WorkspaceJsonlIndexMetadata | null {
  const firstLine = value.split('\n', 1)[0]?.trim()
  if (!firstLine) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(firstLine) as unknown
  } catch {
    return null
  }
  return isWorkspaceJsonlIndexMetadata(parsed) ? parsed : null
}

export function workspaceJsonlIndexIsCurrent(
  metadata: unknown,
  source: Pick<WorkspaceJsonlIndexSource, 'contentHash' | 'identity' | 'revision'>
): boolean {
  if (!isWorkspaceJsonlIndexMetadata(metadata)) return false
  return (
    metadata.contentHash === source.contentHash &&
    metadata.documentId === source.identity.documentId &&
    metadata.revision === source.revision &&
    metadata.workspaceId === source.identity.workspaceId
  )
}

function isWorkspaceJsonlIndexRecord(value: unknown): value is WorkspaceJsonlIndexRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<WorkspaceJsonlIndexRecord>
  return Boolean(
    (record.kind === 'node' || record.kind === 'page') &&
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.type === 'string' &&
    typeof record.pageId === 'string' &&
    typeof record.pageName === 'string' &&
    typeof record.ownerId === 'string' &&
    typeof record.canonicalObjectId === 'string' &&
    typeof record.searchable === 'string'
  )
}

export function parseWorkspaceJsonlIndex(value: string): WorkspaceJsonlIndex | null {
  const lines = value.split('\n').filter(Boolean)
  const metadata = parseWorkspaceJsonlIndexMetadata(lines[0] ?? '')
  if (!metadata) return null
  const records = lines.slice(1).flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as unknown
      return isWorkspaceJsonlIndexRecord(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
  return records.length === metadata.recordCount ? { metadata, records } : null
}

export async function readWorkspaceJsonlIndex(
  rootPath: string
): Promise<WorkspaceJsonlIndex | null> {
  const filePath = path.join(rootPath, WORKSPACE_JSONL_INDEX_FILE)
  try {
    return parseWorkspaceJsonlIndex(await readFile(filePath, 'utf8'))
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code === 'ENOENT') return null
    throw error
  }
}

export async function writeWorkspaceJsonlIndex(
  rootPath: string,
  source: WorkspaceJsonlIndexSource,
  prepared = prepareWorkspaceJsonlIndex(source)
): Promise<WorkspaceJsonlIndexMetadata> {
  await writeBinaryFile(
    path.join(rootPath, WORKSPACE_JSONL_INDEX_FILE),
    UTF8_ENCODER.encode(serializeWorkspaceJsonlIndex(prepared))
  )
  return prepared.metadata
}

export async function ensureWorkspaceJsonlIndex(
  rootPath: string,
  source: WorkspaceJsonlIndexSource,
  previous?: WorkspaceJsonlIndexPrevious | null
): Promise<{ index?: WorkspaceJsonlIndex; metadata: WorkspaceJsonlIndexMetadata }> {
  const filePath = path.join(rootPath, WORKSPACE_JSONL_INDEX_FILE)
  try {
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(4_096)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const metadata = parseWorkspaceJsonlIndexMetadata(buffer.subarray(0, bytesRead).toString())
      if (metadata && workspaceJsonlIndexIsCurrent(metadata, source)) {
        if (previous?.index && workspaceJsonlIndexIsCurrent(previous.index.metadata, source)) {
          return { metadata, index: previous.index }
        }
        const loaded = await readWorkspaceJsonlIndex(rootPath)
        if (loaded && workspaceJsonlIndexIsCurrent(loaded.metadata, source)) {
          return { metadata, index: loaded }
        }
        return { metadata }
      }
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ENOENT') throw error
  }
  const index = prepareWorkspaceJsonlIndex(source, previous)
  return {
    index,
    metadata: await writeWorkspaceJsonlIndex(rootPath, source, index)
  }
}
