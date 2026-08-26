import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { PiProcessPool, resolveWarmPoolSize } from '#mcp/pi/process-pool'

async function createReadyStub(): Promise<{ executable: string; root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-pool-'))
  const executable = path.join(root, 'pi-rpc-stub')
  await writeFile(
    executable,
    `#!/usr/bin/env node
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const command = JSON.parse(line)
  const response = {
    command: command.type,
    id: command.id,
    success: true,
    type: 'response'
  }
  if (command.type === 'get_state') {
    response.data = { sessionId: 'warm-' + String(process.pid) }
  }
  process.stdout.write(JSON.stringify(response) + '\\n')
})
`
  )
  await chmod(executable, 0o755)
  return { executable, root }
}

describe('PiProcessPool', () => {
  test('clamps the warm pool size', () => {
    expect(resolveWarmPoolSize(undefined)).toBe(1)
    expect(resolveWarmPoolSize(2)).toBe(2)
    expect(resolveWarmPoolSize(99)).toBe(4)
    expect(resolveWarmPoolSize(-3)).toBe(0)
    expect(resolveWarmPoolSize(Number.NaN)).toBe(0)
  })

  test('hands out a ready process and refills in the background', async () => {
    const stub = await createReadyStub()
    const pool = new PiProcessPool({
      cwd: stub.root,
      effort: 'high',
      env: { ...process.env },
      executable: stub.executable,
      model: 'xai-auth/grok-4.6',
      size: 1
    })

    try {
      expect(await pool.waitUntilReady(1)).toBe(true)
      expect(pool.readyCount).toBe(1)
      const first = await pool.claim()
      expect(first).toMatchObject({
        effort: 'high',
        model: 'xai-auth/grok-4.6'
      })
      expect(first?.poolSessionId).toBeTruthy()
      expect(first?.sessionId).toMatch(/^warm-\d+$/)
      expect(first?.process.isAlive).toBe(true)
      expect(await pool.waitUntilReady(1)).toBe(true)
      const second = await pool.claim()
      expect(second?.sessionId).not.toBe(first?.sessionId)
      expect(second?.process.isAlive).toBe(true)
      first?.process.close()
      second?.process.close()
    } finally {
      pool.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('fails closed when the executable cannot stay up', async () => {
    const pool = new PiProcessPool({
      cwd: process.cwd(),
      effort: 'high',
      env: { ...process.env },
      executable: '/usr/bin/true',
      model: 'xai-auth/grok-4.6',
      size: 1
    })

    try {
      expect(await pool.waitUntilReady(1, 500)).toBe(false)
      expect(await pool.claim()).toBeNull()
    } finally {
      pool.close()
    }
  })
})
