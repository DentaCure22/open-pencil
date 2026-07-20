import { readContentSource, type ContentSourceMetadata } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

export type MediaEvidenceKind = 'audio' | 'pdf' | 'video'
export type MediaIntakeKind = MediaEvidenceKind | 'raster'

const RASTER_MIME_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp'
])

const RASTER_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp'])

const MIME_KIND = new Map<string, MediaEvidenceKind>([
  ['application/pdf', 'pdf'],
  ['video/mp4', 'video'],
  ['video/ogg', 'video'],
  ['video/quicktime', 'video'],
  ['video/webm', 'video'],
  ['audio/aac', 'audio'],
  ['audio/flac', 'audio'],
  ['audio/mp4', 'audio'],
  ['audio/mpeg', 'audio'],
  ['audio/ogg', 'audio'],
  ['audio/wav', 'audio'],
  ['audio/webm', 'audio'],
  ['audio/x-wav', 'audio']
])

const EXTENSION_KIND = new Map<string, MediaIntakeKind>([
  ['aac', 'audio'],
  ['avif', 'raster'],
  ['flac', 'audio'],
  ['gif', 'raster'],
  ['jpeg', 'raster'],
  ['jpg', 'raster'],
  ['m4a', 'audio'],
  ['mov', 'video'],
  ['mp3', 'audio'],
  ['mp4', 'video'],
  ['oga', 'audio'],
  ['ogg', 'audio'],
  ['ogv', 'video'],
  ['pdf', 'pdf'],
  ['png', 'raster'],
  ['wav', 'audio'],
  ['webm', 'video'],
  ['webp', 'raster']
])

const EXTENSION_MIME = new Map<string, string>([
  ['aac', 'audio/aac'],
  ['flac', 'audio/flac'],
  ['m4a', 'audio/mp4'],
  ['mov', 'video/quicktime'],
  ['mp3', 'audio/mpeg'],
  ['mp4', 'video/mp4'],
  ['oga', 'audio/ogg'],
  ['ogg', 'audio/ogg'],
  ['ogv', 'video/ogg'],
  ['pdf', 'application/pdf'],
  ['wav', 'audio/wav'],
  ['webm', 'video/webm']
])

const FALLBACK_MIME = {
  audio: 'audio/mpeg',
  pdf: 'application/pdf',
  video: 'video/mp4'
} satisfies Record<MediaEvidenceKind, string>

export type MediaEvidenceSource = {
  assetHash: string
  fileName: string
  kind: MediaEvidenceKind
  metadata: ContentSourceMetadata
}

export function fileExtension(fileName: string): string {
  return fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? ''
}

export function mediaIntakeKind(file: Pick<File, 'name' | 'type'>): MediaIntakeKind | null {
  const mimeType = file.type.toLowerCase()
  if (RASTER_MIME_TYPES.has(mimeType)) return 'raster'
  const mimeKind = MIME_KIND.get(mimeType)
  if (mimeKind) return mimeKind
  const extension = fileExtension(file.name)
  if (RASTER_EXTENSIONS.has(extension)) return 'raster'
  return EXTENSION_KIND.get(extension) ?? null
}

export function mediaEvidenceMimeType(
  file: Pick<File, 'name' | 'type'>,
  kind: MediaEvidenceKind
): string {
  const mimeType = file.type.toLowerCase()
  if (MIME_KIND.get(mimeType) === kind) return mimeType
  const extensionMime = EXTENSION_MIME.get(fileExtension(file.name))
  if (extensionMime && MIME_KIND.get(extensionMime) === kind) return extensionMime
  return FALLBACK_MIME[kind]
}

export function mediaEvidenceSource(
  node: Pick<SceneNode, 'pluginData'>
): MediaEvidenceSource | null {
  const metadata = readContentSource(node)
  if (!metadata) return null
  const kind = MIME_KIND.get(metadata.mimeType.toLowerCase())
  if (!kind) return null
  const assetHash = assetHashFromReference(metadata.source)
  if (!assetHash) return null
  return {
    assetHash,
    fileName: metadata.fileName ?? 'Untitled media',
    kind,
    metadata
  }
}

export function isSupportedMediaFile(file: Pick<File, 'name' | 'type'>): boolean {
  return mediaIntakeKind(file) !== null
}

export function mediaEvidenceFrameSize(kind: MediaEvidenceKind): {
  height: number
  width: number
} {
  switch (kind) {
    case 'pdf':
      return { height: 520, width: 720 }
    case 'video':
      return { height: 398, width: 640 }
    case 'audio':
      return { height: 168, width: 560 }
  }
  throw new Error('Unsupported media evidence kind')
}
