import type { WorkspaceGeometry, WorkspaceObject, WorkspaceViewKind } from '@/app/workspace'

function cardSize(
  object: WorkspaceObject,
  viewKind: WorkspaceViewKind
): { height: number; width: number } {
  if (viewKind === 'document') {
    if (object.type === 'collection') return { height: 240, width: 780 }
    if (object.type === 'live-app-block') return { height: 156, width: 780 }
    return {
      height: object.type === 'document-block' && object.blockKind === 'heading' ? 96 : 118,
      width: 780
    }
  }
  if (viewKind === 'review') return { height: 150, width: 460 }
  if (object.type === 'collection') return { height: 196, width: 360 }
  if (object.type === 'live-app-block') return { height: 138, width: 360 }
  return { height: 112, width: 300 }
}

export function defaultWorkspaceProjectionGeometry(
  object: WorkspaceObject,
  viewKind: WorkspaceViewKind,
  ordinal: number
): WorkspaceGeometry {
  const size = cardSize(object, viewKind)
  if (viewKind === 'canvas') {
    return {
      height: size.height,
      width: size.width,
      x: 1480 + (ordinal % 2) * 390,
      y: 88 + Math.floor(ordinal / 2) * 230
    }
  }
  if (viewKind === 'document' || viewKind === 'atlas') {
    return { height: size.height, width: size.width, x: 96, y: 220 + ordinal * 280 }
  }
  if (viewKind === 'review') {
    return {
      height: size.height,
      width: size.width,
      x: 96 + (ordinal % 2) * 500,
      y: 220 + Math.floor(ordinal / 2) * 184
    }
  }
  return {
    height: size.height,
    width: size.width,
    x: 96 + (ordinal % 4) * 340,
    y: 1080 + Math.floor(ordinal / 4) * 230
  }
}
