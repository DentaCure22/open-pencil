import type { LearningReceipt } from '@/app/workspace'
import type {
  DogfoodRun,
  ComposedExperienceFieldGateDefinition,
  ComposedExperienceFieldGateEvaluation,
  IntentExperienceFieldGateDefinition,
  IntentExperienceFieldGateEvaluation,
  PromotionGateDefinition,
  PromotionGateEvaluation,
} from './types'

const isPassingRun = (run: DogfoodRun, maximumRepairCount: number) =>
  run.outcome === 'passed' &&
  run.intentCompleted &&
  run.evidenceTraceable &&
  run.durableReceipt &&
  !run.safetyViolation &&
  run.repairCount <= maximumRepairCount

const hasModelId = (run: DogfoodRun): run is DogfoodRun & { modelId: string } =>
  typeof run.modelId === 'string'

const hasVerifiedHumanAttestation = (run: DogfoodRun): boolean => {
  if (
    !run.attestationVerified ||
    !run.attestationAuthorityRef ||
    !run.attestationSessionId
  ) {
    return false
  }
  if (run.attestationKind === 'authenticated-session') return true
  return (
    run.attestationKind === 'observed-session' &&
    Boolean(run.attestationReviewDigest?.startsWith('sha256:'))
  )
}

const hasControlledComparisonWin = (run: DogfoodRun): boolean =>
  run.comparisonOutcome === 'better' &&
  run.comparisonBaselineKind === 'static-answer' &&
  Boolean(run.comparisonBaselineContentHash?.startsWith('fnv1a-'))

type GateFacts = {
  comparisonWin: boolean
  distinctPassingModels: string[]
  humanRuns: DogfoodRun[]
  keyboardAccepted: boolean
  passingHumanRuns: DogfoodRun[]
  safetyViolation: boolean
  verifiedHumanPasses: DogfoodRun[]
  verifiedHumanRuns: DogfoodRun[]
  visualAccepted: boolean
}

const collectUnmetGates = (
  facts: GateFacts,
  definition: PromotionGateDefinition
) => {
  const unmetGates: string[] = []
  if (facts.safetyViolation) unmetGates.push('zero-safety-violations')
  if (facts.distinctPassingModels.length < definition.requiredDistinctModels) {
    unmetGates.push('distinct-technical-models')
  }
  if (facts.humanRuns.length < definition.minimumHumanRuns) {
    unmetGates.push('human-runs')
  }
  if (facts.passingHumanRuns.length < definition.minimumHumanPasses) {
    unmetGates.push('human-passes')
  }
  if (
    definition.requireVerifiedHumanEvidence &&
    facts.verifiedHumanRuns.length < definition.minimumHumanRuns
  ) {
    unmetGates.push('verified-human-runs')
  }
  if (
    definition.requireVerifiedHumanEvidence &&
    facts.verifiedHumanPasses.length < definition.minimumHumanPasses
  ) {
    unmetGates.push('verified-human-passes')
  }
  if (definition.requireVisualAcceptance && !facts.visualAccepted) {
    unmetGates.push('visual-acceptance')
  }
  if (definition.requireKeyboardAcceptance && !facts.keyboardAccepted) {
    unmetGates.push('keyboard-acceptance')
  }
  if (definition.requireComparisonWin && !facts.comparisonWin) {
    unmetGates.push('comparison-win')
  }
  return unmetGates
}

const resolveStatus = (
  safetyViolation: boolean,
  technicalReady: boolean,
  fieldReady: boolean
): PromotionGateEvaluation['status'] => {
  if (safetyViolation) return 'failed'
  if (technicalReady && fieldReady) return 'provisional'
  if (technicalReady) return 'candidate'
  return 'not-ready'
}

export const INTERACTIVE_PROGRAM_PROMOTION_GATE: PromotionGateDefinition = {
  candidateFormId: 'tool',
  id: 'interactive-program-v1-promotion',
  maximumRepairCount: 1,
  minimumHumanPasses: 3,
  minimumHumanRuns: 5,
  requiredDistinctModels: 2,
  requireComparisonWin: true,
  requireKeyboardAcceptance: true,
  requireVerifiedHumanEvidence: true,
  requireVisualAcceptance: true,
}

export const INTENT_EXPERIENCE_FIELD_GATE: IntentExperienceFieldGateDefinition =
  {
    id: 'intent-experience-cross-form-v1',
    maximumRepairCount: 1,
    minimumDistinctForms: 4,
    minimumHumanPasses: 3,
    minimumHumanRuns: 5,
    requireComparisonWin: true,
    requireKeyboardAcceptance: true,
    requireVerifiedHumanEvidence: true,
    requireVisualAcceptance: true,
  }

export const COMPOSED_EXPERIENCE_FIELD_GATE: ComposedExperienceFieldGateDefinition =
  {
    id: 'composed-experience-usefulness-v1',
    maximumDistractingRuns: 0,
    minimumHelpfulHumanRuns: 2,
    minimumVerifiedHumanRuns: 3,
  }

