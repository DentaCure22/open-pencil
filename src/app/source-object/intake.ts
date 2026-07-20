import type { Editor } from '@open-pencil/core/editor'
import {
  CONTENT_SOURCE_REVISION,
  contentSourcePluginData,
  readContentSource
} from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import {
  assetHashFromReference,
  assetReference,
  computeImageHash
} from '@open-pencil/scene-graph/images'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  sourceObjectFormat,
  sourceObjectMimeType,
  sourceObjectPluginData,
  sourceObjectSource
} from './source'

export const SOURCE_OBJECT_SIZE = { height: 190, width: 460 }

const SOURCE_OBJECT_GAP = 28
const CASCADE_ATTEMPTS = 24
const CASCADE_OVERLAP_THRESHOLD = 0.9

type PreparedSourceObject = {
  bytes: Uint8Array
  fileName: string
  format: string
  hash: string
  mimeType: string
}

function setSelection(editor: Editor, ids: string[]) {
  if (ids.length > 0) editor.select(ids)
  else editor.clearSelection()
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
  return (
    referenceArea > 0 && sharedWidth * sharedHeight >= referenceArea * CASCADE_OVERLAP_THRESHOLD
  )
}

function placementIsAvailable(candidate: Rect, occupied: Rect[]): boolean {
  return occupied.every((bounds) => !sharesMostArea(candidate, bounds))
}

function placementFor(editor: Editor, initial: Rect): Rect {
  const occupied = editor.graph
    .getChildren(editor.state.currentPageId)
    .filter((node) => sourceObjectSource(node) !== null)
    .map((node) => ({ height: node.height, width: node.width, x: node.x, y: node.y }))

  let candidate = initial
  for (let attempt = 0; attempt < CASCADE_ATTEMPTS; attempt++) {
    if (placementIsAvailable(candidate, occupied)) return candidate
    const offset = SOURCE_OBJECT_GAP * (attempt + 1)
    candidate = { ...initial, x: initial.x + offset, y: initial.y + offset }
  }
  return candidate
}

function assetIsReferenced(editor: Editor, hash: string): boolean {
  for (const node of editor.graph.getAllNodes()) {
    const contentSource = readContentSource(node)
    if (contentSource && assetHashFromReference(contentSource.source) === hash) return true
    if (node.fills.some((fill) => fill.imageHash === hash)) return true
  }
  return false
}

async function prepareSourceObject(file: File): Promise<PreparedSourceObject> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const fileName = file.name.trim() || 'Untitled source'
  return {
    bytes,
    fileName,
    format: sourceObjectFormat(fileName),
    hash: computeImageHash(bytes),
    mimeType: sourceObjectMimeType(file)
  }
}

function restoreSnapshot(editor: Editor, snapshot: SceneNode) {
  editor.graph.createNodeWithId(
    snapshot.id,
    snapshot.type,
    snapshot.parentId ?? editor.state.currentPageId,
    { ...structuredClone(snapshot), childIds: [] }
  )
}

export async function placeSourceObjectFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<string[]> {
  if (files.length === 0) return []
  const prepared = await Promise.all(files.map(prepareSourceObject))
  const previousSelection = [...editor.state.selectedIds]
  const pageId = editor.state.currentPageId
  const totalWidth =
    SOURCE_OBJECT_SIZE.width * prepared.length + SOURCE_OBJECT_GAP * (prepared.length - 1)
  const placement = placementFor(editor, {
    height: SOURCE_OBJECT_SIZE.height,
    width: totalWidth,
    x: cx - totalWidth / 2,
    y: cy - SOURCE_OBJECT_SIZE.height / 2
  })
  const snapshots: SceneNode[] = []

  for (const [index, item] of prepared.entries()) {
    editor.graph.images.set(item.hash, item.bytes)
    const node = editor.graph.createNode('FRAME', pageId, {
      clipsContent: true,
      cornerRadius: 12,
      fills: [
        {
          color: { a: 1, b: 0.075, g: 0.071, r: 0.063 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ],
      height: SOURCE_OBJECT_SIZE.height,
      name: item.fileName,
      pluginData: [
        ...sourceObjectPluginData(item.bytes.byteLength),
        ...contentSourcePluginData({
          fileName: item.fileName,
          format: item.format,
          mimeType: item.mimeType,
          revision: CONTENT_SOURCE_REVISION,
          source: assetReference(item.hash)
        })
      ],
      strokes: [
        {
          align: 'INSIDE',
          color: { a: 0.55, b: 0.44, g: 0.36, r: 0.34 },
          opacity: 1,
          visible: true,
          weight: 1
        }
      ],
      width: SOURCE_OBJECT_SIZE.width,
      x: placement.x + index * (SOURCE_OBJECT_SIZE.width + SOURCE_OBJECT_GAP),
      y: placement.y
    })
    snapshots.push(structuredClone(node))
  }

  const ids = snapshots.map((snapshot) => snapshot.id)
  setSelection(editor, ids)
  editor.undo.push({
    label: files.length === 1 ? 'Place source file' : 'Place source files',
    forward: () => {
      for (const item of prepared) editor.graph.images.set(item.hash, item.bytes)
      for (const snapshot of snapshots) restoreSnapshot(editor, snapshot)
      setSelection(editor, ids)
      editor.requestRender()
    },
    inverse: () => {
      for (const id of ids) editor.graph.deleteNode(id)
      for (const item of prepared) {
        if (!assetIsReferenced(editor, item.hash)) editor.graph.images.delete(item.hash)
      }
      setSelection(editor, previousSelection)
      editor.requestRender()
    }
  })
  editor.requestRender()
  return ids
}
