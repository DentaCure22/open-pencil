export {
  BOARD_COMPONENT_PERMISSIONS,
  BOARD_PAGE_PERMISSIONS,
  BOARD_SHAPE_PERMISSIONS,
  BOARD_TARGET_PERMISSIONS
} from './contracts'

export { boardNodeMatchesOwner, runBoardMutation } from './run'
export { runBoardTargetMutation } from './target-mutations'

export {
  boundedBoardNumber,
  deleteBoardLeaf,
  normalizeBoardAppearanceChanges,
  normalizeBoardGeometryChanges,
  normalizeOwnedBoardGeometry,
  restoreBoardLeaf
} from './leaf-mutations'

export { reconcileBoardPage } from './page-reconciliation'

export type {
  BoardPageReconciliationAction,
  BoardPageReconciliationProvenance,
  BoardPageReconciliationReceipt
} from './page-reconciliation'

export type { BoardTargetMutation, BoardTargetReceipt } from './target-mutations'

export type {
  BoardMutationReceipt,
  BoardMutationResult,
  BoardPermission,
  BoardPermissionContext,
  BoardPermissionDenialReason,
  BoardPermissionDescriptor
} from './contracts'
