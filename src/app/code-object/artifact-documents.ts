import {
  CODE_OBJECT_SCHEMA_VERSION,
  type CodeObjectDocument as CoreCodeObjectDocument
} from '@open-pencil/core/code-object'

import type { CodeObjectBoardPermission } from './contracts'
import {
  OFFICE_DOCUMENT_SOURCE,
  OFFICE_SPREADSHEET_SOURCE,
  PDF_DOCUMENT_SOURCE,
  PPTX_DECK_SOURCE
} from './saved-sources'

export type PptxDeckState = {
  activeSlide: number
  view: 'deck'
}

export type PdfDocumentState = {
  activePage: number
  view: 'pdf'
}

export type OfficeDocumentState = {
  revision: number
  seedText: string
  snapshot: Record<string, unknown> | null
  view: 'document'
}

export type OfficeSpreadsheetCell = boolean | number | string

export type OfficeSpreadsheetState = {
  revision: number
  seedCells: OfficeSpreadsheetCell[][]
  snapshot: Record<string, unknown> | null
  view: 'spreadsheet'
}

export type OfficeDocumentDocument = CoreCodeObjectDocument<
  'office-document',
  OfficeDocumentState,
  CodeObjectBoardPermission
>
export type OfficeSpreadsheetDocument = CoreCodeObjectDocument<
  'office-spreadsheet',
  OfficeSpreadsheetState,
  CodeObjectBoardPermission
>
export type PptxDeckDocument = CoreCodeObjectDocument<
  'pptx-deck',
  PptxDeckState,
  CodeObjectBoardPermission
>
export type PdfDocumentDocument = CoreCodeObjectDocument<
  'pdf-document',
  PdfDocumentState,
  CodeObjectBoardPermission
>

const DEFAULT_OFFICE_DOCUMENT_STATE: OfficeDocumentState = {
  revision: 0,
  seedText: `Product direction

Make every source feel native to the board.

Documents should read like documents, spreadsheets should calculate like spreadsheets, and presentations should move like presentations. The board owns placement and composition; the Office surface owns focused editing.

Principles
• One source, one durable object
• Direct editing without an iframe boundary
• Quiet in Design mode, capable in Interaction mode
• Original source preserved`,
  snapshot: null,
  view: 'document'
}

const DEFAULT_OFFICE_SPREADSHEET_STATE: OfficeSpreadsheetState = {
  revision: 0,
  seedCells: [
    ['Channel', 'Q1', 'Q2', 'Change', 'Owner'],
    ['Product', 84, 112, '=C2-B2', 'Maya'],
    ['Growth', 68, 91, '=C3-B3', 'Noah'],
    ['Research', 51, 76, '=C4-B4', 'Ari'],
    ['Platform', 73, 89, '=C5-B5', 'June'],
    ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', '=C6-B6', '']
  ],
  snapshot: null,
  view: 'spreadsheet'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function officeSnapshot(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? structuredClone(value) : null
}

function officeSpreadsheetCell(value: unknown): OfficeSpreadsheetCell | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') return value.slice(0, 2_000)
  return null
}

export function createOfficeDocumentDocument(): OfficeDocumentDocument {
  return {
    boardPermissions: [],
    component: 'office-document',
    definitionId: 'openpencil.document',
    modality: 'document',
    name: 'Document',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: OFFICE_DOCUMENT_SOURCE,
    state: structuredClone(DEFAULT_OFFICE_DOCUMENT_STATE)
  }
}

export function createOfficeSpreadsheetDocument(): OfficeSpreadsheetDocument {
  return {
    boardPermissions: [],
    component: 'office-spreadsheet',
    definitionId: 'openpencil.spreadsheet',
    modality: 'document',
    name: 'Spreadsheet',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: OFFICE_SPREADSHEET_SOURCE,
    state: structuredClone(DEFAULT_OFFICE_SPREADSHEET_STATE)
  }
}

export function createPptxDeckDocument(): PptxDeckDocument {
  return {
    boardPermissions: [],
    component: 'pptx-deck',
    definitionId: 'openpencil.pptx-deck',
    modality: 'document',
    name: 'Presentation',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: PPTX_DECK_SOURCE,
    state: { activeSlide: 0, view: 'deck' }
  }
}

export function createPdfDocumentDocument(): PdfDocumentDocument {
  return {
    boardPermissions: [],
    component: 'pdf-document',
    definitionId: 'openpencil.pdf-document',
    modality: 'document',
    name: 'PDF',
    props: {},
    runtime: 'openpencil-code',
    schemaVersion: CODE_OBJECT_SCHEMA_VERSION,
    source: PDF_DOCUMENT_SOURCE,
    state: { activePage: 1, view: 'pdf' }
  }
}

export function normalizePptxDeckState(state: Record<string, unknown>): PptxDeckState {
  return {
    activeSlide: Math.max(0, Math.round(finiteNumber(state.activeSlide, 0))),
    view: 'deck'
  }
}

export function normalizePdfDocumentState(state: Record<string, unknown>): PdfDocumentState {
  return {
    activePage: Math.max(1, Math.round(finiteNumber(state.activePage, 1))),
    view: 'pdf'
  }
}

export function normalizeOfficeDocumentState(state: Record<string, unknown>): OfficeDocumentState {
  return {
    revision: Math.max(0, Math.round(finiteNumber(state.revision, 0))),
    seedText:
      typeof state.seedText === 'string'
        ? state.seedText.slice(0, 100_000)
        : DEFAULT_OFFICE_DOCUMENT_STATE.seedText,
    snapshot: officeSnapshot(state.snapshot),
    view: 'document'
  }
}

export function normalizeOfficeSpreadsheetState(
  state: Record<string, unknown>
): OfficeSpreadsheetState {
  const seedCells = Array.isArray(state.seedCells)
    ? state.seedCells.slice(0, 2_000).map((row) =>
        Array.isArray(row)
          ? row
              .slice(0, 200)
              .map(officeSpreadsheetCell)
              .map((cell) => cell ?? '')
          : []
      )
    : structuredClone(DEFAULT_OFFICE_SPREADSHEET_STATE.seedCells)
  return {
    revision: Math.max(0, Math.round(finiteNumber(state.revision, 0))),
    seedCells: seedCells.length > 0 ? seedCells : [[]],
    snapshot: officeSnapshot(state.snapshot),
    view: 'spreadsheet'
  }
}
