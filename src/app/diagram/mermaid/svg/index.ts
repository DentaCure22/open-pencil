import { parseColor } from '@open-pencil/core/color'
import {
  MERMAID_DIAGRAM_REVISION,
  MERMAID_SVG_PARSER,
  type MermaidAppearance,
  type MermaidDiagram,
  type MermaidSkeletonElement
} from '@open-pencil/core/diagram'
import type { BlendMode, Fill, GradientTransform } from '@open-pencil/scene-graph'

import { IS_BROWSER } from '@/constants'

import { MERMAID_THEME_VARIABLES } from './theme'

const GEOMETRY_SELECTOR = 'path, rect, circle, ellipse, line, polyline, polygon'
const MERMAID_RECT_CORNER_RADIUS = 10
const SEMANTIC_RECT_SELECTOR = [
  '.actor',
  '.architecture-group',
  '.architecture-service',
  '.block',
  '.classGroup',
  '.cluster',
  '.entityBox',
  '.kanban-item',
  '.kanban-section',
  '.label-container',
  '.mindmap-node',
  '.node',
  '.requirementBox',
  '.statediagram-state'
].join(', ')
const TEXT_SELECTOR = 'text, foreignObject'
const EXCLUDED_ANCESTORS = 'defs, marker, clipPath, mask, pattern, symbol'
const DEFAULT_WIDTH = 640
const DEFAULT_HEIGHT = 360

type MatrixTuple = readonly [number, number, number, number, number, number]

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const CSS_BLEND_MODES: Partial<Record<string, BlendMode>> = {
  'color-burn': 'COLOR_BURN',
  'color-dodge': 'COLOR_DODGE',
  'hard-light': 'HARD_LIGHT',
  'soft-light': 'SOFT_LIGHT',
  color: 'COLOR',
  darken: 'DARKEN',
  difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION',
  hue: 'HUE',
  lighten: 'LIGHTEN',
  luminosity: 'LUMINOSITY',
  multiply: 'MULTIPLY',
  overlay: 'OVERLAY',
  saturation: 'SATURATION',
  screen: 'SCREEN'
}

function finiteNumber(value: string | null | undefined, fallback = 0): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveNumber(value: string | null | undefined, fallback: number): number {
  const parsed = finiteNumber(value, fallback)
  return parsed > 0 ? parsed : fallback
}

function matrixTuple(matrix: DOMMatrix | null): MatrixTuple {
  return matrix ? [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f] : [1, 0, 0, 1, 0, 0]
}

function hasNonAxisTransform(matrix: DOMMatrix | null): boolean {
  return Boolean(matrix && (Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6))
}

function editableTextTransform(
  element: SVGTextElement,
  root: SVGSVGElement
): { bounds: Bounds; rotation: number } | null {
  const matrix = rootMatrix(element, root)
  if (!matrix) return null
  const scaleX = Math.hypot(matrix.a, matrix.b)
  const scaleY = Math.hypot(matrix.c, matrix.d)
  const orthogonality = matrix.a * matrix.c + matrix.b * matrix.d
  if (scaleX <= 1e-6 || scaleY <= 1e-6 || Math.abs(orthogonality) > 1e-4) {
    const bounds = transformedBounds(element, matrix)
    return bounds ? { bounds, rotation: 0 } : null
  }
  let box: DOMRect
  try {
    box = element.getBBox()
  } catch {
    return null
  }
  const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix)
  const width = Math.max(1, box.width * scaleX)
  const height = Math.max(1, box.height * scaleY)
  return {
    bounds: { x: center.x - width / 2, y: center.y - height / 2, width, height },
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI
  }
}

function gradientTransform(start: DOMPoint, end: DOMPoint): GradientTransform {
  return {
    m00: start.x - end.x,
    m01: 0,
    m02: end.x,
    m10: start.y - end.y,
    m11: 0,
    m12: end.y
  }
}

