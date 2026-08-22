import { Buffer } from 'node:buffer'
import { open } from 'node:fs/promises'
import path from 'node:path'

import { canonicalMemoryObjectId, canonicalMemorySourceNodeId } from '@open-pencil/core/tools'
import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { readAuthorityBoardDocument } from './document'
import { writeBinaryFile } from './json-file'
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
  return UTF8_ENCODER.encode(value).length
}

function boundedUtf8(value: string, byteLimit: number): string {
  const scanWindow = value.slice(0, MAX_STRING_SCAN_CODE_UNITS)
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

export function buildWorkspaceJsonlIndex(source: WorkspaceJsonlIndexSource): WorkspaceJsonlIndex {
  const { graph } = readAuthorityBoardDocument(source.document)
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

export async function writeWorkspaceJsonlIndex(
  rootPath: string,
  source: WorkspaceJsonlIndexSource,
  prepared = buildWorkspaceJsonlIndex(source)
): Promise<WorkspaceJsonlIndexMetadata> {
  await writeBinaryFile(
    path.join(rootPath, WORKSPACE_JSONL_INDEX_FILE),
    UTF8_ENCODER.encode(serializeWorkspaceJsonlIndex(prepared))
  )
  return prepared.metadata
}

export async function ensureWorkspaceJsonlIndex(
  rootPath: string,
  source: WorkspaceJsonlIndexSource
): Promise<WorkspaceJsonlIndexMetadata> {
  const filePath = path.join(rootPath, WORKSPACE_JSONL_INDEX_FILE)
  try {
    const handle = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(4_096)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const metadata = parseWorkspaceJsonlIndexMetadata(buffer.subarray(0, bytesRead).toString())
      if (metadata && workspaceJsonlIndexIsCurrent(metadata, source)) return metadata
    } finally {
      await handle.close()
    }
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ENOENT') throw error
  }
  return writeWorkspaceJsonlIndex(rootPath, source)
}
