import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

describe('Pi worker MCP config', () => {
  test('exposes Board context and direct navigation tools to workers', async () => {
    const config = JSON.parse(
      await readFile(path.join(process.cwd(), '.pi', 'mcp.json'), 'utf8')
    ) as {
      mcpServers: Record<
        string,
        {
          directTools?: boolean | string[]
          disabled?: boolean
          includeTools?: string[]
          lifecycle?: string
        }
      >
    }

    expect(config).toEqual({
      mcpServers: {
        openpencil: {
          directTools: [
            'board_apply',
            'board_go',
            'board_query',
            'board_screenshot',
            'board_where',
            'get_agent_chat_context',
            'list_agent_chats',
            'set_theme',
            'trace_query'
          ],
          disabled: false,
          includeTools: [
            'board_apply',
            'board_go',
            'board_query',
            'board_screenshot',
            'board_where',
            'get_agent_chat_context',
            'list_agent_chats',
            'set_theme',
            'trace_query'
          ],
          lifecycle: 'lazy',
          toolPrefix: 'server'
        }
      }
    })
  })
})
