export type SpatialNavigationDirection = 'down' | 'left' | 'right' | 'up'

export type SpatialDirectionVector = {
  x: -1 | 0 | 1
  y: -1 | 0 | 1
}

export const SPATIAL_DIRECTION_VECTORS: Record<SpatialNavigationDirection, SpatialDirectionVector> =
  {
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    up: { x: 0, y: -1 }
  }
