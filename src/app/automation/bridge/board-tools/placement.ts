import type { Rect, SceneNode } from '@open-pencil/scene-graph'

import type { AutomationTarget } from '@/app/automation/bridge/target'

import { nodeBounds } from './readback'

export const BOARD_PLACEMENT_ALGORITHM = 'nearest-free/v1' as const

export type BoardPlacementDirection = 'above' | 'below' | 'left' | 'right'

export type BoardRelativePlacementOffset = {
  column: -1 | 0 | 1
  row: -1 | 0 | 1
}

export type BoardFreePlacementTarget =
  | { kind: 'auto' }
  | { height: number; kind: 'near_region'; width: number; x: number; y: number }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'relative'; objectId: string }
  | { height: number; kind: 'region'; width: number; x: number; y: number }

export type BoardPlacementTarget = { anchorId: string; kind: 'anchor' } | BoardFreePlacementTarget

export type BoardPlacementResult = {
  algorithm: typeof BOARD_PLACEMENT_ALGORITHM
  bounds: Rect
  clearance: number
  rejectedCandidates: number
}

type BoardPlacementInput = {
  anchor: Rect
  clearance: number
  footprint: Pick<Rect, 'height' | 'width'>
  maxRings?: number
  obstacles: Rect[]
  preferredDirections?: BoardPlacementDirection[]
  relativeOffset?: BoardRelativePlacementOffset
  searchRegion?: Rect
}

type CenteredBoardPlacementInput = {
  center: Pick<Rect, 'x' | 'y'>
  clearance: number
  footprint: Pick<Rect, 'height' | 'width'>
  maxRings?: number
  obstacles: Rect[]
  preferredDirections?: BoardPlacementDirection[]
  searchRegion?: Rect
}

type PreparedBoardPlacement = {
  clearance: number
  directions: BoardPlacementDirection[]
  obstacles: Rect[]
}

const DEFAULT_DIRECTIONS: BoardPlacementDirection[] = ['right', 'below', 'left', 'above']

export function parsePlacementDirections(value: unknown): BoardPlacementDirection[] {
  if (value === undefined) return [...DEFAULT_DIRECTIONS]
  if (!Array.isArray(value) || value.length !== 4) {
    throw new Error('placement.preferred_directions must list all four directions once.')
  }
  const allowed = new Set<BoardPlacementDirection>(['above', 'below', 'left', 'right'])
  const directions = value.filter(
    (item): item is BoardPlacementDirection =>
      typeof item === 'string' && allowed.has(item as BoardPlacementDirection)
  )
  if (new Set(directions).size !== 4) {
    throw new Error('placement.preferred_directions must list all four directions once.')
  }
  return directions
}

export function visibleBoardObstacles(
  target: AutomationTarget,
  excludedObjectIds: ReadonlySet<string> = new Set()
): Rect[] {
  return [...target.store.graph.getDescendants(target.pageId)]
    .filter(
      (node) => !excludedObjectIds.has(node.id) && node.visible && node.width > 0 && node.height > 0
    )
    .map((node) => nodeBounds(target, node))
}

