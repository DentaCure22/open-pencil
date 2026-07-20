import {
  COMPOSED_EXPERIENCE_FIELD_GATE,
  evaluateComposedExperienceFieldGate,
  evaluateIntentExperienceFieldGate,
  evaluatePromotionGate,
  INTENT_EXPERIENCE_FIELD_GATE,
  INTERACTIVE_PROGRAM_PROMOTION_GATE,
  type DogfoodRun,
} from '@/app/proving-gates'
import { describe, expect, it } from 'bun:test'

const run = (overrides: Partial<DogfoodRun>): DogfoodRun => ({
  attestationKind: 'automated-run',
  attestationVerified: false,
  comparisonOutcome: 'not-run',
  compositionEvaluations: [],
  durableReceipt: true,
  evidenceTraceable: true,
  executionKind: 'automated',
  formDisposition: 'accepted',
  formId: 'tool',
  id: 'run-1',
  intentCompleted: true,
  keyboardAccepted: false,
  occurredAt: '2026-07-14T14:00:00.000Z',
  outcome: 'passed',
  rendererId: 'interactive-program-v1',
  repairCount: 0,
  safetyViolation: false,
  visualAccepted: false,
  ...overrides,
})

const verifiedHuman = (
  id: string,
  overrides: Partial<DogfoodRun> = {}
): Partial<DogfoodRun> => ({
  attestationAuthorityRef: `authority:${id}`,
  attestationKind: 'observed-session',
  attestationReviewDigest: `sha256:${id}`,
  attestationSessionId: `session:${id}`,
  attestationVerified: true,
  comparisonBaselineContentHash: `fnv1a-${id}`,
  comparisonBaselineKind: 'static-answer',
  executionKind: 'human',
  id,
  ...overrides,
})

