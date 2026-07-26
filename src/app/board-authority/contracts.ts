import type { ObjectGraphAction, Rect } from '@open-pencil/scene-graph'

export const BOARD_AUTHORITY_API_VERSION = 2 as const

export const BOARD_COMPONENT_PERMISSIONS = [
  'component.create',
  'component.delete',
  'component.update.appearance',
  'component.update.geometry',
  'component.update.props',
  'component.update.source',
  'component.update.state'
] as const

export const BOARD_SHAPE_PERMISSIONS = [
  'shape.create',
  'shape.delete',
  'shape.update.appearance',
  'shape.update.geometry'
] as const

export const BOARD_TARGET_PERMISSIONS = [
  'target.action.execute',
  'target.data.write',
  'target.state.write'
] as const

export const BOARD_PAGE_PERMISSIONS = ['page.reconcile'] as const

export type BoardAuthorityPermission =
  | (typeof BOARD_COMPONENT_PERMISSIONS)[number]
  | (typeof BOARD_PAGE_PERMISSIONS)[number]
  | (typeof BOARD_SHAPE_PERMISSIONS)[number]
  | (typeof BOARD_TARGET_PERMISSIONS)[number]

export type BoardComponentLifecycle = 'durable' | 'transient'

export type BoardMutationHistory = 'transient' | 'undoable'

export type BoardComponentSnapshot = {
  definitionId: string
  height: number
  id: string
  lifecycle: BoardComponentLifecycle
  name: string
  opacity: number
  props: Record<string, unknown>
  rotation: number
  selected: boolean
  source: string
  state: Record<string, unknown>
  visible: boolean
  width: number
  x: number
  y: number
}

export type BoardComponentCreateInput = {
  cornerRadius?: number
  definitionId: string
  height?: number
  lifecycle?: BoardComponentLifecycle
  name?: string
  props?: Record<string, unknown>
  source: string
  state?: Record<string, unknown>
  width?: number
  x?: number
  y?: number
}

export type BoardComponentUpdateInput = Partial<
  Pick<
    BoardComponentSnapshot,
    | 'height'
    | 'name'
    | 'opacity'
    | 'props'
    | 'rotation'
    | 'source'
    | 'state'
    | 'visible'
    | 'width'
    | 'x'
    | 'y'
  >
>

export type BoardComponentMutationOptions = {
  history?: BoardMutationHistory
}

export type BoardShapeKind = 'ellipse' | 'rectangle'

export type BoardShapeSnapshot = {
  fill: string
  height: number
  id: string
  kind: BoardShapeKind
  name: string
  opacity: number
  rotation: number
  visible: boolean
  width: number
  x: number
  y: number
}

export type BoardShapeCreateInput = {
  fill?: string
  height?: number
  kind: BoardShapeKind
  name?: string
  width?: number
  x?: number
  y?: number
}

export type BoardShapeUpdateInput = Partial<
  Pick<
    BoardShapeSnapshot,
    'fill' | 'height' | 'name' | 'opacity' | 'rotation' | 'visible' | 'width' | 'x' | 'y'
  >
>

export type BoardShapeAction =
  | {
      shape: BoardShapeCreateInput
      type: 'board.shape.create'
    }
  | {
      changes: BoardShapeUpdateInput
      shapeId: string
      type: 'board.shape.update'
    }
  | {
      shapeId: string
      type: 'board.shape.delete'
    }

export type BoardTargetAction =
  | {
      action: ObjectGraphAction
      targetNodeId: string
      type: 'board.target.action'
    }
  | {
      connectionId: string
      sourceNodeId: string
      targetNodeId: string
      type: 'board.target.data'
      value: unknown
    }
  | {
      connectionId: string
      patch: Record<string, unknown>
      sourceNodeId: string
      targetNodeId: string
      type: 'board.target.state'
    }

export type BoardAuthorityDenialReason =
  | 'action-failed'
  | 'capability-denied'
  | 'component-limit'
  | 'component-not-owned'
  | 'grant-invalid'
  | 'invalid-payload'
  | 'page-mismatch'
  | 'shape-limit'
  | 'shape-not-owned'
  | 'source-missing'
  | 'target-missing'

type BoardMutationReceipt<TType extends string> = {
  actionId: string
  actorId: string
  apiVersion: typeof BOARD_AUTHORITY_API_VERSION
  changed: boolean
  grantId: string
  reason?: BoardAuthorityDenialReason
  status: 'applied' | 'denied' | 'noop'
  targetNodeId?: string
  type: TType
}

export type BoardComponentReceipt = BoardMutationReceipt<
  'board.component.create' | 'board.component.delete' | 'board.component.update'
> & {
  component?: BoardComponentSnapshot
}

export type BoardAuthorityReceipt = BoardMutationReceipt<BoardShapeAction['type']> & {
  shape?: BoardShapeSnapshot
}

export type BoardTargetReceipt = BoardMutationReceipt<BoardTargetAction['type']>

export type BoardPageReconciliationProvenance = {
  operation: 'react-design.patch' | 'react-design.reimport'
  sourceId?: string
}

export type BoardPageReconciliationAction<TResult> = {
  apply: () => TResult
  label: string
  provenance: BoardPageReconciliationProvenance
  type: 'board.page.reconcile'
}

export type BoardPageReconciliationReceipt<TResult> = BoardMutationReceipt<
  BoardPageReconciliationAction<TResult>['type']
> & {
  pageId: string
  pageName: string
  provenance: BoardPageReconciliationProvenance
  result?: TResult
}

export type BoardAuthorityGrantDescriptor = {
  actorId: string
  defaultOrigin: Rect
  labels: {
    create: string
    delete: string
    update: string
  }
  marker: {
    key: string
    pluginId: string
    value: string
  }
  maxShapes?: number
  maxComponents?: number
  name: string
  pageId: string
  permissions: BoardAuthorityPermission[]
  targetNodeIds?: string[]
}

declare const boardAuthorityGrantBrand: unique symbol

export type BoardAuthorityGrant = BoardAuthorityGrantDescriptor & {
  apiVersion: typeof BOARD_AUTHORITY_API_VERSION
  grantId: string
  readonly [boardAuthorityGrantBrand]: true
}

export type BoardShapeClient = {
  apiVersion: typeof BOARD_AUTHORITY_API_VERSION
  createShape: (shape: BoardShapeCreateInput) => Promise<BoardAuthorityReceipt>
  deleteShape: (shapeId: string) => Promise<BoardAuthorityReceipt>
  grantId: string
  permissions: BoardAuthorityPermission[]
  shapes: BoardShapeSnapshot[]
  updateShape: (shapeId: string, changes: BoardShapeUpdateInput) => Promise<BoardAuthorityReceipt>
}

export type BoardComponentClient = {
  apiVersion: typeof BOARD_AUTHORITY_API_VERSION
  components: BoardComponentSnapshot[]
  createComponent: (
    component: BoardComponentCreateInput,
    options?: BoardComponentMutationOptions
  ) => BoardComponentReceipt
  deleteComponent: (
    componentId: string,
    options?: BoardComponentMutationOptions
  ) => BoardComponentReceipt
  grantId: string
  permissions: BoardAuthorityPermission[]
  updateComponent: (
    componentId: string,
    changes: BoardComponentUpdateInput,
    options?: BoardComponentMutationOptions
  ) => BoardComponentReceipt
}
