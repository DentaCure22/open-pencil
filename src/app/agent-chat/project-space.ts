import type { Rect, Vector } from '@open-pencil/scene-graph'

import type { AgentWorkMap, AgentWorkMapProject } from './work-map'

export const FLUID_PROJECT_DETACH_OVERLAP_RATIO = 0.58
export const COLLAPSED_PROJECT_TAB_HEIGHT = 32
export const COLLAPSED_PROJECT_TAB_MAX_WIDTH = 212
export const COLLAPSED_PROJECT_TAB_GAP = 6
export const COLLAPSED_PROJECT_TAB_INSET = 16

type Size = Pick<Rect, 'height' | 'width'>

export type FluidProjectTerritoryAppearance = {
  borderRadius: string
  bottom: number
  detachReady: boolean
  left: number
  right: number
  tension: number
  top: number
}

export type ProjectSpaceBinding = {
  frameId: string
  project: AgentWorkMapProject
}

export type CollapsedProjectTabLayout = Rect

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * Packs closed sub-bots into a quiet tab rail along the top line shared by
 * sibling sub-bot spaces. The rail is presentation-only: reopening restores
 * the sub-bot's exact Board geometry and contents.
 */
export function collapsedProjectTabLayout(
  parent: Rect,
  slotIndex: number,
  readableViewport?: Rect,
  railY?: number
): CollapsedProjectTabLayout {
  const intersection = readableViewport
    ? {
        height:
          Math.min(parent.y + parent.height, readableViewport.y + readableViewport.height) -
          Math.max(parent.y, readableViewport.y),
        width:
          Math.min(parent.x + parent.width, readableViewport.x + readableViewport.width) -
          Math.max(parent.x, readableViewport.x),
        x: Math.max(parent.x, readableViewport.x),
        y: Math.max(parent.y, readableViewport.y)
      }
    : null
  const shelf =
    intersection &&
    intersection.width > COLLAPSED_PROJECT_TAB_INSET * 2 &&
    intersection.height > COLLAPSED_PROJECT_TAB_HEIGHT + COLLAPSED_PROJECT_TAB_INSET * 2
      ? intersection
      : parent
  const availableWidth = Math.max(1, shelf.width - COLLAPSED_PROJECT_TAB_INSET * 2)
  const width = Math.min(COLLAPSED_PROJECT_TAB_MAX_WIDTH, availableWidth)
  const columnCount = Math.max(
    1,
    Math.floor(
      (availableWidth + COLLAPSED_PROJECT_TAB_GAP) / (width + COLLAPSED_PROJECT_TAB_GAP)
    )
  )
  const normalizedIndex = Math.max(0, Math.floor(slotIndex))
  const column = normalizedIndex % columnCount
  const row = Math.floor(normalizedIndex / columnCount)
  const visibleRailY = clamp(
    railY ?? shelf.y + COLLAPSED_PROJECT_TAB_INSET + COLLAPSED_PROJECT_TAB_HEIGHT,
    shelf.y + COLLAPSED_PROJECT_TAB_INSET + COLLAPSED_PROJECT_TAB_HEIGHT,
    shelf.y + shelf.height - COLLAPSED_PROJECT_TAB_INSET
  )

  return {
    height: COLLAPSED_PROJECT_TAB_HEIGHT,
    width,
    x:
      shelf.x +
      shelf.width -
      COLLAPSED_PROJECT_TAB_INSET -
      width -
      column * (width + COLLAPSED_PROJECT_TAB_GAP),
    y:
      visibleRailY -
      COLLAPSED_PROJECT_TAB_HEIGHT -
      row * (COLLAPSED_PROJECT_TAB_HEIGHT + COLLAPSED_PROJECT_TAB_GAP)
  }
}

export function workMapProjectSpaceBindings(
  workMap: AgentWorkMap | null | undefined,
  pageId: string
): ProjectSpaceBinding[] {
  return (workMap?.projects ?? []).flatMap((project) =>
    project.spaceFrameId && project.spacePageId === pageId
      ? [{ frameId: project.spaceFrameId, project }]
      : []
  )
}

export function rectOverlapRatio(child: Rect, parent: Size): number {
  const overlapWidth = Math.max(
    0,
    Math.min(child.x + child.width, parent.width) - Math.max(child.x, 0)
  )
  const overlapHeight = Math.max(
    0,
    Math.min(child.y + child.height, parent.height) - Math.max(child.y, 0)
  )
  const childArea = Math.max(1, child.width * child.height)
  return (overlapWidth * overlapHeight) / childArea
}

