import type { SceneNode } from '@open-pencil/scene-graph'

export const DEFAULT_LIVE_FRAME_RADIUS = 16

function radius(value: number) {
  return `${Math.max(0, value)}px`
}

export function liveFrameCornerRadii(frame: SceneNode) {
  if (!frame.independentCorners) {
    const value = Math.max(0, frame.cornerRadius || DEFAULT_LIVE_FRAME_RADIUS)
    return { bottomLeft: value, bottomRight: value, topLeft: value, topRight: value }
  }

  return {
    bottomLeft: Math.max(0, frame.bottomLeftRadius),
    bottomRight: Math.max(0, frame.bottomRightRadius),
    topLeft: Math.max(0, frame.topLeftRadius),
    topRight: Math.max(0, frame.topRightRadius)
  }
}

export function liveFrameCornerStyle(frame: SceneNode): Record<string, string> {
  const radii = liveFrameCornerRadii(frame)
  return {
    borderBottomLeftRadius: radius(radii.bottomLeft),
    borderBottomRightRadius: radius(radii.bottomRight),
    borderTopLeftRadius: radius(radii.topLeft),
    borderTopRightRadius: radius(radii.topRight)
  }
}
