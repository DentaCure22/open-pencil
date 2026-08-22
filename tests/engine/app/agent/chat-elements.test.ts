import { describe, expect, test } from 'bun:test'

import type { AiMessage, AiMessagePart } from '@/app/agent-chat/types'
import {
  conversationStatus,
  formatAttachmentSize,
  formatElapsedDuration,
  latestMessageCreatedAt,
  messageParts,
  resolveReasoningActivityState,
  resolveToolActivityState,
  shortToolInput,
  toolCallKind,
  toolGroupLabel,
  toolCallLabel,
  toolCallProgressLabel
} from '@/components/ai-elements/model'

function message(overrides: Partial<AiMessage> = {}): AiMessage {
  return {
    createdAt: '2026-08-16T00:00:00.000Z',
    id: 'message-1',
    role: 'assistant',
    text: 'Ready.',
    ...overrides
  }
}

describe('AI Elements Vue chat model', () => {
  test('preserves every supported structured message part', () => {
    const parts: AiMessagePart[] = [
      { text: 'Answer', type: 'text' },
      { state: 'streaming', text: 'Thinking', type: 'reasoning' },
      { input: '{}', name: 'read_file', state: 'pending', type: 'tool' },
      { input: '{}', name: 'search', state: 'running', type: 'tool' },
      { name: 'write_file', output: 'Done', state: 'success', type: 'tool' },
      { error: 'Denied', name: 'shell', state: 'error', type: 'tool' },
      { name: 'publish', state: 'approval', type: 'tool' },
      { code: 'const ready = true', language: 'ts', type: 'code' },
      { mediaType: 'text/plain', name: 'notes.txt', size: 2048, type: 'attachment' },
      { alt: 'Preview', type: 'image', url: 'data:image/png;base64,AA==' },
      { title: 'OpenPencil', type: 'source', url: 'https://openpencil.dev' }
    ]
    expect(messageParts(message({ parts }))).toEqual(parts)
  })

  test('splits legacy fenced code into copyable code parts', () => {
    expect(
      messageParts(message({ text: 'Before\n```ts\nconst ready = true\n```\nAfter' }))
    ).toEqual([
      { text: 'Before\n', type: 'text' },
      { code: 'const ready = true\n', language: 'ts', type: 'code' },
      { text: '\nAfter', type: 'text' }
    ])
  })

  test('maps transport and lifecycle states to the rendered chat status', () => {
    expect(conversationStatus({ sending: true, state: 'idle' })).toBe('submitted')
    expect(conversationStatus({ state: 'running' })).toBe('streaming')
    expect(conversationStatus({ state: 'needs_attention' })).toBe('needs_attention')
    expect(conversationStatus({ error: 'Failed', state: 'running' })).toBe('error')
    expect(conversationStatus({ state: 'completed' })).toBe('ready')
  })

  test('formats attachment sizes densely', () => {
    expect(formatAttachmentSize()).toBe('')
    expect(formatAttachmentSize(512)).toBe('512 B')
    expect(formatAttachmentSize(2048)).toBe('2.0 KB')
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  test('shows a clean running tool row with the command or path', () => {
    expect(shortToolInput('PATH=/Users/omar/.bun/bin:$PATH bun test tests/engine/app/agent')).toBe(
      'PATH=/Users/omar/.bun/bin:$PATH bun test tests/engine/app/agent'
    )
    expect(shortToolInput('{"command":"bun test tests/engine/app/agent"}')).toBe(
      'bun test tests/engine/app/agent'
    )
    expect(shortToolInput('{"CommandLine":"bun test tests/engine/mcp/pi/events.test.ts"}')).toBe(
      'bun test tests/engine/mcp/pi/events.test.ts'
    )
    expect(shortToolInput('{"TargetFile":"src/views/EditorView.vue"}')).toBe(
      'src/views/EditorView.vue'
    )
    expect(shortToolInput('{\n  "path": "src/components/ai-elements/AiToolCall.vue"\n}')).toBe(
      'src/components/ai-elements/AiToolCall.vue'
    )
    expect(shortToolInput('[{"path":"src/a.ts"},{"path":"src/b.ts"}]')).toBe('src/a.ts, src/b.ts')
    expect(shortToolInput('{"search":"gmail"}')).toBe('gmail')
    expect(
      shortToolInput(
        '{"Arguments":{"tool":"codex_apps_gmail_get_profile"},"ToolName":"mcp","toolAction":"Getting Gmail profile","toolSummary":"Check Gmail connection and profile"}'
      )
    ).toBe('Check Gmail connection and profile')
    expect(toolCallLabel('Run command')).toBe('Ran command')
    expect(toolCallLabel('Shell')).toBe('Ran command')
    expect(toolCallLabel('bash')).toBe('Ran command')
    expect(toolCallLabel('Read')).toBe('Read')
    expect(toolCallLabel('Edited files')).toBe('Edited files')
    expect(toolCallLabel('connected_app_search')).toBe('Searched')
    expect(toolCallLabel('mcp', '{"search":"today"}')).toBe('Searched')
    expect(toolCallLabel('mcp', '{"action":"connect"}')).toBe('Connected app')
    expect(toolCallLabel('mcp', '{"server":"codex_apps"}')).toBe('Connected app')
    expect(
      toolCallLabel(
        'call_mcp_tool',
        '{"Arguments":{"provider":"oauth"},"ToolName":"ima2-media_generate_image","toolSummary":"Generate through Codex OAuth"}'
      )
    ).toBe('ima2-media generate image')
    expect(
      toolCallLabel(
        'call_mcp_tool',
        '{"Arguments":{"tool":"codex_apps_gmail_get_profile"},"ToolName":"mcp","toolSummary":"Check Gmail profile"}'
      )
    ).toBe('codex apps gmail get profile')
    expect(toolCallKind('read_file')).toBe('read')
    expect(toolCallKind('bash')).toBe('command')
    expect(toolCallKind('connected_app_search')).toBe('search')
    expect(toolCallKind('mcp', '{"server":"codex_apps"}')).toBe('connected-app')
    expect(toolCallKind('openpencil_board_screenshot')).toBe('image')
    expect(toolCallKind('codex_apps_exa_web_fetch_exa')).toBe('web')
    expect(
      toolGroupLabel([
        { input: '{"path":"a.ts"}', name: 'read_file', state: 'success' },
        { input: '{"path":"b.ts"}', name: 'read_file', state: 'success' },
        { input: '{"command":"bun test"}', name: 'bash', state: 'success' },
        { input: '{"query":"chat"}', name: 'search', state: 'running' }
      ])
    ).toBe('Read files, ran commands, searching')
    expect(toolCallProgressLabel('Run command')).toBe('Running command')
    expect(toolCallProgressLabel('read_file')).toBe('Reading')
    expect(toolCallProgressLabel('search')).toBe('Searching')
  })

  test('uses the whole turn for one elapsed-time divider', () => {
    expect(
      latestMessageCreatedAt([
        message({ createdAt: '2026-08-16T00:00:03.000Z', id: 'later' }),
        message({ createdAt: 'invalid', id: 'invalid' }),
        message({ createdAt: '2026-08-16T00:00:01.000Z', id: 'earlier' })
      ])
    ).toBe('2026-08-16T00:00:03.000Z')
    expect(formatElapsedDuration(0)).toBe('<1s')
    expect(formatElapsedDuration(10_900)).toBe('10s')
    expect(formatElapsedDuration(73_400)).toBe('1m 13s')
    expect(formatElapsedDuration(Number.NaN)).toBe('')
  })

  test('keeps exactly one live activity and preserves terminal errors', () => {
    expect(resolveReasoningActivityState('streaming', 0, 2, 'streaming')).toBe('complete')
    expect(resolveReasoningActivityState('streaming', 1, 2, 'streaming')).toBe('streaming')
    expect(resolveReasoningActivityState('streaming', 1, 2, 'stopped')).toBe('stopped')
    expect(resolveReasoningActivityState('streaming', 1, 2, 'needs_attention')).toBe('stopped')

    expect(resolveToolActivityState('running', 0, 2, 'streaming')).toBe('success')
    expect(resolveToolActivityState('pending', 1, 2, 'streaming')).toBe('pending')
    expect(resolveToolActivityState('running', 1, 2, 'ready')).toBe('success')
    expect(resolveToolActivityState('running', 1, 2, 'error')).toBe('stopped')
    expect(resolveToolActivityState('running', 1, 2, 'needs_attention')).toBe('stopped')
    expect(resolveToolActivityState('error', 0, 2, 'ready')).toBe('error')
  })
})
