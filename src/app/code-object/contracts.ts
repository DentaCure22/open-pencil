export const CODE_OBJECT_BOARD_API_VERSION = 1 as const

export type CodeObjectConnectionPermission = 'state.write'

export type CodeObjectConnection = {
  id: string
  label: string
  permissions: CodeObjectConnectionPermission[]
  targetFrameId: string
}

export type CodeObjectConnectionDescriptor = Omit<CodeObjectConnection, 'targetFrameId'>

export type CodeObjectStatePatchAction = {
  connectionId: string
  sourceStatePatch?: Record<string, unknown>
  targetStatePatch: Record<string, unknown>
  type: 'code-object.state.patch'
}

export type CodeObjectBoardAction = CodeObjectStatePatchAction

export type CodeObjectActionDenialReason =
  | 'action-failed'
  | 'connection-missing'
  | 'cross-page'
  | 'interaction-required'
  | 'invalid-payload'
  | 'permission-denied'
  | 'source-missing'
  | 'target-missing'

export type CodeObjectActionReceipt = {
  actionId: string
  actorFrameId: string
  changed: boolean
  reason?: CodeObjectActionDenialReason
  status: 'applied' | 'denied' | 'noop'
  targetFrameId?: string
  type: CodeObjectBoardAction['type']
}

export type DispatchCodeObjectBoardAction = (
  action: CodeObjectBoardAction
) => Promise<CodeObjectActionReceipt>
