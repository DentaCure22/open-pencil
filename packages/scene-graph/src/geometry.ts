export { clipBoundsToPolygon, clipPolygon, polygonVertices } from './geometry/polygons'
export { degToRad, radToDeg, rotatePoint, rotatedBBox, rotatedCorners } from './geometry/transforms'
export {
  computeAbsoluteBounds,
  computeBounds,
  computeDescendantVisualBounds,
  computeVisualBounds,
  effectOverflow,
  geometryBlobBounds,
  intersectVisualBounds,
  mapAxisAlignedRect,
  nodeVisualBounds,
  rectIntersectionArea,
  rectIntersectionRatio,
  rectsIntersect,
  strokeOverflow,
  unionVisualBounds,
  type VisualBounds,
  type VisualBoundsNode
} from './geometry/visual-bounds'
