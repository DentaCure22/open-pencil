import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { intersectVisualBounds, type VisualBounds } from '@open-pencil/scene-graph/geometry'

import { boundsToRect, visualBoundsArea } from './bounds'
import type { OverlapCategory, OverlapItem, OverlapSeverity } from './index'
import { toNodeSummary } from './scope'

const EMPTY_BOUNDS: VisualBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 }
const SEVERITY_RANK: Record<OverlapSeverity, number> = {
  critical: 4,
  major: 3,
  minor: 2,
  info: 1
}

export function scoredSeverity(severity: OverlapSeverity): number {
  return SEVERITY_RANK[severity]
}

function parentOverflowSeverity(outRatio: number): OverlapSeverity {
  if (outRatio > 0.25) return 'critical'
  if (outRatio > 0.05) return 'major'
  return 'minor'
}

function siblingOverlapSeverity(intersectionArea: number, smallerArea: number): OverlapSeverity {
  if (smallerArea <= 0) return 'info'
  const ratio = intersectionArea / smallerArea
  if (ratio > 0.5) return 'major'
  if (ratio > 0.08) return 'minor'
  return 'info'
}

function makeOverlapItem(
  category: OverlapCategory,
  severity: OverlapSeverity,
  nodeA: SceneNode,
  boundsA: VisualBounds,
  nodeB: SceneNode,
  boundsB: VisualBounds,
  intersection: VisualBounds,
  message: string,
  suggestion: string,
  areaField: 'intersection' | 'overflow' = 'intersection'
): OverlapItem {
  const intersectionRect = boundsToRect(intersection)
  const area =
    areaField === 'intersection'
      ? visualBoundsArea(intersection)
      : visualBoundsArea(boundsA) - visualBoundsArea(intersection)
  const ratio =
    areaField === 'intersection'
      ? area / Math.max(1, Math.min(visualBoundsArea(boundsA), visualBoundsArea(boundsB)))
      : area / Math.max(1, visualBoundsArea(boundsA))

  return {
    category,
    severity,
    message,
    suggestion,
    area: Math.round(area),
    ratio: Math.round(ratio * 1000) / 1000,
    nodeA: toNodeSummary(nodeA),
    nodeB: toNodeSummary(nodeB),
    intersection: {
      ...intersectionRect,
      area: Math.round(visualBoundsArea(intersection))
    }
  }
}

export function buildParentOverflowResult(
  child: SceneNode,
  childBounds: VisualBounds,
  parent: SceneNode,
  parentBounds: VisualBounds
): OverlapItem | null {
  if (parent.clipsContent) return null
  const childArea = visualBoundsArea(childBounds)
  if (childArea <= 0) return null

  const intersection = intersectVisualBounds(childBounds, parentBounds)
  const outArea = intersection ? childArea - visualBoundsArea(intersection) : childArea
  if (outArea <= 0) return null

  const outRatio = outArea / childArea
  const severity = parentOverflowSeverity(outRatio)
  const message = `${child.type === 'TEXT' ? 'Text' : `Node`} "${child.name}" extends ${Math.round(outArea)}px outside parent "${parent.name}"`
  const suggestion =
    child.type === 'TEXT'
      ? 'Set the parent to clip content or constrain text sizing (textAutoResize, maxLines).'
      : `Reposition inside "${parent.name}" or enable clip content on the parent.`

  return makeOverlapItem(
    'parent-overflow',
    severity,
    child,
    childBounds,
    parent,
    parentBounds,
    intersection ?? EMPTY_BOUNDS,
    message,
    suggestion,
    'overflow'
  )
}

function isNodeAbove(graph: SceneGraph, above: SceneNode, below: SceneNode): boolean {
  if (above.parentId !== below.parentId || above.parentId === null) return false
  const parent = graph.getNode(above.parentId)
  if (!parent) return false
  const aboveIndex = parent.childIds.indexOf(above.id)
  const belowIndex = parent.childIds.indexOf(below.id)
  return aboveIndex > belowIndex
}

function detectSiblingOverlay(
  nodeA: SceneNode,
  boundsA: VisualBounds,
  nodeB: SceneNode,
  boundsB: VisualBounds,
  graph: SceneGraph
): OverlapCategory {
  const areaA = visualBoundsArea(boundsA)
  const areaB = visualBoundsArea(boundsB)
  const smallerArea = Math.min(areaA, areaB)
  const largerArea = Math.max(areaA, areaB)
  const intersection = intersectVisualBounds(boundsA, boundsB)
  if (!intersection || smallerArea <= 0) return 'sibling-overlap'
  const overlapArea = visualBoundsArea(intersection)
  const coversSmall = overlapArea / smallerArea > 0.85
  const sizeRatio = largerArea / Math.max(1, smallerArea)
  if (sizeRatio < 5 || !coversSmall) return 'sibling-overlap'

  const larger = areaA >= areaB ? nodeA : nodeB
  const smaller = areaA >= areaB ? nodeB : nodeA
  return isNodeAbove(graph, larger, smaller) ? 'overlay' : 'sibling-overlap'
}

export function buildSiblingOverlapResult(
  nodeA: SceneNode,
  boundsA: VisualBounds,
  nodeB: SceneNode,
  boundsB: VisualBounds,
  graph: SceneGraph
): OverlapItem | null {
  const intersection = intersectVisualBounds(boundsA, boundsB)
  if (!intersection) return null

  const areaA = visualBoundsArea(boundsA)
  const areaB = visualBoundsArea(boundsB)
  const smallerArea = Math.min(areaA, areaB)
  const category = detectSiblingOverlay(nodeA, boundsA, nodeB, boundsB, graph)
  const intersectionArea = visualBoundsArea(intersection)
  let severity: OverlapSeverity
  if (category === 'overlay') {
    severity = smallerArea > 0 && intersectionArea / smallerArea > 0.98 ? 'info' : 'minor'
  } else {
    severity = siblingOverlapSeverity(intersectionArea, smallerArea)
  }

  const larger = areaA >= areaB ? nodeA : nodeB
  const smaller = areaA >= areaB ? nodeB : nodeA
  const message =
    category === 'overlay'
      ? `"${larger.name}" appears to be an overlay covering "${smaller.name}"`
      : `"${nodeA.name}" overlaps "${nodeB.name}"`
  const suggestion =
    category === 'overlay'
      ? 'If intentional (modal/backdrop/dropdown), no action needed. Otherwise reposition or adjust z-order.'
      : 'Review stacking and spacing — this overlap is likely unintended.'

  return makeOverlapItem(
    category,
    severity,
    nodeA,
    boundsA,
    nodeB,
    boundsB,
    intersection,
    message,
    suggestion
  )
}

export function passesThresholds(
  item: OverlapItem,
  minArea: number,
  minRatio: number,
  categoryFilter: OverlapCategory[] | undefined,
  severityFilter: OverlapSeverity | undefined
): boolean {
  if (item.area < minArea) return false
  if (item.ratio < minRatio) return false
  if (categoryFilter && !categoryFilter.includes(item.category)) return false
  if (severityFilter && scoredSeverity(item.severity) < scoredSeverity(severityFilter)) return false
  return true
}