function resolveFieldGateStatus(
  safetyViolation: boolean,
  unmetGates: string[],
  verifiedHumanRuns: number
): IntentExperienceFieldGateEvaluation['status'] {
  if (safetyViolation) return 'failed'
  if (unmetGates.length === 0) return 'provisional'
  return verifiedHumanRuns > 0 ? 'candidate' : 'not-ready'
}

export const dogfoodRunFromLearningReceipt = (
  receipt: LearningReceipt
): DogfoodRun => ({
  attestationAuthorityRef: receipt.attestation.authorityRef,
  attestationKind: receipt.attestation.kind,
  attestationReviewDigest: receipt.attestation.proof?.claim.reviewDigest,
  attestationSessionId: receipt.attestation.sessionId,
  attestationVerified: false,
  comparisonBaselineContentHash: receipt.comparisonBaseline?.contentHash,
  comparisonBaselineKind: receipt.comparisonBaseline?.kind,
  comparisonOutcome: receipt.comparisonOutcome,
  compositionEvaluations: (receipt.compositionEvaluations ?? []).map(
    (evaluation) => ({
      companionSurfaceId: evaluation.companionSurface.objectId,
      outcome: evaluation.outcome,
      primarySurfaceId: evaluation.primarySurface.objectId,
      relationId: evaluation.relation.relationId,
    })
  ),
  durableReceipt: receipt.durableOutcome,
  evidenceTraceable: receipt.evidenceTraceable,
  executionKind: receipt.executionKind,
  familyAttestationVerified: false,
  formDisposition: receipt.formDisposition,
  formId: receipt.formId,
  id: receipt.runId,
  intentCompleted: receipt.intentCompleted,
  keyboardAccepted: receipt.keyboardAccepted,
  modelId: receipt.modelId,
  occurredAt: receipt.occurredAt,
  outcome: receipt.outcome,
  rendererId: receipt.rendererId,
  repairCount: receipt.repairCount,
  safetyViolation: receipt.safetyViolation,
  visualAccepted: receipt.visualAccepted,
})

export const evaluatePromotionGate = (
  runs: DogfoodRun[],
  definition: PromotionGateDefinition
): PromotionGateEvaluation => {
  const relevantRuns = runs.filter(
    (run) => run.formId === definition.candidateFormId
  )
  const automatedRuns = relevantRuns.filter(
    (run) => run.executionKind === 'automated'
  )
  const humanRuns = relevantRuns.filter((run) => run.executionKind === 'human')
  const passingAutomatedRuns = automatedRuns.filter((run) =>
    isPassingRun(run, definition.maximumRepairCount)
  )
  const passingHumanRuns = humanRuns.filter((run) =>
    isPassingRun(run, definition.maximumRepairCount)
  )
  const verifiedHumanRuns = humanRuns.filter(hasVerifiedHumanAttestation)
  const verifiedHumanPasses = verifiedHumanRuns.filter((run) =>
    isPassingRun(run, definition.maximumRepairCount)
  )
  const distinctPassingModels = [
    ...new Set(
      passingAutomatedRuns.filter(hasModelId).map((run) => run.modelId)
    ),
  ].sort()
  const safetyViolation = relevantRuns.some((run) => run.safetyViolation)
  const visualAccepted = passingHumanRuns.some((run) => run.visualAccepted)
  const keyboardAccepted = passingHumanRuns.some((run) => run.keyboardAccepted)
  const comparisonWin = passingHumanRuns.some(hasControlledComparisonWin)
  const facts: GateFacts = {
    comparisonWin,
    distinctPassingModels,
    humanRuns,
    keyboardAccepted,
    passingHumanRuns,
    safetyViolation,
    verifiedHumanPasses,
    verifiedHumanRuns,
    visualAccepted,
  }
  const unmetGates = collectUnmetGates(facts, definition)

  const technicalReady =
    !safetyViolation &&
    distinctPassingModels.length >= definition.requiredDistinctModels
  const fieldReady =
    humanRuns.length >= definition.minimumHumanRuns &&
    passingHumanRuns.length >= definition.minimumHumanPasses &&
    (!definition.requireVerifiedHumanEvidence ||
      (verifiedHumanRuns.length >= definition.minimumHumanRuns &&
        verifiedHumanPasses.length >= definition.minimumHumanPasses)) &&
    (!definition.requireVisualAcceptance || visualAccepted) &&
    (!definition.requireKeyboardAcceptance || keyboardAccepted) &&
    (!definition.requireComparisonWin || comparisonWin)
  const status = resolveStatus(safetyViolation, technicalReady, fieldReady)

  return {
    definitionId: definition.id,
    distinctPassingModels,
    humanPasses: passingHumanRuns.length,
    humanRuns: humanRuns.length,
    status,
    technicalRuns: automatedRuns.length,
    unmetGates,
    verifiedHumanPasses: verifiedHumanPasses.length,
    verifiedHumanRuns: verifiedHumanRuns.length,
  }
}

