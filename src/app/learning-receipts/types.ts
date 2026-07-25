import type { ObservedHumanSessionProof } from '@/app/human-sessions'
import type { ComposedExperienceFieldGateEvaluation } from '@/app/proving-gates'
import type {
  DecisionReceipt,
  LearningComparisonBaseline,
  LearningCompositionEvaluation,
  LearningComparisonOutcome,
  LearningExecutionKind,
  LearningFormDisposition,
  LearningOutcome,
  LearningQualitativeFeedback,
  LearningReceipt,
  ResolvedExperienceFamilyV1,
  SurfaceRun,
  WorkspaceRelation,
  WorkspaceObjectRevisionRef
} from '@/app/workspace'

import type { StaticAnswerBaselineView } from './comparison'

export type RecordLearningReceiptRequest = {
  comparisonBaseline?: LearningComparisonBaseline
  comparisonOutcome: LearningComparisonOutcome
  compositionEvaluations?: LearningCompositionEvaluation[]
  decisionReceipt?: WorkspaceObjectRevisionRef
  durableOutcome: boolean
  evidenceTraceable: boolean
  executionKind: LearningExecutionKind
  expectedWorkspaceRevision: number
  formDisposition: LearningFormDisposition
  idempotencyKey: string
  intentCompleted: boolean
  keyboardAccepted: boolean
  modelId?: string
  occurredAt: string
  outcome: LearningOutcome
  qualitativeFeedback?: LearningQualitativeFeedback
  receiptId: string
  recordedAt: string
  recordedBy: string
  repairCount: number
  runId: string
  safetyViolation: boolean
  surfaceRun: WorkspaceObjectRevisionRef
  visualAccepted: boolean
}

export type RecordLearningReceiptResult = {
  created: boolean
  idempotentReplay: boolean
  receipt: LearningReceipt
  workspaceRevision: number
}

export type LearningReceiptState = {
  latest?: LearningReceipt
  receipts: LearningReceipt[]
  surfaceRunId: string
}

export type ResolveLearningReviewContextRequest = {
  decisionReceiptId?: string
  surfaceRunId: string
}

export type ResolvedLearningReviewContext = {
  baseline: StaticAnswerBaselineView
  composition: ResolvedLearningComposition[]
  compositionGate: ComposedExperienceFieldGateEvaluation
  decision: DecisionReceipt
  decisionRef: WorkspaceObjectRevisionRef
  existing: LearningReceiptState
  experienceFamily?: ResolvedExperienceFamilyV1
  surface: SurfaceRun
  surfaceRef: WorkspaceObjectRevisionRef
  workspaceRevision: number
}

export type ResolvedLearningComposition = {
  companion: SurfaceRun
  companionRef: WorkspaceObjectRevisionRef
  primary: SurfaceRun
  primaryRef: WorkspaceObjectRevisionRef
  relation: WorkspaceRelation
}

export type HumanLearningReviewIdentity = {
  idempotencyKey: string
  receiptId: string
}

export type RecordHumanLearningReviewRequest = Omit<
  RecordLearningReceiptRequest,
  | 'attestation'
  | 'decisionReceipt'
  | 'executionKind'
  | 'idempotencyKey'
  | 'receiptId'
  | 'surfaceRun'
> & {
  decisionReceiptId?: string
  sessionProof?: ObservedHumanSessionProof
  surfaceRunId: string
}

export type RecordHumanLearningReviewResult = RecordLearningReceiptResult & {
  identity: HumanLearningReviewIdentity
  lineage: ResolvedLearningReviewContext
  resolution: 'created' | 'existing' | 'replayed'
  state: LearningReceiptState
}