function radialGradientTransform(
  center: DOMPoint,
  edgeX: DOMPoint,
  edgeY: DOMPoint
): GradientTransform {
  const m00 = (edgeX.x - center.x) * 2
  const m10 = (edgeX.y - center.y) * 2
  const m01 = (edgeY.x - center.x) * 2
  const m11 = (edgeY.y - center.y) * 2
  return {
    m00,
    m01,
    m02: center.x - (m00 + m01) / 2,
    m10,
    m11,
    m12: center.y - (m10 + m11) / 2
  }
}

function rootMatrix(element: SVGGraphicsElement, root: SVGSVGElement): DOMMatrix | null {
  const screenMatrix = element.getScreenCTM()
  const rootRect = root.getBoundingClientRect()
  if (!screenMatrix || rootRect.width <= 0 || rootRect.height <= 0) return element.getCTM()
  const viewBox = root.viewBox.baseVal
  const scaleX = (viewBox.width || rootRect.width) / rootRect.width
  const scaleY = (viewBox.height || rootRect.height) / rootRect.height
  return new DOMMatrix([
    screenMatrix.a * scaleX,
    screenMatrix.b * scaleY,
    screenMatrix.c * scaleX,
    screenMatrix.d * scaleY,
    (screenMatrix.e - rootRect.left) * scaleX,
    (screenMatrix.f - rootRect.top) * scaleY
  ])
}

function transformedBounds(element: SVGGraphicsElement, matrix: DOMMatrix | null): Bounds | null {
  let box: DOMRect
  try {
    box = element.getBBox()
  } catch {
    return null
  }
  if (!matrix) return null
  const points = [
    new DOMPoint(box.x, box.y),
    new DOMPoint(box.x + box.width, box.y),
    new DOMPoint(box.x + box.width, box.y + box.height),
    new DOMPoint(box.x, box.y + box.height)
  ].map((point) => point.matrixTransform(matrix))
  const extents = points.reduce(
    (current, point) => ({
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y)
    }),
    { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity }
  )
  return {
    x: extents.minX,
    y: extents.minY,
    width: Math.max(1, extents.maxX - extents.minX),
    height: Math.max(1, extents.maxY - extents.minY)
  }
}

