import {
  objectGraphConnectionsOnPage,
  resolveObjectGraphPorts,
  type ObjectGraphConnection,
  type Rect,
  type SceneGraph,
  type Vector
} from '@open-pencil/scene-graph'

export const BOARD_BUILD_TRACE_OBJECT_ID = '$trace' as const
export const BOARD_BUILD_TRACE_REGION_KIND = 'trace_region' as const
export const BOARD_BUILD_TRACE_CONNECTION_DELETE_KIND = 'connection.delete_traced' as const

export type BoardBuildTraceConnectionOrientation = 'any' | 'horizontal' | 'vertical'

export type BoardBuildTraceConnectionDelete = {
  kind: typeof BOARD_BUILD_TRACE_CONNECTION_DELETE_KIND
  object_ids: string[]
  orientation: BoardBuildTraceConnectionOrientation
  region: Rect
}

type JsonRecord = Record<string, unknown>

export type BoardBuildTraceContext = {
  base: JsonRecord
  candidateObjectIds: string[]
  connectionCount: number
  gestureId: string
  region: Rect
  selectedObjectId?: string
}

export type BoardBuildTraceMaterialization = {
  connectionScopeCount: number
  objectReferenceCount: number
  regionReferenceCount: number
  value: unknown
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`Trace build preparation requires ${field}.`)
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)
  if (!result) throw new Error(`Trace build preparation requires ${field}.`)
  return result
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Trace build preparation requires finite ${field}.`)
  }
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []))
    )
  ].slice(0, 25)
}

function pointInRect(point: Vector, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

function orientation(
  first: Vector,
  second: Vector
): Exclude<BoardBuildTraceConnectionOrientation, 'any'> {
  return Math.abs(second.y - first.y) >= Math.abs(second.x - first.x) ? 'vertical' : 'horizontal'
}

function cross(first: Vector, second: Vector, third: Vector): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x)
}

const SEGMENT_EPSILON = 0.000001

function pointOnSegment(first: Vector, second: Vector, point: Vector): boolean {
  return (
    Math.abs(cross(first, second, point)) <= SEGMENT_EPSILON &&
    point.x >= Math.min(first.x, second.x) - SEGMENT_EPSILON &&
    point.x <= Math.max(first.x, second.x) + SEGMENT_EPSILON &&
    point.y >= Math.min(first.y, second.y) - SEGMENT_EPSILON &&
    point.y <= Math.max(first.y, second.y) + SEGMENT_EPSILON
  )
}

function segmentsIntersect(a: Vector, b: Vector, c: Vector, d: Vector): boolean {
  const abC = cross(a, b, c)
  const abD = cross(a, b, d)
  const cdA = cross(c, d, a)
  const cdB = cross(c, d, b)
  if (
    ((abC > SEGMENT_EPSILON && abD < -SEGMENT_EPSILON) ||
      (abC < -SEGMENT_EPSILON && abD > SEGMENT_EPSILON)) &&
    ((cdA > SEGMENT_EPSILON && cdB < -SEGMENT_EPSILON) ||
      (cdA < -SEGMENT_EPSILON && cdB > SEGMENT_EPSILON))
  ) {
    return true
  }
  return (
    pointOnSegment(a, b, c) ||
    pointOnSegment(a, b, d) ||
    pointOnSegment(c, d, a) ||
    pointOnSegment(c, d, b)
  )
}

function segmentIntersectsRect(first: Vector, second: Vector, rect: Rect): boolean {
  if (pointInRect(first, rect) || pointInRect(second, rect)) return true
  const topLeft = { x: rect.x, y: rect.y }
  const topRight = { x: rect.x + rect.width, y: rect.y }
  const bottomLeft = { x: rect.x, y: rect.y + rect.height }
  const bottomRight = { x: rect.x + rect.width, y: rect.y + rect.height }
  return (
    segmentsIntersect(first, second, topLeft, topRight) ||
    segmentsIntersect(first, second, topRight, bottomRight) ||
    segmentsIntersect(first, second, bottomRight, bottomLeft) ||
    segmentsIntersect(first, second, bottomLeft, topLeft)
  )
}

export function boardBuildTracedConnections(
  graph: SceneGraph,
  pageId: string,
  scope: BoardBuildTraceConnectionDelete
): ObjectGraphConnection[] {
  const objectIds = new Set(scope.object_ids)
  return objectGraphConnectionsOnPage(graph, pageId)
    .filter((connection) => {
      const ports = resolveObjectGraphPorts(graph, connection)
      if (!ports) return false
      const endpointsCaptured =
        objectIds.has(connection.sourceNodeId) && objectIds.has(connection.targetNodeId)
      const intersectsRegion = segmentIntersectsRect(
        ports.source.anchor.point,
        ports.target.anchor.point,
        scope.region
      )
      if (!endpointsCaptured && !intersectsRegion) return false
      return (
        scope.orientation === 'any' ||
        scope.orientation === orientation(ports.source.anchor.point, ports.target.anchor.point)
      )
    })
    .slice(0, 32)
}

export function boardBuildTraceContext(value: unknown): BoardBuildTraceContext {
  const preparation = requiredRecord(value, 'a result object')
  if (preparation.contract !== 'board-edit-context/v1') {
    throw new Error('Trace build preparation requires board-edit-context/v1.')
  }
  const resolution = requiredRecord(preparation.resolution, 'resolution')
  const regionValue = requiredRecord(preparation.trace_region, 'trace_region')
  const region = {
    height: finiteNumber(regionValue.height, 'trace_region.height'),
    width: finiteNumber(regionValue.width, 'trace_region.width'),
    x: finiteNumber(regionValue.x, 'trace_region.x'),
    y: finiteNumber(regionValue.y, 'trace_region.y')
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new Error('Trace build preparation requires a positive trace region.')
  }
  const selectedObjectId = optionalString(resolution.selected_object_id)
  const traceConnections = isRecord(preparation.trace_connections)
    ? preparation.trace_connections
    : null
  return {
    base: structuredClone(requiredRecord(preparation.board_build_base, 'board_build_base')),
    candidateObjectIds: stringArray(resolution.candidate_object_ids),
    connectionCount:
      typeof traceConnections?.count === 'number' && Number.isInteger(traceConnections.count)
        ? traceConnections.count
        : 0,
    gestureId: requiredString(preparation.gesture_id, 'gesture_id'),
    region,
    ...(selectedObjectId ? { selectedObjectId } : {})
  }
}

export function materializeBoardBuildTrace(
  value: unknown,
  context: BoardBuildTraceContext
): BoardBuildTraceMaterialization {
  let connectionScopeCount = 0
  let objectReferenceCount = 0
  let regionReferenceCount = 0

  const materialize = (item: unknown): unknown => {
    if (item === BOARD_BUILD_TRACE_OBJECT_ID) {
      if (!context.selectedObjectId) {
        throw new Error(
          'The Trace did not resolve one selected object; use trace_region placement or capture a more specific gesture.'
        )
      }
      objectReferenceCount += 1
      return context.selectedObjectId
    }
    if (Array.isArray(item)) return item.map(materialize)
    if (!isRecord(item)) return item
    if (item.kind === BOARD_BUILD_TRACE_CONNECTION_DELETE_KIND) {
      const fields = Object.keys(item)
      if (fields.some((field) => field !== 'kind' && field !== 'orientation')) {
        throw new Error(
          'connection.delete_traced accepts only kind and optional orientation before Trace preparation.'
        )
      }
      const traceOrientation = item.orientation ?? 'any'
      if (
        traceOrientation !== 'any' &&
        traceOrientation !== 'horizontal' &&
        traceOrientation !== 'vertical'
      ) {
        throw new Error(
          'connection.delete_traced orientation must be any, horizontal, or vertical.'
        )
      }
      connectionScopeCount += 1
      return {
        kind: BOARD_BUILD_TRACE_CONNECTION_DELETE_KIND,
        object_ids: structuredClone(context.candidateObjectIds),
        orientation: traceOrientation,
        region: structuredClone(context.region)
      }
    }
    if (item.kind === BOARD_BUILD_TRACE_REGION_KIND) {
      if (Object.keys(item).length !== 1) {
        throw new Error('trace_region placeholder cannot include additional fields.')
      }
      regionReferenceCount += 1
      return { kind: 'near_region', ...context.region }
    }
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, materialize(child)]))
  }

  const materialized = materialize(value)
  return {
    connectionScopeCount,
    objectReferenceCount,
    regionReferenceCount,
    value: materialized
  }
}
