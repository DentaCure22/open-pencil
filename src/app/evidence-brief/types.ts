import type {
  DecisionReceipt,
  EvidenceCollectionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  IntentRecord,
  SurfaceRun,
  WorkspaceObjectRevisionRef
} from '@/app/workspace'

export type EvidenceBriefSharedLineage = {
  evidenceManifest: WorkspaceObjectRevisionRef
  intent: WorkspaceObjectRevisionRef
  primarySurfaceRun: WorkspaceObjectRevisionRef
}

export type EvidenceBriefView = 'overview' | 'focus' | 'sources' | 'review'

export type EvidenceBriefSpec = {
  capturedAt: string
  collectionReceipt?: EvidenceCollectionReceipt
  evidence: EvidenceManifestItem[]
  formChoice?: SurfaceRun['formChoice']
  id: string
  intent: {
    constraints: string[]
    desiredOutcome: string
    statement: string
  }
  openQuestions: string[]
  sharedLineage?: EvidenceBriefSharedLineage
  sections: Array<{
    body: string
    evidenceItemIds: string[]
    id: string
    title: string
  }>
  subject: string
  takeaway: string
  title: string
  views: EvidenceBriefView[]
}

export type EvidenceBriefRenderState = {
  artifactRevision: number
  evidence: EvidenceManifest
  intent: IntentRecord
  receipt?: DecisionReceipt
  spec: EvidenceBriefSpec
  surface: SurfaceRun
  workspaceRevision: number
}

export type EvidenceBriefEventRequest = {
  action: 'approve'
  actorId?: string
  eventId: string
  expected: {
    artifactRevision: number
    surfaceRevision: number
    workspaceRevision: number
  }
  note?: string
  surfaceRunId: string
}

export type EvidenceBriefEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: EvidenceBriefRenderState
  status: 'applied' | 'replayed' | 'rejected'
}

export type EvidenceBriefCreationResult = {
  boardId: string
  created: boolean
  formRationale: string
  surfaceRunId: string
}
