import { describe, expect, test } from 'bun:test'

import { boardObjectChangesFromMessages } from '@/app/agent-chat/board-object-changes'
import type { AiMessage, AiMessagePart } from '@/app/agent-chat/types'

function toolPart(input: {
  name?: string
  output: unknown
  toolInput?: unknown
}): Extract<AiMessagePart, { type: 'tool' }> {
  return {
    input: JSON.stringify(input.toolInput ?? {}),
    name: input.name ?? 'board_apply',
    output: JSON.stringify(input.output),
    state: 'success',
    type: 'tool'
  }
}

function assistant(parts: AiMessagePart[]): AiMessage {
  return {
    createdAt: '2026-08-26T12:00:00.000Z',
    id: 'answer',
    parts,
    role: 'assistant',
    text: ''
  }
}

describe('Board object changes', () => {
  test('derives calm created and edited rows from successful board_apply receipts', () => {
    const changes = boardObjectChangesFromMessages([
      assistant([
        toolPart({
          output: {
            ok: true,
            result: {
              changed_ids: ['hero', 'copy'],
              created_ids: ['hero'],
              deleted_ids: [],
              nodes: [
                { id: 'hero', name: 'Hero card', type: 'FRAME' },
                { id: 'copy', name: 'Summary copy', type: 'TEXT' }
              ]
            },
            target: { pageId: 'page-1' }
          }
        })
      ])
    ])

    expect(changes).toEqual([
      { id: 'hero', name: 'Hero card', pageId: 'page-1', type: 'FRAME', verb: 'created' },
      { id: 'copy', name: 'Summary copy', pageId: 'page-1', type: 'TEXT', verb: 'edited' }
    ])
  })

  test('understands bridged MCP output, deduplicates updates, and removes deleted objects', () => {
    const changes = boardObjectChangesFromMessages([
      assistant([
        toolPart({
          name: 'mcp',
          output: {
            content: [
              {
                text: JSON.stringify({
                  result: {
                    changed_ids: ['first', 'second'],
                    created_ids: ['first', 'second'],
                    deleted_ids: [],
                    nodes: [
                      { id: 'first', name: 'First concept', type: 'FRAME' },
                      { id: 'second', name: 'Second concept', type: 'FRAME' }
                    ]
                  },
                  target: { page_id: 'page-2' }
                }),
                type: 'text'
              }
            ]
          },
          toolInput: { Arguments: { tool: 'openpencil_board_apply' }, ToolName: 'mcp' }
        }),
        toolPart({
          output: {
            result: {
              changed_ids: ['second'],
              created_ids: [],
              deleted_ids: ['first'],
              nodes: [{ id: 'second', name: 'Second concept refined', type: 'FRAME' }]
            },
            target: { pageId: 'page-2' }
          }
        })
      ])
    ])

    expect(changes).toEqual([
      {
        id: 'second',
        name: 'Second concept refined',
        pageId: 'page-2',
        type: 'FRAME',
        verb: 'created'
      }
    ])
  })

  test('ignores unrelated and failed tool calls', () => {
    const unrelated = toolPart({ name: 'board_query', output: { result: {} } })
    const failed = toolPart({
      name: 'board_apply',
      output: { result: { changed_ids: ['ignored'] } }
    })
    failed.state = 'error'

    expect(boardObjectChangesFromMessages([assistant([unrelated, failed])])).toEqual([])
  })
})
