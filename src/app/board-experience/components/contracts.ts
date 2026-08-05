import type { BoardPermissionDescriptor } from '@/app/board-permissions'

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

export type BoardComponentDenialReason =
  | 'action-failed'
  | 'capability-denied'
  | 'component-limit'
  | 'component-not-owned'
  | 'context-invalid'
  | 'invalid-payload'
  | 'session-closed'
  | 'source-missing'
  | 'target-missing'

export type BoardComponentReceipt = {
  actionId: string
  actorId: string
  changed: boolean
  component?: BoardComponentSnapshot
  reason?: BoardComponentDenialReason
  status: 'applied' | 'denied' | 'noop'
  targetNodeId?: string
  type: 'board.component.create' | 'board.component.delete' | 'board.component.update'
}

export type BoardComponentClient = {
  readonly components: BoardComponentSnapshot[]
  createComponent: (
    component: BoardComponentCreateInput,
    options?: BoardComponentMutationOptions
  ) => BoardComponentReceipt
  deleteComponent: (
    componentId: string,
    options?: BoardComponentMutationOptions
  ) => BoardComponentReceipt
  updateComponent: (
    componentId: string,
    changes: BoardComponentUpdateInput,
    options?: BoardComponentMutationOptions
  ) => BoardComponentReceipt
}

export type BoardComponentSessionContext = BoardPermissionDescriptor & {
  isActive: () => boolean
  sessionId: string
}

export type BoardComponentSession = {
  board: BoardComponentClient
  dispose: () => string[]
}
