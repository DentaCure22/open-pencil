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

  test('turns off the pi-memory dump so the handbook owns inject', () => {
    expect(agentWorkerEnv({ PATH: '/usr/bin' }).PI_MEMORY_INJECT).toBe('0')
    expect(agentWorkerEnv({ PATH: '/usr/bin', PI_MEMORY_INJECT: '1' }).PI_MEMORY_INJECT).toBe('1')
  })

  test('points Pi handbook writes at the live Codex notebook', () => {
    const env = agentWorkerEnv({ PATH: '/usr/bin' })
    expect(env.PI_MEMORIES_DIR).toBe(path.join(homedir(), '.codex', 'memories'))
    expect(env.PI_MEMORIES_CONTROL_DIR).toBe(path.join(homedir(), '.pi', 'agent', 'memories'))
    expect(
      agentWorkerEnv({ PATH: '/usr/bin', PI_MEMORIES_DIR: '/tmp/isolated-memories' }).PI_MEMORIES_DIR
    ).toBe('/tmp/isolated-memories')
  })
})
