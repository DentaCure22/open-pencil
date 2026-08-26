export {
  computeAccurateBounds,
  cubicExtrema,
  evalCubic,
  isLineSegment,
  nearestPointOnCubic,
  nearestPointOnNetwork,
  segmentToAbsolute,
  splitCubicAt,
  type CubicPoints,
  type NearestResult,
  type NetworkNearestResult
} from './curve-math'

export { extractSubNetwork, findConnectedComponents } from './connectivity'
export { findAllHandles, findOppositeHandle, mirrorHandle } from './handles'
export { breakAtVertex, deleteVertex, removeVertex, splitSegmentAt } from './network-editing'
