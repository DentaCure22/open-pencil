import DxfParser, {
  type I3DfaceEntity,
  type IArcEntity,
  type ICircleEntity,
  type IEllipseEntity,
  type IEntity,
  type IDxf,
  type ILayer,
  type ILineEntity,
  type ILwpolylineEntity,
  type IMtextEntity,
  type IPoint,
  type IPointEntity,
  type IPolylineEntity,
  type ISolidEntity,
  type ITextEntity
} from 'dxf-parser'

import { MAX_DXF_SOURCE_BYTES } from '../classify'
import type {
  CadDrawing,
  CadDrawingBounds,
  CadDrawingPath,
  CadDrawingText,
  CadPoint
} from '../types'

export const MAX_DXF_ENTITIES = 25_000
export const MAX_DXF_RENDER_POINTS = 100_000

const MAX_ABSOLUTE_COORDINATE = 1_000_000_000_000
const CURVE_SEGMENTS = 72
const DEFAULT_COLOR = '#d8d5df'

const UNIT_LABELS = new Map<number, string>([
  [0, 'Unitless'],
  [1, 'Inches'],
  [2, 'Feet'],
  [3, 'Miles'],
  [4, 'Millimeters'],
  [5, 'Centimeters'],
  [6, 'Meters'],
  [7, 'Kilometers'],
  [8, 'Microinches'],
  [9, 'Mils'],
  [10, 'Yards'],
  [11, 'Angstroms'],
  [12, 'Nanometers'],
  [13, 'Microns'],
  [14, 'Decimeters']
])

type CadDrawingErrorKind = 'invalid' | 'limit' | 'unsupported'

export class CadDrawingError extends Error {
  constructor(
    message: string,
    readonly kind: CadDrawingErrorKind
  ) {
    super(message)
    this.name = 'CadDrawingError'
  }
}

type MutableBounds = {
  maxX: number
  maxY: number
  minX: number
  minY: number
}

type DrawingAccumulator = {
  bounds: MutableBounds
  omittedEntityCount: number
  paths: CadDrawingPath[]
  pointCount: number
  renderedEntityCount: number
  texts: CadDrawingText[]
}

type RuntimeDxf = Omit<Partial<IDxf>, 'tables'> & {
  tables?: Partial<IDxf['tables']>
}

type CadLayers = Partial<Record<string, ILayer>>

function finiteCoordinate(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_ABSOLUTE_COORDINATE
}

function planarZ(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' && finiteCoordinate(value) && Math.abs(value) < 0.000001)
  )
}

function pointIs2d(point: IPoint | undefined): point is IPoint {
  if (!point || !finiteCoordinate(point.x) || !finiteCoordinate(point.y)) return false
  return planarZ(point.z)
}

function drawingPoint(point: IPoint): CadPoint {
  return { x: point.x, y: -point.y }
}

function includePoint(bounds: MutableBounds, point: CadPoint): void {
  bounds.minX = Math.min(bounds.minX, point.x)
  bounds.minY = Math.min(bounds.minY, point.y)
  bounds.maxX = Math.max(bounds.maxX, point.x)
  bounds.maxY = Math.max(bounds.maxY, point.y)
}

function reservePoints(accumulator: DrawingAccumulator, count: number): void {
  if (accumulator.pointCount + count > MAX_DXF_RENDER_POINTS) {
    throw new CadDrawingError(
      `DXF preview exceeds the ${MAX_DXF_RENDER_POINTS.toLocaleString()}-point render guardrail. Exact source bytes are still retained.`,
      'limit'
    )
  }
  accumulator.pointCount += count
}

function layerColor(entity: IEntity, layers: CadLayers): string {
  const color = entity.color || layers[entity.layer]?.color
  if (!Number.isInteger(color) || !color || color < 0 || color > 0xffffff) return DEFAULT_COLOR
  return `#${color.toString(16).padStart(6, '0')}`
}

