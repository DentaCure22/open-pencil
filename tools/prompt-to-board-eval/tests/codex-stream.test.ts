import { describe, expect, test } from 'bun:test'

import { CodexStreamProjector, openPencilSemanticCommand } from '../src/codex-stream'

describe('openPencilSemanticCommand', () => {
  test('classifies the guarded CLI surface without treating arbitrary shell text as a call', () => {
    expect(openPencilSemanticCommand('bun open-pencil board context --current --json')).toBe(
      'context'
    )
    expect(
      openPencilSemanticCommand(
        '/Users/omar/.codex/skills/openpencil/scripts/openpencil-cli.sh board build --fresh-context'
      )
    ).toBe('build')
    expect(
      openPencilSemanticCommand(
        '/Users/omar/.codex/skills/openpencil/scripts/openpencil-cli.sh board build --help'
      )
    ).toBeNull()
    expect(
      openPencilSemanticCommand(
        "/bin/zsh -lc '/Users/omar/.codex/skills/openpencil/scripts/openpencil-cli.sh board build --help'"
      )
    ).toBeNull()
    expect(openPencilSemanticCommand('bun open-pencil board connect -h')).toBeNull()
    expect(openPencilSemanticCommand('echo "board build"')).toBeNull()
  })
})

describe('CodexStreamProjector', () => {
  test('timestamps streamed lifecycle, command, context, message, and final events externally', () => {
    let now = 1_000
    const projector = new CodexStreamProjector({
      clock: () => ({ epochMs: now, monotonicMs: now++ }),
      recorderId: 'recorder-1',
      runId: 'RUN-1'
    })
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'item-1',
          type: 'command_execution',
          command: 'bun open-pencil board context --current --json',
          status: 'in_progress'
        }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item-1',
          type: 'command_execution',
          command: 'bun open-pencil board context --current --json',
          aggregated_output: '{}',
          exit_code: 0,
          status: 'completed'
        }
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'item-2', type: 'agent_message', text: 'Done.' }
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, output_tokens: 3 } })
    ]
    const events = lines.flatMap((line) => projector.projectLine(line))

    expect(events.map((event) => event.kind)).toEqual([
      'codex_thread_started',
      'codex_turn_started',
      'command_started',
      'command_completed',
      'board_context_completed',
      'agent_message_completed',
      'codex_turn_completed'
    ])
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(events[2]?.data.semantic_command).toBe('context')
    expect(events[2]?.data.argument_bytes).toBe(
      Buffer.byteLength('bun open-pencil board context --current --json')
    )
    expect(events[3]?.data.exit_code).toBe(0)
    expect(events[3]?.data.result_bytes).toBe(2)
    expect(events[5]?.data.text_bytes).toBe(5)
    expect(events[6]?.data).toMatchObject({
      usage: {
        cached_input_tokens: null,
        input_tokens: 12,
        output_tokens: 3,
        total_tokens: 15,
        uncached_input_tokens: null
      },
      usage_scope: 'codex_thread_total'
    })
  })

  test('records malformed JSON as an explicit run error', () => {
    const [event] = new CodexStreamProjector({
      clock: () => ({ epochMs: 10, monotonicMs: 10 }),
      recorderId: 'recorder-1',
      runId: 'RUN-2'
    }).projectLine('{')
    expect(event?.kind).toBe('run_error')
    expect(event?.data.code).toBe('invalid_codex_jsonl')
  })

  test('captures direct OpenPencil MCP calls without confusing them with visibility proof', () => {
    let now = 20
    const projector = new CodexStreamProjector({
      clock: () => ({ epochMs: now, monotonicMs: now++ }),
      recorderId: 'recorder-1',
      runId: 'RUN-3'
    })
    const events = projector.projectLine(
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'mcp-1',
          type: 'mcp_tool_call',
          server: 'openpencil',
          tool: 'board_build',
          arguments: { request_id: 'request-1' },
          result: { structured_content: { status: 'completed' } },
          error: null,
          status: 'completed'
        }
      })
    )
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('command_completed')
    expect(events[0]?.data.semantic_command).toBe('board_build')
    expect(events[0]?.data.argument_encoding).toBe('canonical-json/utf8')
    expect(events[0]?.data.argument_bytes).toBe(Buffer.byteLength('{"request_id":"request-1"}'))
    expect(events[0]?.data.result_bytes).toBe(
      Buffer.byteLength('{"structured_content":{"status":"completed"}}')
    )
  })

  test('derives cached, uncached, reasoning, and total thread usage without double counting', () => {
    const [event] = new CodexStreamProjector({ recorderId: 'recorder', runId: 'run' }).projectLine(
      JSON.stringify({
        type: 'turn.completed',
        usage: {
          cache_write_input_tokens: 2,
          cached_input_tokens: 7,
          input_tokens: 20,
          output_tokens: 8,
          reasoning_output_tokens: 5
        }
      })
    )

    expect(event?.data).toMatchObject({
      usage: {
        cache_write_input_tokens: 2,
        cached_input_tokens: 7,
        input_tokens: 20,
        output_tokens: 8,
        reasoning_output_tokens: 5,
        total_tokens: 28,
        uncached_input_tokens: 13
      },
      usage_scope: 'codex_thread_total'
    })
  })

  test('accounts for unsupported top-level and item events instead of dropping them', () => {
    const projector = new CodexStreamProjector({ recorderId: 'recorder', runId: 'run' })
    const topLevel = projector.projectLine(JSON.stringify({ type: 'response.delta', value: 'x' }))
    const item = projector.projectLine(
      JSON.stringify({
        item: { id: 'reasoning-1', text: 'private', type: 'reasoning' },
        type: 'item.completed'
      })
    )

    expect(topLevel).toHaveLength(1)
    expect(topLevel[0]).toMatchObject({
      data: { codex_event_type: 'response.delta', reason: 'unsupported_top_level_event' },
      kind: 'codex_event_unmapped'
    })
    expect(item).toHaveLength(1)
    expect(item[0]).toMatchObject({
      data: { item_id: 'reasoning-1', item_type: 'reasoning', reason: 'unsupported_item_type' },
      kind: 'codex_event_unmapped'
    })
  })

  test('fails closed when a recognized Board CLI command omits machine output', () => {
    const projector = new CodexStreamProjector({ recorderId: 'recorder', runId: 'run' })
    const events = projector.projectLine(
      JSON.stringify({
        item: {
          aggregated_output: 'Created the card.',
          command: 'bun open-pencil board build --fresh-context',
          exit_code: 0,
          id: 'command-1',
          status: 'completed',
          type: 'command_execution'
        },
        type: 'item.completed'
      })
    )

    expect(events.map(({ kind }) => kind)).toEqual(['command_completed', 'run_error'])
    expect(events[1]?.data.code).toBe('unstructured_openpencil_cli_output')
  })
})
