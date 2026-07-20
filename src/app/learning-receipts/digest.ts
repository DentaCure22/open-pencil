import { observedHumanReviewDigest } from '@/app/human-sessions'

import type { RecordLearningReceiptRequest } from './types'

export function humanLearningReviewEvidence(
  request: Pick<
    RecordLearningReceiptRequest,
    | 'comparisonBaseline'
    | 'comparisonOutcome'
    | 'compositionEvaluations'
    | 'durableOutcome'
    | 'evidenceTraceable'
    | 'formDisposition'
    | 'intentCompleted'
    | 'keyboardAccepted'
    | 'outcome'
    | 'qualitativeFeedback'
    | 'repairCount'
    | 'safetyViolation'
    | 'visualAccepted'
  >
) {
  const compositionEvaluations = request.compositionEvaluations?.length
    ? { compositionEvaluations: structuredClone(request.compositionEvaluations) }
    : {}
  return {
    comparisonBaseline: structuredClone(request.comparisonBaseline),
    comparisonOutcome: request.comparisonOutcome,
    ...compositionEvaluations,
    durableOutcome: request.durableOutcome,
    evidenceTraceable: request.evidenceTraceable,
    formDisposition: request.formDisposition,
    intentCompleted: request.intentCompleted,
    keyboardAccepted: request.keyboardAccepted,
    outcome: request.outcome,
    qualitativeFeedback: structuredClone(request.qualitativeFeedback),
    repairCount: request.repairCount,
    safetyViolation: request.safetyViolation,
    visualAccepted: request.visualAccepted
  }
}

export async function humanLearningReviewDigest(
  request: Parameters<typeof humanLearningReviewEvidence>[0],
  crypto: Crypto = globalThis.crypto
): Promise<string> {
  return observedHumanReviewDigest(humanLearningReviewEvidence(request), crypto)
}
