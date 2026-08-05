import { describe, expect, test } from 'bun:test'

import { aggregateCampaign, metricDistribution } from '../src/aggregate'
import type { EvalRunSummary } from '../src/schema'

const config = {
  config_id: 'a'.repeat(64),
  measurement_class: 'assisted_cold' as const
}

function summary(
  overrides: Partial<EvalRunSummary> & {
    expected?: EvalRunSummary['metadata']['expected_outcome']
  }
): EvalRunSummary {
  const expected = overrides.expected ?? 'artifact_success'
  return {
    failures: [],
    metadata: {
      config,
      expected_outcome: expected,
      prompt: 'Build it.',
      provenance: {
        rubric_id: 'aggregate-rubric',
        rubric_version: '1',
        scenario_version: 'b'.repeat(64)
      },
      requirements: {
        durability: true,
        pixel_witness: false,
        receipt: true,
        recovery: false,
        render_acknowledgement: false,
        semantic_quality: false,
        visual_quality: false
      },
      run_id: 'RUN',
      scenario_id: 'SCENARIO'
    },
    milestones: {
      authoritative_result_at_ms: 20,
      durability_confirmed_at_ms: 21,
      final_response_observed_at_ms: 30,
      first_board_tool_started_at_ms: 10,
      first_tool_started_at_ms: 10,
      pixel_witness_at_ms: null,
      prompt_dispatched_at_ms: 0,
      render_acknowledged_at_ms: null,
      semantic_review_at_ms: null
    },
    schema_version: 'prompt-to-board-eval-summary/v4',
    target: null,
    timings_ms: {
      command_execution_total: 3,
      prompt_to_authoritative: 20,
      prompt_to_final: 30,
      prompt_to_first_board_tool: 10,
      prompt_to_first_tool: 10,
      prompt_to_semantic_review: null,
      prompt_to_visible: null
    },
    valid: true,
    witnesses: {
      durability: true,
      pixel: false,
      receipt: true,
      render: false,
      semantic_quality: false,
      visual_quality: false
    },
    ...overrides
  }
}

describe('campaign aggregation', () => {
  test('keeps end-to-end, visible, and operational timings separate', () => {
    expect(metricDistribution([10, null, 30, 20])).toEqual({
      count: 3,
      maximum: 30,
      median: 20,
      minimum: 10,
      p95: 30
    })
    const visible = summary({
      metadata: {
        ...summary({}).metadata,
        requirements: {
          ...summary({}).metadata.requirements,
          pixel_witness: true,
          semantic_quality: true,
          visual_quality: true
        }
      },
      timings_ms: {
        command_execution_total: 4,
        prompt_to_authoritative: 15,
        prompt_to_final: 40,
        prompt_to_first_board_tool: 8,
        prompt_to_first_tool: 8,
        prompt_to_semantic_review: 30,
        prompt_to_visible: 25
      },
      witnesses: {
        durability: true,
        pixel: true,
        receipt: true,
        render: true,
        semantic_quality: true,
        visual_quality: true
      }
    })
    const aggregate = aggregateCampaign([
      summary({}),
      visible,
      summary({ expected: 'safe_stop' }),
      summary({ failures: ['missing_pixel_witness'], valid: false })
    ])
    expect(aggregate.classifications).toEqual({
      headless_durable_pass: 1,
      invalid: 1,
      safe_stop_pass: 1,
      strict_visible_pass: 1
    })
    expect(aggregate.config).toEqual(config)
    expect(aggregate.metrics_ms.prompt_to_visible).toMatchObject({ count: 1, median: 25 })
    expect(aggregate.metrics_ms.prompt_to_final).toMatchObject({ count: 4, median: 30 })
    expect(aggregate.metrics_ms.prompt_to_semantic_review).toMatchObject({ count: 1, median: 30 })
    expect(aggregate.metrics_ms.prompt_to_first_board_tool).toMatchObject({
      count: 4,
      median: 10
    })
    expect(aggregate.metrics_ms.operational_command_execution).toMatchObject({
      count: 4,
      median: 3
    })
    expect(aggregate.failures).toEqual({ missing_pixel_witness: 1 })
    expect(aggregate.witness_rates.semantic_quality).toBe(0.25)
  })

  test('refuses to pool different configurations or measurement classes', () => {
    expect(() =>
      aggregateCampaign([
        summary({}),
        summary({
          metadata: {
            ...summary({}).metadata,
            config: { config_id: 'b'.repeat(64), measurement_class: 'assisted_cold' }
          }
        })
      ])
    ).toThrow('cannot pool')

    expect(() =>
      aggregateCampaign([
        summary({}),
        summary({
          metadata: {
            ...summary({}).metadata,
            config: { ...config, measurement_class: 'assisted_warm' }
          }
        })
      ])
    ).toThrow('cannot pool')
  })
})
