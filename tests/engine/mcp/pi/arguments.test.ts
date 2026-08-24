import { describe, expect, test } from 'bun:test'

import { parsePiModelId, piPromptWithEvidence, piRpcArguments } from '#mcp/pi/arguments'

describe('Pi RPC arguments', () => {
  test('starts a persistent RPC session with provider, model, and thinking', () => {
    expect(
      piRpcArguments({
        effort: 'high',
        mode: 'new',
        model: 'xai-auth/grok-4.6',
        sessionDir: '/tmp/pi-sessions',
        sessionId: 'thread-1'
      })
    ).toEqual([
      '--mode',
      'rpc',
      '--provider',
      'xai-auth',
      '--model',
      'grok-4.6',
      '--thinking',
      'high',
      '--approve',
      '--session-id',
      'thread-1',
      '--session-dir',
      '/tmp/pi-sessions'
    ])
  })

  test('does not append a launch system prompt', () => {
    const args = piRpcArguments({
      effort: 'high',
      mode: 'new',
      model: 'xai-auth/grok-4.6',
      sessionId: 'thread-1'
    })
    expect(args).not.toContain('--append-system-prompt')
    expect(args.join(' ')).not.toContain('meaningful milestones')
  })

  test('forks from the source session into a new session id', () => {
    const args = piRpcArguments({
      effort: 'medium',
      mode: 'fork',
      model: 'openai-codex/gpt-5.6-luna',
      sessionId: 'thread-2',
      sourceSessionId: 'thread-1'
    })
    expect(args).toEqual(expect.arrayContaining(['--fork', 'thread-1', '--session-id', 'thread-2']))
    expect(parsePiModelId('openai-codex/gpt-5.6-luna')).toEqual({
      model: 'gpt-5.6-luna',
      provider: 'openai-codex'
    })
    expect(parsePiModelId('xai/grok-4.6')).toEqual({
      model: 'grok-4.6',
      provider: 'xai-auth'
    })
    expect(parsePiModelId('grok-4.6')).toEqual({
      model: 'grok-4.6',
      provider: 'xai-auth'
    })
  })

  test('keeps normal Pi tools available', () => {
    const args = piRpcArguments({
      effort: 'high',
      mode: 'new',
      model: 'xai-auth/grok-4.6',
      sessionId: 'thread-1'
    })

    expect(args).not.toContain('--exclude-tools')
    expect(args).not.toContain('--mcp-config')
  })

  test('points Board workers at a lazy MCP config when one is prepared', () => {
    const args = piRpcArguments({
      effort: 'high',
      mcpConfigPath: '/tmp/board-worker.mcp.json',
      mode: 'new',
      model: 'xai-auth/grok-4.6',
      sessionId: 'thread-1'
    })
    expect(args).toEqual(expect.arrayContaining(['--mcp-config', '/tmp/board-worker.mcp.json']))
    expect(args).not.toContain('--exclude-tools')
  })

  test('keeps evidence on the prompt, not the CLI argv', () => {
    expect(piPromptWithEvidence('Do the work', '/tmp/trace.png')).toContain('/tmp/trace.png')
    expect(
      piRpcArguments({
        effort: 'high',
        mode: 'new',
        model: 'xai-auth/grok-4.6',
        sessionId: 'thread-1'
      })
    ).not.toContain('/tmp/trace.png')
  })
})
