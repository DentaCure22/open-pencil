import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

describe('Pi worker MCP config', () => {
  test('exposes only read-only Board context tools to workers', async () => {
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
          directTools: false,
          disabled: false,
          includeTools: [
            'board_screenshot',
            'board_where',
            'get_agent_chat_context',
            'list_agent_chats',
            'set_theme'
          ],
          lifecycle: 'lazy'
        }
      }
    })
  })
})