function addPath(
  accumulator: DrawingAccumulator,
  entity: IEntity,
  layers: CadLayers,
  points: CadPoint[],
  closed: boolean
): void {
  if (points.length < 2) {
    accumulator.omittedEntityCount += 1
    return
  }
  reservePoints(accumulator, points.length)
  for (const point of points) includePoint(accumulator.bounds, point)
  accumulator.paths.push({
    closed,
    color: layerColor(entity, layers),
    layer: entity.layer || '0',
    points
  })
  accumulator.renderedEntityCount += 1
}

function normalizedSweep(start: number, end: number): number {
  let sweep = end - start
  while (sweep <= 0) sweep += Math.PI * 2
  return Math.min(sweep, Math.PI * 2)
}

function sampledArc(center: IPoint, radius: number, start: number, end: number): CadPoint[] | null {
  if (!pointIs2d(center) || !finiteCoordinate(radius) || radius <= 0) return null
  const sweep = normalizedSweep(start, end)
  const segments = Math.max(8, Math.ceil((CURVE_SEGMENTS * sweep) / (Math.PI * 2)))
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = start + (sweep * index) / segments
    return { x: center.x + Math.cos(angle) * radius, y: -(center.y + Math.sin(angle) * radius) }
  })
}

function sampledEllipse(entity: IEllipseEntity): CadPoint[] | null {
  if (
    !pointIs2d(entity.center) ||
    !pointIs2d(entity.majorAxisEndPoint) ||
    !finiteCoordinate(entity.axisRatio) ||
    entity.axisRatio <= 0
  ) {
    return null
  }
  const start = Number.isFinite(entity.startAngle) ? entity.startAngle : 0
  const end = Number.isFinite(entity.endAngle) ? entity.endAngle : Math.PI * 2
  const sweep = normalizedSweep(start, end)
  const segments = Math.max(12, Math.ceil((CURVE_SEGMENTS * sweep) / (Math.PI * 2)))
  const major = entity.majorAxisEndPoint
  const minorX = -major.y * entity.axisRatio
  const minorY = major.x * entity.axisRatio
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = start + (sweep * index) / segments
    return {
      x: entity.center.x + major.x * Math.cos(angle) + minorX * Math.sin(angle),
      y: -(entity.center.y + major.y * Math.cos(angle) + minorY * Math.sin(angle))
    }
  })
}

function points2d(points: IPoint[] | undefined): CadPoint[] | null {
  if (!points || points.length < 2 || points.some((point) => !pointIs2d(point))) return null
  return points.map(drawingPoint)
}

function readableText(value: string): string {
  return value
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim()
    .slice(0, 2_000)
}

function addText(
  accumulator: DrawingAccumulator,
  entity: IEntity,
  layers: CadLayers,
  point: IPoint | undefined,
  content: string,
  height: number,
  rotation: number
): void {
  if (!pointIs2d(point) || !finiteCoordinate(height) || height <= 0) {
    accumulator.omittedEntityCount += 1
    return
  }
  const text = readableText(content)
  if (!text) {
    accumulator.omittedEntityCount += 1
    return
  }
  const position = drawingPoint(point)
  reservePoints(accumulator, 1)
  includePoint(accumulator.bounds, position)
  includePoint(accumulator.bounds, {
    x: position.x + Math.max(height, text.length * height * 0.55),
    y: position.y + height
  })
  accumulator.texts.push({
    color: layerColor(entity, layers),
    content: text,
    height,
    layer: entity.layer || '0',
    rotation: Number.isFinite(rotation) ? -rotation : 0,
    x: position.x,
    y: position.y
  })
  accumulator.renderedEntityCount += 1
}

function layerIsVisible(entity: IEntity, layers: CadLayers): boolean {
  const layer = layers[entity.layer]
  const isVisible = (value: unknown) => value !== false
  return isVisible(entity.visible) && isVisible(layer?.visible)
}