export const evaluateIntentExperienceFieldGate = (
  runs: DogfoodRun[],
  definition: IntentExperienceFieldGateDefinition = INTENT_EXPERIENCE_FIELD_GATE
): IntentExperienceFieldGateEvaluation => {
  const humanRuns = runs.filter((run) => run.executionKind === 'human')
  const passingHumanRuns = humanRuns.filter((run) =>
    isPassingRun(run, definition.maximumRepairCount)
  )
  const verifiedHumanRuns = humanRuns.filter(hasVerifiedHumanAttestation)
  const verifiedHumanPasses = verifiedHumanRuns.filter((run) =>
    isPassingRun(run, definition.maximumRepairCount)
  )
  const distinctForms = [
    ...new Set(verifiedHumanRuns.map((run) => run.formId)),
  ].sort()
  const safetyViolation = humanRuns.some((run) => run.safetyViolation)
  const unmetGates: string[] = []
  if (safetyViolation) unmetGates.push('zero-safety-violations')
  if (humanRuns.length < definition.minimumHumanRuns)
    unmetGates.push('human-runs')
  if (passingHumanRuns.length < definition.minimumHumanPasses)
    unmetGates.push('human-passes')
  if (definition.requireVerifiedHumanEvidence) {
    if (verifiedHumanRuns.length < definition.minimumHumanRuns) {
      unmetGates.push('verified-human-runs')
    }
    if (verifiedHumanPasses.length < definition.minimumHumanPasses) {
      unmetGates.push('verified-human-passes')
    }
  }
  if (distinctForms.length < definition.minimumDistinctForms)
    unmetGates.push('form-breadth')
  if (
    definition.requireVisualAcceptance &&
    !passingHumanRuns.some((run) => run.visualAccepted)
  ) {
    unmetGates.push('visual-acceptance')
  }
  if (
    definition.requireKeyboardAcceptance &&
    !passingHumanRuns.some((run) => run.keyboardAccepted)
  ) {
    unmetGates.push('keyboard-acceptance')
  }
  if (
    definition.requireComparisonWin &&
    !passingHumanRuns.some(hasControlledComparisonWin)
  ) {
    unmetGates.push('comparison-win')
  }
  const status = resolveFieldGateStatus(
    safetyViolation,
    unmetGates,
    verifiedHumanRuns.length
  )
  return {
    definitionId: definition.id,
    distinctForms,
    humanPasses: passingHumanRuns.length,
    humanRuns: humanRuns.length,
    status,
    unmetGates,
    verifiedHumanPasses: verifiedHumanPasses.length,
    verifiedHumanRuns: verifiedHumanRuns.length,
  }
}

export const evaluateComposedExperienceFieldGate = (
  runs: DogfoodRun[],
  definition: ComposedExperienceFieldGateDefinition = COMPOSED_EXPERIENCE_FIELD_GATE
): ComposedExperienceFieldGateEvaluation => {
  const humanRuns = runs.filter(
    (run) =>
      run.executionKind === 'human' && run.compositionEvaluations.length > 0
  )
  const verifiedHumanRuns = humanRuns.filter(
    (run) => run.familyAttestationVerified && hasVerifiedHumanAttestation(run)
  )
  const helpfulVerifiedHumanRuns = verifiedHumanRuns.filter(
    (run) =>
      run.compositionEvaluations.some(
        (evaluation) => evaluation.outcome === 'helped'
      ) &&
      run.compositionEvaluations.every(
        (evaluation) => evaluation.outcome !== 'distracted'
      )
  )
  const evaluations = verifiedHumanRuns.flatMap(
    (run) => run.compositionEvaluations
  )
  const helpfulEvaluations = evaluations.filter(
    (evaluation) => evaluation.outcome === 'helped'
  ).length
  const duplicatedEvaluations = evaluations.filter(
    (evaluation) => evaluation.outcome === 'duplicated'
  ).length
  const distractedEvaluations = evaluations.filter(
    (evaluation) => evaluation.outcome === 'distracted'
  ).length
  const unmetGates: string[] = []
  if (verifiedHumanRuns.length < definition.minimumVerifiedHumanRuns) {
    unmetGates.push('verified-composition-runs')
  }
  if (helpfulVerifiedHumanRuns.length < definition.minimumHelpfulHumanRuns) {
    unmetGates.push('helpful-composition-runs')
  }
  if (distractedEvaluations > definition.maximumDistractingRuns) {
    unmetGates.push('composition-distraction')
  }
  let status: ComposedExperienceFieldGateEvaluation['status'] = 'not-ready'
  if (unmetGates.length === 0) status = 'provisional'
  else if (verifiedHumanRuns.length > 0) status = 'candidate'
  return {
    definitionId: definition.id,
    distractedEvaluations,
    duplicatedEvaluations,
    helpfulEvaluations,
    helpfulVerifiedHumanRuns: helpfulVerifiedHumanRuns.length,
    humanRuns: humanRuns.length,
    requiredHelpfulHumanRuns: definition.minimumHelpfulHumanRuns,
    requiredVerifiedHumanRuns: definition.minimumVerifiedHumanRuns,
    status,
    unmetGates,
    verifiedHumanRuns: verifiedHumanRuns.length,
  }
}