function gradientReference(value: string): string | null {
  const match = /url\(\s*["']?(?:[^#)]*#)?([^)'"\s]+)["']?\s*\)/u.exec(value)
  return match?.[1] ?? null
}

function referencedGradient(root: SVGSVGElement, value: string): SVGGradientElement | null {
  const id = gradientReference(value)
  if (!id) return null
  const match = Array.from(
    root.querySelectorAll<SVGGradientElement>('linearGradient, radialGradient')
  ).find((gradient) => gradient.id === id)
  return match ?? null
}

function gradientStops(gradient: SVGGradientElement): Fill['gradientStops'] {
  const stops = Array.from(gradient.querySelectorAll<SVGStopElement>(':scope > stop'))
  return stops.map((stop) => {
    const style = window.getComputedStyle(stop)
    const color = parseColor(style.stopColor || stop.getAttribute('stop-color') || '#000000')
    color.a *= Math.min(1, Math.max(0, finiteNumber(style.stopOpacity, 1)))
    return {
      color,
      position: Math.min(1, Math.max(0, stop.offset.baseVal))
    }
  })
}

function objectBoundingBoxCoordinate(value: string | null, fallback: number): number {
  if (!value) return fallback
  if (value.trim().endsWith('%')) return finiteNumber(value, fallback * 100) / 100
  return finiteNumber(value, fallback)
}

function localPoint(point: DOMPoint, bounds: Bounds): DOMPoint {
  return new DOMPoint(
    (point.x - bounds.x) / Math.max(1, bounds.width),
    (point.y - bounds.y) / Math.max(1, bounds.height)
  )
}

function gradientMatrix(gradient: SVGGradientElement): DOMMatrix {
  return gradient.gradientTransform.baseVal.consolidate()?.matrix ?? new DOMMatrix()
}

function linearGradientPoints(
  gradient: SVGLinearGradientElement,
  elementMatrix: DOMMatrix | null,
  bounds: Bounds
): { start: DOMPoint; end: DOMPoint } {
  const objectBoundingBox = gradient.getAttribute('gradientUnits') !== 'userSpaceOnUse'
  const transform = gradientMatrix(gradient)
  if (objectBoundingBox) {
    return {
      start: new DOMPoint(
        objectBoundingBoxCoordinate(gradient.getAttribute('x1'), 0),
        objectBoundingBoxCoordinate(gradient.getAttribute('y1'), 0)
      ).matrixTransform(transform),
      end: new DOMPoint(
        objectBoundingBoxCoordinate(gradient.getAttribute('x2'), 1),
        objectBoundingBoxCoordinate(gradient.getAttribute('y2'), 0)
      ).matrixTransform(transform)
    }
  }

  const combined = elementMatrix?.multiply(transform) ?? transform
  return {
    start: localPoint(
      new DOMPoint(gradient.x1.baseVal.value, gradient.y1.baseVal.value).matrixTransform(combined),
      bounds
    ),
    end: localPoint(
      new DOMPoint(gradient.x2.baseVal.value, gradient.y2.baseVal.value).matrixTransform(combined),
      bounds
    )
  }
}

function radialGradientPoints(
  gradient: SVGRadialGradientElement,
  elementMatrix: DOMMatrix | null,
  bounds: Bounds
): { center: DOMPoint; edgeX: DOMPoint; edgeY: DOMPoint } {
  const objectBoundingBox = gradient.getAttribute('gradientUnits') !== 'userSpaceOnUse'
  const transform = gradientMatrix(gradient)
  const cx = objectBoundingBox
    ? objectBoundingBoxCoordinate(gradient.getAttribute('cx'), 0.5)
    : gradient.cx.baseVal.value
  const cy = objectBoundingBox
    ? objectBoundingBoxCoordinate(gradient.getAttribute('cy'), 0.5)
    : gradient.cy.baseVal.value
  const radius = objectBoundingBox
    ? objectBoundingBoxCoordinate(gradient.getAttribute('r'), 0.5)
    : gradient.r.baseVal.value
  const matrix = objectBoundingBox ? transform : (elementMatrix?.multiply(transform) ?? transform)
  const normalize = objectBoundingBox
    ? (point: DOMPoint) => point
    : (point: DOMPoint) => localPoint(point, bounds)
  return {
    center: normalize(new DOMPoint(cx, cy).matrixTransform(matrix)),
    edgeX: normalize(new DOMPoint(cx + radius, cy).matrixTransform(matrix)),
    edgeY: normalize(new DOMPoint(cx, cy + radius).matrixTransform(matrix))
  }
}

function gradientPaint(
  value: string,
  root: SVGSVGElement,
  elementMatrix: DOMMatrix | null,
  bounds: Bounds
): Fill | undefined {
  const gradient = referencedGradient(root, value)
  if (!gradient) return undefined
  const stops = gradientStops(gradient)
  if (!stops?.length) return undefined
  const color = { ...stops[0].color }

  if (gradient instanceof SVGLinearGradientElement) {
    const { start, end } = linearGradientPoints(gradient, elementMatrix, bounds)
    return {
      type: 'GRADIENT_LINEAR',
      color,
      opacity: 1,
      visible: true,
      gradientStops: stops,
      gradientTransform: gradientTransform(start, end)
    }
  }

  if (!(gradient instanceof SVGRadialGradientElement)) return undefined
  const { center, edgeX, edgeY } = radialGradientPoints(gradient, elementMatrix, bounds)
  return {
    type: 'GRADIENT_RADIAL',
    color,
    opacity: 1,
    visible: true,
    gradientStops: stops,
    gradientTransform: radialGradientTransform(center, edgeX, edgeY)
  }
}

function elementBlendMode(element: SVGElement, root: SVGSVGElement): BlendMode | undefined {
  let current: Element | null = element
  while (current && current !== root) {
    const mode = window.getComputedStyle(current).mixBlendMode
    const mapped = CSS_BLEND_MODES[mode]
    if (mapped) return mapped
    current = current.parentElement
  }
  return undefined
}

function htmlBounds(element: SVGForeignObjectElement, root: SVGSVGElement): Bounds | null {
  const elementRect = element.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  if (
    elementRect.width <= 0 ||
    elementRect.height <= 0 ||
    rootRect.width <= 0 ||
    rootRect.height <= 0
  ) {
    return null
  }
  const viewBox = root.viewBox.baseVal
  const scaleX = (viewBox.width || rootRect.width) / rootRect.width
  const scaleY = (viewBox.height || rootRect.height) / rootRect.height
  return {
    x: (elementRect.left - rootRect.left) * scaleX,
    y: (elementRect.top - rootRect.top) * scaleY,
    width: elementRect.width * scaleX,
    height: elementRect.height * scaleY
  }
}

function shapePath(element: SVGElement): string | null {
  if (element instanceof SVGPathElement) return element.getAttribute('d')
  if (!(element instanceof SVGGraphicsElement)) return null
  const box = element.getBBox()
  const left = box.x
  const top = box.y
  const right = box.x + box.width
  const bottom = box.y + box.height

  if (element instanceof SVGLineElement) {
    return `M ${element.x1.baseVal.value} ${element.y1.baseVal.value} L ${element.x2.baseVal.value} ${element.y2.baseVal.value}`
  }
  if (element instanceof SVGPolylineElement || element instanceof SVGPolygonElement) {
    const points = Array.from(element.points).map((point) => `${point.x} ${point.y}`)
    if (points.length < 2) return null
    return `M ${points.join(' L ')}${element instanceof SVGPolygonElement ? ' Z' : ''}`
  }
  if (element instanceof SVGCircleElement || element instanceof SVGEllipseElement) {
    const rx = box.width / 2
    const ry = box.height / 2
    const centerX = left + rx
    const centerY = top + ry
    return `M ${centerX - rx} ${centerY} A ${rx} ${ry} 0 1 0 ${centerX + rx} ${centerY} A ${rx} ${ry} 0 1 0 ${centerX - rx} ${centerY} Z`
  }
  if (element instanceof SVGRectElement) {
    const radiusX = Math.min(element.rx.baseVal.value, box.width / 2)
    const radiusY = Math.min(element.ry.baseVal.value || radiusX, box.height / 2)
    if (radiusX > 0 || radiusY > 0) {
      return `M ${left + radiusX} ${top} H ${right - radiusX} A ${radiusX} ${radiusY} 0 0 1 ${right} ${top + radiusY} V ${bottom - radiusY} A ${radiusX} ${radiusY} 0 0 1 ${right - radiusX} ${bottom} H ${left + radiusX} A ${radiusX} ${radiusY} 0 0 1 ${left} ${bottom - radiusY} V ${top + radiusY} A ${radiusX} ${radiusY} 0 0 1 ${left + radiusX} ${top} Z`
    }
    return `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`
  }
  return null
}

function rectangleCornerRadius(element: SVGRectElement, bounds: Bounds, scale: number): number {
  const renderedRadius = Math.max(element.rx.baseVal.value, element.ry.baseVal.value) * scale
  const minimumRadius = element.closest(SEMANTIC_RECT_SELECTOR) ? MERMAID_RECT_CORNER_RADIUS : 0
  return Math.min(bounds.width / 2, bounds.height / 2, Math.max(minimumRadius, renderedRadius))
}

function styleOpacity(
  style: CSSStyleDeclaration,
  property: 'fillOpacity' | 'strokeOpacity'
): number {
  return Math.min(1, Math.max(0, finiteNumber(style[property], 1)))
}

function dashPattern(style: CSSStyleDeclaration): number[] {
  if (!style.strokeDasharray || style.strokeDasharray === 'none') return []
  const values = style.strokeDasharray
    .split(/[ ,]+/)
    .map((value) => finiteNumber(value))
    .filter((value) => value > 0)
  return values.length % 2 === 0 ? values : [...values, ...values]
}

function visibleElement(
  element: Element,
  style: CSSStyleDeclaration,
  root: SVGSVGElement
): boolean {
  let ancestor: Element | null = element.parentElement
  while (ancestor && ancestor !== root) {
    const ancestorStyle = window.getComputedStyle(ancestor)
    if (
      ancestorStyle.display === 'none' ||
      ancestorStyle.visibility === 'hidden' ||
      finiteNumber(ancestorStyle.opacity, 1) <= 0
    ) {
      return false
    }
    ancestor = ancestor.parentElement
  }
  return (
    !element.closest(EXCLUDED_ANCESTORS) &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    finiteNumber(style.opacity, 1) > 0
  )
}

function insideRoot(bounds: Bounds, root: SVGSVGElement): boolean {
  const viewBox = root.viewBox.baseVal
  const width = viewBox.width || positiveNumber(root.getAttribute('width'), DEFAULT_WIDTH)
  const height = viewBox.height || positiveNumber(root.getAttribute('height'), DEFAULT_HEIGHT)
  const left = viewBox.x
  const top = viewBox.y
  return (
    bounds.x + bounds.width >= left &&
    bounds.x <= left + width &&
    bounds.y + bounds.height >= top &&
    bounds.y <= top + height
  )
}

function ancestorGroups(element: Element, root: SVGSVGElement): string[] {
  const groups: string[] = []
  let current: Element | null = element.parentElement
  while (current && current !== root) {
    if (current instanceof SVGGElement) {
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter(
            (sibling) => sibling instanceof SVGGElement
          )
        : []
      const index = siblings.indexOf(current)
      const className = current.getAttribute('class')?.trim()
      const dataId = current.getAttribute('data-id')?.trim()
      const identity =
        current.id ||
        (dataId ? `${className?.split(/\s+/)[0] ?? 'group'}:${dataId}` : null) ||
        (className ? `${className}@${Math.max(0, index)}` : `group@${Math.max(0, index)}`)
      if (identity) groups.unshift(identity)
    }
    current = current.parentElement
  }
  return groups
}

function elementName(element: Element): string {
  return (
    element.getAttribute('aria-label') ||
    element.getAttribute('data-id') ||
    element.getAttribute('class')?.trim().split(/\s+/)[0] ||
    element.tagName.toLowerCase()
  )
}

function markerKind(value: string): string | null {
  const reference = gradientReference(value)?.toLowerCase()
  if (!reference) return null
  if (reference.includes('zeroormore')) return 'cardinality_zero_or_many'
  if (reference.includes('oneormore')) return 'cardinality_one_or_many'
  if (reference.includes('zeroorone')) return 'cardinality_zero_or_one'
  if (reference.includes('onlyone') || reference.includes('exactlyone')) {
    return 'cardinality_exactly_one'
  }
  if (reference.includes('aggregation') || reference.includes('diamond')) return 'diamond_outline'
  if (reference.includes('composition')) return 'diamond'
  if (reference.includes('circle') || reference.includes('lollipop')) return 'circle'
  if (reference.includes('bar')) return 'bar'
  return 'arrow'
}

function normalizedText(value: unknown): string {
  return typeof value === 'string' ? value.replaceAll(/\s+/g, ' ').trim() : ''
}

function geometryElement(
  element: SVGElement,
  root: SVGSVGElement,
  index: number
): MermaidSkeletonElement | null {
  if (!(element instanceof SVGGraphicsElement)) return null
  const style = window.getComputedStyle(element)
  if (!visibleElement(element, style, root)) return null
  const matrix = rootMatrix(element, root)
  const rectangle = element instanceof SVGRectElement
  const nativeRectangle = rectangle && !hasNonAxisTransform(matrix)
  const path = nativeRectangle ? null : shapePath(element)
  const bounds = transformedBounds(element, matrix)
  if ((!nativeRectangle && !path) || !bounds) return null
  if (elementName(element) === 'today' && !insideRoot(bounds, root)) return null
  const scale = matrix ? Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) : 1
  const id = element.id ? `${element.id}-${index}` : `${element.tagName.toLowerCase()}-${index}`
  const fillPaint = gradientPaint(style.fill, root, matrix, bounds)
  const strokePaint = gradientPaint(style.stroke, root, matrix, bounds)
  const startArrowhead = markerKind(style.getPropertyValue('marker-start'))
  const endArrowhead = markerKind(style.getPropertyValue('marker-end'))
  return {
    id,
    type: nativeRectangle ? 'rectangle' : 'path',
    name: elementName(element),
    ...bounds,
    path: path ?? undefined,
    cornerRadius: nativeRectangle ? rectangleCornerRadius(element, bounds, scale) : undefined,
    transform: matrixTuple(matrix),
    backgroundColor: style.fill,
    strokeColor: style.stroke,
    fillPaint,
    strokePaint,
    blendMode: elementBlendMode(element, root),
    strokeWidth: positiveNumber(style.strokeWidth, 1) * scale,
    strokeDasharray: dashPattern(style),
    strokeLineCap: style.strokeLinecap,
    strokeLineJoin: style.strokeLinejoin,
    fillOpacity: styleOpacity(style, 'fillOpacity'),
    strokeOpacity: styleOpacity(style, 'strokeOpacity'),
    opacity: Math.min(1, Math.max(0, finiteNumber(style.opacity, 1))),
    fillRule: style.fillRule === 'evenodd' ? 'EVENODD' : 'NONZERO',
    startArrowhead,
    endArrowhead,
    groupIds: ancestorGroups(element, root)
  }
}

