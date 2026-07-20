import { unzipSync, type UnzipFileInfo } from 'fflate'

import type { OfficeDocumentKind, OfficePreviewErrorCode } from './types'

export const MAX_OFFICE_SOURCE_BYTES = 10 * 1024 * 1024

export type OfficeArchive = Partial<Record<string, Uint8Array>>

const MAX_ARCHIVE_ENTRIES = 2_000
const MAX_ENTRY_BYTES = 5 * 1024 * 1024
const MAX_SELECTED_XML_BYTES = 14 * 1024 * 1024

export class OfficePreviewError extends Error {
  constructor(
    readonly code: OfficePreviewErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OfficePreviewError'
  }
}

function hasCompoundFileHeader(bytes: Uint8Array): boolean {
  const header = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
  return header.every((value, index) => bytes[index] === value)
}

function hasZipHeader(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) ||
      (bytes[2] === 0x05 && bytes[3] === 0x06) ||
      (bytes[2] === 0x07 && bytes[3] === 0x08))
  )
}

function isWantedEntry(kind: OfficeDocumentKind, name: string): boolean {
  if (name === '[Content_Types].xml') return true
  if (kind === 'docx') return name === 'word/document.xml'
  if (kind === 'xlsx') {
    return (
      name === 'xl/workbook.xml' ||
      name === 'xl/_rels/workbook.xml.rels' ||
      name === 'xl/sharedStrings.xml' ||
      /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)
    )
  }
  return (
    name === 'ppt/presentation.xml' ||
    name === 'ppt/_rels/presentation.xml.rels' ||
    /^ppt\/slides\/slide\d+\.xml$/i.test(name)
  )
}

export function openOfficePackage(bytes: Uint8Array, kind: OfficeDocumentKind): OfficeArchive {
  if (bytes.byteLength > MAX_OFFICE_SOURCE_BYTES) {
    throw new OfficePreviewError(
      'file-too-large',
      `Preview is limited to ${MAX_OFFICE_SOURCE_BYTES / (1024 * 1024)} MB Office files.`
    )
  }
  if (hasCompoundFileHeader(bytes)) {
    throw new OfficePreviewError(
      'encrypted',
      'Encrypted or legacy compound Office files cannot be previewed.'
    )
  }
  if (!hasZipHeader(bytes)) {
    throw new OfficePreviewError(
      'invalid-package',
      'This file is not a valid Office Open XML package.'
    )
  }

  let entryCount = 0
  let selectedBytes = 0
  const filter = (file: UnzipFileInfo): boolean => {
    entryCount += 1
    if (entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new OfficePreviewError('preview-too-large', 'Office package contains too many entries.')
    }
    if (!isWantedEntry(kind, file.name)) return false
    if (file.originalSize > MAX_ENTRY_BYTES) {
      throw new OfficePreviewError('preview-too-large', 'An Office preview part is too large.')
    }
    selectedBytes += file.originalSize
    if (selectedBytes > MAX_SELECTED_XML_BYTES) {
      throw new OfficePreviewError('preview-too-large', 'Office preview content is too large.')
    }
    return true
  }

  try {
    return unzipSync(bytes, { filter })
  } catch (error) {
    if (error instanceof OfficePreviewError) throw error
    throw new OfficePreviewError('invalid-package', 'The Office package is corrupt or unsupported.')
  }
}
