import { describe, expect, test } from 'bun:test'

import board from '#cli/commands/board'
import inspect, { inspectSubCommands } from '#cli/commands/inspect'
import { applyAgentOutputMode } from '#cli/output-mode'

describe('agent-facing CLI command surface', () => {
  test('adds machine output only to Board look, go, and theme', () => {
    expect(applyAgentOutputMode(['board', 'where'], 'json')).toEqual(['board', 'where', '--json'])
    expect(applyAgentOutputMode(['board', 'go', 'Dental Chart'], 'json')).toEqual([
      'board',
      'go',
      'Dental Chart',
      '--json'
    ])
    expect(applyAgentOutputMode(['board', 'theme', 'dark'], 'json')).toEqual([
      'board',
      'theme',
      'dark',
      '--json'
    ])
    expect(applyAgentOutputMode(['inspect', 'tree', 'document.fig'], 'json')).toEqual([
      'inspect',
      'tree',
      'document.fig'
    ])
    expect(applyAgentOutputMode(['board', '--help'], 'json')).toEqual(['board', '--help'])
    expect(() => applyAgentOutputMode(['board', 'where', '--no-json'], 'json')).toThrow('conflicts')
    expect(applyAgentOutputMode(['board', 'where'], 'release')).toEqual(['board', 'where', '--json'])
  })

  test('groups document inspection under one command', () => {
    expect(Object.keys(inspectSubCommands)).toEqual([
      'find',
      'info',
      'node',
      'pages',
      'query',
      'selection',
      'tree',
      'variables'
    ])
    expect(inspect.subCommands).toBe(inspectSubCommands)
  })

  test('keeps the Board CLI on where, go, and theme', () => {
    expect(Object.keys(board.subCommands ?? {})).toEqual(['where', 'go', 'theme'])
    expect(board.subCommands?.build).toBeUndefined()
    expect(board.subCommands?.change).toBeUndefined()
    expect(board.subCommands?.connect).toBeUndefined()
    expect(board.subCommands?.create).toBeUndefined()
    expect(board.subCommands?.edit).toBeUndefined()
    expect(board.subCommands?.present).toBeUndefined()
  })
})
