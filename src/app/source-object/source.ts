import { readContentSource, type ContentSourceMetadata } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

const PLUGIN_ID = 'open-pencil-source-object'
const KIND_KEY = 'kind'
const KIND = 'downloadable-source'
const BYTE_LENGTH_KEY = 'byte-length'

const EXTENSION_MIME_TYPES = new Map<string, string>([
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['key', 'application/vnd.apple.keynote'],
  ['numbers', 'application/vnd.apple.numbers'],
  ['pages', 'application/vnd.apple.pages'],
  ['ppt', 'application/vnd.ms-powerpoint'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['rtf', 'application/rtf'],
  ['tar', 'application/x-tar'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['zip', 'application/zip']
])

export type SourceObjectSource = {
  assetHash: string
  byteLength: number | null
  fileName: string
  metadata: ContentSourceMetadata
}

export function sourceObjectExtension(fileName: string): string {
  return fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

export function sourceObjectMimeType(file: Pick<File, 'name' | 'type'>): string {
  const declared = file.type.trim()
  if (declared) return declared
  return EXTENSION_MIME_TYPES.get(sourceObjectExtension(file.name)) ?? 'application/octet-stream'
}

export function sourceObjectFormat(fileName: string): string {
  return sourceObjectExtension(fileName) || 'binary'
}

export function sourceObjectPluginData(byteLength: number): SceneNode['pluginData'] {
  return [
    { pluginId: PLUGIN_ID, key: KIND_KEY, value: KIND },
    { pluginId: PLUGIN_ID, key: BYTE_LENGTH_KEY, value: String(byteLength) }
  ]
}

export function sourceObjectSource(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): SourceObjectSource | null {
  if (
    !node ||
    !node.pluginData.some(
      (entry) => entry.pluginId === PLUGIN_ID && entry.key === KIND_KEY && entry.value === KIND
    )
  ) {
    return null
  }
  const metadata = readContentSource(node)
  if (!metadata) return null
  const assetHash = assetHashFromReference(metadata.source)
  if (!assetHash) return null
  const byteLengthValue = node.pluginData.find(
    (entry) => entry.pluginId === PLUGIN_ID && entry.key === BYTE_LENGTH_KEY
  )?.value
  const byteLength = byteLengthValue ? Number.parseInt(byteLengthValue, 10) : Number.NaN
  return {
    assetHash,
    byteLength: Number.isSafeInteger(byteLength) && byteLength >= 0 ? byteLength : null,
    fileName: metadata.fileName ?? 'Untitled file',
    metadata
  }
}

export function isSourceObjectNode(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): boolean {
  return sourceObjectSource(node) !== null
}
