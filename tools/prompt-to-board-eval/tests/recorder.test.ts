import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEvaluationConfiguration } from '../src/evaluation-config'
import { readEvalEvents } from '../src/io'
import { recordCodexRunDetailed } from '../src/recorder'
import { buildRecorderContextInventory } from '../src/telemetry'
import { scenario } from '../src/testing/campaign-support'

function frozenConfiguration(ignoreRules = false, browserRequired = true, ignoreUserConfig = true) {
  return createEvaluationConfiguration({
    agent: { model: 'gpt-test', reasoning_effort: 'low', service_tier: 'default' },
    assistance: {
      context: 'pre_scoped',
      modality: 'agent_selected',
      placement: 'agent_selected',
      prompt: 'natural',
      provided_recipe_sha256: null,
      recipe: 'none',
      target: 'provided_exact'
    },
    board: {
      content_document_id: 'content-1',
      density: 'sparse',
      document_id: 'document-1',
      fixture_hash: 'fixture-hash',
      page_id: 'page-1',
      reset_policy: 'fixture-reset-v1',
      revision: 12,
      runtime_instance_id: 'runtime-1',
      workspace_id: 'workspace-1'
    },
    browser: {
      engine: browserRequired ? 'chromium' : 'none',
      profile_state: browserRequired ? ('fresh' as const) : ('not_applicable' as const),
      required: browserRequired,
      version: browserRequired ? 'test' : 'not-applicable',
      viewport: browserRequired ? { height: 900, width: 1200 } : null
    },
    context: {
      cwd_mode: 'isolated',
      ignore_rules: ignoreRules,
      ignore_user_config: ignoreUserConfig,
      rules_hash: 'rules-hash',
      user_config_hash: 'ignored-user-config'
    },
    evaluator: {
      difficulty_class: 'single_interactive_artifact',
      grader_version: 'pixel-grader/v7',
      modality_class: 'code_object_interactive',
      version: 'evaluator/v3',
      visible_proof_safety_timeout_ms: 2_700_000
    },
    measurement_class: 'assisted_cold',
    prompt_tooling: {
      prompt_template_hash: 'prompt-template-hash',
      skill_bundle_hash: 'skill-bundle-hash',
      tool_build_hash: 'tool-build-hash',
      tool_contract_version: 'board-tools/v3'
    },
    retry: { agent_turn_limit: 8, board_retry_policy: 'same-request-id', max_retries: 1 },
    source: {
      commit: 'abc123',
      dirty: true,
      dirty_diff_hash: 'dirty-diff-hash',
      dirty_files: ['src/changed.ts']
    }
  })
}