function textContent(element: Element): string {
  if (element instanceof SVGForeignObjectElement) {
    const html = element.querySelector<HTMLElement>('*')
    const lines = (html?.innerText ?? element.textContent ?? '')
      .split(/\r?\n/u)
      .map((line) => normalizedText(line))
      .filter(Boolean)
    return lines.join('\n')
  }
  if (element instanceof SVGTextElement) {
    const spans = Array.from(element.querySelectorAll(':scope > tspan'))
      .map((span) => normalizedText(span.textContent))
      .filter(Boolean)
    if (spans.length) return [...new Set(spans)].join('\n')
  }
  return normalizedText(element.textContent)
}

function textBounds(element: Element, bounds: Bounds): Bounds {
  if (!element.closest('.architecture-service, .architecture-groups')) return bounds
  return { ...bounds, x: bounds.x - 8, width: bounds.width + 16 }
}

function textElement(
  element: SVGTextElement | SVGForeignObjectElement,
  root: SVGSVGElement,
  index: number
): MermaidSkeletonElement | null {
  const probe =
    element instanceof SVGForeignObjectElement
      ? (element.querySelector<HTMLElement>('*') ?? element)
      : (element.querySelector<SVGTSpanElement>('tspan') ?? element)
  const style = window.getComputedStyle(probe)
  if (!visibleElement(element, style, root)) return null
  const text = textContent(element)
  const editableTransform =
    element instanceof SVGTextElement ? editableTextTransform(element, root) : null
  const bounds =
    editableTransform?.bounds ??
    (element instanceof SVGForeignObjectElement
      ? htmlBounds(element, root)
      : transformedBounds(element, rootMatrix(element, root)))
  if (!text || !bounds) return null
  const paddedBounds = textBounds(element, bounds)
  const id = element.id ? `${element.id}-${index}` : `text-${index}`
  const fontWeight = Number.parseInt(style.fontWeight, 10)
  const textAlign =
    style.textAlign === 'left' || style.textAlign === 'right' ? style.textAlign : 'center'
  return {
    id,
    type: 'text',
    name: elementName(element),
    ...paddedBounds,
    text,
    fontSize: positiveNumber(style.fontSize, 16),
    fontFamily: style.fontFamily.split(',')[0]?.replaceAll(/["']/g, '').trim(),
    fontWeight: Number.isFinite(fontWeight) ? fontWeight : 400,
    strokeColor: style.fill === 'none' ? style.color : style.fill,
    fillOpacity: styleOpacity(style, 'fillOpacity'),
    opacity: Math.min(1, Math.max(0, finiteNumber(style.opacity, 1))),
    rotation: editableTransform?.rotation ?? 0,
    label: {
      text,
      fontSize: positiveNumber(style.fontSize, 16),
      color: style.fill === 'none' ? style.color : style.fill,
      textAlign,
      verticalAlign: 'middle'
    },
    groupIds: ancestorGroups(element, root)
  }
}

function prepareRoot(root: SVGSVGElement): void {
  const viewBox = root.viewBox.baseVal
  const width = viewBox.width || positiveNumber(root.getAttribute('width'), DEFAULT_WIDTH)
  const height = viewBox.height || positiveNumber(root.getAttribute('height'), DEFAULT_HEIGHT)
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.style.maxWidth = 'none'
}

function nativeTransparentElements(
  source: string,
  elements: MermaidSkeletonElement[]
): MermaidSkeletonElement[] {
  const isSankey = /^\s*sankey(?:-beta)?\s*$/mu.test(source)
  if (!isSankey) return elements

  // Mermaid's SVG uses multiply for translucent Sankey links. That is faithful on its white
  // documentation surface but turns the gradients muddy gray on a transparent dark canvas.
  // Native editable mode keeps the gradient and opacity while making its color backdrop-safe.
  return elements.map((element) =>
    element.strokePaint?.gradientStops ? { ...element, blendMode: 'NORMAL' } : element
  )
}

async function renderSvg(source: string, appearance: MermaidAppearance): Promise<MermaidDiagram> {
  if (!IS_BROWSER) throw new Error('Mermaid rendering requires a browser.')
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: appearance === 'light' ? 'default' : 'dark',
    themeVariables: MERMAID_THEME_VARIABLES
  })

  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = `opacity:0;position:fixed;z-index:-1;left:-99999px;top:-99999px;width:${DEFAULT_WIDTH}px;height:${DEFAULT_HEIGHT}px;pointer-events:none`
  document.body.appendChild(host)
  try {
    const id = `open-pencil-mermaid-${crypto.randomUUID()}`
    const { svg } = await mermaid.render(id, source, host)
    host.innerHTML = svg
    const root = host.querySelector('svg')
    if (!(root instanceof SVGSVGElement)) throw new Error('Mermaid returned no SVG diagram.')
    prepareRoot(root)
    const geometry = Array.from(root.querySelectorAll<SVGElement>(GEOMETRY_SELECTOR)).flatMap(
      (element, index) => geometryElement(element, root, index) ?? []
    )
    const textElements = Array.from(
      root.querySelectorAll<SVGTextElement | SVGForeignObjectElement>(TEXT_SELECTOR)
    )
    const renderedTextElements = textElements.flatMap((element, index) => {
      const rendered = textElement(element, root, index)
      return rendered ? [{ element, rendered }] : []
    })
    const foreignObjectTexts = new Set(
      renderedTextElements.flatMap(({ element, rendered }) =>
        element instanceof SVGForeignObjectElement ? [rendered.text ?? ''] : []
      )
    )
    const text = renderedTextElements
      .filter(
        ({ element, rendered }) =>
          element instanceof SVGForeignObjectElement || !foreignObjectTexts.has(rendered.text ?? '')
      )
      .map(({ rendered }) => rendered)
    const elements = nativeTransparentElements(source, [...geometry, ...text])
    if (elements.length === 0) throw new Error('Mermaid returned no editable diagram pieces.')
    return {
      appearance,
      source,
      revision: MERMAID_DIAGRAM_REVISION,
      parser: MERMAID_SVG_PARSER,
      elements,
      files: {}
    }
  } finally {
    host.remove()
  }
}

let svgRenderQueue: Promise<void> = Promise.resolve()

export function parseMermaidSvgInBrowser(
  source: string,
  appearance: MermaidAppearance = 'dark'
): Promise<MermaidDiagram> {
  const task = svgRenderQueue.then(() => renderSvg(source, appearance))
  svgRenderQueue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}
