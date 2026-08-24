import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  boardWorkerPrompt,
  boardWorkerMcpConfig,
  resolveBoardWorkerMcpConfigPath,
  resolvePiSessionMcpConfigPath,
  WORKER_BOARD_TOOL_NAMES
} from '#mcp/pi/worker-mcp'

describe('Board worker MCP surface', () => {
  test('activates the OpenPencil skill once for a new Board worker prompt', () => {
    expect(boardWorkerPrompt('Make a cool object.')).toBe('/skill:openpencil Make a cool object.')
    expect(boardWorkerPrompt('/skill:openpencil Make a cool object.')).toBe(
      '/skill:openpencil Make a cool object.'
    )
  })

  test('keeps the five approved worker tools and excludes navigation and dispatch', () => {
    expect(WORKER_BOARD_TOOL_NAMES).toEqual([
      'board_screenshot',
      'board_where',
      'get_agent_chat_context',
      'list_agent_chats',
      'set_theme'
    ])
    expect(WORKER_BOARD_TOOL_NAMES).not.toContain('board_go')
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
          directTools: false,
          includeTools: [...WORKER_BOARD_TOOL_NAMES],
          lifecycle: 'lazy'
        }
      },
      settings: { agentPluginPaths: ['/opt/plugins'] }
    })
  })

  test('preserves ordinary servers when optional OpenPencil MCP is absent', () => {
    expect(boardWorkerMcpConfig({ mcpServers: { grok: { command: 'node' } } })).toEqual({
      mcpServers: { grok: { command: 'node' } }
    })
    expect(boardWorkerMcpConfig(null)).toEqual({ mcpServers: {} })
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
        }
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
            directTools: false,
            includeTools: [...WORKER_BOARD_TOOL_NAMES],
            lifecycle: 'lazy'
          }
        }
      })
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
