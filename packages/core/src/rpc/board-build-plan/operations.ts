import {
  boardBuildPlanReferenceKey,
  boundedNumber,
  DIRECTIONS,
  exactFields,
  isRecord,
  OBJECT_PATCH_FIELDS,
  parseCodeObjectViewport,
  requiredString
} from './parsing'
import type { JsonRecord } from './parsing'
import type {
  BoardBuildPlanAbsoluteMoveOperation,
  BoardBuildPlanBounds,
  BoardBuildPlanDirection,
  BoardBuildPlanObjectPatch,
  BoardBuildPlanOperation,
  BoardBuildPlanRelativeMove,
  BoardBuildPlanRelativeMoveOperation,
  BoardBuildPlanResolvedOperation
} from './types'

export { boardBuildPlanReferenceKey }

function parseObjectPatch(value: unknown, label: string): BoardBuildPlanObjectPatch {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, [...OBJECT_PATCH_FIELDS], label)
  if (Object.keys(value).length === 0) throw new Error(`${label} cannot be empty.`)
  const patch: BoardBuildPlanObjectPatch = {}
  if (value.cornerRadius !== undefined) {
    patch.cornerRadius = boundedNumber(value.cornerRadius, `${label}.cornerRadius`, 0, 100_000)
  }
  if (value.fill !== undefined) {
    patch.fill = requiredString(value.fill, `${label}.fill`, 32)
  }
  if (value.name !== undefined) patch.name = requiredString(value.name, `${label}.name`, 240)
  if (value.text !== undefined) patch.text = requiredString(value.text, `${label}.text`, 10_000)
  for (const field of ['locked', 'visible'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') {
      throw new Error(`${label}.${field} must be a boolean.`)
    }
    if (typeof value[field] === 'boolean') patch[field] = value[field]
  }
  if (value.opacity !== undefined) {
    patch.opacity = boundedNumber(value.opacity, `${label}.opacity`, 0, 1)
  }
  return patch
}

function parseMoveOperation(
  value: JsonRecord,
  objectId: string,
  label: string
): BoardBuildPlanAbsoluteMoveOperation | BoardBuildPlanRelativeMoveOperation {
  const hasCoordinates = value.x !== undefined || value.y !== undefined
  const hasRelativeTarget = value.relative_to !== undefined
  if (hasCoordinates === hasRelativeTarget) {
    throw new Error(`${label} must use either x and y or relative_to.`)
  }
  if (!hasRelativeTarget) {
    exactFields(value, ['kind', 'object_id', 'x', 'y'], label)
    return {
      kind: 'object.move',
      object_id: objectId,
      x: boundedNumber(value.x, `${label}.x`, -1_000_000, 1_000_000),
      y: boundedNumber(value.y, `${label}.y`, -1_000_000, 1_000_000)
    }
  }
  exactFields(value, ['kind', 'object_id', 'relative_to'], label)
  if (!isRecord(value.relative_to)) {
    throw new TypeError(`${label}.relative_to must be an object.`)
  }
  exactFields(value.relative_to, ['align', 'gap', 'object_id', 'side'], `${label}.relative_to`)
  const relativeObjectId = requiredString(
    value.relative_to.object_id,
    `${label}.relative_to.object_id`,
    240
  )
  if (relativeObjectId === objectId) {
    throw new Error(`${label}.relative_to.object_id must reference a different object.`)
  }
  const side = requiredString(value.relative_to.side, `${label}.relative_to.side`)
  if (!DIRECTIONS.has(side as BoardBuildPlanDirection)) {
    throw new Error(`${label}.relative_to.side must be above, below, left, or right.`)
  }
  const align = value.relative_to.align
  if (align !== undefined && align !== 'start' && align !== 'center' && align !== 'end') {
    throw new Error(`${label}.relative_to.align must be start, center, or end.`)
  }
  return {
    kind: 'object.move',
    object_id: objectId,
    relative_to: {
      ...(align === undefined ? {} : { align }),
      ...(value.relative_to.gap === undefined
        ? {}
        : { gap: boundedNumber(value.relative_to.gap, `${label}.relative_to.gap`, 0, 10_000) }),
      object_id: relativeObjectId,
      side: side as BoardBuildPlanDirection
    }
  }
}

