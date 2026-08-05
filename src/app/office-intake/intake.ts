import { strFromU8, unzipSync } from 'fflate'

import type { Editor } from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'

import {
  codeObjectPluginData,
  createOfficeDocumentDocument,
  createOfficeSpreadsheetDocument,
  type OfficeSpreadsheetCell
} from '@/app/code-object/model'
import {
  captureAssetBackedSurface,
  placeAssetBackedFiles,
  type AssetBackedFilePlacementResult,
  type CreatedAssetBackedSurface
} from '@/app/file-intake/asset-backed-placement'

const DOCUMENT_WIDTH = 760
const DOCUMENT_HEIGHT = 900
const SPREADSHEET_WIDTH = 1120
const SPREADSHEET_HEIGHT = 720
const OFFICE_CASCADE = 42
const MAX_DOCUMENT_CHARACTERS = 100_000
const MAX_SPREADSHEET_ROWS = 200
const MAX_SPREADSHEET_COLUMNS = 50

type OfficeKind = 'document' | 'spreadsheet'

type ParsedOfficeSource =
  | { kind: 'document'; text: string }
  | { cells: OfficeSpreadsheetCell[][]; kind: 'spreadsheet' }

function decodeXmlText(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
}

function elementContents(xml: string, localName: string): string[] {
  const expression = new RegExp(
    `<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`,
    'gi'
  )
  return Array.from(xml.matchAll(expression), (match) => match[1] ?? '')
}

function attributeValue(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = tag.match(new RegExp(`\\b${escaped}=(?:"([^"]*)"|'([^']*)')`, 'i'))
  return match?.[1] ?? match?.[2] ?? null
}

function archiveText(files: Record<string, Uint8Array>, path: string): string {
  const bytes = files[path]
  if (!bytes) throw new Error(`Office archive entry is missing: ${path}`)
  return strFromU8(bytes)
}

export function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes)
  const documentXml = archiveText(files, 'word/document.xml')
  const paragraphs = elementContents(documentXml, 'p')
    .map((paragraph) =>
      decodeXmlText(
        paragraph
          .replace(/<(?:[\w-]+:)?tab\b[^>]*\/>/gi, '\t')
          .replace(/<(?:[\w-]+:)?br\b[^>]*\/>/gi, '\n')
          .replace(/<[^>]+>/g, '')
      ).trimEnd()
    )
    .filter((paragraph, index, all) => paragraph.length > 0 || all[index - 1]?.length)
  const text = paragraphs.join('\n\n').trim()
  if (!text) throw new Error('The Word document has no readable text')
  return text.slice(0, MAX_DOCUMENT_CHARACTERS)
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? ''
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const source = files['xl/sharedStrings.xml']
  if (!source) return []
  return elementContents(strFromU8(source), 'si').map((item) =>
    elementContents(item, 't').map(decodeXmlText).join('')
  )
}

function cellValue(
  cellTag: string,
  cellBody: string,
  strings: string[]
): OfficeSpreadsheetCell | null {
  const formula = elementContents(cellBody, 'f')[0]
  if (formula !== undefined) return `=${decodeXmlText(formula)}`
  const type = attributeValue(cellTag, 't')
  if (type === 'inlineStr') return elementContents(cellBody, 't').map(decodeXmlText).join('')
  const raw = elementContents(cellBody, 'v')[0]
  if (raw === undefined) return null
  const decoded = decodeXmlText(raw)
  if (type === 's') return strings[Number(decoded)] ?? ''
  if (type === 'b') return decoded === '1'
  if (type === 'str') return decoded
  const numeric = Number(decoded)
  return Number.isFinite(numeric) ? numeric : decoded
}

