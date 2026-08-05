import type { BoardBuildPlanRelativeOffset } from '@open-pencil/core/rpc'
import type { Rect, SceneGraph, SceneNode, Vector } from '@open-pencil/scene-graph'

export const AUTHORITY_PLACEMENT_ALGORITHM = 'nearest-free/v1' as const

export type AuthorityPlacementDirection = 'above' | 'below' | 'left' | 'right'
export type AuthorityRelativePlacementOffset = BoardBuildPlanRelativeOffset
export type AuthorityFreePlacementTarget =
  | { kind: 'auto' }
  | { height: number; kind: 'near_region'; width: number; x: number; y: number }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'relative'; objectId: string }
  | { height: number; kind: 'region'; width: number; x: number; y: number }

export type AuthorityPlacementResult = {
  algorithm: typeof AUTHORITY_PLACEMENT_ALGORITHM
  bounds: Rect
  clearance: number
  rejectedCandidates: number
}

type PlacementInput = {
  anchor: Rect
  clearance: number
  excludedObjectIds?: ReadonlySet<string>
  footprint: Pick<Rect, 'height' | 'width'>
  graph: SceneGraph
  pageId: string
  preferredDirections: AuthorityPlacementDirection[]
  relativeOffset?: AuthorityRelativePlacementOffset
}

type FreePlacementInput = {
  clearance: number
  excludedObjectIds?: ReadonlySet<string>
  footprint: Pick<Rect, 'height' | 'width'>
  graph: SceneGraph
  pageId: string
  preferredDirections?: AuthorityPlacementDirection[]
  relativeOffset?: AuthorityRelativePlacementOffset
  target: AuthorityFreePlacementTarget
}

type FreePlacementSearch = {
  center: Vector
  maxRing: number
  region?: Rect
}

export type AuthorityPlacementConflict = {
  bounds: Rect
  id: string
  name: string
}

type AuthorityPlacementErrorDetails = {
  conflict?: AuthorityPlacementConflict
}

export class AuthorityPlacementError extends Error {
  readonly details: AuthorityPlacementErrorDetails

  constructor(message: string, details: AuthorityPlacementErrorDetails = {}) {
    super(message)
    this.name = 'AuthorityPlacementError'
    this.details = details
  }
}

const DEFAULT_DIRECTIONS: AuthorityPlacementDirection[] = ['right', 'below', 'left', 'above']
const EMPTY_AUTO_SEARCH_REGION: Rect = { height: 1_200, width: 1_600, x: 0, y: 0 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  return value
}

function assertTargetFields(value: Record<string, unknown>, supported: readonly string[]): void {
  const unsupported = Object.keys(value).filter((key) => !supported.includes(key))
  if (unsupported.length > 0) {
    throw new Error(
      `placement.target contains unsupported fields: ${unsupported.sort().join(', ')}.`
    )
  }
}

export function parseAuthorityFreePlacementTarget(value: unknown): AuthorityFreePlacementTarget {
  if (!isRecord(value)) throw new Error('placement.target must be an object.')
  if (value.kind === 'auto') {
    assertTargetFields(value, ['kind'])
    return { kind: 'auto' }
  }
  if (value.kind === 'relative') {
    assertTargetFields(value, ['kind', 'object_id'])
    const objectId = value.object_id
    if (typeof objectId !== 'string' || !objectId.trim()) {
      throw new Error('placement.target.object_id must be a non-empty string.')
    }
    return { kind: 'relative', objectId: objectId.trim() }
  }
  if (value.kind === 'point') {
    assertTargetFields(value, ['kind', 'x', 'y'])
    return {
      kind: 'point',
      x: finiteNumber(value.x, 'placement.target.x'),
      y: finiteNumber(value.y, 'placement.target.y')
    }
  }
  if (value.kind === 'near_region' || value.kind === 'region') {
    assertTargetFields(value, ['height', 'kind', 'width', 'x', 'y'])
    const height = finiteNumber(value.height, 'placement.target.height')
    const width = finiteNumber(value.width, 'placement.target.width')
    if (width <= 0 || height <= 0) throw new Error('placement.target region must be positive.')
    return {
      height,
      kind: value.kind,
      width,
      x: finiteNumber(value.x, 'placement.target.x'),
      y: finiteNumber(value.y, 'placement.target.y')
    }
  }
  throw new Error('placement.target.kind must be auto, near_region, point, relative, or region.')
}

