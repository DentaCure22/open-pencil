import type { VectorNetwork } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

/** Compute the opposite handle for the selected mirroring mode. */
export function mirrorHandle(
  handle: Vector,
  mode: 'NONE' | 'ANGLE' | 'ANGLE_AND_LENGTH',
  oppositeLength?: number
): Vector | null {
  switch (mode) {
    case 'NONE':
      return null
    case 'ANGLE_AND_LENGTH':
      return { x: -handle.x, y: -handle.y }
    case 'ANGLE': {
      const len = oppositeLength ?? Math.hypot(handle.x, handle.y)
      const hLen = Math.hypot(handle.x, handle.y)
      if (hLen < 1e-9) return { x: 0, y: 0 }
      const scale = len / hLen
      return { x: -handle.x * scale, y: -handle.y * scale }
    }
  }
  return null
}

export function findOppositeHandle(
  network: VectorNetwork,
  vertexIndex: number,
  segmentIndex: number
): { segmentIndex: number; tangentField: 'tangentStart' | 'tangentEnd' } | null {
  for (let i = 0; i < network.segments.length; i++) {
    if (i === segmentIndex) continue
    const s = network.segments[i]
    if (s.start === vertexIndex) return { segmentIndex: i, tangentField: 'tangentStart' }
    if (s.end === vertexIndex) return { segmentIndex: i, tangentField: 'tangentEnd' }
  }
  return null
}

export function findAllHandles(
  network: VectorNetwork,
  vertexIndex: number
): { segmentIndex: number; tangentField: 'tangentStart' | 'tangentEnd'; neighborIndex: number }[] {
  const result: {
    segmentIndex: number
    tangentField: 'tangentStart' | 'tangentEnd'
    neighborIndex: number
  }[] = []
  for (let i = 0; i < network.segments.length; i++) {
    const s = network.segments[i]
    if (s.start === vertexIndex) {
      result.push({ segmentIndex: i, tangentField: 'tangentStart', neighborIndex: s.end })
    }
    if (s.end === vertexIndex) {
      result.push({ segmentIndex: i, tangentField: 'tangentEnd', neighborIndex: s.start })
    }
  }
  return result
}
