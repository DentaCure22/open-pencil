import type { Rect } from '@open-pencil/scene-graph'

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

export type BoardPermission =
  | (typeof BOARD_COMPONENT_PERMISSIONS)[number]
  | (typeof BOARD_PAGE_PERMISSIONS)[number]
  | (typeof BOARD_SHAPE_PERMISSIONS)[number]
  | (typeof BOARD_TARGET_PERMISSIONS)[number]

export type BoardPermissionDescriptor = {
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
  maxComponents?: number
  maxShapes?: number
  name: string
  pageId: string
  permissions: BoardPermission[]
  targetNodeIds?: string[]
}

export type BoardPermissionDenialReason =
  | 'capability-denied'
  | 'context-invalid'
  | 'source-missing'
  | 'target-missing'

export type BoardMutationReceipt<
  TType extends string,
  TReason extends string = BoardPermissionDenialReason
> = {
  actionId: string
  actorId: string
  changed: boolean
  reason?: TReason
  status: 'applied' | 'denied' | 'noop'
  targetNodeId?: string
  type: TType
}

export type BoardPermissionContext = Readonly<
  Omit<BoardPermissionDescriptor, 'labels' | 'marker' | 'permissions' | 'targetNodeIds'> & {
    labels: Readonly<BoardPermissionDescriptor['labels']>
    marker: Readonly<BoardPermissionDescriptor['marker']>
    permissions: readonly BoardPermission[]
    targetNodeIds: readonly string[]
  }
>

export type BoardMutationResult<TResult> =
  | {
      context: BoardPermissionContext
      result: TResult
      status: 'allowed'
    }
  | {
      reason: BoardPermissionDenialReason
      status: 'denied'
    }
