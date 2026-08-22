import { describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import path from 'node:path'

import { agentWorkerEnv, mergeWorkerPath, workerBinCandidates } from '#mcp/agent-router/worker-env'

describe('workerBinCandidates', () => {
  test('puts the worker executable folder first', () => {
    const candidates = workerBinCandidates('/Applications/Pi.app/Contents/Resources/pi')

    expect(candidates[0]).toBe('/Applications/Pi.app/Contents/Resources')
    expect(candidates).toContain(path.join(homedir(), '.local', 'bin'))
  })
})

describe('mergeWorkerPath', () => {
  test('puts user bin dirs in front and drops duplicates', () => {
    expect(
      mergeWorkerPath('/usr/bin:/bin:/opt/homebrew/bin', ['/opt/homebrew/bin', '/usr/local/bin'])
    ).toBe('/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin')
  })
})

describe('agentWorkerEnv', () => {
  test('preserves the parent tool environment', () => {
    const parentEnv = {
      MCP_DIRECT_TOOLS: 'codex_apps,google drive_search',
      PATH: '/usr/bin:/bin'
    }

    expect(agentWorkerEnv(parentEnv).MCP_DIRECT_TOOLS).toBe('codex_apps,google drive_search')
    expect(parentEnv.MCP_DIRECT_TOOLS).toBe('codex_apps,google drive_search')
  })
})