type EntityRenderer = (entity: IEntity, accumulator: DrawingAccumulator, layers: CadLayers) => void

function omitEntity(accumulator: DrawingAccumulator): void {
  accumulator.omittedEntityCount += 1
}

function renderPathOrOmit(
  entity: IEntity,
  accumulator: DrawingAccumulator,
  layers: CadLayers,
  points: CadPoint[] | null,
  closed: boolean
): void {
  if (!points) {
    omitEntity(accumulator)
    return
  }
  addPath(accumulator, entity, layers, points, closed)
}

const renderLine: EntityRenderer = (entity, accumulator, layers) => {
  renderPathOrOmit(entity, accumulator, layers, points2d((entity as ILineEntity).vertices), false)
}

const renderLwPolyline: EntityRenderer = (entity, accumulator, layers) => {
  const polyline = entity as ILwpolylineEntity
  if (polyline.vertices.some((vertex) => vertex.bulge && Math.abs(vertex.bulge) > 0.000001)) {
    omitEntity(accumulator)
    return
  }
  renderPathOrOmit(entity, accumulator, layers, points2d(polyline.vertices), polyline.shape)
}

const renderPolyline: EntityRenderer = (entity, accumulator, layers) => {
  const polyline = entity as IPolylineEntity
  const points = points2d(polyline.vertices)
  if (!polyline.is3dPolyline && !polyline.is3dPolygonMesh && points) {
    addPath(accumulator, entity, layers, points, polyline.shape)
  } else {
    omitEntity(accumulator)
  }
}

const renderCircle: EntityRenderer = (entity, accumulator, layers) => {
  const circle = entity as ICircleEntity
  renderPathOrOmit(
    entity,
    accumulator,
    layers,
    sampledArc(circle.center, circle.radius, 0, Math.PI * 2),
    true
  )
}

const renderArc: EntityRenderer = (entity, accumulator, layers) => {
  const arc = entity as IArcEntity
  renderPathOrOmit(
    entity,
    accumulator,
    layers,
    sampledArc(arc.center, arc.radius, arc.startAngle, arc.endAngle),
    false
  )
}

const renderEllipse: EntityRenderer = (entity, accumulator, layers) => {
  const ellipse = entity as IEllipseEntity
  renderPathOrOmit(
    entity,
    accumulator,
    layers,
    sampledEllipse(ellipse),
    normalizedSweep(ellipse.startAngle, ellipse.endAngle) >= Math.PI * 2 - 0.000001
  )
}

const renderPointEntity: EntityRenderer = (entity, accumulator, layers) => {
  const point = (entity as IPointEntity).position
  if (!pointIs2d(point)) {
    omitEntity(accumulator)
    return
  }
  const center = drawingPoint(point)
  addPath(
    accumulator,
    entity,
    layers,
    [
      { x: center.x - 0.5, y: center.y },
      { x: center.x + 0.5, y: center.y }
    ],
    false
  )
}

const renderSolid: EntityRenderer = (entity, accumulator, layers) => {
  renderPathOrOmit(entity, accumulator, layers, points2d((entity as ISolidEntity).points), true)
}

const renderFace: EntityRenderer = (entity, accumulator, layers) => {
  renderPathOrOmit(entity, accumulator, layers, points2d((entity as I3DfaceEntity).vertices), true)
}

const renderText: EntityRenderer = (entity, accumulator, layers) => {
  const text = entity as ITextEntity
  addText(accumulator, entity, layers, text.startPoint, text.text, text.textHeight, text.rotation)
}

const renderMtext: EntityRenderer = (entity, accumulator, layers) => {
  const text = entity as IMtextEntity
  addText(accumulator, entity, layers, text.position, text.text, text.height, text.rotation)
}

