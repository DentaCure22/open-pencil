import {
  getAbsolutePositionFull,
  getWorldMatrix,
  TransformMatrix,
  type ObjectGraphPortSide,
  type SceneGraph,
  type SceneNode,
  type Vector
} from '@open-pencil/scene-graph'

export const OBJECT_GRAPH_PORT_SIDES = ['top', 'right', 'bottom', 'left'] as const

export type ObjectGraphFixedPortSide = Exclude<ObjectGraphPortSide, 'auto'>

export type ObjectGraphPortAnchor = {
  normal: Vector
  point: Vector
}

export type ObjectGraphNodeProjection = {
  bounds: ReturnType<typeof getAbsolutePositionFull>
  corners: [Vector, Vector, Vector, Vector]
  ports: Record<ObjectGraphFixedPortSide, ObjectGraphPortAnchor>
}

const LOCAL_NORMALS: Record<ObjectGraphFixedPortSide, Vector> = {
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 }
}

function normalizeVector(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y)
  return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length }
}

function transformNormal(matrix: ReturnType<typeof getWorldMatrix>, normal: Vector): Vector {
  return normalizeVector({
    x: matrix[0] * normal.x + matrix[1] * normal.y,
    y: matrix[3] * normal.x + matrix[4] * normal.y
  })
}

function localPortPoint(node: SceneNode, side: ObjectGraphFixedPortSide): Vector {
  if (side === 'top') return { x: node.width / 2, y: 0 }
  if (side === 'right') return { x: node.width, y: node.height / 2 }
  if (side === 'bottom') return { x: node.width / 2, y: node.height }
  return { x: 0, y: node.height / 2 }
}

export function projectObjectGraphNode(
  node: SceneNode,
  graph: SceneGraph
): ObjectGraphNodeProjection {
  const matrix = getWorldMatrix(node, graph)
  const bounds = getAbsolutePositionFull(node, graph)
  const mappedCorners = TransformMatrix.mapPoints(matrix, [
    0,
    0,
    node.width,
    0,
    node.width,
    node.height,
    0,
    node.height
  ])
  const corners: [Vector, Vector, Vector, Vector] = [
    { x: mappedCorners[0], y: mappedCorners[1] },
    { x: mappedCorners[2], y: mappedCorners[3] },
    { x: mappedCorners[4], y: mappedCorners[5] },
    { x: mappedCorners[6], y: mappedCorners[7] }
  ]
  const ports = Object.fromEntries(
    OBJECT_GRAPH_PORT_SIDES.map((side) => [
      side,
      {
        normal: transformNormal(matrix, LOCAL_NORMALS[side]),
        point: TransformMatrix.mapPoint(matrix, localPortPoint(node, side))
      }
    ])
  ) as Record<ObjectGraphFixedPortSide, ObjectGraphPortAnchor>

  return { bounds, corners, ports }
}

export function bestObjectGraphPortSide(
  projection: ObjectGraphNodeProjection,
  toward: Vector
): ObjectGraphFixedPortSide {
  const direction = normalizeVector({
    x: toward.x - projection.bounds.centerX,
    y: toward.y - projection.bounds.centerY
  })
  let best: ObjectGraphFixedPortSide = OBJECT_GRAPH_PORT_SIDES[0]
  let bestScore = Number.NEGATIVE_INFINITY
  for (const side of OBJECT_GRAPH_PORT_SIDES) {
    const normal = projection.ports[side].normal
    const score = normal.x * direction.x + normal.y * direction.y
    if (score > bestScore) {
      best = side
      bestScore = score
    }
  }
  return best
}
