import { describe, expect, test } from 'bun:test'

import type { EvaluationConfiguration } from '../src/evaluation-config'
import type { PromptToBoardScenario } from '../src/scenario-manifest'
import {
  evaluateStraightThroughEligibility,
  planStraightThroughRelease,
  type StraightThroughReleaseInput,
  type StraightThroughRunInput
} from '../src/straight-through'
import { configuration, scenario, target } from '../src/testing/campaign-support'

type UnknownRecord = Record<string, unknown>

const EXACT_TARGET = target('page-A')
const REQUEST_ID = 'request-straight-through-1'

function runInput(overrides: Partial<StraightThroughRunInput> = {}): StraightThroughRunInput {
  return {
    configuration: configuration('fresh', EXACT_TARGET, false),
    enabled: true,
    exactTarget: EXACT_TARGET,
    requestId: REQUEST_ID,
    scenario: scenario('straight-through', 'fresh'),
    ...overrides
  }
}

function releaseEnvelope(): UnknownRecord {
  return {
    persistence: { authority_revision: 12, status: 'durable' },
    receipt: {
      appliedRevision: 12,
      requestId: REQUEST_ID,
      semantic_owner: { owner_id: 'owner-1', root_object_id: 'owner-1' },
      status: 'applied'
    },
    release_summary: {
      artifact_count: 1,
      contract: 'board-build-release/v1',
      message: 'Board build applied durably on document-1 / Fixture: 1 artifact at revision 12.',
      proof_limitations: ['pixels:not_evaluated'],
      request_id: REQUEST_ID,
      revision: 12,
      status: 'ready',
      target: { ...EXACT_TARGET, page_name: 'Fixture' }
    },
    status: { command: 'completed', mutation: 'applied' },
    target: { ...EXACT_TARGET, page_name: 'Fixture' }
  }
}

