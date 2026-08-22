import type { Rect, SceneGraph, SceneNode, Vector } from '@open-pencil/scene-graph'

import {
  isSmylrProductionAppCodeObjectFrame,
  resolveSmylrProductionIframeAnchor
} from '@/app/smylr-production/workspace'

export const AGENT_CARD_HEIGHT = 800
export const AGENT_CARD_WIDTH = 640
const AGENT_CARD_COLUMN_GAP = 48
export const AGENT_CARD_ROW_GAP = 48
const AGENT_BOARD_COLUMNS = 2
export const AGENT_BOARD_SIDE_GAP = 96
export const AGENT_BOARD_TOP_OFFSET = 0

export type AgentBoardPlacement = Vector & { parentId: string }

type AgentBoardLayoutContext = {
  anchor: SceneNode
  container: SceneNode
}

function resolveAgentBoardContainer(graph: SceneGraph, pageId: string): SceneNode | null {
  const candidates = [...graph.getAllNodes()].filter(
    (node) =>
      node.parentId === pageId &&
      node.type === 'FRAME' &&
      node.childIds.some((childId) => isSmylrProductionAppCodeObjectFrame(graph.getNode(childId)))
  )
  const workspace = candidates.find((node) => /workspace/i.test(node.name))
  if (workspace) return workspace
  let largest: SceneNode | null = null
  for (const candidate of candidates) {
    if (!largest || candidate.width * candidate.height > largest.width * largest.height) {
      largest = candidate
    }
  }
  return largest
}

function resolveAgentBoardAnchor(graph: SceneGraph, container: SceneNode): SceneNode | null {
  let anchor: SceneNode | null = null
  let anchorArea = -1
  for (const childId of container.childIds) {
    const child = graph.getNode(childId)
    if (!child || !isSmylrProductionAppCodeObjectFrame(child)) continue
    const area = child.width * child.height
    if (area > anchorArea) {
      anchor = child
      anchorArea = area
    }
  }
  return anchor
}

function resolveAgentBoardLayoutContext(
  graph: SceneGraph,
  pageId: string
): AgentBoardLayoutContext | null {
  const container = resolveAgentBoardContainer(graph, pageId)
  if (container) {
    const anchor = resolveAgentBoardAnchor(graph, container)
    if (anchor) return { anchor, container }
  }

  const page = graph.getNode(pageId)
  const pageAnchor = resolveSmylrProductionIframeAnchor(graph, pageId)
  if (page && pageAnchor) {
    return { anchor: pageAnchor, container: page }
  }

  return null
}

function resolveAnchorRectInContainer(
  graph: SceneGraph,
  anchor: SceneNode,
  container: SceneNode
): Rect {
  if (anchor.parentId === container.id) {
    return { height: anchor.height, width: anchor.width, x: anchor.x, y: anchor.y }
  }
  const anchorAbs = graph.getAbsolutePosition(anchor.id)
  const containerAbs = graph.getAbsolutePosition(container.id)
  return {
    height: anchor.height,
    width: anchor.width,
    x: anchorAbs.x - containerAbs.x,
    y: anchorAbs.y - containerAbs.y
  }
}

function agentBoardGridDimensions(agentCount: number): { height: number; width: number } {
  const rows = Math.max(1, Math.ceil(agentCount / AGENT_BOARD_COLUMNS))
  return {
    width:
      AGENT_BOARD_COLUMNS * AGENT_CARD_WIDTH + (AGENT_BOARD_COLUMNS - 1) * AGENT_CARD_COLUMN_GAP,
    height: rows * AGENT_CARD_HEIGHT + (rows - 1) * AGENT_CARD_ROW_GAP
  }
}

function besideAgentBoardLayout(anchorRect: Rect, agentCount: number) {
  const grid = agentBoardGridDimensions(agentCount)
  const margin = AGENT_BOARD_SIDE_GAP
  const origin = {
    x: anchorRect.x + anchorRect.width + margin,
    y: anchorRect.y + AGENT_BOARD_TOP_OFFSET
  }
  return {
    grid,
    origin
  }
}

export function agentBoardGridOrigin(
  anchorRect: Rect,
  container: Pick<SceneNode, 'width'>,
  agentCount: number
): Vector {
  const beside = besideAgentBoardLayout(anchorRect, agentCount)
  const margin = AGENT_BOARD_SIDE_GAP
  if (beside.origin.x + beside.grid.width <= container.width - margin) return beside.origin

  return {
    x: Math.max(margin, Math.min(beside.origin.x, container.width - beside.grid.width - margin)),
    y: anchorRect.y + anchorRect.height + AGENT_CARD_ROW_GAP
  }
}

export function agentBoardPlacement(
  index: number,
  input: {
    originX: number
    originY: number
    parentId: string
  }
): AgentBoardPlacement {
  const column = index % AGENT_BOARD_COLUMNS
  const row = Math.floor(index / AGENT_BOARD_COLUMNS)
  return {
    parentId: input.parentId,
    x: input.originX + column * (AGENT_CARD_WIDTH + AGENT_CARD_COLUMN_GAP),
    y: input.originY + row * (AGENT_CARD_HEIGHT + AGENT_CARD_ROW_GAP)
  }
}

export function placementForPage(
  graph: SceneGraph,
  pageId: string,
  index: number,
  fallback: AgentBoardPlacement
): AgentBoardPlacement {
  const context = resolveAgentBoardLayoutContext(graph, pageId)
  if (!context) return fallback
  const anchorRect = resolveAnchorRectInContainer(graph, context.anchor, context.container)
  const agentCount = Math.max(index + 1, AGENT_BOARD_COLUMNS)
  const origin = agentBoardGridOrigin(anchorRect, context.container, agentCount)
  return agentBoardPlacement(index, {
    originX: origin.x,
    originY: origin.y,
    parentId: context.container.id
  })
}
