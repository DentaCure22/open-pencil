import { XMLParser } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'

import type {
  PptxDeck,
  PptxElement,
  PptxShapeElement,
  PptxSlide,
  PptxTextAlign,
  PptxTextElement,
  PptxVerticalAlign
} from './types'

const EMU_PER_PIXEL = 12_700
const DEFAULT_SLIDE_WIDTH = 960
const DEFAULT_SLIDE_HEIGHT = 540
const DEFAULT_TEXT_COLOR = '#111111'
const MAX_PPTX_BYTES = 64 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 2_000
const CENTRAL_FILE_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50

type XmlObject = Record<string, unknown>

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: false
})

function xmlObject(value: unknown): XmlObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlObject)
    : null
}

function xmlObjects(value: unknown): XmlObject[] {
  if (Array.isArray(value))
    return value.flatMap((item) => (xmlObject(item) ? [item as XmlObject] : []))
  const item = xmlObject(value)
  return item ? [item] : []
}

function child(value: unknown, key: string): XmlObject | null {
  return xmlObject(xmlObject(value)?.[key])
}

function attribute(value: unknown, key: string): unknown {
  return xmlObject(value)?.[`@_${key}`]
}

function numericAttribute(value: unknown, key: string): number | null {
  const candidate = attribute(value, key)
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  if (typeof candidate !== 'string') return null
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function stringAttribute(value: unknown, key: string): string | null {
  const candidate = attribute(value, key)
  return typeof candidate === 'string' || typeof candidate === 'number' ? String(candidate) : null
}

function emu(value: number | null): number {
  return (value ?? 0) / EMU_PER_PIXEL
}

function hexColor(value: unknown, fallback: string | null): string | null {
  const raw = stringAttribute(child(value, 'srgbClr'), 'val')
  return raw && /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : fallback
}

function solidFill(value: unknown, fallback: string | null = null): string | null {
  return hexColor(child(value, 'solidFill'), fallback)
}

function littleEndian16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function littleEndian32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function endOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (littleEndian32(bytes, offset) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  return -1
}

function validateArchiveBounds(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_PPTX_BYTES) throw new Error('PPTX exceeds the 64 MB intake limit')
  const end = endOfCentralDirectory(bytes)
  if (end < 0) throw new Error('PPTX has no ZIP central directory')
  const entries = littleEndian16(bytes, end + 10)
  if (entries > MAX_ARCHIVE_ENTRIES) throw new Error('PPTX contains too many archive entries')
  let offset = littleEndian32(bytes, end + 16)
  let expandedBytes = 0
  for (let index = 0; index < entries; index++) {
    if (littleEndian32(bytes, offset) !== CENTRAL_FILE_HEADER) {
      throw new Error('PPTX central directory is malformed')
    }
    expandedBytes += littleEndian32(bytes, offset + 24)
    if (expandedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('PPTX expands beyond the 128 MB intake limit')
    }
    offset +=
      46 +
      littleEndian16(bytes, offset + 28) +
      littleEndian16(bytes, offset + 30) +
      littleEndian16(bytes, offset + 32)
  }
}

function textValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

function paragraphs(txBody: XmlObject): XmlObject[] {
  return xmlObjects(txBody.p)
}

function runs(paragraph: XmlObject): XmlObject[] {
  return [...xmlObjects(paragraph.r), ...xmlObjects(paragraph.fld)]
}

function paragraphText(paragraph: XmlObject): string {
  const runText = runs(paragraph)
    .map((run) => textValue(run.t))
    .join('')
  return runText || textValue(paragraph.t)
}

function textStyle(txBody: XmlObject): XmlObject | null {
  const firstParagraph = paragraphs(txBody).at(0)
  const firstRun = firstParagraph ? runs(firstParagraph).at(0) : null
  return child(firstRun, 'rPr') ?? child(child(firstParagraph, 'pPr'), 'defRPr')
}

function textAlign(txBody: XmlObject): PptxTextAlign {
  const firstParagraph = paragraphs(txBody)[0]
  const alignment = stringAttribute(child(firstParagraph, 'pPr'), 'algn')
  if (alignment === 'ctr') return 'CENTER'
  if (alignment === 'r') return 'RIGHT'
  if (alignment === 'just' || alignment === 'dist') return 'JUSTIFIED'
  return 'LEFT'
}

function verticalAlign(txBody: XmlObject): PptxVerticalAlign {
  const anchor = stringAttribute(child(txBody, 'bodyPr'), 'anchor')
  if (anchor === 'b') return 'BOTTOM'
  if (anchor === 'ctr') return 'CENTER'
  return 'TOP'
}

function transform(
  spPr: XmlObject,
  allowZeroHeight = false
): Pick<PptxElement, 'height' | 'width' | 'x' | 'y'> | null {
  const xfrm = child(spPr, 'xfrm')
  const offset = child(xfrm, 'off')
  const extent = child(xfrm, 'ext')
  const width = emu(numericAttribute(extent, 'cx'))
  const height = emu(numericAttribute(extent, 'cy'))
  if (width <= 0 || (allowZeroHeight ? height < 0 : height <= 0)) return null
  return {
    height,
    width,
    x: emu(numericAttribute(offset, 'x')),
    y: emu(numericAttribute(offset, 'y'))
  }
}

function shapeName(shape: XmlObject, fallback: string): string {
  const nonVisual = child(shape, 'nvSpPr') ?? child(shape, 'nvCxnSpPr')
  return stringAttribute(child(nonVisual, 'cNvPr'), 'name') ?? fallback
}

function shapeKind(geometry: string): PptxShapeElement['shape'] {
  if (geometry === 'ellipse') return 'ellipse'
  if (geometry === 'straightConnector1') return 'line'
  return 'rectangle'
}