export function extractXlsxCells(bytes: Uint8Array): OfficeSpreadsheetCell[][] {
  const files = unzipSync(bytes)
  const worksheetPath = Object.keys(files)
    .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0]
  if (!worksheetPath) throw new Error('The workbook has no worksheets')
  const worksheetXml = archiveText(files, worksheetPath)
  const strings = sharedStrings(files)
  const rows: OfficeSpreadsheetCell[][] = []
  const cellExpression =
    /(<(?:[\w-]+:)?c\b[^>]*\br=(?:"[^"]+"|'[^']+')[^>]*>)([\s\S]*?)<\/(?:[\w-]+:)?c>/gi
  for (const match of worksheetXml.matchAll(cellExpression)) {
    const cellTag = match[1] ?? ''
    const reference = attributeValue(cellTag, 'r') ?? ''
    const rowIndex = Math.max(0, Number(reference.match(/\d+$/)?.[0] ?? '1') - 1)
    const column = columnIndex(reference)
    if (rowIndex >= MAX_SPREADSHEET_ROWS || column < 0 || column >= MAX_SPREADSHEET_COLUMNS) {
      continue
    }
    const value = cellValue(cellTag, match[2] ?? '', strings)
    if (value === null) continue
    const row = (rows[rowIndex] ??= [])
    row[column] = value
  }
  if (rows.length === 0) throw new Error('The workbook has no readable cells')
  return rows
}

function officeKind(file: Pick<File, 'name' | 'type'>): OfficeKind | null {
  const name = file.name.toLowerCase()
  if (
    name.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'document'
  }
  if (
    name.endsWith('.xlsx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return 'spreadsheet'
  }
  return null
}

export function isOfficeFile(file: Pick<File, 'name' | 'type'>): boolean {
  return officeKind(file) !== null
}

function parseOfficeSource(
  file: Pick<File, 'name' | 'type'>,
  bytes: Uint8Array
): ParsedOfficeSource {
  const kind = officeKind(file)
  if (kind === 'document') return { kind, text: extractDocxText(bytes) }
  if (kind === 'spreadsheet') return { cells: extractXlsxCells(bytes), kind }
  throw new Error('Unsupported Office file')
}

async function createOfficeSurface(
  editor: Editor,
  file: File,
  cx: number,
  cy: number,
  offset: number
): Promise<CreatedAssetBackedSurface> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const parsed = parseOfficeSource(file, bytes)
  const document =
    parsed.kind === 'document'
      ? (() => {
          const base = createOfficeDocumentDocument()
          return { ...base, state: { ...base.state, seedText: parsed.text } }
        })()
      : (() => {
          const base = createOfficeSpreadsheetDocument()
          return { ...base, state: { ...base.state, seedCells: parsed.cells } }
        })()
  const width = parsed.kind === 'document' ? DOCUMENT_WIDTH : SPREADSHEET_WIDTH
  const height = parsed.kind === 'document' ? DOCUMENT_HEIGHT : SPREADSHEET_HEIGHT
  const fileName = file.name.trim() || (parsed.kind === 'document' ? 'Document.docx' : 'Book.xlsx')
  const assetHash = computeImageHash(bytes)
  const root = editor.graph.createNode('FRAME', editor.state.currentPageId, {
    clipsContent: true,
    fills: [],
    height,
    name: fileName.replace(/\.(docx|xlsx)$/i, '') || fileName,
    pluginData: contentSourcePluginData({
      fileName,
      format: parsed.kind === 'document' ? 'docx' : 'xlsx',
      mimeType: file.type || 'application/octet-stream',
      revision: CONTENT_SOURCE_REVISION,
      source: assetReference(assetHash)
    }),
    width,
    x: cx - width / 2 + offset * OFFICE_CASCADE,
    y: cy - height / 2 + offset * OFFICE_CASCADE
  })
  editor.graph.updateNode(root.id, {
    pluginData: codeObjectPluginData(root, document)
  })
  return captureAssetBackedSurface(editor, root, assetHash, bytes)
}

export async function placeOfficeFiles(
  editor: Editor,
  files: File[],
  cx: number,
  cy: number
): Promise<AssetBackedFilePlacementResult> {
  return placeAssetBackedFiles(editor, files, cx, cy, {
    createSurface: createOfficeSurface,
    pluralLabel: 'Place Office files',
    singularLabel: 'Place Office file'
  })
}