const ENTITY_RENDERERS = new Map<string, EntityRenderer>([
  ['3DFACE', renderFace],
  ['ARC', renderArc],
  ['CIRCLE', renderCircle],
  ['ELLIPSE', renderEllipse],
  ['LINE', renderLine],
  ['LWPOLYLINE', renderLwPolyline],
  ['MTEXT', renderMtext],
  ['POINT', renderPointEntity],
  ['POLYLINE', renderPolyline],
  ['SOLID', renderSolid],
  ['TEXT', renderText]
])

function renderEntity(entity: IEntity, accumulator: DrawingAccumulator, layers: CadLayers): void {
  const renderer = ENTITY_RENDERERS.get(entity.type)
  if (!renderer || !layerIsVisible(entity, layers)) {
    omitEntity(accumulator)
    return
  }
  renderer(entity, accumulator, layers)
}

function drawingBounds(bounds: MutableBounds): CadDrawingBounds {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)) {
    return { height: 2, maxX: 1, maxY: 1, minX: -1, minY: -1, width: 2 }
  }
  const width = Math.max(bounds.maxX - bounds.minX, 0.001)
  const height = Math.max(bounds.maxY - bounds.minY, 0.001)
  return { ...bounds, height, width }
}

function drawingUnits(value: unknown): string {
  return typeof value === 'number'
    ? (UNIT_LABELS.get(value) ?? `Unit code ${value}`)
    : 'Unknown units'
}

export function parseDxfDrawing(bytes: Uint8Array): CadDrawing {
  if (bytes.byteLength === 0) throw new CadDrawingError('DXF source is empty.', 'invalid')
  if (bytes.byteLength > MAX_DXF_SOURCE_BYTES) {
    throw new CadDrawingError(
      `DXF source exceeds the ${MAX_DXF_SOURCE_BYTES.toLocaleString()}-byte preview guardrail.`,
      'limit'
    )
  }
  const prefix = new TextDecoder().decode(bytes.subarray(0, 32))
  if (prefix.startsWith('AutoCAD Binary DXF')) {
    throw new CadDrawingError(
      'Binary DXF is retained but not rendered; export ASCII DXF for the read-only viewer.',
      'unsupported'
    )
  }
  let parsed: ReturnType<DxfParser['parseSync']>
  try {
    parsed = new DxfParser().parseSync(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new CadDrawingError(
      error instanceof Error
        ? `DXF could not be parsed: ${error.message}`
        : 'DXF could not be parsed.',
      'invalid'
    )
  }
  const document: RuntimeDxf | null = parsed
  if (!document || !Array.isArray(document.entities)) {
    throw new CadDrawingError('DXF does not contain a readable ENTITIES section.', 'invalid')
  }
  if (document.entities.length > MAX_DXF_ENTITIES) {
    throw new CadDrawingError(
      `DXF contains ${document.entities.length.toLocaleString()} entities; the viewer limit is ${MAX_DXF_ENTITIES.toLocaleString()}.`,
      'limit'
    )
  }
  const layers = document.tables?.layer?.layers ?? {}
  const accumulator: DrawingAccumulator = {
    bounds: {
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY
    },
    omittedEntityCount: 0,
    paths: [],
    pointCount: 0,
    renderedEntityCount: 0,
    texts: []
  }
  for (const entity of document.entities) renderEntity(entity, accumulator, layers)
  if (accumulator.renderedEntityCount === 0) {
    throw new CadDrawingError(
      'DXF contains no supported visible 2D entities. Exact source bytes are still retained.',
      'unsupported'
    )
  }
  return {
    bounds: drawingBounds(accumulator.bounds),
    entityCount: document.entities.length,
    layerCount: new Set(document.entities.map((entity) => entity.layer || '0')).size,
    omittedEntityCount: accumulator.omittedEntityCount,
    paths: accumulator.paths,
    renderedEntityCount: accumulator.renderedEntityCount,
    texts: accumulator.texts,
    units: drawingUnits(document.header?.$INSUNITS)
  }
}