describe('proving gates', () => {
  it('classifies two successful program models as candidate, not human-proven', () => {
    const result = evaluatePromotionGate(
      [
        run({ id: 'priority', modelId: 'weighted-priority' }),
        run({ id: 'capacity', modelId: 'capacity-planner' }),
      ],
      INTERACTIVE_PROGRAM_PROMOTION_GATE
    )

    expect(result.status).toBe('candidate')
    expect(result.distinctPassingModels).toEqual([
      'capacity-planner',
      'weighted-priority',
    ])
    expect(result.humanRuns).toBe(0)
    expect(result.unmetGates).toContain('human-runs')
    expect(result.unmetGates).toContain('comparison-win')
  })

  it('promotes only after the five-run human and acceptance gates pass', () => {
    const technicalRuns = [
      run({ id: 'priority', modelId: 'weighted-priority' }),
      run({ id: 'capacity', modelId: 'capacity-planner' }),
    ]
    const humanRuns = [
      run(
        verifiedHuman('human-1', {
          attestationKind: 'authenticated-session',
          comparisonOutcome: 'better',
          keyboardAccepted: true,
          visualAccepted: true,
        })
      ),
      run(verifiedHuman('human-2')),
      run(
        verifiedHuman('human-3', {
          attestationKind: 'authenticated-session',
        })
      ),
      run(verifiedHuman('human-4', { outcome: 'failed' })),
      run(
        verifiedHuman('human-5', {
          attestationKind: 'authenticated-session',
          outcome: 'abandoned',
        })
      ),
    ]

    const result = evaluatePromotionGate(
      [...technicalRuns, ...humanRuns],
      INTERACTIVE_PROGRAM_PROMOTION_GATE
    )

    expect(result.status).toBe('provisional')
    expect(result.humanRuns).toBe(5)
    expect(result.humanPasses).toBe(3)
    expect(result.verifiedHumanRuns).toBe(5)
    expect(result.verifiedHumanPasses).toBe(3)
    expect(result.unmetGates).toEqual([])
  })

  it('keeps five self-reported human runs below promotion', () => {
    const technicalRuns = [
      run({ id: 'priority', modelId: 'weighted-priority' }),
      run({ id: 'capacity', modelId: 'capacity-planner' }),
    ]
    const humanRuns = [
      run({
        attestationKind: 'self-report',
        comparisonOutcome: 'better',
        executionKind: 'human',
        id: 'human-1',
        keyboardAccepted: true,
        visualAccepted: true,
      }),
      run({
        attestationKind: 'self-report',
        executionKind: 'human',
        id: 'human-2',
      }),
      run({
        attestationKind: 'self-report',
        executionKind: 'human',
        id: 'human-3',
      }),
      run({
        attestationKind: 'self-report',
        executionKind: 'human',
        id: 'human-4',
        outcome: 'failed',
      }),
      run({
        attestationKind: 'self-report',
        executionKind: 'human',
        id: 'human-5',
        outcome: 'abandoned',
      }),
    ]

    const result = evaluatePromotionGate(
      [...technicalRuns, ...humanRuns],
      INTERACTIVE_PROGRAM_PROMOTION_GATE
    )

    expect(result.status).toBe('candidate')
    expect(result.humanRuns).toBe(5)
    expect(result.humanPasses).toBe(3)
    expect(result.verifiedHumanRuns).toBe(0)
    expect(result.verifiedHumanPasses).toBe(0)
    expect(result.unmetGates).toContain('verified-human-runs')
    expect(result.unmetGates).toContain('verified-human-passes')
  })

  it('keeps proof-shaped observed sessions below promotion until cryptographically reverified', () => {
    const shapedLikeVerified = [1, 2, 3, 4, 5].map((index) =>
      run({
        attestationAuthorityRef: `authority:forged-${index}`,
        attestationKind: 'observed-session',
        attestationReviewDigest: `sha256:forged-${index}`,
        attestationSessionId: `session:forged-${index}`,
        attestationVerified: false,
        executionKind: 'human',
        id: `forged-${index}`,
      })
    )

    expect(evaluateIntentExperienceFieldGate(shapedLikeVerified)).toMatchObject(
      {
        humanRuns: 5,
        status: 'not-ready',
        verifiedHumanPasses: 0,
        verifiedHumanRuns: 0,
      }
    )
  })

  it('fails promotion when any recorded run has a safety violation', () => {
    const result = evaluatePromotionGate(
      [
        run({ id: 'priority', modelId: 'weighted-priority' }),
        run({ id: 'capacity', modelId: 'capacity-planner' }),
        run({
          executionKind: 'human',
          id: 'unsafe-human',
          safetyViolation: true,
        }),
      ],
      INTERACTIVE_PROGRAM_PROMOTION_GATE
    )

    expect(result.status).toBe('failed')
    expect(result.unmetGates).toContain('zero-safety-violations')
  })

  it('does not count a vague better rating as a controlled comparison win', () => {
    const humanRuns = [1, 2, 3, 4, 5].map((index) =>
      run(
        verifiedHuman(`unstructured-${index}`, {
          comparisonBaselineContentHash: undefined,
          comparisonBaselineKind: undefined,
          comparisonOutcome: index === 1 ? 'better' : 'same',
          keyboardAccepted: index === 1,
          visualAccepted: index === 1,
        })
      )
    )
    const result = evaluatePromotionGate(
      [
        run({ id: 'priority', modelId: 'weighted-priority' }),
        run({ id: 'capacity', modelId: 'capacity-planner' }),
        ...humanRuns,
      ],
      INTERACTIVE_PROGRAM_PROMOTION_GATE
    )

    expect(result.status).toBe('candidate')
    expect(result.unmetGates).toContain('comparison-win')
  })

  it('requires verified human evidence across multiple forms for the whole vision', () => {
    const result = evaluateIntentExperienceFieldGate(
      [
        run(
          verifiedHuman('brief-1', {
            comparisonOutcome: 'better',
            formId: 'brief',
            keyboardAccepted: true,
            visualAccepted: true,
          })
        ),
        run(verifiedHuman('map-1', { formId: 'map' })),
        run(verifiedHuman('presentation-1', { formId: 'presentation' })),
        run(
          verifiedHuman('decision-1', { formId: 'decision', outcome: 'failed' })
        ),
        run(verifiedHuman('tool-1', { formId: 'tool', outcome: 'abandoned' })),
      ],
      INTENT_EXPERIENCE_FIELD_GATE
    )

    expect(result.status).toBe('provisional')
    expect(result.humanRuns).toBe(5)
    expect(result.humanPasses).toBe(3)
    expect(result.verifiedHumanRuns).toBe(5)
    expect(result.distinctForms).toEqual([
      'brief',
      'decision',
      'map',
      'presentation',
      'tool',
    ])
    expect(result.unmetGates).toEqual([])
  })

  it('does not confuse self-reports or one repeated form with cross-form field proof', () => {
    const selfReports = [1, 2, 3, 4, 5].map((index) =>
      run({
        attestationKind: 'self-report',
        comparisonOutcome: index === 1 ? 'better' : 'same',
        executionKind: 'human',
        id: `self-report-${index}`,
        keyboardAccepted: index === 1,
        visualAccepted: index === 1,
      })
    )
    const unverified = evaluateIntentExperienceFieldGate(selfReports)
    expect(unverified.status).toBe('not-ready')
    expect(unverified.unmetGates).toContain('verified-human-runs')
    expect(unverified.unmetGates).toContain('form-breadth')

    const repeated = [1, 2, 3, 4, 5].map((index) =>
      run(
        verifiedHuman(`tool-only-${index}`, {
          comparisonOutcome: index === 1 ? 'better' : 'same',
          keyboardAccepted: index === 1,
          visualAccepted: index === 1,
        })
      )
    )
    const narrow = evaluateIntentExperienceFieldGate(repeated)
    expect(narrow.status).toBe('candidate')
    expect(narrow.verifiedHumanRuns).toBe(5)
    expect(narrow.distinctForms).toEqual(['tool'])
    expect(narrow.unmetGates).toEqual(['form-breadth'])
  })

  it('promotes composition only after verified people say the extra views helped', () => {
    const composition = (outcome: 'distracted' | 'duplicated' | 'helped') => [
      {
        companionSurfaceId: 'surface-companion',
        outcome,
        primarySurfaceId: 'surface-primary',
        relationId: 'relation-companion',
      },
    ]
    const selfReport = run({
      attestationKind: 'self-report',
      compositionEvaluations: composition('helped'),
      executionKind: 'human',
      id: 'self-report-composition',
    })
    expect(evaluateComposedExperienceFieldGate([selfReport])).toMatchObject({
      humanRuns: 1,
      status: 'not-ready',
      verifiedHumanRuns: 0,
    })

    const verified = evaluateComposedExperienceFieldGate(
      [
        run(
          verifiedHuman('composition-1', {
            compositionEvaluations: composition('helped'),
            familyAttestationVerified: true,
          })
        ),
        run(
          verifiedHuman('composition-2', {
            compositionEvaluations: composition('helped'),
            familyAttestationVerified: true,
          })
        ),
        run(
          verifiedHuman('composition-3', {
            compositionEvaluations: composition('duplicated'),
            familyAttestationVerified: true,
          })
        ),
      ],
      COMPOSED_EXPERIENCE_FIELD_GATE
    )
    expect(verified).toMatchObject({
      duplicatedEvaluations: 1,
      helpfulEvaluations: 2,
      helpfulVerifiedHumanRuns: 2,
      status: 'provisional',
      unmetGates: [],
      verifiedHumanRuns: 3,
    })

    const distracted = evaluateComposedExperienceFieldGate([
      run(
        verifiedHuman('distracted-1', {
          compositionEvaluations: composition('distracted'),
          familyAttestationVerified: true,
        })
      ),
    ])
    expect(distracted.status).toBe('candidate')
    expect(distracted.unmetGates).toContain('composition-distraction')
  })
})
