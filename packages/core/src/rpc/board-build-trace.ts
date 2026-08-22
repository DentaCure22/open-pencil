import type { Rect } from '@open-pencil/scene-graph'

export const BOARD_BUILD_TRACE_OBJECT_ID = '$trace' as const
export const BOARD_BUILD_TRACE_REGION_KIND = 'trace_region' as const

type JsonRecord = Record<string, unknown>

export type BoardBuildTraceContext = {
  base: JsonRecord
  candidateObjectIds: string[]
  gestureId: string
  region: Rect
  selectedObjectId?: string
}

export type BoardBuildTraceMaterialization = {
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
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Trace build preparation requires ${field}.`)
  }
  return value.trim()
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
  return {
    base: structuredClone(requiredRecord(preparation.board_build_base, 'board_build_base')),
    candidateObjectIds: stringArray(resolution.candidate_object_ids),
    gestureId: requiredString(preparation.gesture_id, 'gesture_id'),
    region,
    ...(selectedObjectId ? { selectedObjectId } : {})
  }
}

export function materializeBoardBuildTrace(
  value: unknown,
  context: BoardBuildTraceContext
): BoardBuildTraceMaterialization {
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
    objectReferenceCount,
    regionReferenceCount,
    value: materialized
  }
}
