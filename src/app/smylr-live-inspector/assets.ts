import { toRaw } from 'vue'

import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'

import { smylrLiveContainerToSceneGraph } from '@/app/smylr-live-container'
import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode
} from '@/app/smylr-live-container/types'

export type SmylrLiveComponentAsset = {
  id: string
  name: string
  node: SmylrLiveContainerNode
  sourcePath: string | null
}

function cloneLiveValue<T>(value: T): T {
  return structuredClone(toRaw(value))
}

function sourceKey(node: SmylrLiveContainerNode) {
  const componentName = node.source?.componentName
  if (!componentName) return null
  return `${componentName}|${node.source?.filePath ?? ''}`
}

function nodeArea(node: SmylrLiveContainerNode) {
  return Math.max(node.rect.width, 0) * Math.max(node.rect.height, 0)
}

function componentSlotName(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

/**
 * Storybook primitives expose stable data-slot roots even when production
 * React strips owner metadata. Resolve that real computed root without making
 * data-slot nodes into assets on normal application pages.
 */
export function findSmylrComputedComponentAsset(
  document: SmylrLiveContainerDocument,
  name: string,
  sourcePath: string
): SmylrLiveComponentAsset | null {
  const expectedSlot = componentSlotName(name)
  const exact: SmylrLiveContainerNode[] = []
  const related: SmylrLiveContainerNode[] = []

  const largest = (nodes: SmylrLiveContainerNode[]): SmylrLiveContainerNode | null =>
    nodes.reduce<SmylrLiveContainerNode | null>(
      (current, candidate) =>
        !current || nodeArea(candidate) > nodeArea(current) ? candidate : current,
      null
    )

  const visit = (node: SmylrLiveContainerNode) => {
    const slot = node.attrs?.['data-slot']?.toLowerCase()
    if (slot === expectedSlot) exact.push(node)
    else if (slot?.startsWith(`${expectedSlot}-`)) {
      related.push(node)
    }
    for (const child of node.children ?? []) visit(child)
  }

  visit(document.tree)
  const node = largest(exact) ?? largest(related)
  if (!node) return null
  return {
    id: `smylr-computed:${expectedSlot}:${node.id}`,
    name,
    node,
    sourcePath
  }
}

/** Collect one useful rendered representative for each component owner on the live page. */
export function collectSmylrLiveComponentAssets(
  document: SmylrLiveContainerDocument | null
): SmylrLiveComponentAsset[] {
  if (!document) return []

  const bySource = new Map<string, SmylrLiveComponentAsset>()
  const visit = (node: SmylrLiveContainerNode) => {
    const key = sourceKey(node)
    const name = node.source?.componentName
    if (key && name) {
      const current = bySource.get(key)
      if (!current || nodeArea(node) > nodeArea(current.node)) {
        bySource.set(key, {
          id: `smylr-live:${key}`,
          name,
          node,
          sourcePath: node.source?.filePath ?? null
        })
      }
    }
    for (const child of node.children ?? []) visit(child)
  }

  visit(document.tree)
  return [...bySource.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Convert the captured component subtree directly into native OpenPencil clipboard nodes. */
export function buildSmylrLiveComponentClipboardHtml(
  document: SmylrLiveContainerDocument,
  asset: SmylrLiveComponentAsset
): string | null {
  const tree = cloneLiveValue(asset.node)
  tree.rect = { ...tree.rect, x: 0, y: 0 }
  const graph = smylrLiveContainerToSceneGraph({
    capturedAt: document.capturedAt,
    route: document.route,
    selectedId: tree.id,
    semanticTokenCatalog: document.semanticTokenCatalog
      ? cloneLiveValue(document.semanticTokenCatalog)
      : undefined,
    title: asset.name,
    tree
  })
  const nativeNode = [...graph.nodes.values()].find((candidate) => candidate.name === tree.id)
  if (!nativeNode) return null
  nativeNode.name = asset.name
  return buildOpenPencilClipboardHTML([nativeNode], graph)
}
