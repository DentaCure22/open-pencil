import type { OfficeArchive } from '../archive'
import type { PptxPreview, PresentationShape, PresentationSlide } from '../types'
import {
  attribute,
  child,
  children,
  collectText,
  findRecords,
  packageXml,
  relationshipPath
} from '../xml'

const MAX_SLIDES = 40
const MAX_SHAPES = 30

type SlideSize = { height: number; width: number }

function numericAttribute(value: unknown, key: string): number | null {
  const parsed = Number.parseFloat(attribute(value, key))
  return Number.isFinite(parsed) ? parsed : null
}

function slideSize(root: Record<string, unknown>): SlideSize {
  const size = child(child(root, 'presentation'), 'sldSz')
  return {
    height: numericAttribute(size, 'cy') ?? 6_858_000,
    width: numericAttribute(size, 'cx') ?? 12_192_000
  }
}

function relationshipTargets(archive: OfficeArchive): Map<string, string> {
  const root = packageXml(archive, 'ppt/_rels/presentation.xml.rels')
  const relationships = children(child(root, 'Relationships'), 'Relationship')
  return new Map(
    relationships.flatMap((relationship) => {
      const id = attribute(relationship, 'Id')
      const path = relationshipPath('ppt', attribute(relationship, 'Target'))
      return id && path ? [[id, path]] : []
    })
  )
}

function shapeGeometry(shape: Record<string, unknown>, size: SlideSize, index: number) {
  const transform = child(child(shape, 'spPr'), 'xfrm')
  const offset = child(transform, 'off')
  const extent = child(transform, 'ext')
  const x = numericAttribute(offset, 'x')
  const y = numericAttribute(offset, 'y')
  const width = numericAttribute(extent, 'cx')
  const height = numericAttribute(extent, 'cy')
  if (x === null || y === null || width === null || height === null) {
    return { height: 14, width: 76, x: 12, y: 12 + index * 16 }
  }
  return {
    height: Math.min(100, Math.max(4, (height / size.height) * 100)),
    width: Math.min(100, Math.max(8, (width / size.width) * 100)),
    x: Math.min(96, Math.max(0, (x / size.width) * 100)),
    y: Math.min(96, Math.max(0, (y / size.height) * 100))
  }
}

function shapeRole(shape: Record<string, unknown>): PresentationShape['role'] {
  const placeholder = child(child(child(shape, 'nvSpPr'), 'nvPr'), 'ph')
  const placeholderType = attribute(placeholder, 'type').toLowerCase()
  const name = attribute(child(child(shape, 'nvSpPr'), 'cNvPr'), 'name').toLowerCase()
  return placeholderType.includes('title') || name.includes('title') ? 'title' : 'body'
}

function parseSlide(
  archive: OfficeArchive,
  path: string,
  index: number,
  size: SlideSize
): PresentationSlide {
  const root = packageXml(archive, path)
  const shapeRecords = findRecords(root, 'sp', MAX_SHAPES + 1)
  const shapes = shapeRecords.slice(0, MAX_SHAPES).flatMap((shape, shapeIndex) => {
    const text = collectText(child(shape, 'txBody'), 't', 4_000).trim()
    if (!text) return []
    return [
      {
        ...shapeGeometry(shape, size, shapeIndex),
        role: shapeRole(shape),
        text
      }
    ]
  })
  return {
    name: `Slide ${index + 1}`,
    shapes,
    truncated: shapeRecords.length > MAX_SHAPES
  }
}

export function parsePptxPreview(archive: OfficeArchive): PptxPreview {
  const presentation = packageXml(archive, 'ppt/presentation.xml')
  const size = slideSize(presentation)
  const slideRecords = children(child(child(presentation, 'presentation'), 'sldIdLst'), 'sldId')
  const targets = relationshipTargets(archive)
  const slides = slideRecords.slice(0, MAX_SLIDES).flatMap((slide, index) => {
    const path = targets.get(attribute(slide, 'id'))
    if (!path || !archive[path]) return []
    return [parseSlide(archive, path, index, size)]
  })
  return {
    kind: 'pptx',
    slides,
    truncated: slideRecords.length > MAX_SLIDES || slides.some((slide) => slide.truncated)
  }
}
