export const WORK_LIFECYCLE_STATUSES = [
  'reference',
  'draft',
  'in-review',
  'preferred',
  'change-set',
  'approved',
  'implementing',
  'verified',
  'historical'
] as const

export type WorkLifecycleStatus = (typeof WORK_LIFECYCLE_STATUSES)[number]

export const WORK_LIFECYCLE_ACTIONS = [
  'start-draft',
  'start-branch',
  'request-review',
  'request-changes',
  'mark-preferred',
  'create-change-set',
  'approve',
  'start-implementation',
  'verify',
  'archive'
] as const

export type WorkLifecycleAction = (typeof WORK_LIFECYCLE_ACTIONS)[number]
export type WorkLifecycleActorKind = 'agent' | 'human' | 'system'

export type WorkLifecycleVerificationEvidence = {
  realAppVerified: true
  sourcePatchId: string
  testCommand: string
  testPassed: true
  verifiedBy: string
}

export type WorkLifecycleTransitionReceipt = {
  action: WorkLifecycleAction
  actorId: string
  actorKind: WorkLifecycleActorKind
  evidence?: WorkLifecycleVerificationEvidence
  from: WorkLifecycleStatus
  id: string
  itemId: string
  label: string
  occurredAt: string
  revision: number
  to: WorkLifecycleStatus
}

export type WorkLifecycleState = {
  history: WorkLifecycleTransitionReceipt[]
  revision: number
  status: WorkLifecycleStatus
}

export type TransitionWorkLifecycleInput = {
  action: WorkLifecycleAction
  actorId?: string
  actorKind?: WorkLifecycleActorKind
  evidence?: WorkLifecycleVerificationEvidence
  id?: string
  label?: string
  now?: string
}

export type WorkLifecycleTransitionResult =
  | {
      ok: true
      receipt: WorkLifecycleTransitionReceipt
      state: WorkLifecycleState
    }
  | {
      ok: false
      reason: string
      state: WorkLifecycleState
    }

export type WorkViewLocation = {
  kind: string
  pageId: string
}

export type WorkViewViewport = {
  panX: number
  panY: number
  zoom: number
}

export type WorkViewSnapshot = {
  activeTool: string
  location: WorkViewLocation
  selectedIds: string[]
  viewport: WorkViewViewport
}

export type WorkViewMovementReceipt = {
  actorId: string
  actorKind: WorkLifecycleActorKind
  from: WorkViewLocation
  id: string
  itemId: string
  occurredAt: string
  origin: WorkViewSnapshot
  to: WorkViewLocation
}

export type WorkViewMemory = {
  active: WorkViewSnapshot | null
  history: WorkViewMovementReceipt[]
  version: 1
  views: Record<string, WorkViewSnapshot>
}

export type RecordWorkViewMovementInput = {
  actorId?: string
  actorKind?: WorkLifecycleActorKind
  id?: string
  now?: string
}
