import type { SceneNode } from '@open-pencil/scene-graph'

import { sourceObjectSource } from '@/app/source-object/source'

import type { OfficeDocumentKind, OfficeDocumentSource } from './types'

const OFFICE_MIME_KINDS = new Map<string, OfficeDocumentKind>([
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx']
])

const OFFICE_KINDS = new Set<OfficeDocumentKind>(['docx', 'pptx', 'xlsx'])

export function officeDocumentKind(fileName: string): OfficeDocumentKind | null {
  const extension = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  return extension && OFFICE_KINDS.has(extension as OfficeDocumentKind)
    ? (extension as OfficeDocumentKind)
    : null
}

export function isOfficeDocumentFile(file: Pick<File, 'name' | 'type'>): boolean {
  return officeDocumentKind(file.name) !== null || OFFICE_MIME_KINDS.has(file.type)
}

export function officeDocumentSource(
  node: Pick<SceneNode, 'pluginData'> | null | undefined
): OfficeDocumentSource | null {
  const source = sourceObjectSource(node)
  if (!source) return null
  const kind =
    officeDocumentKind(source.fileName) ??
    officeDocumentKind(`source.${source.metadata.format}`) ??
    OFFICE_MIME_KINDS.get(source.metadata.mimeType) ??
    null
  return kind ? { ...source, kind } : null
}
