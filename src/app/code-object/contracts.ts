import type { ObjectGraphInputEnvelope, ObjectGraphSignal } from '@open-pencil/scene-graph'

import type {
  BoardAuthorityDenialReason,
  BoardAuthorityPermission,
  BoardShapeCreateInput,
  BoardShapeKind,
  BoardShapeSnapshot,
  BoardShapeUpdateInput,
  BoardTargetReceipt
} from '@/app/board-authority'

export const CODE_OBJECT_BOARD_API_VERSION = 3 as const

/** @deprecated Read/source compatibility only. Authority is stored on Object Graph records. */
export type CodeObjectConnectionPermission = 'state.write'
export type CodeObjectBoardPermission = BoardAuthorityPermission

/** @deprecated Read/source compatibility only. New connections are page-owned Object Graph records. */
export type CodeObjectConnection = {
  id: string
  label: string
  permissions: CodeObjectConnectionPermission[]
  targetFrameId: string
}

export type CodeObjectConnectionDescriptor = Omit<CodeObjectConnection, 'targetFrameId'>

export type CodeObjectStatePatch = Record<string, unknown>

export type CodeObjectBoardShapeKind = BoardShapeKind

export type CodeObjectBoardShapeSnapshot = BoardShapeSnapshot

export type CodeObjectBoardSelfSnapshot = {
  height: number
  id: string
  name: string
  rotation: number
  width: number
  x: number
  y: number
}

export type CodeObjectCreateBoardShapeInput = BoardShapeCreateInput

export type CodeObjectUpdateBoardShapeInput = BoardShapeUpdateInput

export type CodeObjectStatePatchAction = {
  connectionId: string
  sourceStatePatch?: CodeObjectStatePatch
  targetStatePatch: CodeObjectStatePatch
  type: 'code-object.state.patch'
}

export type CodeObjectCreateBoardShapeAction = {
  shape: CodeObjectCreateBoardShapeInput
  type: 'code-object.board-shape.create'
}

export type CodeObjectUpdateBoardShapeAction = {
  changes: CodeObjectUpdateBoardShapeInput
  shapeId: string
  type: 'code-object.board-shape.update'
}

export type CodeObjectDeleteBoardShapeAction = {
  shapeId: string
  type: 'code-object.board-shape.delete'
}

export type CodeObjectGraphEmitAction = {
  signal: ObjectGraphSignal
  type: 'code-object.graph.emit'
}

export type CodeObjectBoardAction =
  | CodeObjectCreateBoardShapeAction
  | CodeObjectDeleteBoardShapeAction
  | CodeObjectGraphEmitAction
  | CodeObjectStatePatchAction
  | CodeObjectUpdateBoardShapeAction

export type CodeObjectActionDenialReason =
  | BoardAuthorityDenialReason
  | 'connection-missing'
  | 'cross-page'
  | 'interaction-required'
  | 'permission-denied'
  | 'unsupported-action'

export type CodeObjectActionReceipt = {
  actionId: string
  actorFrameId: string
  authorityReceipt?: BoardTargetReceipt
  changed: boolean
  reason?: CodeObjectActionDenialReason
  status: 'applied' | 'denied' | 'noop'
  targetNodeId?: string
  targetNodeIds?: string[]
  targetFrameId?: string
  type: CodeObjectBoardAction['type']
  shape?: CodeObjectBoardShapeSnapshot
}

export type DispatchCodeObjectBoardAction = (
  action: CodeObjectBoardAction
) => Promise<CodeObjectActionReceipt>

export type CodeObjectBoardClient = {
  apiVersion: typeof CODE_OBJECT_BOARD_API_VERSION
  connections: CodeObjectConnectionDescriptor[]
  createShape: (shape: CodeObjectCreateBoardShapeInput) => Promise<CodeObjectActionReceipt>
  deleteShape: (shapeId: string) => Promise<CodeObjectActionReceipt>
  emitGraphSignal: (signal: ObjectGraphSignal) => Promise<CodeObjectActionReceipt>
  inputs: ObjectGraphInputEnvelope[]
  permissions: CodeObjectBoardPermission[]
  self: CodeObjectBoardSelfSnapshot
  shapes: CodeObjectBoardShapeSnapshot[]
  updateShape: (
    shapeId: string,
    changes: CodeObjectUpdateBoardShapeInput
  ) => Promise<CodeObjectActionReceipt>
}