function nested(candidate: UnknownRecord, key: string): UnknownRecord {
  const value = candidate[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected ${key} to be an object.`)
  }
  return value as UnknownRecord
}

function changedEnvelope(change: (candidate: UnknownRecord) => void): UnknownRecord {
  const candidate = structuredClone(releaseEnvelope())
  change(candidate)
  return candidate
}

function releaseInput(
  envelope: unknown = releaseEnvelope(),
  overrides: Partial<StraightThroughRunInput> = {}
): StraightThroughReleaseInput {
  return { ...runInput(overrides), envelope }
}

describe('straight-through eligibility', () => {
  test('opts in only exact, fresh, non-visible native composition success runs', () => {
    expect(evaluateStraightThroughEligibility(runInput())).toEqual({
      expected_request_id: REQUEST_ID,
      expected_target: EXACT_TARGET,
      status: 'eligible'
    })

    const textScenario: PromptToBoardScenario = {
      ...scenario('native-text', 'fresh'),
      modalities: ['native_text']
    }
    expect(evaluateStraightThroughEligibility(runInput({ scenario: textScenario })).status).toBe(
      'eligible'
    )

    const connectedCardsScenario: PromptToBoardScenario = {
      ...scenario('connected-cards', 'fresh'),
      modalities: ['native_text', 'native_card', 'object_connection']
    }
    expect(
      evaluateStraightThroughEligibility(runInput({ scenario: connectedCardsScenario })).status
    ).toBe('eligible')
  })

  test('falls back conservatively for every unsupported run shape', () => {
    const safeStopScenario: PromptToBoardScenario = {
      ...scenario('safe-stop', 'fresh'),
      expected_outcome: 'safe_stop',
      modalities: ['none']
    }
    const visibleScenario: PromptToBoardScenario = {
      ...scenario('visible', 'fresh'),
      visibility: 'required'
    }
    const diagramScenario: PromptToBoardScenario = {
      ...scenario('diagram', 'fresh'),
      modalities: ['native_diagram']
    }
    const mixedScenario: PromptToBoardScenario = {
      ...scenario('mixed', 'fresh'),
      modalities: ['native_card', 'native_diagram']
    }
    const warmConfiguration: EvaluationConfiguration = configuration('warm', EXACT_TARGET, false)

    const cases: Array<{
      input: StraightThroughRunInput
      reason: string
    }> = [
      { input: runInput({ enabled: false }), reason: 'not_opted_in' },
      { input: runInput({ scenario: safeStopScenario }), reason: 'not_artifact_success' },
      {
        input: runInput({ scenario: scenario('warm-scenario', 'warm') }),
        reason: 'not_fresh_session'
      },
      {
        input: runInput({ configuration: warmConfiguration }),
        reason: 'not_cold_measurement'
      },
      { input: runInput({ resumeThreadId: 'thread-1' }), reason: 'resume_requested' },
      {
        input: runInput({ configuration: configuration('fresh', EXACT_TARGET, true) }),
        reason: 'browser_required'
      },
      { input: runInput({ scenario: visibleScenario }), reason: 'visibility_required' },
      { input: runInput({ scenario: diagramScenario }), reason: 'unsupported_modality' },
      { input: runInput({ scenario: mixedScenario }), reason: 'unsupported_modality' },
      { input: runInput({ exactTarget: null }), reason: 'missing_exact_target' },
      { input: runInput({ requestId: '  ' }), reason: 'missing_request_id' },
      {
        input: runInput({ outputSchemaPath: '/tmp/model-final.schema.json' }),
        reason: 'output_schema_required'
      }
    ]

    for (const candidate of cases) {
      expect(evaluateStraightThroughEligibility(candidate.input)).toMatchObject({
        reason: candidate.reason,
        status: 'fallback'
      })
    }
  })

  test('fails closed when the explicit target and frozen configuration disagree', () => {
    expect(
      evaluateStraightThroughEligibility(runInput({ exactTarget: target('page-B') }))
    ).toMatchObject({
      reason: 'target_configuration_mismatch',
      status: 'fail'
    })
  })
})

describe('straight-through Board release validation', () => {
  test('returns a deterministic typed final plan for an authoritative ready release', () => {
    const input = releaseInput()
    const before = structuredClone(input.envelope)
    const first = planStraightThroughRelease(input)
    const second = planStraightThroughRelease(input)

    expect(first).toEqual(second)
    expect(input.envelope).toEqual(before)
    expect(first).toEqual({
      plan: {
        action: 'release_and_terminate',
        contract: 'prompt-to-board-straight-through-final/v1',
        final_origin: 'board_build_release_summary',
        release_summary: nested(releaseEnvelope(), 'release_summary'),
        request_id: REQUEST_ID,
        revision: 12,
        target: EXACT_TARGET,
        text: 'Board build applied durably on document-1 / Fixture: 1 artifact at revision 12.'
      },
      status: 'release'
    })

    const replayed = changedEnvelope((candidate) => {
      nested(candidate, 'status').mutation = 'replayed'
    })
    expect(planStraightThroughRelease(releaseInput(replayed)).status).toBe('release')
  })

  test('falls back for a valid release that is not authoritative-ready', () => {
    for (const status of ['stop', 'unknown']) {
      const envelope = changedEnvelope((candidate) => {
        nested(candidate, 'release_summary').status = status
      })
      expect(planStraightThroughRelease(releaseInput(envelope))).toMatchObject({
        reason: 'release_not_ready',
        status: 'fallback'
      })
    }
  })

  test('rejects malformed contract, command, durability, receipt, and final fields', () => {
    const cases: Array<{
      change: (candidate: UnknownRecord) => void
      reason: string
    }> = [
      {
        change: (candidate) => {
          nested(candidate, 'release_summary').contract = 'board-build-release/v0'
        },
        reason: 'release_contract_mismatch'
      },
      {
        change: (candidate) => {
          nested(candidate, 'release_summary').status = 'pending'
        },
        reason: 'release_status_invalid'
      },
      {
        change: (candidate) => {
          nested(candidate, 'status').command = 'failed'
        },
        reason: 'command_not_completed'
      },
      {
        change: (candidate) => {
          nested(candidate, 'status').mutation = 'not_applied'
        },
        reason: 'mutation_not_applied_or_replayed'
      },
      {
        change: (candidate) => {
          nested(candidate, 'persistence').status = 'unknown'
        },
        reason: 'persistence_not_durable'
      },
      {
        change: (candidate) => {
          candidate.receipt = null
        },
        reason: 'receipt_missing'
      },
      {
        change: (candidate) => {
          nested(candidate, 'receipt').status = 'rejected'
        },
        reason: 'receipt_status_invalid'
      },
      {
        change: (candidate) => {
          nested(candidate, 'release_summary').message = ' '
        },
        reason: 'release_message_missing'
      },
      {
        change: (candidate) => {
          nested(candidate, 'release_summary').proof_limitations = ['valid', '']
        },
        reason: 'invalid_envelope'
      }
    ]

    expect(planStraightThroughRelease(releaseInput(null))).toMatchObject({
      reason: 'invalid_envelope',
      status: 'fail'
    })
    expect(planStraightThroughRelease(releaseInput({}))).toMatchObject({
      reason: 'invalid_envelope',
      status: 'fail'
    })
    for (const candidate of cases) {
      expect(
        planStraightThroughRelease(releaseInput(changedEnvelope(candidate.change)))
      ).toMatchObject({ reason: candidate.reason, status: 'fail' })
    }
  })

  test('rejects request, target, and revision mismatches', () => {
    const cases: Array<{
      change: (candidate: UnknownRecord) => void
      reason: string
    }> = [
      {
        change: (candidate) => {
          nested(candidate, 'release_summary').request_id = 'wrong-request'
        },
        reason: 'request_id_mismatch'
      },
      {
        change: (candidate) => {
          nested(candidate, 'receipt').request_id = 'conflicting-alias'
        },
        reason: 'request_id_mismatch'
      },
      {
        change: (candidate) => {
          nested(nested(candidate, 'release_summary'), 'target').page_id = 'wrong-page'
        },
        reason: 'target_mismatch'
      },
      {
        change: (candidate) => {
          delete nested(candidate, 'target').workspace_id
        },
        reason: 'target_mismatch'
      },
      {
        change: (candidate) => {
          nested(candidate, 'release_summary').revision = -1
        },
        reason: 'revision_invalid'
      },
      {
        change: (candidate) => {
          delete nested(candidate, 'receipt').appliedRevision
        },
        reason: 'revision_invalid'
      },
      {
        change: (candidate) => {
          nested(candidate, 'receipt').applied_revision = 13
        },
        reason: 'revision_invalid'
      },
      {
        change: (candidate) => {
          nested(candidate, 'receipt').appliedRevision = 13
        },
        reason: 'revision_mismatch'
      },
      {
        change: (candidate) => {
          nested(candidate, 'persistence').authority_revision = 13
        },
        reason: 'revision_mismatch'
      }
    ]

    for (const candidate of cases) {
      expect(
        planStraightThroughRelease(releaseInput(changedEnvelope(candidate.change)))
      ).toMatchObject({ reason: candidate.reason, status: 'fail' })
    }
  })

  test('requires nonempty receipt-owned artifacts and matching counts', () => {
    const missing = changedEnvelope((candidate) => {
      delete nested(candidate, 'receipt').semantic_owner
    })
    const zero = changedEnvelope((candidate) => {
      nested(candidate, 'release_summary').artifact_count = 0
    })
    const mismatch = changedEnvelope((candidate) => {
      nested(candidate, 'release_summary').artifact_count = 2
    })

    expect(planStraightThroughRelease(releaseInput(missing))).toMatchObject({
      reason: 'artifact_ownership_missing',
      status: 'fail'
    })
    expect(planStraightThroughRelease(releaseInput(zero))).toMatchObject({
      reason: 'artifact_ownership_missing',
      status: 'fail'
    })
    expect(planStraightThroughRelease(releaseInput(mismatch))).toMatchObject({
      reason: 'artifact_ownership_mismatch',
      status: 'fail'
    })
  })

  test('accepts mixed-plan owner maps without weakening unique ownership', () => {
    const envelope = changedEnvelope((candidate) => {
      nested(candidate, 'release_summary').artifact_count = 2
      const receipt = nested(candidate, 'receipt')
      delete receipt.semantic_owner
      receipt.owner_ids = { brief: 'owner-1', detail: 'owner-2' }
    })

    expect(planStraightThroughRelease(releaseInput(envelope)).status).toBe('release')
  })

  test('accepts an authority committed receipt with compact owner IDs', () => {
    const envelope = changedEnvelope((candidate) => {
      const receipt = nested(candidate, 'receipt')
      delete receipt.semantic_owner
      receipt.owner_ids = ['owner-1']
      receipt.status = 'committed'
    })

    expect(planStraightThroughRelease(releaseInput(envelope)).status).toBe('release')
  })
})