function overlaps(left: Rect, right: Rect): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  )
}

function inside(candidate: Rect, region: Rect | undefined): boolean {
  if (!region) return true
  return (
    candidate.x >= region.x &&
    candidate.y >= region.y &&
    candidate.x + candidate.width <= region.x + region.width &&
    candidate.y + candidate.height <= region.y + region.height
  )
}

function expanded(rect: Rect, clearance: number): Rect {
  return {
    height: rect.height + clearance * 2,
    width: rect.width + clearance * 2,
    x: rect.x - clearance,
    y: rect.y - clearance
  }
}

function visibleObstacleEntries(
  graph: SceneGraph,
  pageId: string,
  excludedObjectIds: ReadonlySet<string> = new Set()
): AuthorityPlacementConflict[] {
  return [...graph.getDescendants(pageId)]
    .filter(
      (node) =>
        !excludedObjectIds.has(node.id) &&
        node.visible &&
        node.opacity > 0 &&
        node.width > 0 &&
        node.height > 0
    )
    .map((node) => ({ bounds: graph.getAbsoluteBounds(node.id), id: node.id, name: node.name }))
}

function visibleObstacleBounds(
  graph: SceneGraph,
  pageId: string,
  excludedObjectIds?: ReadonlySet<string>
): Rect[] {
  return visibleObstacleEntries(graph, pageId, excludedObjectIds).map(({ bounds }) => bounds)
}

function visibleObstacles(
  graph: SceneGraph,
  pageId: string,
  clearance: number,
  excludedObjectIds?: ReadonlySet<string>
): Array<AuthorityPlacementConflict & { expandedBounds: Rect }> {
  return visibleObstacleEntries(graph, pageId, excludedObjectIds).map((obstacle) => ({
    ...obstacle,
    expandedBounds: expanded(obstacle.bounds, clearance)
  }))
}

function primaryOffset(
  direction: AuthorityPlacementDirection,
  ring: number,
  secondary: number
): [number, number] {
  if (direction === 'right') return [ring, secondary]
  if (direction === 'below') return [secondary, ring]
  if (direction === 'left') return [-ring, secondary]
  return [secondary, -ring]
}

function offsetsForRing(
  ring: number,
  directions: AuthorityPlacementDirection[]
): Array<[number, number]> {
  const offsets: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const direction of directions) {
    for (let secondary = 0; secondary <= ring; secondary += 1) {
      const values = secondary === 0 ? [0] : [secondary, -secondary]
      for (const value of values) {
        const offset = primaryOffset(direction, ring, value)
        const key = `${offset[0]}:${offset[1]}`
        if (seen.has(key)) continue
        seen.add(key)
        offsets.push(offset)
      }
    }
  }
  return offsets
}

function axisPosition(
  anchorStart: number,
  anchorSize: number,
  footprintSize: number,
  clearance: number,
  offset: number
): number {
  if (offset > 0) {
    return anchorStart + anchorSize + clearance + (offset - 1) * (footprintSize + clearance)
  }
  if (offset < 0) {
    return anchorStart - clearance - footprintSize + (offset + 1) * (footprintSize + clearance)
  }
  return anchorStart
}

function anchoredCandidate(
  anchor: Rect,
  footprint: Pick<Rect, 'height' | 'width'>,
  clearance: number,
  column: number,
  row: number
): Rect {
  return {
    height: footprint.height,
    width: footprint.width,
    x: axisPosition(anchor.x, anchor.width, footprint.width, clearance, column),
    y: axisPosition(anchor.y, anchor.height, footprint.height, clearance, row)
  }
}

export function parseAuthorityPlacementDirections(value: unknown): AuthorityPlacementDirection[] {
  if (value === undefined) return [...DEFAULT_DIRECTIONS]
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('placement.preferred_directions must list all four directions once.')
  }
  const allowed = new Set<AuthorityPlacementDirection>(['above', 'below', 'left', 'right'])
  const directions = value.filter(
    (entry): entry is AuthorityPlacementDirection =>
      typeof entry === 'string' && allowed.has(entry as AuthorityPlacementDirection)
  )
  if (new Set(directions).size !== 4) {
    throw new Error('placement.preferred_directions must list all four directions once.')
  }
  return directions
}

