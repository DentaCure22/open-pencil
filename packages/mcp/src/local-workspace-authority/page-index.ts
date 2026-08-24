import path from 'node:path'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { writeJsonFile } from './json-file'

const WORKSPACE_PAGE_INDEX_FILE = 'workspace.index.json'
const WORKSPACE_PAGE_INDEX_CONTRACT = 'workspace-page-index/v1'

type WorkspacePageIndexEntry = {
  bounds?: Rect
  childCount: number
  descendantCount: number
  id: string
  name: string
  type: string
}

type WorkspacePageIndex = {
  contract: typeof WORKSPACE_PAGE_INDEX_CONTRACT
  generatedAt: string
  nodeCount: number
  pageCount: number
  pages: WorkspacePageIndexEntry[]
  revision: number
  rootId: string | null
  updatedAt: string | null
}

type IndexedNode = {
  childIds: string[]
  height: unknown
  name: string
  parentId: string | null
  type: string
  width: unknown
  x: unknown
  y: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function positiveRect(node: IndexedNode): Rect | undefined {
  const x = finiteNumber(node.x)
  const y = finiteNumber(node.y)
  const width = finiteNumber(node.width)
  const height = finiteNumber(node.height)
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined
  }
  return { height, width, x, y }
}

function unionRects(ids: readonly string[], rects: Map<string, Rect>): Rect | undefined {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const id of ids) {
    const rect = rects.get(id)
    if (!rect) continue
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  if (!Number.isFinite(minX)) return undefined
  return { height: maxY - minY, width: maxX - minX, x: minX, y: minY }
}

function indexNode(id: string, value: unknown): IndexedNode {
  const node = isRecord(value) ? value : {}
  return {
    childIds: Array.isArray(node.childIds)
      ? node.childIds.filter((childId): childId is string => typeof childId === 'string')
      : [],
    height: node.height,
    name: typeof node.name === 'string' && node.name ? node.name : id,
    parentId: typeof node.parentId === 'string' && node.parentId ? node.parentId : null,
    type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
    width: node.width,
    x: node.x,
    y: node.y
  }
}

export function buildWorkspacePageIndex(
  document: unknown,
  meta: { revision: number; updatedAt: string | null }
): WorkspacePageIndex {
  const source = isRecord(document) ? document : {}
  const rootId = typeof source.rootId === 'string' && source.rootId ? source.rootId : null
  const nodes = new Map<string, IndexedNode>()
  if (Array.isArray(source.nodes)) {
    for (const pair of source.nodes) {
      if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue
      nodes.set(pair[0], indexNode(pair[0], pair[1]))
    }
  }
  const rects = new Map<string, Rect>()
  for (const [id, node] of nodes) {
    const rect = positiveRect(node)
    if (rect) rects.set(id, rect)
  }
  const pages = [...nodes]
    .filter(([, node]) => node.type === 'CANVAS' && node.parentId === rootId)
    .map(([id, node]): WorkspacePageIndexEntry => {
      const children =
        node.childIds.length > 0
          ? node.childIds
          : [...nodes].filter(([, child]) => child.parentId === id).map(([childId]) => childId)
      const bounds = positiveRect(node) ?? unionRects(children, rects)
      return {
        ...(bounds ? { bounds } : {}),
        childCount: node.childIds.length,
        descendantCount: descendantCount(id, nodes),
        id,
        name: node.name,
        type: node.type
      }
    })
  pages.sort(
    (first, second) => first.name.localeCompare(second.name) || first.id.localeCompare(second.id)
  )
  return {
    contract: WORKSPACE_PAGE_INDEX_CONTRACT,
    generatedAt: new Date().toISOString(),
    nodeCount: nodes.size,
    pageCount: pages.length,
    pages,
    revision: meta.revision,
    rootId,
    updatedAt: meta.updatedAt
  }
}

function descendantCount(startId: string, nodes: Map<string, IndexedNode>): number {
  let count = 0
  const visited = new Set([startId])
  const queue = [...(nodes.get(startId)?.childIds ?? [])]
  while (queue.length > 0) {
    const id = queue.pop()
    if (id === undefined || visited.has(id)) continue
    visited.add(id)
    count += 1
    queue.push(...(nodes.get(id)?.childIds ?? []))
  }
  return count
}

export async function writeWorkspacePageIndex(
  rootPath: string,
  document: unknown,
  meta: { revision: number; updatedAt: string | null }
): Promise<void> {
  await writeJsonFile(
    path.join(rootPath, WORKSPACE_PAGE_INDEX_FILE),
    buildWorkspacePageIndex(document, meta),
    { space: 0 }
  )
}
