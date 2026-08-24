import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { isPiRpcTimeout, PiRpcProcess } from '#mcp/pi/rpc-process'

describe('PiRpcProcess', () => {
  test('identifies Pi RPC command timeouts', () => {
    expect(isPiRpcTimeout(new Error('Pi RPC prompt timed out.'))).toBe(true)
    expect(isPiRpcTimeout(new Error('Pi RPC steer timed out.'))).toBe(true)
    expect(isPiRpcTimeout(new Error('Pi rejected the prompt.'))).toBe(false)
  })

  test('preserves strict JSONL framing when UTF-8 is split across chunks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-rpc-'))
    const executable = path.join(root, 'pi-rpc-utf8-stub')
    await writeFile(
      executable,
      `#!/usr/bin/env node
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const command = JSON.parse(line)
  const payload = Buffer.from(JSON.stringify({
    command: command.type,
    data: { sessionId: 'session-🙂' },
    id: command.id,
    success: true,
    type: 'response'
  }) + '\\n')
  const emoji = Buffer.from('🙂')
  const split = payload.indexOf(emoji) + 2
  process.stdout.write(payload.subarray(0, split))
  setTimeout(() => process.stdout.write(payload.subarray(split)), 5)
})
`
    )
    await chmod(executable, 0o755)
    const process = await PiRpcProcess.start({
      args: [],
      cwd: root,
      env: { ...globalThis.process.env },
      executable,
      onEvent: () => undefined,
      onExit: () => undefined
    })

    try {
      const response = await process.command({ type: 'get_state' })
      expect(response).toMatchObject({
        data: { sessionId: 'session-🙂' },
        success: true
      })
    } finally {
      process.close()
      await rm(root, { force: true, recursive: true })
    }
  })

  test('reports liveness and accepts rebound event handlers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-rpc-'))
    const executable = path.join(root, 'pi-rpc-bind-stub')
    await writeFile(
      executable,
      `#!/usr/bin/env node
const readline = require('node:readline')
const lines = readline.createInterface({ input: process.stdin })
lines.on('line', (line) => {
  const command = JSON.parse(line)
  process.stdout.write(JSON.stringify({
    command: command.type,
    data: { sessionId: 'bound' },
    id: command.id,
    success: true,
    type: 'response'
  }) + '\\n')
})
`
    )
    await chmod(executable, 0o755)
    const events: string[] = []
    const process = await PiRpcProcess.start({
      args: [],
      cwd: root,
      env: { ...globalThis.process.env },
      executable,
      onEvent: () => events.push('original'),
      onExit: () => undefined
    })

    try {
      expect(process.isAlive).toBe(true)
      process.bind({
        onEvent: (event) => events.push(event.type),
        onExit: () => undefined
      })
      const response = await process.command({ type: 'get_state' })
      expect(response.success).toBe(true)
      expect(events).toEqual([])
    } finally {
      process.close()
      await rm(root, { force: true, recursive: true })
    }
  })
})