function relativeOffsetAxis(value: unknown, field: string): -1 | 0 | 1 {
  if (value !== -1 && value !== 0 && value !== 1) {
    throw new Error(`${field} must be -1, 0, or 1.`)
  }
  return value
}

export function parseAuthorityRelativePlacementOffset(
  value: unknown
): AuthorityRelativePlacementOffset | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('placement.relative_offset must be an object.')
  const unsupported = Object.keys(value).filter((key) => key !== 'column' && key !== 'row')
  if (unsupported.length > 0) {
    throw new Error(
      `placement.relative_offset contains unsupported fields: ${unsupported.sort().join(', ')}.`
    )
  }
  const result: AuthorityRelativePlacementOffset = {
    column: relativeOffsetAxis(value.column, 'placement.relative_offset.column'),
    row: relativeOffsetAxis(value.row, 'placement.relative_offset.row')
  }
  if (result.column === 0 && result.row === 0) {
    throw new Error('placement.relative_offset must move on at least one axis.')
  }
  return result
}

export function requireAuthorityAnchor(
  graph: SceneGraph,
  pageId: string,
  anchorId: string
): SceneNode {
  const anchor = graph.getNode(anchorId)
  if (!anchor || !graph.isDescendant(anchor.id, pageId)) {
    throw new Error(`Anchor "${anchorId}" is not on Board "${pageId}".`)
  }
  if (!anchor.visible) throw new Error(`Anchor "${anchorId}" is hidden.`)
  if (anchor.opacity <= 0) throw new Error(`Anchor "${anchorId}" is transparent.`)
  if (anchor.width <= 0 || anchor.height <= 0) {
    throw new Error(`Anchor "${anchorId}" has no visible bounds.`)
  }
  return anchor
}

export function resolveAuthorityAnchoredPlacement(input: PlacementInput): AuthorityPlacementResult {
  const obstacles = visibleObstacles(
    input.graph,
    input.pageId,
    input.clearance,
    input.excludedObjectIds
  )
  let rejectedCandidates = 0
  let firstConflict: AuthorityPlacementConflict | undefined
  for (let ring = 1; ring <= 12; ring += 1) {
    const requested = input.relativeOffset
      ? ([input.relativeOffset.column * ring, input.relativeOffset.row * ring] as [number, number])
      : undefined
    const requestedKey = requested ? `${requested[0]}:${requested[1]}` : undefined
    const offsets = [
      ...(requested ? [requested] : []),
      ...offsetsForRing(ring, input.preferredDirections).filter(
        ([column, row]) => `${column}:${row}` !== requestedKey
      )
    ]
    for (const [column, row] of offsets) {
      const candidate = anchoredCandidate(
        input.anchor,
        input.footprint,
        input.clearance,
        column,
        row
      )
      const conflict = obstacles.find((obstacle) => overlaps(candidate, obstacle.expandedBounds))
      if (conflict) {
        firstConflict ??= { bounds: conflict.bounds, id: conflict.id, name: conflict.name }
        rejectedCandidates += 1
        continue
      }
      return {
        algorithm: AUTHORITY_PLACEMENT_ALGORITHM,
        bounds: candidate,
        clearance: input.clearance,
        rejectedCandidates
      }
    }
  }
  throw new AuthorityPlacementError(
    'No collision-free placement was found within the bounded search region.',
    firstConflict ? { conflict: firstConflict } : {}
  )
}

function centeredCandidate(
  center: Vector,
  footprint: Pick<Rect, 'height' | 'width'>,
  clearance: number,
  column: number,
  row: number
): Rect {
  return {
    height: footprint.height,
    width: footprint.width,
    x: center.x - footprint.width / 2 + column * (footprint.width + clearance),
    y: center.y - footprint.height / 2 + row * (footprint.height + clearance)
  }
}

function unionBounds(bounds: Rect[]): Rect | null {
  if (bounds.length === 0) return null
  const first = bounds[0]
  let left = first.x
  let top = first.y
  let right = first.x + first.width
  let bottom = first.y + first.height
  for (const item of bounds.slice(1)) {
    left = Math.min(left, item.x)
    top = Math.min(top, item.y)
    right = Math.max(right, item.x + item.width)
    bottom = Math.max(bottom, item.y + item.height)
  }
  return { height: bottom - top, width: right - left, x: left, y: top }
}

