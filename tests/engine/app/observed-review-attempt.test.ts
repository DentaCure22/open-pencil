import { describe, expect, test } from 'bun:test'

import {
  createPendingObservedReviewAttempt,
  retryPendingObservedReviewAttempt,
  type RecordHumanLearningReviewRequest
} from '@/app/learning-receipts'

function request(
  overrides: Partial<RecordHumanLearningReviewRequest> = {}
): RecordHumanLearningReviewRequest {
  return {
    comparisonOutcome: 'better',
    decisionReceiptId: 'decision-receipt_field-run',
    durableOutcome: true,
    evidenceTraceable: true,
    expectedWorkspaceRevision: 12,
    formDisposition: 'accepted',
    intentCompleted: true,
    keyboardAccepted: true,
    occurredAt: '2026-07-14T20:00:03.000Z',
    outcome: 'passed',
    qualitativeFeedback: {
      frictions: [],
      strengths: ['Fitting form'],
      suggestedChanges: [],
      summary: 'The interactive answer completed the task.'
    },
    recordedAt: '2026-07-14T20:00:04.000Z',
    recordedBy: 'participant-01',
    repairCount: 0,
    runId: 'human-learning-review-field-run',
    safetyViolation: false,
    surfaceRunId: 'surface-run_field-run',
    visualAccepted: true,
    ...overrides
  }
}

describe('pending observed review attempt', () => {
  test('retries the exact signed request while refreshing only optimistic workspace state', () => {
    const original = createPendingObservedReviewAttempt(request())
    const retry = retryPendingObservedReviewAttempt(
      original,
      request({ expectedWorkspaceRevision: 14 })
    )

    expect(retry.request).toMatchObject({
      expectedWorkspaceRevision: 14,
      recordedAt: '2026-07-14T20:00:04.000Z',
      runId: 'human-learning-review-field-run'
    })
    expect(original.request.expectedWorkspaceRevision).toBe(12)
  })

  test('refuses edited review evidence after an exact submission begins', () => {
    const original = createPendingObservedReviewAttempt(request())
    expect(() =>
      retryPendingObservedReviewAttempt(
        original,
        request({
          expectedWorkspaceRevision: 14,
          qualitativeFeedback: {
            frictions: ['Changed after issue'],
            strengths: [],
            suggestedChanges: [],
            summary: 'A different review.'
          }
        })
      )
    ).toThrow('changed after submission began')
  })
})
