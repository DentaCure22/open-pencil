import type {
  DecisionRecommendation,
  DecisionReceipt,
  EvidenceManifest,
  EvidenceManifestItem,
  IntentRecord,
  SurfaceInteractionAction,
  SurfaceRun
} from '@/app/workspace'

export type FlowStudioView = 'overview' | 'focus' | 'compare' | 'review'

export type FlowStudioOption = {
  evidenceItemIds: string[]
  fieldGroups: Array<{ fields: string[]; title: string }>
  id: string
  label: string
  summary: string
  title: string
  tradeoff: string
  uncertainty: string
}

export type FlowStudioSpec = {
  capturedAt: string
  conversation: Array<{ author: 'agent' | 'user'; body: string }>
  decision: { body: string; status: 'accepted' | 'open' }
  evidence: EvidenceManifestItem[]
  id: string
  intent: {
    constraints: string[]
    desiredOutcome: string
    statement: string
  }
  options: FlowStudioOption[]
  signals: Array<{
    id: string
    kind: 'analytics' | 'design-system' | 'runtime-error'
    label: string
    truth: string
    value: string
  }>
  source: {
    applicationId: string
    environment: string
    route: string
    scenarioId: string
    sourceRevision: string
    truth: 'illustrative-preview'
  }
  subject: string
  tasks: Array<{ id: string; status: 'done' | 'in-progress' | 'todo'; title: string }>
  title: string
  views: FlowStudioView[]
}

export type FlowStudioObjectRefs = {
  comparisonReviewId: string
  optionArtifactIds: string[]
  sourceBlockId: string
  taskCollectionId: string
  taskRecordIds: string[]
}

export type FlowStudioRenderState = {
  artifactRevision: number
  evidence: EvidenceManifest
  intent: IntentRecord
  objectRefs: FlowStudioObjectRefs
  options: DecisionRecommendation[]
  receipt?: DecisionReceipt
  spec: FlowStudioSpec
  surface: SurfaceRun
  workspaceRevision: number
}

export type FlowStudioEventRequest = {
  action: Extract<SurfaceInteractionAction, 'approve' | 'prefer' | 'unprefer'>
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
}

export type FlowStudioEventResult = {
  error?: string
  eventId: string
  receiptId?: string
  state?: FlowStudioRenderState
  status: 'applied' | 'replayed' | 'rejected'
}

export type FlowStudioCreationResult = {
  boardId: string
  created: boolean
  formRationale: string
  surfaceRunId: string
}