function autoSearchRegion(input: FreePlacementInput): Rect {
  const content = unionBounds(
    visibleObstacleBounds(input.graph, input.pageId, input.excludedObjectIds)
  )
  if (!content) {
    return {
      height: Math.max(
        EMPTY_AUTO_SEARCH_REGION.height,
        input.footprint.height + input.clearance * 2
      ),
      width: Math.max(EMPTY_AUTO_SEARCH_REGION.width, input.footprint.width + input.clearance * 2),
      x: EMPTY_AUTO_SEARCH_REGION.x,
      y: EMPTY_AUTO_SEARCH_REGION.y
    }
  }
  const horizontalPadding = input.footprint.width * 2 + input.clearance * 2
  const verticalPadding = input.footprint.height * 2 + input.clearance * 2
  const width = Math.max(EMPTY_AUTO_SEARCH_REGION.width, content.width + horizontalPadding * 2)
  const height = Math.max(EMPTY_AUTO_SEARCH_REGION.height, content.height + verticalPadding * 2)
  const center: Vector = {
    x: content.x + content.width / 2,
    y: content.y + content.height / 2
  }
  return { height, width, x: center.x - width / 2, y: center.y - height / 2 }
}

function freePlacementSearch(input: FreePlacementInput): FreePlacementSearch {
  if (input.target.kind === 'relative') {
    throw new Error('Relative Board placement must resolve from its exact object.')
  }
  if (input.target.kind === 'point') {
    return { center: { x: input.target.x, y: input.target.y }, maxRing: 0 }
  }
  const region =
    input.target.kind === 'auto'
      ? autoSearchRegion(input)
      : {
          height: input.target.height,
          width: input.target.width,
          x: input.target.x,
          y: input.target.y
        }
  return {
    center: { x: region.x + region.width / 2, y: region.y + region.height / 2 },
    maxRing: 12,
    ...(input.target.kind === 'near_region' ? {} : { region })
  }
}

export function resolveAuthorityFreePlacement(input: FreePlacementInput): AuthorityPlacementResult {
  if (input.target.kind === 'relative') {
    const anchor = requireAuthorityAnchor(input.graph, input.pageId, input.target.objectId)
    return resolveAuthorityAnchoredPlacement({
      anchor: input.graph.getAbsoluteBounds(anchor.id),
      clearance: input.clearance,
      excludedObjectIds: input.excludedObjectIds,
      footprint: input.footprint,
      graph: input.graph,
      pageId: input.pageId,
      preferredDirections: input.preferredDirections ?? [...DEFAULT_DIRECTIONS],
      relativeOffset: input.relativeOffset
    })
  }
  const search = freePlacementSearch(input)
  const obstacles = visibleObstacles(
    input.graph,
    input.pageId,
    input.clearance,
    input.excludedObjectIds
  )
  let rejectedCandidates = 0
  let firstConflict: AuthorityPlacementConflict | undefined
  for (let ring = 0; ring <= search.maxRing; ring += 1) {
    const offsets =
      ring === 0 ? ([[0, 0]] as Array<[number, number]>) : offsetsForRing(ring, DEFAULT_DIRECTIONS)
    for (const [column, row] of offsets) {
      const candidate = centeredCandidate(
        search.center,
        input.footprint,
        input.clearance,
        column,
        row
      )
      const conflict = obstacles.find((obstacle) => overlaps(candidate, obstacle.expandedBounds))
      if (!inside(candidate, search.region) || conflict) {
        if (conflict) {
          firstConflict ??= { bounds: conflict.bounds, id: conflict.id, name: conflict.name }
        }
        rejectedCandidates += 1
        continue
      }
      return {
        algorithm: AUTHORITY_PLACEMENT_ALGORITHM,
        bounds: candidate,
        clearance: input.clearance,
        rejectedCandidates
      }
    }
  }
  throw new AuthorityPlacementError(
    'No collision-free placement was found in the requested Board target.',
    firstConflict ? { conflict: firstConflict } : {}
  )
}
