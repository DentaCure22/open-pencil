import { describe, expect, test } from 'bun:test'

import { summarizeEvalRun } from '../src/measurements'
import { createEvalEvent, type EvalEvent, type EvalRunMetadata } from '../src/schema'

const target = {
  content_document_id: 'content-1',
  document_id: 'tab-1',
  page_id: 'page-1',
  runtime_instance_id: 'runtime-1',
  workspace_id: 'workspace-1'
}

const metadata: EvalRunMetadata = {
  config: {
    config_id: 'a'.repeat(64),
    measurement_class: 'open_ended_cold'
  },
  expected_outcome: 'artifact_success',
  prompt: 'Create a useful launch gate.',
  provenance: {
    rubric_id: 'launch-gate-rubric',
    rubric_version: '2',
    scenario_version: 'a'.repeat(64)
  },
  requirements: {
    durability: true,
    pixel_witness: true,
    receipt: true,
    recovery: false,
    render_acknowledgement: true,
    semantic_quality: true,
    visual_quality: true
  },
  run_id: 'RUN-1',
  scenario_id: 'SCENARIO-1'
}

function sourceForKind(kind: EvalEvent['kind']): EvalEvent['source'] {
  if (kind.startsWith('pixel')) return 'browser'
  if (kind.includes('review')) return 'reviewer'
  return 'openpencil'
}

function event(
  sequence: number,
  observedAtMs: number,
  kind: EvalEvent['kind'],
  data: Record<string, unknown> = {}
): EvalEvent {
  return createEvalEvent({
    data,
    kind,
    observed_at_ms: observedAtMs,
    observed_monotonic_ms: observedAtMs,
    precision_ms: 1,
    recorder_id: 'recorder-1',
    run_id: metadata.run_id,
    sequence,
    source: sourceForKind(kind)
  })
}

function completeEvents(): EvalEvent[] {
  return [
    event(0, 1_000, 'run_dispatched', { prompt: metadata.prompt }),
    event(1, 1_100, 'command_started', {
      item_id: 'tool-1',
      command: 'openpencil board build',
      semantic_command: 'build'
    }),
    event(2, 1_300, 'command_completed', { item_id: 'tool-1', exit_code: 0 }),
    event(3, 1_310, 'openpencil_result', {
      mutation_state: 'applied',
      owner_id: 'owner-1',
      request_id: 'request-1',
      target
    }),
    event(4, 1_320, 'render_acknowledged', { acknowledged: true, target }),
    event(5, 1_350, 'durability_confirmed', { current: true, target }),
    event(6, 1_400, 'pixel_witness_captured', {
      artifact_visible: true,
      screenshot_path: '/tmp/evidence.png',
      screenshot_sha256: 'abc',
      target
    }),
    event(7, 1_450, 'visual_review_completed', {
      quality_passed: true,
      screenshot_sha256: 'abc'
    }),
    event(8, 1_470, 'semantic_review_completed', {
      evidence_sha256: 'b'.repeat(64),
      quality_passed: true,
      rubric_id: metadata.provenance.rubric_id,
      rubric_version: metadata.provenance.rubric_version,
      scenario_id: metadata.scenario_id,
      scenario_version: metadata.provenance.scenario_version,
      target
    }),
    event(9, 1_490, 'agent_message_completed', { text: 'Done.' }),
    event(10, 1_500, 'codex_turn_completed', { usage: {} })
  ]
}

