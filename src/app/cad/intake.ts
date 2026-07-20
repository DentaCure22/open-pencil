import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import { assetReference } from '@open-pencil/scene-graph/images'

import {
  placeSourceBackedFrames,
  readStoredSourceAsset
} from '@/app/file-intake/source-backed-frames'

import { classifyCadFile } from './classify'
import { cadDrawingPluginData, cadDrawingSource } from './source'

const VIEWER_WIDTH = 720
const VIEWER_HEIGHT = 480
const VIEWER_GAP = 32

type PreparedCadDrawing = {
  bytes: Uint8Array
  fileName: string
  hash: string
  mimeType: string
}

async function prepareDrawing(file: File): Promise<PreparedCadDrawing> {
  const classification = classifyCadFile(file)
  if (classification?.disposition !== 'cad-viewer') {
    throw new Error(`${file.name || 'Untitled source'} is not eligible for the DXF viewer.`)
  }
  return {
    ...(await readStoredSourceAsset(file, 'Untitled.dxf')),
    mimeType: file.type.trim() || 'image/vnd.dxf'
  }
}

export async function placeCadDrawingFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<string[]> {
  const prepared = files.length === 0 ? [] : await Promise.all(files.map(prepareDrawing))
  return placeSourceBackedFrames({
    center: { x: cx, y: cy },
    editor,
    gap: VIEWER_GAP,
    isOccupied: (node) => cadDrawingSource(node) !== null,
    items: prepared,
    labels: { plural: 'Place CAD drawings', singular: 'Place CAD drawing' },
    presentation: {
      fillColor: { a: 1, b: 0.065, g: 0.059, r: 0.047 },
      name: (item) => item.fileName.replace(/\.[^.]+$/, '') || item.fileName,
      pluginData: (item) => [
        ...cadDrawingPluginData(),
        ...contentSourcePluginData({
          fileName: item.fileName,
          format: 'dxf',
          mimeType: item.mimeType,
          revision: CONTENT_SOURCE_REVISION,
          source: assetReference(item.hash)
        })
      ],
      strokeColor: { a: 0.55, b: 0.32, g: 0.4, r: 0.23 }
    },
    size: { height: VIEWER_HEIGHT, width: VIEWER_WIDTH }
  })
}
