import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { rectIntersectionRatio } from '@open-pencil/scene-graph/geometry'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'
import type { Rect } from '@open-pencil/scene-graph/primitives'

import { codeObjectPluginData, createPdfDocumentDocument } from '@/app/code-object/model'
import { hasAssetReference } from '@/app/media-evidence/assets'

const PDF_WIDTH = 720
const PDF_HEIGHT = 520
const PDF_CASCADE = 32
const PDF_CASCADE_ATTEMPTS = 24

type CreatedPdf = {
  assetHash: string
  bytes: Uint8Array
  root: SceneNode
  snapshot: SceneNode
}

function placement(editor: Editor, cx: number, cy: number, offset: number): Rect {
  const pageId = editor.state.currentPageId
  const initial = {
    height: PDF_HEIGHT,
    width: PDF_WIDTH,
    x: cx - PDF_WIDTH / 2 + offset * PDF_CASCADE,
    y: cy - PDF_HEIGHT / 2 + offset * PDF_CASCADE
  }
  const occupied = editor.graph
    .getChildren(pageId)
    .map((node) => ({ height: node.height, width: node.width, x: node.x, y: node.y }))
  let candidate = initial
  for (let attempt = 0; attempt < PDF_CASCADE_ATTEMPTS; attempt++) {
    let overlaps = false
    for (const bounds of occupied) {
      if (rectIntersectionRatio(candidate, bounds) >= 0.94) {
        overlaps = true
        break
      }
    }
    if (!overlaps) return candidate
    candidate = {
      ...initial,
      x: initial.x + (attempt + 1) * PDF_CASCADE,
      y: initial.y + (attempt + 1) * PDF_CASCADE
    }
  }
  return candidate
}

function restoreSnapshot(editor: Editor, snapshot: SceneNode) {
  if (editor.graph.getNode(snapshot.id)) return
  const { childIds: _childIds, id, parentId, ...overrides } = structuredClone(snapshot)
  editor.graph.createNodeWithId(id, snapshot.type, parentId ?? editor.state.currentPageId, {
    ...overrides,
    childIds: []
  })
}

async function createPdf(
  editor: Editor,
  file: File,
  cx: number,
  cy: number,
  offset: number
): Promise<CreatedPdf> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const assetHash = computeImageHash(bytes)
  const fileName = file.name.trim() || 'Untitled.pdf'
  const bounds = placement(editor, cx, cy, offset)
  const root = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    clipsContent: true,
    cornerRadius: 12,
    fills: [],
    height: bounds.height,
    name: fileName.replace(/\.pdf$/i, '') || fileName,
    pluginData: contentSourcePluginData({
      fileName,
      format: 'pdf',
      mimeType: file.type || 'application/pdf',
      revision: CONTENT_SOURCE_REVISION,
      source: assetReference(assetHash)
    }),
    strokes: [],
    width: bounds.width,
    x: bounds.x,
    y: bounds.y
  })
  editor.graph.updateNode(root.id, {
    pluginData: codeObjectPluginData(root, createPdfDocumentDocument())
  })
  editor.graph.images.set(assetHash, bytes)
  const persistedRoot = editor.graph.getNode(root.id) ?? root
  return {
    assetHash,
    bytes,
    root: persistedRoot,
    snapshot: structuredClone(persistedRoot)
  }
}

export function isPdfFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type.toLowerCase() === 'application/pdf'
}

export async function placePdfFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<string[]> {
  const pdfFiles = files.filter(isPdfFile)
  if (pdfFiles.length === 0) return []
  const previousSelection = [...editor.state.selectedIds]
  const created: CreatedPdf[] = []
  for (const [index, file] of pdfFiles.entries()) {
    created.push(await createPdf(editor, file, cx, cy, index))
  }
  const ids = created.map(({ root }) => root.id)
  editor.select(ids)
  editor.undo.push({
    forward: () => {
      for (const item of created) {
        editor.graph.images.set(item.assetHash, item.bytes)
        restoreSnapshot(editor, item.snapshot)
      }
      editor.select(ids)
      editor.requestRender()
    },
    inverse: () => {
      for (const id of ids) editor.graph.deleteNode(id)
      for (const item of created) {
        if (!hasAssetReference(editor, item.assetHash)) {
          editor.graph.images.delete(item.assetHash)
        }
      }
      if (previousSelection.length > 0) editor.select(previousSelection)
      else editor.clearSelection()
      editor.requestRender()
    },
    label: ids.length === 1 ? 'Place PDF Code Object' : 'Place PDF Code Objects'
  })
  editor.requestRender()
  return ids
}