function textElement(shape: XmlObject, index: number): PptxTextElement | null {
  const spPr = child(shape, 'spPr')
  const txBody = child(shape, 'txBody')
  if (!spPr || !txBody) return null
  const bounds = transform(spPr)
  if (!bounds) return null
  const style = textStyle(txBody)
  const fontSize = (numericAttribute(style, 'sz') ?? 1800) / 100
  const fontFamily = stringAttribute(child(style, 'latin'), 'typeface') ?? 'Arial'
  return {
    ...bounds,
    backgroundColor: solidFill(spPr),
    color: solidFill(style, DEFAULT_TEXT_COLOR) ?? DEFAULT_TEXT_COLOR,
    fontFamily,
    fontSize,
    fontWeight: numericAttribute(style, 'b') === 1 ? 700 : 400,
    kind: 'text',
    name: shapeName(shape, `Text ${index + 1}`),
    text: paragraphs(txBody).map(paragraphText).join('\n'),
    textAlign: textAlign(txBody),
    verticalAlign: verticalAlign(txBody)
  }
}

function shapeElement(shape: XmlObject, index: number): PptxShapeElement | null {
  const spPr = child(shape, 'spPr')
  if (!spPr) return null
  const geometry = stringAttribute(child(spPr, 'prstGeom'), 'prst')
  if (
    geometry !== 'rect' &&
    geometry !== 'roundRect' &&
    geometry !== 'ellipse' &&
    geometry !== 'straightConnector1'
  ) {
    return null
  }
  const bounds = transform(spPr, geometry === 'straightConnector1')
  if (!bounds) return null
  const line = child(spPr, 'ln')
  return {
    ...bounds,
    cornerRadius: geometry === 'roundRect' ? Math.min(bounds.width, bounds.height) * 0.08 : 0,
    fillColor: solidFill(spPr),
    kind: 'shape',
    name: shapeName(shape, `Shape ${index + 1}`),
    shape: shapeKind(geometry),
    strokeColor: solidFill(line),
    strokeWidth: emu(numericAttribute(line, 'w'))
  }
}

function parseSlide(bytes: Uint8Array, name: string): PptxSlide {
  const parsed = xmlObject(xmlParser.parse(strFromU8(bytes)))
  const slide = child(parsed, 'sld')
  const common = child(slide, 'cSld')
  const tree = child(common, 'spTree')
  if (!common || !tree) throw new Error(`PPTX slide is missing its shape tree: ${name}`)
  const connectors = xmlObjects(tree.cxnSp).flatMap((shape, index) => {
    const element = shapeElement(shape, index)
    return element ? [element] : []
  })
  const elements = xmlObjects(tree.sp).flatMap((shape, index) => {
    const element = child(shape, 'txBody') ? textElement(shape, index) : shapeElement(shape, index)
    return element && (element.kind !== 'text' || element.text.trim()) ? [element] : []
  })
  return {
    backgroundColor: solidFill(child(child(common, 'bg'), 'bgPr'), '#FFFFFF') ?? '#FFFFFF',
    elements: [...connectors, ...elements],
    name
  }
}

function slideNumber(path: string): number {
  return Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? Number.MAX_SAFE_INTEGER)
}

function orderedSlidePaths(archive: Record<string, Uint8Array>, presentation: XmlObject): string[] {
  const relationshipsBytes = Object.hasOwn(archive, 'ppt/_rels/presentation.xml.rels')
    ? archive['ppt/_rels/presentation.xml.rels']
    : null
  if (!relationshipsBytes) return []
  const relationships = xmlObject(xmlParser.parse(strFromU8(relationshipsBytes)))
  const relationshipById = new Map(
    xmlObjects(child(relationships, 'Relationships')?.Relationship).flatMap((relationship) => {
      const id = stringAttribute(relationship, 'Id')
      const target = stringAttribute(relationship, 'Target')
      return id && target ? [[id, target] as const] : []
    })
  )
  return xmlObjects(child(presentation, 'sldIdLst')?.sldId).flatMap((slideId) => {
    const relationshipId = stringAttribute(slideId, 'id')
    const target = relationshipId ? relationshipById.get(relationshipId) : null
    if (!target) return []
    const normalized = target.replace(/^\.\.\//, '')
    const path = normalized.startsWith('ppt/') ? normalized : `ppt/${normalized}`
    return Object.hasOwn(archive, path) ? [path] : []
  })
}

export function parsePptx(bytes: Uint8Array): PptxDeck {
  validateArchiveBounds(bytes)
  const archive = unzipSync(bytes)
  const presentationBytes = Object.hasOwn(archive, 'ppt/presentation.xml')
    ? archive['ppt/presentation.xml']
    : null
  if (!presentationBytes) throw new Error('PPTX is missing ppt/presentation.xml')
  const parsed = xmlObject(xmlParser.parse(strFromU8(presentationBytes)))
  const presentation = child(parsed, 'presentation')
  const size = child(presentation, 'sldSz')
  const width = emu(numericAttribute(size, 'cx')) || DEFAULT_SLIDE_WIDTH
  const height = emu(numericAttribute(size, 'cy')) || DEFAULT_SLIDE_HEIGHT
  const ordered = presentation ? orderedSlidePaths(archive, presentation) : []
  const slidePaths =
    ordered.length > 0
      ? ordered
      : Object.keys(archive)
          .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
          .sort((first, second) => slideNumber(first) - slideNumber(second))
  if (slidePaths.length === 0) throw new Error('PPTX contains no slides')
  return {
    height,
    slides: slidePaths.map((path, index) => parseSlide(archive[path], `Slide ${index + 1}`)),
    width
  }
}