export function requireVisibleBoardAnchor(target: AutomationTarget, anchorId: string): SceneNode {
  const anchor = target.store.graph.getNode(anchorId)
  if (!anchor || !target.store.graph.isDescendant(anchor.id, target.pageId)) {
    throw new Error(`Anchor "${anchorId}" is not on Board "${target.pageName}".`)
  }
  if (!anchor.visible) throw new Error(`Anchor "${anchorId}" is hidden.`)
  return anchor
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

function isFreePlacement(
  candidate: Rect,
  searchRegion: Rect | undefined,
  obstacles: Rect[]
): boolean {
  return (
    inside(candidate, searchRegion) && !obstacles.some((obstacle) => overlaps(candidate, obstacle))
  )
}

function placementResult(
  bounds: Rect,
  clearance: number,
  rejectedCandidates: number
): BoardPlacementResult {
  return {
    algorithm: BOARD_PLACEMENT_ALGORITHM,
    bounds,
    clearance,
    rejectedCandidates
  }
}

function expanded(rect: Rect, clearance: number): Rect {
  return {
    height: rect.height + clearance * 2,
    width: rect.width + clearance * 2,
    x: rect.x - clearance,
    y: rect.y - clearance
  }
}

function preparePlacement(
  input: Pick<BoardPlacementInput, 'clearance' | 'obstacles' | 'preferredDirections'>
): PreparedBoardPlacement | null {
  const clearance = Math.max(0, input.clearance)
  const directions =
    input.preferredDirections?.length === 4
      ? [...new Set(input.preferredDirections)]
      : DEFAULT_DIRECTIONS
  if (directions.length !== 4) return null
  return {
    clearance,
    directions,
    obstacles: input.obstacles.map((obstacle) => expanded(obstacle, clearance))
  }
}

function candidateForOffset(
  anchor: Rect,
  footprint: Pick<Rect, 'height' | 'width'>,
  clearance: number,
  column: number,
  row: number
): Rect {
  const x = axisPosition(anchor.x, anchor.width, footprint.width, clearance, column)
  const y = axisPosition(anchor.y, anchor.height, footprint.height, clearance, row)
  return { height: footprint.height, width: footprint.width, x, y }
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

function primaryOffset(
  direction: BoardPlacementDirection,
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
  directions: BoardPlacementDirection[]
): Array<[number, number]> {
  const offsets: Array<[number, number]> = []
  const seen = new Set<string>()
  for (const direction of directions) {
    for (let secondary = 0; secondary <= ring; secondary++) {
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

function placementOffsetsForRing(
  ring: number,
  directions: BoardPlacementDirection[],
  relativeOffset: BoardRelativePlacementOffset | undefined
): Array<[number, number]> {
  const fallback = offsetsForRing(ring, directions)
  if (!relativeOffset) return fallback
  const preferred: [number, number] = [relativeOffset.column * ring, relativeOffset.row * ring]
  return [
    preferred,
    ...fallback.filter(([column, row]) => column !== preferred[0] || row !== preferred[1])
  ]
}

export function resolveNearestFreePlacement(
  input: BoardPlacementInput
): BoardPlacementResult | null {
  const prepared = preparePlacement(input)
  if (!prepared) return null
  const { clearance, directions, obstacles } = prepared
  let rejectedCandidates = 0

  for (let ring = 1; ring <= (input.maxRings ?? 12); ring++) {
    for (const [column, row] of placementOffsetsForRing(ring, directions, input.relativeOffset)) {
      const candidate = candidateForOffset(input.anchor, input.footprint, clearance, column, row)
      if (!isFreePlacement(candidate, input.searchRegion, obstacles)) {
        rejectedCandidates++
        continue
      }
      return placementResult(candidate, clearance, rejectedCandidates)
    }
  }
  return null
}

function centeredCandidate(input: CenteredBoardPlacementInput, column: number, row: number): Rect {
  const horizontalStep = input.footprint.width + input.clearance
  const verticalStep = input.footprint.height + input.clearance
  return {
    height: input.footprint.height,
    width: input.footprint.width,
    x: input.center.x - input.footprint.width / 2 + column * horizontalStep,
    y: input.center.y - input.footprint.height / 2 + row * verticalStep
  }
}

export function resolveCenteredFreePlacement(
  input: CenteredBoardPlacementInput
): BoardPlacementResult | null {
  const prepared = preparePlacement(input)
  if (!prepared) return null
  const { clearance, directions, obstacles } = prepared
  let rejectedCandidates = 0
  const center = centeredCandidate({ ...input, clearance }, 0, 0)
  if (isFreePlacement(center, input.searchRegion, obstacles)) {
    return placementResult(center, clearance, rejectedCandidates)
  }
  rejectedCandidates++
  for (let ring = 1; ring <= (input.maxRings ?? 0); ring++) {
    for (const [column, row] of offsetsForRing(ring, directions)) {
      const candidate = centeredCandidate({ ...input, clearance }, column, row)
      if (!isFreePlacement(candidate, input.searchRegion, obstacles)) {
        rejectedCandidates++
        continue
      }
      return placementResult(candidate, clearance, rejectedCandidates)
    }
  }
  return null
}
