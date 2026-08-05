import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEvalEvent, type EvalEvent } from '../src/schema'
import {
  deriveEvalRunTelemetry,
  persistEvalRunTelemetryArtifact,
  readEvalRunTelemetryArtifact
} from '../src/telemetry'

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
    run_id: 'RUN-1',
    sequence,
    source: kind.startsWith('codex_') || kind.startsWith('command_') ? 'codex' : 'orchestrator'
  })
}

describe('honest Codex telemetry', () => {
  test('derives only observed lifecycle, byte, receipt, durability, and thread-total usage evidence', () => {
    const events = [
      event(0, 100, 'run_dispatched', {
        context_inventory: {
          components: [],
          schema_version: 'prompt-to-board-context-inventory/v2'
        }
      }),
      event(1, 110, 'process_spawned'),
      event(2, 120, 'prompt_written', { bytes: 41 }),
      event(3, 130, 'codex_turn_started'),
      event(4, 140, 'command_started', {
        argument_bytes: 20,
        item_id: 'tool-1',
        semantic_command: 'build'
      }),
      event(5, 160, 'command_completed', {
        item_id: 'tool-1',
        result_bytes: 30,
        semantic_command: 'build'
      }),
      event(6, 165, 'openpencil_result', {
        mutation_state: 'applied',
        request_id: 'request-1'
      }),
      event(7, 170, 'durability_confirmed'),
      event(8, 180, 'agent_message_completed', { text_bytes: 7 }),
      event(9, 190, 'codex_turn_completed', {
        usage: {
          cache_write_input_tokens: 2,
          cached_input_tokens: 5,
          input_tokens: 20,
          output_tokens: 8,
          reasoning_output_tokens: 3,
          total_tokens: 28,
          uncached_input_tokens: 15
        },
        usage_scope: 'codex_thread_total'
      }),
      event(10, 195, 'codex_raw_stream_closed', { bytes: 500 }),
      event(11, 200, 'final_response_released', { text: 'Released' })
    ]

    const telemetry = deriveEvalRunTelemetry(events)

    expect(telemetry.milestones).toMatchObject({
      durability_observed_at_ms: {
        availability: 'observed',
        source_event_sequence: 7,
        value: 170
      },
      evaluator_enqueued_at_ms: {
        availability: 'observed',
        source_event_sequence: 0,
        value: 100
      },
      final_generated_at_ms: {
        availability: 'observed',
        source_event_sequence: 8,
        value: 180
      },
      final_released_at_ms: {
        availability: 'observed',
        source_event_sequence: 11,
        value: 200
      },
      first_tool_arguments_available_at_ms: {
        availability: 'observed',
        source_event_sequence: 4,
        value: 140
      },
      first_tool_completed_at_ms: {
        availability: 'observed',
        source_event_sequence: 5,
        value: 160
      },
      first_tool_invoked_at_ms: {
        availability: 'observed',
        source_event_sequence: 4,
        value: 140
      },
      receipt_observed_at_ms: {
        availability: 'observed',
        source_event_sequence: 6,
        value: 165
      }
    })
    expect(telemetry.bytes).toMatchObject({
      full_dispatched_prompt: { availability: 'observed', value: 41 },
      generated_final: { availability: 'observed', value: 7 },
      raw_codex_stream: { availability: 'observed', value: 500 },
      released_final: { availability: 'observed', value: 8 },
      tool_arguments: { availability: 'observed', value: 20 },
      tool_result: { availability: 'observed', value: 30 }
    })
    expect(telemetry.tokens).toMatchObject({
      cached_input_tokens: { availability: 'observed', value: 5 },
      input_tokens: { availability: 'observed', value: 20 },
      output_tokens: { availability: 'observed', value: 8 },
      reasoning_output_tokens: { availability: 'observed', value: 3 },
      scope: { availability: 'observed', value: 'codex_thread_total' },
      total_tokens: { availability: 'derived', value: 28 },
      uncached_input_tokens: { availability: 'derived', value: 15 }
    })
    expect(telemetry.milestones.first_tool_arguments_started_at_ms).toEqual({
      availability: 'unavailable',
      availability_reason:
        'Codex JSONL first exposes complete tool arguments when invocation starts; argument-generation start is unavailable.',
      source_event_sequence: null,
      value: null
    })
    expect(telemetry.context_inventory?.schema_version).toBe('prompt-to-board-context-inventory/v2')
  })

  test('does not classify commentary from an incomplete turn as its generated final', () => {
    const telemetry = deriveEvalRunTelemetry([
      event(0, 100, 'run_dispatched'),
      event(1, 110, 'codex_turn_started'),
      event(2, 120, 'agent_message_completed', { text_bytes: 19 })
    ])

    expect(telemetry.bytes.generated_final).toEqual({
      availability: 'unavailable',
      availability_reason:
        'A completed Codex turn was not observed, so an agent message cannot be identified as the generated final.',
      source_event_sequence: null,
      value: null
    })
    expect(telemetry.milestones.final_generated_at_ms).toEqual({
      availability: 'unavailable',
      availability_reason:
        'A completed Codex turn was not observed, so an agent message cannot be identified as the generated final.',
      source_event_sequence: null,
      value: null
    })
  })

  test('keeps partial turn usage exact and leaves missing token fields unavailable', () => {
    const telemetry = deriveEvalRunTelemetry([
      event(0, 100, 'run_dispatched'),
      event(1, 110, 'codex_turn_started'),
      event(2, 120, 'agent_message_completed', { text_bytes: 5 }),
      event(3, 130, 'codex_turn_completed', {
        usage: {
          cached_input_tokens: 64,
          input_tokens: 100,
          reasoning_output_tokens: 7,
          uncached_input_tokens: 36
        },
        usage_scope: 'codex_thread_total'
      })
    ])

    expect(telemetry.tokens.input_tokens).toMatchObject({
      availability: 'observed',
      source_event_sequence: 3,
      value: 100
    })
    expect(telemetry.tokens.cached_input_tokens.value).toBe(64)
    expect(telemetry.tokens.uncached_input_tokens).toMatchObject({
      availability: 'derived',
      value: 36
    })
    expect(telemetry.tokens.reasoning_output_tokens.value).toBe(7)
    expect(telemetry.tokens.output_tokens).toEqual({
      availability: 'unavailable',
      availability_reason: 'codex_turn_completed did not expose output_tokens.',
      source_event_sequence: 3,
      value: null
    })
    expect(telemetry.tokens.total_tokens).toEqual({
      availability: 'unavailable',
      availability_reason: 'codex_turn_completed did not expose total_tokens.',
      source_event_sequence: 3,
      value: null
    })
  })

  test('uses the semantic Board build for recipe bytes and excludes straight-through pre-build commentary', () => {
    const telemetry = deriveEvalRunTelemetry([
      event(0, 100, 'run_dispatched'),
      event(1, 110, 'command_started', { argument_bytes: 900, item_id: 'preflight' }),
      event(2, 120, 'command_completed', { item_id: 'preflight', result_bytes: 1_200 }),
      event(3, 130, 'agent_message_completed', { text_bytes: 25 }),
      event(4, 140, 'command_started', {
        argument_bytes: 321,
        item_id: 'board-build',
        semantic_command: 'build'
      }),
      event(5, 150, 'openpencil_result', {
        mutation_state: 'applied',
        request_id: 'request-1'
      }),
      event(6, 160, 'durability_confirmed'),
      event(7, 170, 'final_response_released', {
        final_origin: 'board_build_release_summary',
        text: 'Durable Board build released.'
      })
    ])

    expect(telemetry.bytes.tool_arguments).toMatchObject({
      availability: 'observed',
      source_event_sequence: 4,
      value: 321
    })
    expect(telemetry.bytes.tool_result).toMatchObject({
      availability: 'unavailable',
      value: null
    })
    expect(telemetry.bytes.generated_final).toMatchObject({
      availability: 'unavailable',
      value: null
    })
    expect(telemetry.milestones.final_generated_at_ms).toMatchObject({
      availability: 'unavailable',
      value: null
    })
    expect(telemetry.bytes.released_final.value).toBe(29)
    expect(telemetry.milestones.final_released_at_ms.value).toBe(170)
    for (const field of [
      telemetry.tokens.cache_write_input_tokens,
      telemetry.tokens.cached_input_tokens,
      telemetry.tokens.input_tokens,
      telemetry.tokens.output_tokens,
      telemetry.tokens.reasoning_output_tokens,
      telemetry.tokens.scope,
      telemetry.tokens.total_tokens,
      telemetry.tokens.uncached_input_tokens
    ]) {
      expect(field).toMatchObject({
        availability: 'unavailable',
        availability_reason:
          'The straight-through supervisor ended the Codex turn after authoritative Board receipt and before Codex emitted exact usage; no token estimate was substituted.',
        value: null
      })
    }
  })

  test('does not call a pre-mutation safe-stop result a receipt', () => {
    const telemetry = deriveEvalRunTelemetry([
      event(0, 100, 'run_dispatched'),
      event(1, 110, 'openpencil_result', {
        mutation_state: 'not_applied',
        request_id: 'request-1'
      })
    ])

    expect(telemetry.milestones.receipt_observed_at_ms).toMatchObject({
      availability: 'unavailable',
      value: null
    })
  })

  test('persists one immutable versioned artifact derived from the raw event log', async () => {
    const directory = join(tmpdir(), `openpencil-telemetry-${randomUUID()}`)
    const eventLogPath = join(directory, 'events.jsonl')
    await mkdir(directory, { recursive: true })
    const events = [
      event(0, 100, 'run_dispatched'),
      event(1, 110, 'agent_message_completed', { text_bytes: 4 })
    ]
    await writeFile(
      eventLogPath,
      events.map((candidate) => JSON.stringify(candidate)).join('\n') + '\n'
    )

    const first = await persistEvalRunTelemetryArtifact(eventLogPath)
    const second = await persistEvalRunTelemetryArtifact(eventLogPath)
    const artifact = await readEvalRunTelemetryArtifact(first.path)

    expect(second.path).toBe(first.path)
    expect(artifact.schema_version).toBe('prompt-to-board-run-telemetry/v1')
    expect(artifact.run_id).toBe('RUN-1')
    expect(artifact.source_event_count).toBe(2)
    expect(artifact.source_event_log_sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(await readFile(first.path, 'utf8')).toContain('"model_started_at_ms"')
    expect(artifact.telemetry.milestones.model_started_at_ms.availability).toBe('unavailable')
  })

  test('does not invent model, first-token, argument-generation, or token-attribution evidence', () => {
    const telemetry = deriveEvalRunTelemetry([event(0, 100, 'run_dispatched')])

    expect(telemetry.milestones.model_request_enqueued_at_ms.availability_reason).toBe(
      'Codex JSONL does not expose provider model-request enqueue timestamps.'
    )
    expect(telemetry.milestones.model_started_at_ms.availability_reason).toBe(
      'Codex JSONL turn.started is a turn lifecycle marker, not a provider model-start timestamp.'
    )
    expect(telemetry.milestones.first_model_token_at_ms.availability_reason).toBe(
      'Codex JSONL exposes completed agent messages, not first-token timestamps.'
    )
    expect(telemetry.milestones.first_tool_arguments_started_at_ms.availability_reason).toBe(
      'Codex JSONL first exposes complete tool arguments when invocation starts; argument-generation start is unavailable.'
    )
    expect(telemetry.milestones.final_model_request_started_at_ms.availability_reason).toBe(
      'Codex JSONL does not expose the model-request start after a tool result.'
    )
    expect(telemetry.tokens.tool_argument_tokens.availability_reason).toBe(
      'Codex turn.completed reports thread-total usage but does not attribute tokens to tool arguments.'
    )
    expect(telemetry.tokens.tool_result_tokens.availability_reason).toBe(
      'Codex turn.completed reports thread-total usage but does not attribute tokens to tool results.'
    )
    for (const field of [
      telemetry.milestones.model_request_enqueued_at_ms,
      telemetry.milestones.model_started_at_ms,
      telemetry.milestones.first_model_token_at_ms,
      telemetry.milestones.first_tool_arguments_started_at_ms,
      telemetry.milestones.final_model_request_started_at_ms,
      telemetry.tokens.tool_argument_tokens,
      telemetry.tokens.tool_result_tokens
    ]) {
      expect(field).toMatchObject({
        availability: 'unavailable',
        source_event_sequence: null,
        value: null
      })
    }
    expect(telemetry.milestones.codex_turn_started_at_ms).toMatchObject({
      availability: 'unavailable',
      value: null
    })
    expect(telemetry.tokens.input_tokens.availability_reason).toBe(
      'codex_turn_completed did not expose input_tokens.'
    )
  })
})
