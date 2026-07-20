import type {
  DecisionRecommendation,
  DecisionReceipt,
  EvidenceCollectionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  IntentRecord,
  SurfaceInteractionAction,
  SurfaceRun
} from '@/app/workspace'

export type OptionWorkbenchSpec = {
  actorId?: string
  capturedAt: string
  collectionReceipt?: EvidenceCollectionReceipt
  evidence: EvidenceManifestItem[]
  formChoice?: SurfaceRun['formChoice']
  formRationale: string
  id: string
  intent: {
    constraints: string[]
    desiredOutcome: string
    statement: string
  }
  mode: 'compare' | 'decision'
  recommendations: DecisionRecommendation[]
  rendererId: string
  title: string
}

export type WeeklyDecisionEventRequest = {
  action: SurfaceInteractionAction
  actorId?: string
  eventId: string
  expected: {
    artifactRevision: number
    surfaceRevision: number
    workspaceRevision: number
  }
  note?: string
  recommendationId?: string
  surfaceRunId: string
  toIndex?: number
}

export type WeeklyDecisionEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: WeeklyDecisionRenderState
  status: 'applied' | 'replayed' | 'rejected'
}

export type WeeklyDecisionRenderState = {
  artifactRevision: number
  evidence: EvidenceManifest
  intent: IntentRecord
  recommendations: DecisionRecommendation[]
  receipt?: DecisionReceipt
  surface: SurfaceRun
  workspaceRevision: number
}

export type WeeklyDecisionCreationResult = {
  boardId: string
  created: boolean
  surfaceRunId: string
}