describe('summarizeEvalRun', () => {
  test('accepts a complete exact-target prompt-to-visible-to-final run', () => {
    const summary = summarizeEvalRun(completeEvents(), metadata)
    expect(summary.valid).toBe(true)
    expect(summary.failures).toEqual([])
    expect(summary.timings_ms).toEqual({
      command_execution_total: 200,
      prompt_to_authoritative: 310,
      prompt_to_final: 490,
      prompt_to_final_generation: 490,
      prompt_to_first_board_tool: 100,
      prompt_to_first_tool: 100,
      prompt_to_semantic_review: 470,
      prompt_to_visible: 400
    })
    expect(summary.witnesses).toEqual({
      durability: true,
      pixel: true,
      receipt: true,
      render: true,
      semantic_quality: true,
      visual_quality: true
    })
  })

  test('does not infer visible success from an authoritative Board result', () => {
    const events = completeEvents().filter(
      (candidate) =>
        candidate.kind !== 'pixel_witness_captured' && candidate.kind !== 'visual_review_completed'
    )
    const summary = summarizeEvalRun(events, metadata)
    expect(summary.valid).toBe(false)
    expect(summary.failures).toContain('missing_pixel_witness')
    expect(summary.timings_ms.prompt_to_visible).toBeNull()
  })

  test('accepts the lean durability, pixel, and semantic proof contract', () => {
    const events = completeEvents()
      .filter(
        (candidate) =>
          candidate.kind !== 'render_acknowledged' && candidate.kind !== 'visual_review_completed'
      )
      .map((candidate, sequence) => ({ ...candidate, sequence }))
    const summary = summarizeEvalRun(events, metadata)

    expect(summary.valid).toBe(true)
    expect(summary.failures).toEqual([])
    expect(summary.witnesses).toMatchObject({
      durability: true,
      pixel: true,
      render: false,
      semantic_quality: true,
      visual_quality: false
    })
  })

  test('accepts a receipt with a non-empty exact mixed-plan owner map', () => {
    const events = completeEvents().map((candidate) =>
      candidate.kind === 'openpencil_result'
        ? {
            ...candidate,
            data: {
              ...candidate.data,
              owner_id: null,
              owner_ids: { brief: 'owner-1', control: 'owner-2' }
            }
          }
        : candidate
    )
    const summary = summarizeEvalRun(events, metadata)

    expect(summary.valid).toBe(true)
    expect(summary.witnesses.receipt).toBe(true)
  })

  test('does not accept an empty or malformed mixed-plan owner map as a receipt', () => {
    for (const ownerIds of [{}, { brief: '' }, { brief: 42 }]) {
      const events = completeEvents().map((candidate) =>
        candidate.kind === 'openpencil_result'
          ? {
              ...candidate,
              data: { ...candidate.data, owner_id: null, owner_ids: ownerIds }
            }
          : candidate
      )
      const summary = summarizeEvalRun(events, metadata)

      expect(summary.valid).toBe(false)
      expect(summary.witnesses.receipt).toBe(false)
      expect(summary.failures).toContain('missing_receipt')
    }
  })

  test('keeps visual quality and semantic intent correctness independent', () => {
    const events = completeEvents().map((candidate) =>
      candidate.kind === 'semantic_review_completed'
        ? { ...candidate, data: { ...candidate.data, quality_passed: false } }
        : candidate
    )
    const summary = summarizeEvalRun(events, metadata)
    expect(summary.witnesses.pixel).toBe(true)
    expect(summary.witnesses.visual_quality).toBe(true)
    expect(summary.witnesses.semantic_quality).toBe(false)
    expect(summary.failures).toEqual(['semantic_quality_failed'])
  })

  test('rejects semantic evidence graded against another rubric version', () => {
    const events = completeEvents().map((candidate) =>
      candidate.kind === 'semantic_review_completed'
        ? { ...candidate, data: { ...candidate.data, rubric_version: 'stale' } }
        : candidate
    )
    expect(summarizeEvalRun(events, metadata).failures).toContain(
      'semantic_review_provenance_mismatch'
    )
  })

  test('rejects cross-target witnesses and final responses sent before visible proof', () => {
    const events = completeEvents().map((candidate) => {
      if (candidate.kind === 'pixel_witness_captured') {
        return {
          ...candidate,
          data: { ...candidate.data, target: { ...target, page_id: 'page-2' } }
        }
      }
      if (candidate.kind === 'agent_message_completed') {
        return { ...candidate, observed_at_ms: 1_390, observed_monotonic_ms: 1_390 }
      }
      return candidate
    })
    const summary = summarizeEvalRun(events, metadata)
    expect(summary.failures).toContain('witness_target_mismatch')
    expect(summary.failures).toContain('event_time_moved_backwards')
    expect(summary.failures).toContain('final_before_pixel_witness')
  })

  test('rejects raw eval as a real-Board mutation path', () => {
    const events = completeEvents().map((candidate) =>
      candidate.kind === 'command_started'
        ? { ...candidate, data: { ...candidate.data, command: 'openpencil eval -c "mutate"' } }
        : candidate
    )
    expect(summarizeEvalRun(events, metadata).failures).toContain('unsafe_raw_eval_path')
  })
})
