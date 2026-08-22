import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { rewriteStdinValueArgs } from '#cli/argv'
import board from '#cli/commands/board'
import inspect, { inspectSubCommands } from '#cli/commands/inspect'
import { applyAgentOutputMode } from '#cli/output-mode'

describe('agent-facing CLI command surface', () => {
  test('adds machine output only to Board automation when explicitly enabled', () => {
    expect(applyAgentOutputMode(['board', 'build', '--request', '{}'], 'json')).toEqual([
      'board',
      'build',
      '--request',
      '{}',
      '--json'
    ])
    expect(applyAgentOutputMode(['board', 'build', '--json'], 'json')).toEqual([
      'board',
      'build',
      '--json'
    ])
    expect(applyAgentOutputMode(['board', 'fixture', 'assert'], 'json')).toEqual([
      'board',
      'fixture',
      'assert',
      '--json'
    ])
    expect(applyAgentOutputMode(['inspect', 'tree', 'document.fig'], 'json')).toEqual([
      'inspect',
      'tree',
      'document.fig'
    ])
    expect(applyAgentOutputMode(['board', '--help'], 'json')).toEqual(['board', '--help'])
    expect(() => applyAgentOutputMode(['board', 'context', '--no-json'], 'json')).toThrow(
      'conflicts'
    )
    expect(applyAgentOutputMode(['board', 'build', '--request', '{}'], 'release')).toEqual([
      'board',
      'build',
      '--request',
      '{}',
      '--json',
      '--release-summary'
    ])
    expect(applyAgentOutputMode(['board', 'build', '--release-summary'], 'release')).toEqual([
      'board',
      'build',
      '--release-summary',
      '--json'
    ])
    expect(applyAgentOutputMode(['board', 'read'], 'release')).toEqual(['board', 'read', '--json'])
    expect(applyAgentOutputMode(['board', 'search'], 'json')).toEqual(['board', 'search', '--json'])
    expect(() => applyAgentOutputMode(['board', 'build', '--no-json'], 'release')).toThrow(
      'OPENPENCIL_OUTPUT=release conflicts'
    )
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

  test('preserves a standalone stdin marker as the request-file value for Citty', () => {
    expect(rewriteStdinValueArgs(['board', 'build', '--request-file', '-', '--json'])).toEqual([
      'board',
      'build',
      '--request-file=-',
      '--json'
    ])
    expect(rewriteStdinValueArgs(['board', 'build', '--request-file=request.json'])).toEqual([
      'board',
      'build',
      '--request-file=request.json'
    ])
  })

  test('reads file-backed stdin after Citty starts the Board command', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-plan-stdin-'))
    const planPath = join(directory, 'invalid-plan.json')
    const repo = fileURLToPath(new URL('../../../', import.meta.url))
    try {
      await writeFile(planPath, '{}\n')
      const result = spawnSync(
        '/bin/zsh',
        [
          '-lc',
          '"$1" "$2" board build --request-file - --json < "$3"',
          'openpencil-plan-stdin',
          process.execPath,
          join(repo, 'packages/cli/src/index.ts'),
          planPath
        ],
        { cwd: repo, encoding: 'utf8' }
      )
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { message: 'request.contract must be board-build-request/v1.' },
        failure_scope: 'pre_mutation',
        release_summary: { status: 'stop' }
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  test('keeps the normal Board surface focused on discovery, navigation, build, and present', () => {
    expect(Object.keys(board.subCommands ?? {})).toEqual([
      'search',
      'get',
      'ls',
      'nearby',
      'pages',
      'open',
      'where',
      'create',
      'build',
      'present'
    ])
    expect(board.subCommands?.change).toBeUndefined()
    expect(board.subCommands?.connect).toBeUndefined()
    expect(board.subCommands?.edit).toBeUndefined()
    const buildArgs = board.subCommands?.build?.args
    expect(Object.keys(buildArgs ?? {}).sort()).toEqual(
      ['gesture-id', 'json', 'latest-gesture', 'release-summary', 'request', 'request-file'].sort()
    )
    expect(buildArgs).toHaveProperty('latest-gesture')
    expect(buildArgs).toHaveProperty('gesture-id')
  })
})
