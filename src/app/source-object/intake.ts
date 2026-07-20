import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import { assetReference } from '@open-pencil/scene-graph/images'

import {
  placeSourceBackedFrames,
  readStoredSourceAsset
} from '@/app/file-intake/source-backed-frames'

import {
  sourceObjectFormat,
  sourceObjectMimeType,
  sourceObjectPluginData,
  sourceObjectSource
} from './source'

export const SOURCE_OBJECT_SIZE = { height: 190, width: 460 }

const SOURCE_OBJECT_GAP = 28

type PreparedSourceObject = {
  bytes: Uint8Array
  fileName: string
  format: string
  hash: string
  mimeType: string
}

async function prepareSourceObject(file: File): Promise<PreparedSourceObject> {
  const source = await readStoredSourceAsset(file, 'Untitled source')
  return {
    ...source,
    format: sourceObjectFormat(source.fileName),
    mimeType: sourceObjectMimeType(file)
  }
}

export async function placeSourceObjectFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<string[]> {
  if (files.length === 0) return []
  const prepared = await Promise.all(files.map(prepareSourceObject))
  return placeSourceBackedFrames({
    center: { x: cx, y: cy },
    editor,
    gap: SOURCE_OBJECT_GAP,
    isOccupied: (node) => sourceObjectSource(node) !== null,
    items: prepared,
    labels: { plural: 'Place source files', singular: 'Place source file' },
    presentation: {
      fillColor: { a: 1, b: 0.075, g: 0.071, r: 0.063 },
      name: (item) => item.fileName,
      pluginData: (item) => [
        ...sourceObjectPluginData(item.bytes.byteLength),
        ...contentSourcePluginData({
          fileName: item.fileName,
          format: item.format,
          mimeType: item.mimeType,
          revision: CONTENT_SOURCE_REVISION,
          source: assetReference(item.hash)
        })
      ],
      strokeColor: { a: 0.55, b: 0.44, g: 0.36, r: 0.34 }
    },
    size: SOURCE_OBJECT_SIZE
  })
}