describe('Codex run recorder configuration evidence', () => {
  test('records the complete dispatched prompt and frozen provenance before execution', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-recorder-'))
    const binary = join(directory, 'fake-codex')
    await writeFile(
      binary,
      `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"item.completed","item":{"type":"agent_message","id":"msg-1","text":"Built it."}}'
`,
      'utf8'
    )
    await chmod(binary, 0o755)
    const configuration = frozenConfiguration()
    const prompt = 'Build the held-out artifact exactly as requested.'
    const eventLogPath = join(directory, 'events.jsonl')

    const result = await recordCodexRunDetailed({
      campaignRosterId: 'a'.repeat(64),
      codexBinary: binary,
      configuration,
      cwd: directory,
      eventLogPath,
      prompt,
      recorderId: 'recorder-test',
      rubricId: 'held-out-rubric',
      rubricVersion: '3',
      runId: 'RUN-1',
      scenarioFingerprint: 'b'.repeat(64),
      scenarioId: 'HOLD-1',
      stderrPath: join(directory, 'stderr.log')
    })

    expect(result.exitCode).toBe(0)
    expect(result.status).toBe('pending_proof')
    const events = await readEvalEvents(eventLogPath)
    const dispatched = events[0]
    expect(dispatched?.kind).toBe('run_dispatched')
    expect(dispatched?.data).toMatchObject({
      campaign_roster_id: 'a'.repeat(64),
      config: {
        config_id: configuration.config_id,
        measurement_class: 'assisted_cold'
      },
      grader_version: 'pixel-grader/v7',
      prompt,
      rubric_id: 'held-out-rubric',
      rubric_version: '3',
      scenario_fingerprint: 'b'.repeat(64),
      scenario_id: 'HOLD-1',
      source_snapshot: configuration.source
    })
    const contextInventory = dispatched?.data.context_inventory
    expect(contextInventory).toMatchObject({
      schema_version: 'prompt-to-board-context-inventory/v2'
    })
    const components = Reflect.get(contextInventory as object, 'components') as Array<{
      availability: string
      bytes: number | null
      kind: string
      token_count: number | null
    }>
    expect(components.find(({ kind }) => kind === 'full_dispatched_prompt')).toMatchObject({
      availability: 'observed',
      bytes: Buffer.byteLength(prompt),
      token_count: null
    })
    expect(components.find(({ kind }) => kind === 'system_instructions')).toMatchObject({
      availability: 'unavailable',
      bytes: null,
      token_count: null
    })
    expect(components.find(({ kind }) => kind === 'tool_schemas')).toMatchObject({
      availability: 'provenance_only',
      bytes: null,
      token_count: null
    })
    expect(events.map(({ kind }) => kind)).toEqual([
      'run_dispatched',
      'process_spawned',
      'prompt_written',
      'agent_message_completed',
      'codex_raw_stream_closed',
      'run_pending_proof'
    ])
    const rawText = await readFile(join(directory, 'codex-events.raw.jsonl'), 'utf8')
    expect(rawText).toBe(
      '{"type":"item.completed","item":{"type":"agent_message","id":"msg-1","text":"Built it."}}\n'
    )
    expect(events.find(({ kind }) => kind === 'codex_raw_stream_closed')?.data).toEqual({
      bytes: Buffer.byteLength(rawText),
      line_count: 1,
      path: join(directory, 'codex-events.raw.jsonl'),
      sha256: createHash('sha256').update(rawText).digest('hex')
    })
    expect(events.at(-1)?.data).toMatchObject({
      config_id: configuration.config_id,
      expected_target: {
        content_document_id: 'content-1',
        document_id: 'document-1',
        page_id: 'page-1',
        runtime_instance_id: 'runtime-1',
        workspace_id: 'workspace-1'
      },
      generated_event_sequence: 3,
      proof_safety_timeout_ms: 2_700_000
    })
    expect(events.some(({ kind }) => kind === 'final_response_released')).toBe(false)
  })

  test('marks project instructions unavailable when the run disables rules', () => {
    const inventory = buildRecorderContextInventory('Build it.', frozenConfiguration(true))

    expect(inventory.components.find(({ kind }) => kind === 'project_instructions')).toMatchObject({
      availability: 'unavailable',
      bytes: null,
      provenance_hash: null,
      token_count: null
    })
  })

  test('releases a verified durable receipt without exposing it to another model turn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-straight-through-'))
    const binary = join(directory, 'fake-codex')
    const requestId = 'ptb-run:0123456789abcdef0123456789abcdef'
    const exactTarget = {
      content_document_id: 'content-1',
      document_id: 'document-1',
      page_id: 'page-1',
      runtime_instance_id: 'runtime-1',
      workspace_id: 'workspace-1'
    }
    const releaseMessage =
      'Board build applied durably on document-1 / Fixture: 1 artifact at revision 13.'
    await writeFile(
      binary,
      `#!/Users/omar/.bun/bin/bun
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const input = createInterface({ input: process.stdin })
for await (const line of input) {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'fake' } })
  } else if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-straight' } } })
    send({ method: 'thread/started', params: { thread: { id: 'thread-straight' } } })
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-straight' } } })
    send({ method: 'turn/started', params: { threadId: 'thread-straight', turnId: 'turn-straight' } })
    send({ method: 'item/completed', params: { threadId: 'thread-straight', turnId: 'turn-straight', item: { type: 'agentMessage', id: 'msg-preamble', text: 'Using the guarded Board builder now.' } } })
    send({ method: 'rawResponse/completed', emittedAtMs: Date.now() - 100, params: { threadId: 'thread-straight', turnId: 'turn-straight' } })
    send({ method: 'item/started', params: { threadId: 'thread-straight', turnId: 'turn-straight', item: { type: 'commandExecution', id: 'cmd-1', command: 'openpencil board build --request-id ${requestId}', status: 'inProgress' } } })
    const socket = createConnection({ path: process.env.OPENPENCIL_BOARD_BUILD_RELEASE_SOCKET })
    socket.once('connect', () => socket.write(JSON.stringify({
      contract: 'board-build-terminal-release/v1',
      nonce: process.env.OPENPENCIL_BOARD_BUILD_RELEASE_NONCE,
      release: {
        persistence: { authority_revision: 13, status: 'durable' },
        proof: { durable_readback: 'passed' },
        receipt: { appliedRevision: 13, requestId: '${requestId}', semantic_owner: { owner_id: 'owner-1', root_object_id: 'owner-1' }, status: 'applied' },
        release_summary: {
          artifact_count: 1,
          contract: 'board-build-release/v1',
          message: ${JSON.stringify(releaseMessage)},
          proof_limitations: ['pixels:not_evaluated'],
          request_id: '${requestId}',
          revision: 13,
          status: 'ready',
          target: { ...${JSON.stringify(exactTarget)}, page_name: 'Fixture' }
        },
        status: { command: 'completed', mutation: 'applied' },
        target: { ...${JSON.stringify(exactTarget)}, page_name: 'Fixture' }
      }
    }) + '\\n'))
  } else if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} })
    send({ method: 'item/completed', params: { threadId: 'thread-straight', turnId: 'turn-straight', item: { type: 'commandExecution', id: 'cmd-1', aggregatedOutput: '', exitCode: 1, status: 'failed' } } })
    send({ method: 'turn/completed', params: { threadId: 'thread-straight', turn: { id: 'turn-straight', status: 'interrupted' } } })
    send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-straight', turnId: 'turn-straight', tokenUsage: { total: { cacheWriteInputTokens: 3, cachedInputTokens: 70, inputTokens: 100, outputTokens: 15, reasoningOutputTokens: 5, totalTokens: 115 } } } })
  }
}
`,
      'utf8'
    )
    await chmod(binary, 0o755)
    const configuration = frozenConfiguration(false, false, false)
    const eventLogPath = join(directory, 'events.jsonl')
    const released: string[] = []

    const result = await recordCodexRunDetailed({
      campaignRosterId: 'c'.repeat(64),
      codexBinary: binary,
      configuration,
      cwd: directory,
      eventLogPath,
      onFinalResponseReleased: ({ text }) => released.push(text),
      prompt: 'Build one concise native card.',
      recorderId: 'recorder-straight-through',
      rubricId: 'native-card-rubric',
      rubricVersion: '1',
      runId: 'STRAIGHT-1',
      scenarioFingerprint: 'd'.repeat(64),
      scenarioId: 'STRAIGHT-CARD',
      stderrPath: join(directory, 'stderr.log'),
      straightThrough: {
        configuration,
        enabled: true,
        exactTarget,
        requestId,
        scenario: scenario('STRAIGHT-CARD', 'fresh')
      }
    })

    expect(result).toEqual({
      exitCode: 0,
      status: 'recorded',
      threadId: 'thread-straight'
    })
    const events = await readEvalEvents(eventLogPath)
    expect(events.map(({ kind }) => kind)).toEqual([
      'run_dispatched',
      'process_spawned',
      'prompt_written',
      'codex_thread_started',
      'codex_turn_started',
      'agent_message_completed',
      'command_started',
      'openpencil_result',
      'durability_confirmed',
      'final_response_released',
      'codex_turn_completed',
      'codex_raw_stream_closed'
    ])
    expect(events.some(({ kind }) => kind === 'command_completed')).toBeFalse()
    const durabilitySequence =
      events.find(({ kind }) => kind === 'durability_confirmed')?.sequence ?? 0
    expect(
      events.some(
        ({ kind, sequence }) => kind === 'agent_message_completed' && sequence > durabilitySequence
      )
    ).toBeFalse()
    expect(events.find(({ kind }) => kind === 'codex_raw_stream_closed')?.data).toMatchObject({
      actual_exit_code: null,
      actual_signal: 'SIGTERM',
      intentional_termination: true
    })
    expect(events.find(({ kind }) => kind === 'final_response_released')?.data).toMatchObject({
      final_origin: 'board_build_release_summary',
      request_id: requestId,
      target: exactTarget,
      text: releaseMessage
    })
    expect(released).toEqual([releaseMessage])
    expect(events.find(({ kind }) => kind === 'codex_turn_completed')?.data.usage).toEqual({
      cache_write_input_tokens: 3,
      cached_input_tokens: 70,
      input_tokens: 100,
      output_tokens: 15,
      reasoning_output_tokens: 5,
      total_tokens: 115,
      uncached_input_tokens: 30
    })
  })
})
