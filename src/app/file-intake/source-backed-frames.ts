import type { Editor } from '@open-pencil/core/editor'
import { readContentSource } from '@open-pencil/core/io'
import type { Color, SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference, computeImageHash } from '@open-pencil/scene-graph/images'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

const CASCADE_ATTEMPTS = 24
const OVERLAP_THRESHOLD = 0.9

export type StoredSourceAsset = {
  bytes: Uint8Array
  fileName: string
  hash: string
}

export type SourceBackedFrameOptions<Item extends StoredSourceAsset> = {
  center: Vector
  editor: Editor
  gap: number
  isOccupied: (node: SceneNode) => boolean
  items: Item[]
  labels: { plural: string; singular: string }
  presentation: {
    fillColor: Color
    name: (item: Item) => string
    pluginData: (item: Item) => SceneNode['pluginData']
    strokeColor: Color
  }
  size: { height: number; width: number }
}

function sharesMostArea(first: Rect, second: Rect): boolean {
  const sharedWidth = Math.max(
    0,
    Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x)
  )
  const sharedHeight = Math.max(
    0,
    Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y)
  )
  const referenceArea = Math.min(first.width * first.height, second.width * second.height)
  return referenceArea > 0 && sharedWidth * sharedHeight >= referenceArea * OVERLAP_THRESHOLD
}

function findPlacement<Item extends StoredSourceAsset>(
  options: SourceBackedFrameOptions<Item>
): Rect {
  const { center, editor, gap, isOccupied, items, size } = options
  const totalWidth = size.width * items.length + gap * Math.max(0, items.length - 1)
  const origin = {
    height: size.height,
    width: totalWidth,
    x: center.x - totalWidth / 2,
    y: center.y - size.height / 2
  }
  const occupied = editor.graph
    .getChildren(editor.state.currentPageId)
    .filter(isOccupied)
    .map((node) => ({ height: node.height, width: node.width, x: node.x, y: node.y }))

  for (let attempt = 0; attempt < CASCADE_ATTEMPTS; attempt++) {
    const offset = attempt * gap
    const candidate = { ...origin, x: origin.x + offset, y: origin.y + offset }
    if (occupied.every((bounds) => !sharesMostArea(candidate, bounds))) return candidate
  }
  return origin
}

function selectNodes(editor: Editor, ids: string[]): void {
  if (ids.length === 0) editor.clearSelection()
  else editor.select(ids)
}

function assetRemainsReferenced(editor: Editor, hash: string): boolean {
  for (const node of editor.graph.getAllNodes()) {
    const source = readContentSource(node)
    if (
      (source !== null && assetHashFromReference(source.source) === hash) ||
      node.fills.some((fill) => fill.imageHash === hash)
    ) {
      return true
    }
  }
  return false
}

export async function readStoredSourceAsset(
  file: File,
  fallbackFileName: string
): Promise<StoredSourceAsset> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    bytes,
    fileName: file.name.trim() || fallbackFileName,
    hash: computeImageHash(bytes)
  }
}

function restoreSnapshot(editor: Editor, snapshot: SceneNode, pageId: string): void {
  editor.graph.createNodeWithId(snapshot.id, snapshot.type, snapshot.parentId ?? pageId, {
    ...structuredClone(snapshot),
    childIds: []
  })
}

export function placeSourceBackedFrames<Item extends StoredSourceAsset>(
  options: SourceBackedFrameOptions<Item>
): string[] {
  const { editor, gap, items, labels, presentation, size } = options
  if (items.length === 0) return []

  const pageId = editor.state.currentPageId
  const previousSelection = [...editor.state.selectedIds]
  const placement = findPlacement(options)
  const snapshots = items.map((item, index) => {
    editor.graph.images.set(item.hash, item.bytes)
    const position = {
      x: placement.x + index * (size.width + gap),
      y: placement.y
    }
    return structuredClone(
      editor.graph.createNode('FRAME', pageId, {
        clipsContent: true,
        cornerRadius: 12,
        fills: [
          {
            color: presentation.fillColor,
            opacity: 1,
            type: 'SOLID',
            visible: true
          }
        ],
        height: size.height,
        name: presentation.name(item),
        pluginData: presentation.pluginData(item),
        strokes: [
          {
            align: 'INSIDE',
            color: presentation.strokeColor,
            opacity: 1,
            visible: true,
            weight: 1
          }
        ],
        width: size.width,
        ...position
      })
    )
  })
  const ids = snapshots.map((snapshot) => snapshot.id)

  selectNodes(editor, ids)
  editor.undo.push({
    label: items.length === 1 ? labels.singular : labels.plural,
    forward: () => {
      for (const item of items) editor.graph.images.set(item.hash, item.bytes)
      for (const snapshot of snapshots) restoreSnapshot(editor, snapshot, pageId)
      selectNodes(editor, ids)
      editor.requestRender()
    },
    inverse: () => {
      for (const id of ids) editor.graph.deleteNode(id)
      for (const item of items) {
        if (!assetRemainsReferenced(editor, item.hash)) editor.graph.images.delete(item.hash)
      }
      selectNodes(editor, previousSelection)
      editor.requestRender()
    }
  })
  editor.requestRender()
  return ids
}