export function parseOperation(value: unknown, index: number): BoardBuildPlanOperation {
  const label = `plan.operations[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  const kind = requiredString(value.kind, `${label}.kind`)
  if (kind === 'transaction.revert') {
    exactFields(value, ['kind', 'transaction_id'], label)
    return {
      kind,
      transaction_id: requiredString(value.transaction_id, `${label}.transaction_id`, 240)
    }
  }
  const objectId = requiredString(value.object_id, `${label}.object_id`, 240)
  if (kind === 'canonical_object.fork') {
    exactFields(value, ['kind', 'object_id'], label)
    return { kind, object_id: objectId }
  }
  if (kind === 'object.update') {
    exactFields(value, ['kind', 'object_id', 'patch'], label)
    return { kind, object_id: objectId, patch: parseObjectPatch(value.patch, `${label}.patch`) }
  }
  if (kind === 'object.move') {
    return parseMoveOperation(value, objectId, label)
  }
  if (kind === 'object.resize') {
    exactFields(value, ['height', 'kind', 'object_id', 'viewport_preset', 'width'], label)
    const { preset: viewportPreset, viewport } = parseCodeObjectViewport(value, label)
    return {
      height: viewport?.height ?? boundedNumber(value.height, `${label}.height`, 1, 100_000),
      kind,
      object_id: objectId,
      ...(viewportPreset ? { viewport_preset: viewportPreset } : {}),
      width: viewport?.width ?? boundedNumber(value.width, `${label}.width`, 1, 100_000)
    }
  }
  if (kind === 'object.duplicate') {
    exactFields(value, ['kind', 'object_id', 'offset_x', 'offset_y'], label)
    return {
      kind,
      object_id: objectId,
      ...(value.offset_x === undefined
        ? {}
        : { offset_x: boundedNumber(value.offset_x, `${label}.offset_x`, -10_000, 10_000) }),
      ...(value.offset_y === undefined
        ? {}
        : { offset_y: boundedNumber(value.offset_y, `${label}.offset_y`, -10_000, 10_000) })
    }
  }
  if (kind === 'object.delete') {
    exactFields(value, ['kind', 'object_id'], label)
    return { kind, object_id: objectId }
  }
  throw new Error(
    `${label}.kind must be canonical_object.fork, transaction.revert, object.update, object.move, object.resize, object.duplicate, or object.delete.`
  )
}

const DEFAULT_RELATIVE_MOVE_GAP = 48

function relativeMovePosition(
  moving: BoardBuildPlanBounds,
  anchor: BoardBuildPlanBounds,
  relative: BoardBuildPlanRelativeMove
): Pick<BoardBuildPlanBounds, 'x' | 'y'> {
  const align = relative.align ?? 'start'
  const gap = relative.gap ?? DEFAULT_RELATIVE_MOVE_GAP
  const horizontal = relative.side === 'left' || relative.side === 'right'
  const crossAxisPosition = (
    anchorStart: number,
    anchorSize: number,
    movingSize: number
  ): number => {
    if (align === 'center') return anchorStart + (anchorSize - movingSize) / 2
    if (align === 'end') return anchorStart + anchorSize - movingSize
    return anchorStart
  }
  if (horizontal) {
    return {
      x: relative.side === 'left' ? anchor.x - moving.width - gap : anchor.x + anchor.width + gap,
      y: crossAxisPosition(anchor.y, anchor.height, moving.height)
    }
  }
  return {
    x: crossAxisPosition(anchor.x, anchor.width, moving.width),
    y: relative.side === 'above' ? anchor.y - moving.height - gap : anchor.y + anchor.height + gap
  }
}

export function resolveBoardBuildPlanOperations(
  operations: readonly BoardBuildPlanOperation[] | undefined,
  boundsForObject: (objectId: string) => BoardBuildPlanBounds | undefined
): BoardBuildPlanResolvedOperation[] {
  const bounds = new Map<string, BoardBuildPlanBounds>()
  const deleted = new Set<string>()
  const requireBounds = (objectId: string, label: string): BoardBuildPlanBounds => {
    if (deleted.has(objectId)) throw new Error(`${label} references a deleted object.`)
    const cached = bounds.get(objectId)
    if (cached) return cached
    const resolved = boundsForObject(objectId)
    if (
      !resolved ||
      ![resolved.x, resolved.y, resolved.width, resolved.height].every(Number.isFinite)
    ) {
      throw new Error(`${label} object "${objectId}" has no usable Board bounds.`)
    }
    const copied = { ...resolved }
    bounds.set(objectId, copied)
    return copied
  }

  return (operations ?? []).flatMap((operation, index): BoardBuildPlanResolvedOperation[] => {
    const label = `plan.operations[${index}]`
    if (operation.kind === 'object.delete') {
      deleted.add(operation.object_id)
      bounds.delete(operation.object_id)
      return [operation]
    }
    if (operation.kind === 'object.move' && 'relative_to' in operation) {
      const moving = requireBounds(operation.object_id, `${label}.object_id`)
      const anchor = requireBounds(
        operation.relative_to.object_id,
        `${label}.relative_to.object_id`
      )
      const position = relativeMovePosition(moving, anchor, operation.relative_to)
      bounds.set(operation.object_id, { ...moving, ...position })
      return [{ kind: operation.kind, object_id: operation.object_id, ...position }]
    }
    if (operation.kind === 'object.move') {
      const moving = requireBounds(operation.object_id, `${label}.object_id`)
      bounds.set(operation.object_id, { ...moving, x: operation.x, y: operation.y })
    } else if (operation.kind === 'object.resize') {
      const moving = requireBounds(operation.object_id, `${label}.object_id`)
      bounds.set(operation.object_id, {
        ...moving,
        height: operation.height,
        width: operation.width
      })
    }
    return [operation]
  })
}
