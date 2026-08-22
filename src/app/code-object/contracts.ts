import type { BoardPermission, BoardPermissionDenialReason } from '@/app/board-permissions'

export const CODE_OBJECT_BOARD_API_VERSION = 3 as const

export type CodeObjectBoardPermission = BoardPermission

export type CodeObjectStatePatch = Record<string, unknown>

export type CodeObjectBoardShapeKind = 'ellipse' | 'rectangle'

export type CodeObjectBoardShapeSnapshot = {
  fill: string
  height: number
  id: string
  kind: CodeObjectBoardShapeKind
  name: string
  opacity: number
  rotation: number
  visible: boolean
  width: number
  x: number
  y: number
}

export type CodeObjectBoardSelfSnapshot = {
  height: number
  id: string
  name: string
  rotation: number
  width: number
  x: number
  y: number
}

export type CodeObjectCreateBoardShapeInput = {
  fill?: string
  height?: number
  kind: CodeObjectBoardShapeKind
  name?: string
  width?: number
  x?: number
  y?: number
}

export type CodeObjectUpdateBoardShapeInput = Partial<
  Pick<
    CodeObjectBoardShapeSnapshot,
    'fill' | 'height' | 'name' | 'opacity' | 'rotation' | 'visible' | 'width' | 'x' | 'y'
  >
>

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

export type CodeObjectBoardAction =
  | CodeObjectCreateBoardShapeAction
  | CodeObjectDeleteBoardShapeAction
  | CodeObjectUpdateBoardShapeAction

export type CodeObjectActionDenialReason =
  | BoardPermissionDenialReason
  | 'action-failed'
  | 'invalid-payload'
  | 'shape-limit'
  | 'shape-not-owned'
  | 'cross-page'
  | 'interaction-required'
  | 'permission-denied'
  | 'unsupported-action'

export type CodeObjectActionReceipt = {
  actionId: string
  actorFrameId: string
  changed: boolean
  reason?: CodeObjectActionDenialReason
  status: 'applied' | 'denied' | 'noop'
  targetNodeId?: string
  targetFrameId?: string
  type: CodeObjectBoardAction['type']
  shape?: CodeObjectBoardShapeSnapshot
}

export type DispatchCodeObjectBoardAction = (
  action: CodeObjectBoardAction
) => Promise<CodeObjectActionReceipt>

export type CodeObjectBoardClient = {
  apiVersion: typeof CODE_OBJECT_BOARD_API_VERSION
  createShape: (shape: CodeObjectCreateBoardShapeInput) => Promise<CodeObjectActionReceipt>
  deleteShape: (shapeId: string) => Promise<CodeObjectActionReceipt>
  permissions: CodeObjectBoardPermission[]
  self: CodeObjectBoardSelfSnapshot
  shapes: CodeObjectBoardShapeSnapshot[]
  updateShape: (
    shapeId: string,
    changes: CodeObjectUpdateBoardShapeInput
  ) => Promise<CodeObjectActionReceipt>
}
