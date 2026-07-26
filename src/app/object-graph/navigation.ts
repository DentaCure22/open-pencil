import { objectGraphConnectionsForNode, type SceneGraph } from '@open-pencil/scene-graph'

import { projectObjectGraphNode } from '@/app/object-graph/projection'

export type ObjectGraphNavigationDirection = 'down' | 'left' | 'right' | 'up'

type DirectionVector = {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

type NavigationCandidate = {
  distance: number
  nodeId: string
  offAxisRatio: number
}

const DIRECTION_VECTORS: Record<ObjectGraphNavigationDirection, DirectionVector> = {
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: -1 }
}

function compareCandidates(first: NavigationCandidate, second: NavigationCandidate): number {
  return (
    first.offAxisRatio - second.offAxisRatio ||
    first.distance - second.distance ||
    first.nodeId.localeCompare(second.nodeId)
  )
}

export function connectedObjectGraphNodeInDirection(
  graph: SceneGraph,
  pageId: string,
  nodeId: string,
  direction: ObjectGraphNavigationDirection
): string | null {
  const current = graph.getNode(nodeId)
  if (!current) return null
  const origin = projectObjectGraphNode(current, graph).bounds
  const vector = DIRECTION_VECTORS[direction]
  const peerIds = new Set(
    objectGraphConnectionsForNode(graph, pageId, nodeId).map((connection) =>
      connection.sourceNodeId === nodeId ? connection.targetNodeId : connection.sourceNodeId
    )
  )
  const candidates: NavigationCandidate[] = []

  for (const peerId of peerIds) {
    const peer = graph.getNode(peerId)
    if (!peer || !graph.isDescendant(peer.id, pageId)) continue
    const target = projectObjectGraphNode(peer, graph).bounds
    const dx = target.centerX - origin.centerX
    const dy = target.centerY - origin.centerY
    const primary = dx * vector.x + dy * vector.y
    const perpendicular = Math.abs(dx * vector.y - dy * vector.x)
    if (primary <= 0 || perpendicular > primary) continue
    candidates.push({
      distance: Math.hypot(dx, dy),
      nodeId: peer.id,
      offAxisRatio: perpendicular / primary
    })
  }

  candidates.sort(compareCandidates)
  return candidates[0]?.nodeId ?? null
}
