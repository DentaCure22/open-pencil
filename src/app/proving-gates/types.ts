export type DogfoodExecutionKind = 'automated' | 'human'
export type DogfoodAttestationKind =
  'authenticated-session' | 'automated-run' | 'observed-session' | 'self-report'

export type DogfoodOutcome = 'abandoned' | 'failed' | 'passed'

export type FormDisposition = 'accepted' | 'abandoned' | 'overridden'

export type ComparisonOutcome = 'better' | 'not-run' | 'same' | 'worse'

export type DogfoodCompositionEvaluation = {
  companionSurfaceId: string
  outcome: 'distracted' | 'duplicated' | 'helped'
  primarySurfaceId: string
  relationId: string
}

export type DogfoodRun = {
  attestationAuthorityRef?: string
  attestationKind: DogfoodAttestationKind
  attestationReviewDigest?: string
  attestationSessionId?: string
  attestationVerified: boolean
  comparisonBaselineContentHash?: string
  comparisonBaselineKind?: 'static-answer'
  comparisonOutcome: ComparisonOutcome
  compositionEvaluations: DogfoodCompositionEvaluation[]
  durableReceipt: boolean
  evidenceTraceable: boolean
  executionKind: DogfoodExecutionKind
  familyAttestationVerified?: boolean
  formDisposition: FormDisposition
  formId: string
  id: string
  intentCompleted: boolean
  keyboardAccepted: boolean
  modelId?: string
  occurredAt: string
  outcome: DogfoodOutcome
  rendererId: string
  repairCount: number
  safetyViolation: boolean
  visualAccepted: boolean
}

export type PromotionGateDefinition = {
  candidateFormId: string
  id: string
  maximumRepairCount: number
  minimumHumanPasses: number
  minimumHumanRuns: number
  requiredDistinctModels: number
  requireComparisonWin: boolean
  requireKeyboardAcceptance: boolean
  requireVerifiedHumanEvidence: boolean
  requireVisualAcceptance: boolean
}

export type PromotionGateStatus =
  'candidate' | 'failed' | 'not-ready' | 'provisional'

export type PromotionGateEvaluation = {
  definitionId: string
  distinctPassingModels: string[]
  humanPasses: number
  humanRuns: number
  status: PromotionGateStatus
  technicalRuns: number
  unmetGates: string[]
  verifiedHumanPasses: number
  verifiedHumanRuns: number
}

export type IntentExperienceFieldGateDefinition = {
  id: string
  maximumRepairCount: number
  minimumDistinctForms: number
  minimumHumanPasses: number
  minimumHumanRuns: number
  requireComparisonWin: boolean
  requireKeyboardAcceptance: boolean
  requireVerifiedHumanEvidence: boolean
  requireVisualAcceptance: boolean
}

export type IntentExperienceFieldGateEvaluation = {
  definitionId: string
  distinctForms: string[]
  humanPasses: number
  humanRuns: number
  status: PromotionGateStatus
  unmetGates: string[]
  verifiedHumanPasses: number
  verifiedHumanRuns: number
}

export type ComposedExperienceFieldGateDefinition = {
  id: string
  maximumDistractingRuns: number
  minimumHelpfulHumanRuns: number
  minimumVerifiedHumanRuns: number
}

export type ComposedExperienceFieldGateEvaluation = {
  definitionId: string
  distractedEvaluations: number
  duplicatedEvaluations: number
  helpfulEvaluations: number
  helpfulVerifiedHumanRuns: number
  humanRuns: number
  requiredHelpfulHumanRuns: number
  requiredVerifiedHumanRuns: number
  status: PromotionGateStatus
  unmetGates: string[]
  verifiedHumanRuns: number
}
