import { parseObjectGraphPorts, type ObjectGraphPortDefinition } from '@open-pencil/scene-graph'

import type {
  BoardBuildPlanDirection,
  BoardBuildPlanLayoutAnchor,
  BoardBuildPlanNearRegionTarget,
  BoardBuildPlanPlacement,
  BoardBuildPlanPlacementTarget,
  BoardBuildPlanReference,
  BoardBuildPlanRegionTarget,
  BoardBuildPlanRelativeOffset
} from './types'

export type JsonRecord = Record<string, unknown>

const ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
export const NATIVE_CARD_ADAPTIVE_WIDTH = 640
export const NATIVE_CARD_SOFT_BODY_FIT_BUDGET = 700
export const DIRECTIONS = new Set<BoardBuildPlanDirection>(['above', 'below', 'left', 'right'])
const DIRECTION_FALLBACK_ORDER: readonly BoardBuildPlanDirection[] = [
  'right',
  'below',
  'above',
  'left'
]
const DIRECTION_ALIASES = new Map<string, BoardBuildPlanDirection>([
  ['bottom', 'below'],
  ['down', 'below'],
  ['top', 'above'],
  ['up', 'above']
])
const DIRECTION_EXPANSIONS = new Map<string, BoardBuildPlanDirection[]>([
  ['above-left', ['above', 'left']],
  ['above-right', ['above', 'right']],
  ['below-left', ['below', 'left']],
  ['below-right', ['below', 'right']],
  ['bottom-left', ['below', 'left']],
  ['bottom-right', ['below', 'right']],
  ['down-left', ['below', 'left']],
  ['down-right', ['below', 'right']],
  ['lower-left', ['below', 'left']],
  ['lower-right', ['below', 'right']],
  ['top-left', ['above', 'left']],
  ['top-right', ['above', 'right']],
  ['up-left', ['above', 'left']],
  ['up-right', ['above', 'right']],
  ['upper-left', ['above', 'left']],
  ['upper-right', ['above', 'right']]
])
export const DIRECTION_OFFSETS = new Map<string, BoardBuildPlanRelativeOffset>([
  ['above-left', { column: -1, row: -1 }],
  ['above-right', { column: 1, row: -1 }],
  ['below-left', { column: -1, row: 1 }],
  ['below-right', { column: 1, row: 1 }],
  ['bottom-left', { column: -1, row: 1 }],
  ['bottom-right', { column: 1, row: 1 }],
  ['down-left', { column: -1, row: 1 }],
  ['down-right', { column: 1, row: 1 }],
  ['lower-left', { column: -1, row: 1 }],
  ['lower-right', { column: 1, row: 1 }],
  ['top-left', { column: -1, row: -1 }],
  ['top-right', { column: 1, row: -1 }],
  ['up-left', { column: -1, row: -1 }],
  ['up-right', { column: 1, row: -1 }],
  ['upper-left', { column: -1, row: -1 }],
  ['upper-right', { column: 1, row: -1 }]
])
export const PORT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u
export const OBJECT_PATCH_FIELDS = new Set([
  'cornerRadius',
  'fill',
  'locked',
  'name',
  'opacity',
  'text',
  'visible'
])

export function preferredDirectionOffset(value: unknown): BoardBuildPlanRelativeOffset | undefined {
  if (!Array.isArray(value)) return undefined
  const first = value[0]
  return typeof first === 'string' ? DIRECTION_OFFSETS.get(first.replace(' ', '-')) : undefined
}

export function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function exactFields(value: JsonRecord, fields: readonly string[], label: string): void {
  const allowed = new Set(fields)
  const unexpected = Object.keys(value).filter((field) => !allowed.has(field))
  if (unexpected.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unexpected.sort().join(', ')}.`)
  }
}

export function requiredString(value: unknown, label: string, maximum?: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`)
  const result = value.trim()
  if (maximum !== undefined && result.length > maximum) {
    throw new Error(`${label} must contain at most ${maximum} characters.`)
  }
  return result
}

export function optionalString(
  value: unknown,
  label: string,
  maximum?: number
): string | undefined {
  if (value === undefined) return undefined
  return requiredString(value, label, maximum)
}