/**
 * Project territories hold onto a crossing object while it is still visibly
 * connected. Once its centre clears the edge and less than 58% remains inside,
 * releasing the pointer detaches it back to the page.
 */
export function shouldDetachFromFluidProjectSpace(child: Rect, parent: Size): boolean {
  const centerX = child.x + child.width / 2
  const centerY = child.y + child.height / 2
  const overshoot = Math.max(-centerX, centerX - parent.width, -centerY, centerY - parent.height)
  const deliberateCrossing = Math.min(24, Math.max(10, Math.min(child.width, child.height) * 0.22))
  return (
    overshoot >= deliberateCrossing &&
    rectOverlapRatio(child, parent) < FLUID_PROJECT_DETACH_OVERLAP_RATIO
  )
}

/**
 * Keeps a project Frame conventionally rounded at rest, then lets only the
 * relevant edge and corners stretch toward a direct child during a move.
 */
export function fluidProjectTerritoryAppearance(
  frame: Size,
  movingChildren: Rect[],
  frameMotion: Vector = { x: 0, y: 0 }
): FluidProjectTerritoryAppearance {
  let overflowLeft = 0
  let overflowTop = 0
  let overflowRight = 0
  let overflowBottom = 0
  let biasX = clamp(frameMotion.x / 96, -1, 1) * 0.4
  let biasY = clamp(frameMotion.y / 96, -1, 1) * 0.4

  for (const child of movingChildren) {
    overflowLeft = Math.max(overflowLeft, -child.x)
    overflowTop = Math.max(overflowTop, -child.y)
    overflowRight = Math.max(overflowRight, child.x + child.width - frame.width)
    overflowBottom = Math.max(overflowBottom, child.y + child.height - frame.height)
    const centerX = child.x + child.width / 2
    const centerY = child.y + child.height / 2
    biasX = clamp((centerX - frame.width / 2) / Math.max(1, frame.width / 2), -1, 1)
    biasY = clamp((centerY - frame.height / 2) / Math.max(1, frame.height / 2), -1, 1)
  }

  const left = clamp(overflowLeft * 0.72, 0, 86)
  const right = clamp(overflowRight * 0.72, 0, 86)
  const top = clamp(overflowTop * 0.34, 0, 30)
  const bottom = clamp(overflowBottom * 0.72, 0, 86)
  const tension = clamp(Math.max(left, right, top, bottom) / 74, 0, 1)
  const movement = clamp(Math.hypot(frameMotion.x, frameMotion.y) / 120, 0, 1)
  const baseRadius = clamp(Math.min(frame.width, frame.height) * 0.05, 18, 32)

  // Resting values are intentionally identical: this is a normal Frame, not a
  // blob. Bias, overflow, and motion only affect it while something is moving.
  const topLeftX = baseRadius + Math.max(0, -biasX) * 6 + left * 0.08
  const topRightX = baseRadius + Math.max(0, biasX) * 6 + right * 0.08
  const bottomRightX = baseRadius + Math.max(0, biasX) * 30 + right * 0.65 + movement * 24
  const bottomLeftX = baseRadius + Math.max(0, -biasX) * 30 + left * 0.55 + movement * 20
  const topLeftY = baseRadius + Math.max(0, -biasY) * 4 + top * 0.04
  const topRightY = baseRadius + Math.max(0, -biasY) * 4 + top * 0.04
  const bottomRightY = baseRadius + Math.max(0, biasY) * 28 + bottom * 0.55 + movement * 22
  const bottomLeftY = baseRadius + Math.max(0, biasY) * 28 + bottom * 0.5 + movement * 20

  return {
    borderRadius: `${round(topLeftX)}px ${round(topRightX)}px ${round(bottomRightX)}px ${round(bottomLeftX)}px / ${round(topLeftY)}px ${round(topRightY)}px ${round(bottomRightY)}px ${round(bottomLeftY)}px`,
    bottom: round(bottom),
    detachReady: movingChildren.some((child) => shouldDetachFromFluidProjectSpace(child, frame)),
    left: round(left),
    right: round(right),
    tension: round(Math.max(tension, movement * 0.35)),
    top: round(top)
  }
}
