export type HumanLearningOutcome = 'passed' | 'failed' | 'abandoned'

export type HumanLearningFormDisposition = 'accepted' | 'overridden' | 'abandoned'

export type HumanLearningComparison = 'better' | 'same' | 'worse' | 'not-run'

export type HumanLearningCompositionSummary = {
  companionName: string
  companionSurface: WorkspaceObjectRevisionRef
  companionRenderer: string
  primaryName: string
  primarySurface: WorkspaceObjectRevisionRef
  primaryRenderer: string
  relation: { relationId: string; revision: number }
}

export type HumanLearningCompositionGateSummary = Pick<
  ComposedExperienceFieldGateEvaluation,
  'requiredVerifiedHumanRuns' | 'status' | 'verifiedHumanRuns'
>

export type HumanLearningSurfaceSummary = {
  name: string
  formLabel: string
  renderer: string
  decided: boolean
}

export type HumanLearningReviewSubmission = {
  comparisonBaseline?: LearningComparisonBaseline
  compositionEvaluations?: LearningCompositionEvaluation[]
  idempotencyKey: string
  jobCompleted: boolean
  outcome: HumanLearningOutcome
  formDisposition: HumanLearningFormDisposition
  comparison: HumanLearningComparison
  repairCount: number
  visualAccepted: boolean
  keyboardAccepted: boolean
  evidenceTraceable: boolean
  safetyProblem: boolean
  feedback: string
}

export type HumanLearningStaticBaseline = StaticAnswerBaselineView
import type { StaticAnswerBaselineView } from '@/app/learning-receipts'
import type { ComposedExperienceFieldGateEvaluation } from '@/app/proving-gates'
import type {
  LearningComparisonBaseline,
  LearningCompositionEvaluation,
  WorkspaceObjectRevisionRef
} from '@/app/workspace'