export function optionalText(value: unknown, label: string, maximum: number): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`)
  const result = value.trim()
  if (result.length > maximum) {
    throw new Error(`${label} must contain at most ${maximum} characters.`)
  }
  return result
}

export function boundedNumber(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

export function isPlainJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (typeof value !== 'object' || ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isPlainJson(entry, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((entry) => isPlainJson(entry, ancestors))
  ancestors.delete(value)
  return valid
}

export function optionalPlainJsonObject(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value) || !isPlainJson(value)) {
    throw new Error(`${label} must be a plain JSON object.`)
  }
  return structuredClone(value)
}

export function parsePortDefinitions(
  value: unknown,
  label: string
): ObjectGraphPortDefinition[] | undefined {
  if (value === undefined) return undefined
  const ports = parseObjectGraphPorts(value)
  if (!ports) {
    throw new Error(
      `${label} must contain at most 256 unique named ports with id, label, direction, kinds, side, and offset.`
    )
  }
  return ports
}

export function parseAlias(value: unknown, label: string): string {
  const alias = requiredString(value, label, 64)
  if (!ALIAS_PATTERN.test(alias)) {
    throw new Error(`${label} must match ${String(ALIAS_PATTERN)}.`)
  }
  return alias
}

export function parseReference(value: unknown, label: string): BoardBuildPlanReference {
  if (typeof value === 'string') return { alias: parseAlias(value, label) }
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, ['alias', 'object_id'], label)
  const hasAlias = value.alias !== undefined
  const hasObjectId = value.object_id !== undefined
  if (hasAlias === hasObjectId) {
    throw new Error(`${label} requires exactly one of alias or object_id.`)
  }
  return hasAlias
    ? { alias: parseAlias(value.alias, `${label}.alias`) }
    : { object_id: requiredString(value.object_id, `${label}.object_id`, 256) }
}

export function boardBuildPlanReferenceKey(reference: BoardBuildPlanReference): string {
  return 'alias' in reference ? `alias:${reference.alias}` : `object:${reference.object_id}`
}

export function parseDirections(
  value: unknown,
  label: string
): BoardBuildPlanDirection[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new Error(`${label} must contain one to four unique directions.`)
  }
  const directions = value.flatMap((direction) => {
    if (typeof direction !== 'string') {
      throw new Error(`${label} contains an unsupported direction.`)
    }
    const directionKey = direction.replace(' ', '-')
    const expansion = DIRECTION_EXPANSIONS.get(directionKey)
    if (expansion) return expansion
    const normalized = DIRECTION_ALIASES.get(directionKey) ?? directionKey
    if (!DIRECTIONS.has(normalized as BoardBuildPlanDirection)) {
      throw new Error(`${label} contains an unsupported direction.`)
    }
    return [normalized as BoardBuildPlanDirection]
  })
  const selected = new Set(directions)
  return [...selected, ...DIRECTION_FALLBACK_ORDER.filter((direction) => !selected.has(direction))]
}

export function parsePlacementTarget(value: unknown, label: string): BoardBuildPlanPlacementTarget {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const kind = requiredString(value.kind, `${label}.kind`)
  if (kind === 'auto') {
    exactFields(value, ['kind'], label)
    return { kind }
  }
  if (kind === 'point') {
    exactFields(value, ['kind', 'x', 'y'], label)
    return {
      kind,
      x: boundedNumber(value.x, `${label}.x`, -1_000_000, 1_000_000),
      y: boundedNumber(value.y, `${label}.y`, -1_000_000, 1_000_000)
    }
  }
  if (kind === 'relative') {
    exactFields(value, ['kind', 'object_id'], label)
    return {
      kind,
      object_id: requiredString(value.object_id, `${label}.object_id`, 256)
    }
  }
  if (kind === 'near_region' || kind === 'region') {
    exactFields(value, ['height', 'kind', 'width', 'x', 'y'], label)
    return {
      height: boundedNumber(value.height, `${label}.height`, 1, 1_000_000),
      kind,
      width: boundedNumber(value.width, `${label}.width`, 1, 1_000_000),
      x: boundedNumber(value.x, `${label}.x`, -1_000_000, 1_000_000),
      y: boundedNumber(value.y, `${label}.y`, -1_000_000, 1_000_000)
    }
  }
  throw new Error(`${label}.kind must be auto, near_region, point, relative, or region.`)
}

export function parseLayoutAnchor(value: unknown, label: string): BoardBuildPlanLayoutAnchor {
  if (isRecord(value) && (value.kind === 'near_region' || value.kind === 'region')) {
    return parsePlacementTarget(value, label) as
      | BoardBuildPlanNearRegionTarget
      | BoardBuildPlanRegionTarget
  }
  return parseReference(value, label)
}

export function parsePlacement(
  value: unknown,
  label: string,
  allowTarget: boolean
): BoardBuildPlanPlacement | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(
    value,
    allowTarget
      ? ['clearance', 'preferred_directions', 'relative_offset', 'target']
      : ['clearance', 'preferred_directions', 'relative_offset'],
    label
  )
  const clearance =
    value.clearance === undefined
      ? undefined
      : boundedNumber(value.clearance, `${label}.clearance`, 0, 1_024)
  const preferredDirections = parseDirections(
    value.preferred_directions,
    `${label}.preferred_directions`
  )
  let relativeOffset: BoardBuildPlanRelativeOffset | undefined
  if (value.relative_offset !== undefined) {
    if (!isRecord(value.relative_offset)) {
      throw new Error(`${label}.relative_offset must be an object.`)
    }
    exactFields(value.relative_offset, ['column', 'row'], `${label}.relative_offset`)
    const column = value.relative_offset.column
    const row = value.relative_offset.row
    if (
      (column !== -1 && column !== 0 && column !== 1) ||
      (row !== -1 && row !== 0 && row !== 1) ||
      (column === 0 && row === 0)
    ) {
      throw new Error(`${label}.relative_offset must use -1, 0, or 1 and cannot be zero/zero.`)
    }
    relativeOffset = { column, row }
  }
  const target =
    allowTarget && value.target !== undefined
      ? parsePlacementTarget(value.target, `${label}.target`)
      : undefined
  return {
    ...(clearance === undefined ? {} : { clearance }),
    ...(preferredDirections ? { preferred_directions: preferredDirections } : {}),
    ...(relativeOffset ? { relative_offset: relativeOffset } : {}),
    ...(target ? { target } : {})
  }
}

export function boundedInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): number {
  const result = boundedNumber(value, label, minimum, maximum)
  if (!Number.isInteger(result)) throw new Error(`${label} must be an integer.`)
  return result
}
