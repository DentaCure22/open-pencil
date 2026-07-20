import { openOfficePackage, OfficePreviewError } from './archive'
import { parseDocxPreview } from './parse/docx'
import { parsePptxPreview } from './parse/pptx'
import { parseXlsxPreview } from './parse/xlsx'
import type { OfficeDocumentKind, OfficePreviewResult } from './types'

function previewForKind(archive: ReturnType<typeof openOfficePackage>, kind: OfficeDocumentKind) {
  if (kind === 'docx') return parseDocxPreview(archive)
  if (kind === 'xlsx') return parseXlsxPreview(archive)
  return parsePptxPreview(archive)
}

export function parseOfficeDocumentPreview(
  bytes: Uint8Array,
  kind: OfficeDocumentKind
): OfficePreviewResult {
  try {
    const archive = openOfficePackage(bytes, kind)
    const preview = previewForKind(archive, kind)
    const isEmpty =
      (preview.kind === 'docx' && preview.blocks.length === 0) ||
      (preview.kind === 'xlsx' && preview.sheets.length === 0) ||
      (preview.kind === 'pptx' && preview.slides.length === 0)
    if (isEmpty) {
      throw new OfficePreviewError(
        'unsupported-document',
        'This Office package contains no supported preview content.'
      )
    }
    return { preview, status: 'ready' }
  } catch (error) {
    if (error instanceof OfficePreviewError) {
      return { code: error.code, message: error.message, status: 'error' }
    }
    return {
      code: 'invalid-package',
      message: 'This Office file could not be previewed.',
      status: 'error'
    }
  }
}
