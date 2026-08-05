import { codeObjectViewportPreset, isCodeObjectViewportPresetId } from '#core/code-object/viewport'
import type { BoardBuildTraceConnectionDelete } from '#core/rpc/board-build-trace'

import { assertReferenceAvailable } from './artifacts'
import {
  boardBuildPlanReferenceKey,
  boundedNumber,
  DIRECTIONS,
  exactFields,
  isRecord,
  OBJECT_PATCH_FIELDS,
  optionalString,
  parseReference,
  PORT_ID_PATTERN,
  requiredString
} from './parsing'
import type { JsonRecord } from './parsing'
import type {
  BoardBuildPlanAbsoluteMoveOperation,
  BoardBuildPlan,
  BoardBuildPlanBounds,
  BoardBuildPlanConnection,
  BoardBuildPlanConnectionKind,
  BoardBuildPlanDirection,
  BoardBuildPlanObjectPatch,
  BoardBuildPlanOperation,
  BoardBuildPlanPort,
  BoardBuildPlanReference,
  BoardBuildPlanRelativeMove,
  BoardBuildPlanRelativeMoveOperation,
  BoardBuildPlanResolvedOperation
} from './types'

function parsePort(value: unknown, label: string): BoardBuildPlanPort | undefined {
  if (value === undefined) return undefined
  const port = requiredString(value, label)
  if (!PORT_ID_PATTERN.test(port)) {
    throw new Error(
      `${label} must be a side (auto, bottom, left, right, top) or a stable named port ID.`
    )
  }
  return port
}

export { boardBuildPlanReferenceKey }

