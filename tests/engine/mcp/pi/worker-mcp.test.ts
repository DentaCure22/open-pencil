import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  BOARD_WORKER_THREAD_ENV,
  BOARD_WORKER_THREAD_BINDING_ENV,
  bindBoardWorkerThread,
  boardWorkerBindingPath,
  boardWorkerEnv,
  boardWorkerPrompt,
  boardWorkerPoolEnv,
  boardWorkerThreadId,
  boardWorkerMcpConfig,
  resolveBoardWorkerMcpConfigPath,
  resolvePiSessionMcpConfigPath,
  WORKER_BOARD_TOOL_NAMES,
  WORKER_MEDIA_DIRECT_TOOL_NAMES,
  WORKER_MEDIA_EAGER_TOOL_NAMES,
  WORKER_MEDIA_REQUEST_TIMEOUT_MS
} from '#mcp/pi/worker-mcp'

describe('Board worker MCP surface', () => {
  test('activates the OpenPencil skill once for a new Board worker prompt', () => {
    const prompt = boardWorkerPrompt('Make a cool object.')
    expect(prompt).toStartWith('/skill:openpencil Make a cool object.\n\n')
    expect(prompt).toContain('call board_where and workmap_query')
    expect(prompt).toContain('expected_revision from workmap_query and an operations array')
    expect(prompt).toContain('Never emit XML or a pseudo tool call')
    expect(prompt).toContain('todo states, not chat locations')
    expect(prompt).toContain('Keep hammering until the requested result is verified')
    expect(prompt).toContain('then mark it Finished')
    expect(prompt).toContain('leave the todo In motion')
    expect(prompt).toContain('Use workmap_create_todo_chat')
    expect(prompt).toContain('never another chat')
    expect(prompt).not.toContain('Needs you')
    expect(prompt).not.toContain('Review when')
    expect(prompt).not.toContain('Only the user marks Finished')
    expect(prompt).not.toContain('work-plan skill')
    expect(boardWorkerPrompt('/skill:openpencil Make a cool object.')).toBe(
      '/skill:openpencil Make a cool object.'
    )
  })

  test('keeps the approved worker tools and excludes dispatch', () => {
    expect(WORKER_BOARD_TOOL_NAMES).toEqual([
      'board_apply',
      'board_go',
      'board_query',
      'board_screenshot',
      'board_where',
      'get_agent_chat_context',
      'list_agent_chats',
      'set_theme',
      'trace_query',
      'workmap_apply',
      'workmap_create_todo_chat',
      'workmap_query'
    ])
    expect(WORKER_BOARD_TOOL_NAMES).not.toContain('dispatch_work')
  })

  test('narrows OpenPencil while preserving ordinary servers and plugin tools', () => {
    expect(
      boardWorkerMcpConfig({
        imports: ['codex'],
        mcpServers: {
          grok: { command: 'node', lifecycle: 'eager' },
          openpencil: {
            command: '/opt/openpencil/dispatch',
            lifecycle: 'eager',
            searchKeywords: { dispatch_work: ['dispatch'] }
          }
        },
        settings: { agentPluginPaths: ['/opt/plugins', '/opt/openpencil'] }
      })
    ).toEqual({
      mcpServers: {
        grok: { command: 'node', lifecycle: 'eager' },
        openpencil: {
          command: '/opt/openpencil/dispatch',
          directTools: [...WORKER_BOARD_TOOL_NAMES],
          includeTools: [...WORKER_BOARD_TOOL_NAMES],
          lifecycle: 'lazy',
          toolPrefix: 'server'
        }
      },
      settings: { agentPluginPaths: ['/opt/plugins'], freezeDirectTools: true }
    })
  })

  test('preserves ordinary servers when optional OpenPencil MCP is absent', () => {
    expect(boardWorkerMcpConfig({ mcpServers: { grok: { command: 'node' } } })).toEqual({
      mcpServers: { grok: { command: 'node' } },
      settings: { freezeDirectTools: true }
    })
    expect(boardWorkerMcpConfig(null)).toEqual({ mcpServers: {} })
  })

  test('promotes durable image tools directly with a media-sized timeout', () => {
    expect(
      boardWorkerMcpConfig({
        mcpServers: {
          'ima2-media': {
            command: 'node',
            directTools: ['list_models'],
            requestTimeoutMs: 60_000
          }
        }
      })
    ).toEqual({
      mcpServers: {
        'ima2-media': {
          command: 'node',
          directTools: ['list_models', ...WORKER_MEDIA_DIRECT_TOOL_NAMES],
          requestTimeoutMs: WORKER_MEDIA_REQUEST_TIMEOUT_MS,
          toolPrefix: 'server'
        }
      },
      settings: { freezeDirectTools: true }
    })
  })

  test('does not replace the user catalog unless a path is explicit', () => {
    expect(
      resolvePiSessionMcpConfigPath({
        env: {},
        mcpConfigPath: undefined
      })
    ).toBeUndefined()
    expect(
      resolvePiSessionMcpConfigPath({
        env: { OPENPENCIL_PI_MCP_CONFIG: '/tmp/user-mcp.json' }
      })
    ).toBe(path.resolve('/tmp/user-mcp.json'))
  })

  test('writes the worker config beside Pi sessions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-worker-mcp-'))
    try {
      const written = resolveBoardWorkerMcpConfigPath({
        sessionDir: root,
        userConfig: {
          mcpServers: {
            openpencil: { command: '/opt/openpencil/dispatch', lifecycle: 'eager' }
          }
        }
      })
      expect(written).toBe(path.join(root, 'board-worker.mcp.json'))
      expect(JSON.parse(await readFile(written ?? '', 'utf8'))).toMatchObject({
        mcpServers: {
          openpencil: {
            includeTools: [...WORKER_BOARD_TOOL_NAMES],
            lifecycle: 'lazy'
          }
        },
        settings: { freezeDirectTools: true }
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('filters only the OpenPencil server in an explicit user catalog', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-worker-mcp-explicit-'))
    const source = path.join(root, 'user-mcp.json')
    try {
      await writeFile(
        source,
        JSON.stringify({
          mcpServers: {
            gmail: { command: '/opt/gmail' },
            openpencil: { command: '/opt/openpencil/dispatch', lifecycle: 'eager' }
          }
        })
      )
      const written = resolveBoardWorkerMcpConfigPath({
        mcpConfigPath: source,
        sessionDir: root
      })
      expect(written).toBe(path.join(root, 'board-worker.mcp.json'))
      expect(JSON.parse(await readFile(written ?? '', 'utf8'))).toEqual({
        mcpServers: {
          gmail: { command: '/opt/gmail' },
          openpencil: {
            command: '/opt/openpencil/dispatch',
            directTools: [...WORKER_BOARD_TOOL_NAMES],
            includeTools: [...WORKER_BOARD_TOOL_NAMES],
            lifecycle: 'lazy',
            toolPrefix: 'server'
          }
        },
        settings: { freezeDirectTools: true }
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test('makes the Board schemas eager for Antigravity without dropping parent choices', () => {
    const env = boardWorkerEnv(
      {
        AGY_EAGER_MCP_TOOLS: 'google_drive_search,openpencil_board_where',
        PATH: '/usr/bin'
      },
      undefined,
      'thread-current'
    )
    expect(env.AGY_EAGER_MCP_TOOLS).toBe(
      [
        'google_drive_search',
        'openpencil_board_where',
        'openpencil_board_apply',
        'openpencil_board_go',
        'openpencil_board_query',
        'openpencil_board_screenshot',
        'openpencil_get_agent_chat_context',
        'openpencil_list_agent_chats',
        'openpencil_set_theme',
        'openpencil_trace_query',
        'openpencil_workmap_apply',
        'openpencil_workmap_create_todo_chat',
        'openpencil_workmap_query',
        ...WORKER_MEDIA_EAGER_TOOL_NAMES,
        'pi_edit',
        'mcp'
      ].join(',')
    )
    expect(env[BOARD_WORKER_THREAD_ENV]).toBe('thread-current')
  })

  test('binds a prestarted Board worker to its claimed chat through a private file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-board-binding-'))
    try {
      const bindingPath = boardWorkerBindingPath(root, 'pool-session')
      const env = boardWorkerPoolEnv(bindingPath, { PATH: '/usr/bin' })
      expect(env[BOARD_WORKER_THREAD_ENV]).toBeUndefined()
      expect(env[BOARD_WORKER_THREAD_BINDING_ENV]).toBe(bindingPath)
      expect(boardWorkerThreadId(env)).toBeUndefined()

      bindBoardWorkerThread(bindingPath, 'thread-claimed')
      expect(boardWorkerThreadId(env)).toBe('thread-claimed')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
