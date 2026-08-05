import { describe, expect, test } from 'bun:test'

import {
  EVAL_EVENT_KINDS,
  createEvalEvent,
  migrateLegacyEvalRunMetadata,
  parseEvalEvent,
  parseEvalRunMetadata,
  parseEvalTarget
} from '../src/schema'

describe('eval schema', () => {
  test('requires versioned immutable event identity and an exact five-part target', () => {
    expect(
      createEvalEvent({
        data: {},
        kind: 'run_dispatched',
        observed_at_ms: 1,
        observed_monotonic_ms: 1,
        precision_ms: 1,
        recorder_id: 'recorder-1',
        run_id: 'RUN-1',
        sequence: 0,
        source: 'orchestrator'
      })
    ).toMatchObject({ schema_version: 'prompt-to-board-eval-event/v3' })
    expect(() => parseEvalEvent({})).toThrow('schema_version')
    expect(() =>
      parseEvalTarget({
        content_document_id: 'content',
        document_id: 'tab',
        page_id: 'page',
        runtime_instance_id: 'runtime'
      })
    ).toThrow('workspace_id')
  })

  test('keeps the Codex final schema inside the supported strict subset', async () => {
    const schema = await Bun.file(
      new URL('../schemas/agent-final.schema.json', import.meta.url)
    ).json()
    expect(JSON.stringify(schema)).not.toContain('"oneOf"')
    expect(schema.properties.target.type).toEqual(['object', 'null'])
  })

  test('keeps the checked-in event JSON schema aligned with the runtime v3 contract', async () => {
    const schema = await Bun.file(
      new URL('../schemas/run-event-v3.schema.json', import.meta.url)
    ).json()

    expect(schema.properties.schema_version.const).toBe('prompt-to-board-eval-event/v3')
    expect(schema.properties.kind.enum).toEqual(EVAL_EVENT_KINDS)
    expect(
      await Bun.file(new URL('../schemas/run-event-v2.schema.json', import.meta.url)).exists()
    ).toBe(false)
  })

  test('requires explicit provenance when migrating historical metadata', () => {
    const legacy = {
      config: { config_id: 'a'.repeat(64), measurement_class: 'open_ended_cold' },
      expected_outcome: 'artifact_success',
      prompt: 'Build it.',
      requirements: {
        durability: true,
        pixel_witness: true,
        receipt: true,
        recovery: false,
        render_acknowledgement: true,
        visual_quality: true
      },
      run_id: 'RUN-1',
      scenario_id: 'SCENARIO-1'
    }
    expect(() => parseEvalRunMetadata(legacy)).toThrow('provenance')
    expect(
      migrateLegacyEvalRunMetadata(legacy, {
        provenance: {
          rubric_id: 'historical-rubric',
          rubric_version: '1',
          scenario_version: 'b'.repeat(64)
        },
        require_semantic_quality: false
      })
    ).toMatchObject({
      provenance: { rubric_id: 'historical-rubric', rubric_version: '1' },
      requirements: { semantic_quality: false }
    })
  })
})
