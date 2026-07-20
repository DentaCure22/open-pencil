import type { ObservedHumanSessionProof } from '@/app/human-sessions'

import type { RecordHumanLearningReviewRequest } from './types'

export type PendingObservedReviewAttempt = {
  proof?: ObservedHumanSessionProof
  request: RecordHumanLearningReviewRequest
}

type ComparableReviewRequest = Omit<
  RecordHumanLearningReviewRequest,
  'expectedWorkspaceRevision' | 'sessionProof'
>

function isObjectRecord(value: unknown): value is { [key: string]: unknown } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isObjectRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function comparableRequest(request: RecordHumanLearningReviewRequest): ComparableReviewRequest {
  const { expectedWorkspaceRevision: _revision, sessionProof: _proof, ...comparable } = request
  return comparable
}

export function createPendingObservedReviewAttempt(
  request: RecordHumanLearningReviewRequest
): PendingObservedReviewAttempt {
  return { request: structuredClone(request) }
}

export function retryPendingObservedReviewAttempt(
  attempt: PendingObservedReviewAttempt,
  candidate: RecordHumanLearningReviewRequest
): PendingObservedReviewAttempt {
  if (
    canonicalJson(comparableRequest(attempt.request)) !==
    canonicalJson(comparableRequest(candidate))
  ) {
    throw new Error(
      'This observed review changed after submission began. Abort the session or reopen a fresh review.'
    )
  }
  return {
    ...attempt,
    request: {
      ...structuredClone(attempt.request),
      expectedWorkspaceRevision: candidate.expectedWorkspaceRevision
    }
  }
}

export function retainObservedReviewProof(
  attempt: PendingObservedReviewAttempt,
  proof: ObservedHumanSessionProof
): PendingObservedReviewAttempt {
  return {
    proof: structuredClone(proof),
    request: structuredClone(attempt.request)
  }
}
