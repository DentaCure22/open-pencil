import type {
  DecisionReceipt,
  EvidenceCollectionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  IntentRecord,
  SurfaceRun
} from '@/app/workspace'

export type SequentialPresentationSlideLayout =
  | 'statement'
  | 'sequence'
  | 'evidence'
  | 'contrast'
  | 'closing'

export type SequentialPresentationSlide = {
  body: string
  evidenceItemIds: string[]
  eyebrow: string
  id: string
  layout: SequentialPresentationSlideLayout
  points?: string[]
  title: string
}

export type SequentialPresentationSpec = {
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
  review: {
    approvalLabel: string
    approvalMeaning: string
    approvalNotMeaning: string
  }
  slides: SequentialPresentationSlide[]
  subject: string
  subtitle: string
  title: string
}

export type SequentialPresentationRenderState = {
  activeSlideId: string
  artifactRevision: number
  evidence: EvidenceManifest
  intent: IntentRecord
  receipt?: DecisionReceipt
  spec: SequentialPresentationSpec
  surface: SurfaceRun
  workspaceRevision: number
}

export type SequentialPresentationEventRequest = {
  action: 'approve' | 'navigate'
  actorId?: string
  eventId: string
  expected: {
    artifactRevision: number
    surfaceRevision: number
    workspaceRevision: number
  }
  note?: string
  surfaceRunId: string
  targetSlideId?: string
}

export type SequentialPresentationEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: SequentialPresentationRenderState
  status: 'applied' | 'replayed' | 'rejected'
}

export type SequentialPresentationCreationResult = {
  boardId: string
  created: boolean
  formRationale: string
  surfaceRunId: string
}