export function boardBuildPlanInboundReferences(
  plan: BoardBuildPlan,
  targetAlias: string
): BoardBuildPlanReference[] {
  const references = plan.connections
    .filter((connection) => 'alias' in connection.target && connection.target.alias === targetAlias)
    .map((connection) => connection.source)
  const seen = new Set<string>()
  return references.filter((reference) => {
    const key = boardBuildPlanReferenceKey(reference)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function boardBuildPlanConvergenceAnchor(
  sourceBounds: readonly BoardBuildPlanBounds[],
  footprint: Pick<BoardBuildPlanBounds, 'height' | 'width'>,
  direction: BoardBuildPlanDirection
): BoardBuildPlanBounds | undefined {
  if (sourceBounds.length < 2) return undefined
  const left = Math.min(...sourceBounds.map((bounds) => bounds.x))
  const top = Math.min(...sourceBounds.map((bounds) => bounds.y))
  const right = Math.max(...sourceBounds.map((bounds) => bounds.x + bounds.width))
  const bottom = Math.max(...sourceBounds.map((bounds) => bounds.y + bounds.height))
  if (direction === 'left' || direction === 'right') {
    return {
      height: footprint.height,
      width: right - left,
      x: left,
      y: top + (bottom - top - footprint.height) / 2
    }
  }
  return {
    height: bottom - top,
    width: footprint.width,
    x: left + (right - left - footprint.width) / 2,
    y: top
  }
}

export function parseConnection(
  value: unknown,
  index: number,
  aliases: ReadonlySet<string>
): BoardBuildPlanConnection {
  const label = `plan.connections[${index}]`
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(
    value,
    ['automatic', 'kind', 'label', 'source', 'source_port', 'target', 'target_port'],
    label
  )
  const kind = requiredString(value.kind, `${label}.kind`) as BoardBuildPlanConnectionKind
  if (kind !== 'action' && kind !== 'data' && kind !== 'visual') {
    throw new Error(`${label}.kind must be visual, data, or action.`)
  }
  if (value.automatic !== undefined && typeof value.automatic !== 'boolean') {
    throw new Error(`${label}.automatic must be a boolean.`)
  }
  if (kind === 'visual' && value.automatic === true) {
    throw new Error(`${label} visual connections cannot be automatic.`)
  }
  const source = parseReference(value.source, `${label}.source`)
  const target = parseReference(value.target, `${label}.target`)
  assertReferenceAvailable(source, aliases, `${label}.source`)
  assertReferenceAvailable(target, aliases, `${label}.target`)
  if (boardBuildPlanReferenceKey(source) === boardBuildPlanReferenceKey(target)) {
    throw new Error(`${label} cannot connect an object to itself.`)
  }
  const connectionLabel = optionalString(value.label, `${label}.label`, 80)
  const sourcePort = parsePort(value.source_port, `${label}.source_port`)
  const targetPort = parsePort(value.target_port, `${label}.target_port`)
  return {
    ...(typeof value.automatic === 'boolean'
      ? { automatic: value.automatic }
      : kind === 'visual'
        ? {}
        : { automatic: false }),
    kind,
    ...(connectionLabel ? { label: connectionLabel } : {}),
    source,
    ...(sourcePort ? { source_port: sourcePort } : {}),
    target,
    ...(targetPort ? { target_port: targetPort } : {})
  }
}

export function connectionKey(connection: BoardBuildPlanConnection): string {
  return [
    connection.kind,
    boardBuildPlanReferenceKey(connection.source),
    connection.source_port ?? 'auto',
    boardBuildPlanReferenceKey(connection.target),
    connection.target_port ?? 'auto',
    connection.label ?? connection.kind,
    String(connection.automatic ?? connection.kind !== 'visual')
  ].join('\u0000')
}

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
  if (kind === 'connection.delete_traced') {
    exactFields(value, ['kind', 'object_ids', 'orientation', 'region'], label)
    if (!Array.isArray(value.object_ids) || value.object_ids.length > 25) {
      throw new Error(`${label}.object_ids must contain at most 25 exact object IDs.`)
    }
    const objectIds = value.object_ids.map((objectId, objectIndex) =>
      requiredString(objectId, `${label}.object_ids[${objectIndex}]`, 240)
    )
    if (new Set(objectIds).size !== objectIds.length) {
      throw new Error(`${label}.object_ids must be unique.`)
    }
    const operationOrientation = optionalString(value.orientation, `${label}.orientation`) ?? 'any'
    if (
      operationOrientation !== 'any' &&
      operationOrientation !== 'horizontal' &&
      operationOrientation !== 'vertical'
    ) {
      throw new Error(`${label}.orientation must be any, horizontal, or vertical.`)
    }
    if (!isRecord(value.region)) throw new Error(`${label}.region must be an object.`)
    exactFields(value.region, ['height', 'width', 'x', 'y'], `${label}.region`)
    return {
      kind,
      object_ids: objectIds,
      orientation: operationOrientation,
      region: {
        height: boundedNumber(value.region.height, `${label}.region.height`, 0.0001, 1_000_000),
        width: boundedNumber(value.region.width, `${label}.region.width`, 0.0001, 1_000_000),
        x: boundedNumber(value.region.x, `${label}.region.x`, -1_000_000, 1_000_000),
        y: boundedNumber(value.region.y, `${label}.region.y`, -1_000_000, 1_000_000)
      }
    }
  }
  if (kind === 'connection.delete') {
    exactFields(value, ['connection_id', 'kind'], label)
    return {
      connection_id: requiredString(value.connection_id, `${label}.connection_id`, 240),
      kind
    }
  }
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
    const viewportPreset = value.viewport_preset
    if (viewportPreset !== undefined && !isCodeObjectViewportPresetId(viewportPreset)) {
      throw new Error(`${label}.viewport_preset must be desktop, laptop, tablet, or phone.`)
    }
    const viewport = viewportPreset ? codeObjectViewportPreset(viewportPreset) : undefined
    if (
      viewport &&
      ((value.height !== undefined && value.height !== viewport.height) ||
        (value.width !== undefined && value.width !== viewport.width))
    ) {
      throw new Error(`${label}.height and width must match its viewport_preset.`)
    }
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
    `${label}.kind must be canonical_object.fork, connection.delete, connection.delete_traced, transaction.revert, object.update, object.move, object.resize, object.duplicate, or object.delete.`
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
  boundsForObject: (objectId: string) => BoardBuildPlanBounds | undefined,
  traceConnectionIds?: (operation: BoardBuildTraceConnectionDelete) => string[]
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
    if (operation.kind === 'connection.delete_traced') {
      if (!traceConnectionIds) {
        throw new Error(`${label} requires Trace connection resolution.`)
      }
      return [...new Set(traceConnectionIds(operation))].slice(0, 32).map((connectionId) => ({
        connection_id: connectionId,
        kind: 'connection.delete' as const
      }))
    }
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
