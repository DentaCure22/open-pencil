import type { SourceObjectSource } from '@/app/source-object/source'

export type OfficeDocumentKind = 'docx' | 'pptx' | 'xlsx'

export type OfficeDocumentSource = SourceObjectSource & {
  kind: OfficeDocumentKind
}

export type OfficeTextBlockKind = 'heading' | 'list-item' | 'paragraph' | 'title'

export type OfficeTextBlock = {
  kind: OfficeTextBlockKind
  level: number
  text: string
}

export type DocxPreview = {
  blocks: OfficeTextBlock[]
  kind: 'docx'
  title: string
  truncated: boolean
}

export type SpreadsheetCell = {
  column: number
  row: number
  value: string
}

export type SpreadsheetSheet = {
  cells: SpreadsheetCell[]
  columnCount: number
  name: string
  rowCount: number
  truncated: boolean
}

export type XlsxPreview = {
  kind: 'xlsx'
  sheets: SpreadsheetSheet[]
  truncated: boolean
}

export type PresentationShape = {
  height: number
  role: 'body' | 'title'
  text: string
  width: number
  x: number
  y: number
}

export type PresentationSlide = {
  name: string
  shapes: PresentationShape[]
  truncated: boolean
}

export type PptxPreview = {
  kind: 'pptx'
  slides: PresentationSlide[]
  truncated: boolean
}

export type OfficeDocumentPreview = DocxPreview | PptxPreview | XlsxPreview

export type OfficePreviewErrorCode =
  | 'encrypted'
  | 'file-too-large'
  | 'invalid-package'
  | 'preview-too-large'
  | 'unsupported-document'

export type OfficePreviewFailure = {
  code: OfficePreviewErrorCode
  message: string
  status: 'error'
}

export type OfficePreviewReady = {
  preview: OfficeDocumentPreview
  status: 'ready'
}

export type OfficePreviewResult = OfficePreviewFailure | OfficePreviewReady
