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
        { directTools?: string[]; disabled?: boolean; includeTools?: string[] }
      >
    }

    expect(config).toEqual({
      mcpServers: {
        openpencil: {
          directTools: ['board_where', 'board_screenshot'],
          disabled: false,
          includeTools: ['board_where', 'board_screenshot']
        }
      }
    })
  })
})
