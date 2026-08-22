import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { FALLBACK_PI_MODELS } from '#mcp/pi/catalog'
import { PiAgentRouter } from '#mcp/pi/router'

type PiStub = {
  commandLog: string
  executable: string
  root: string
}

async function createPiStub(input: {
  dynamicReplies?: boolean
  events?: Array<Record<string, unknown>>
  exitAfterPrompt?: boolean
  holdUntilSteer?: boolean
}): Promise<PiStub> {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-router-'))
  const executable = path.join(root, 'pi-rpc-stub')
  const commandLog = path.join(root, 'commands.jsonl')
  const source = `#!/usr/bin/env node
const readline = require('node:readline')
const { appendFileSync } = require('node:fs')
const events = ${JSON.stringify(input.events ?? [])}
const dynamicReplies = ${JSON.stringify(input.dynamicReplies === true)}
const exitAfterPrompt = ${JSON.stringify(input.exitAfterPrompt === true)}
const holdUntilSteer = ${JSON.stringify(input.holdUntilSteer === true)}
const commandLog = ${JSON.stringify(commandLog)}
const lines = readline.createInterface({ input: process.stdin })
let promptCount = 0

function send(value) {
  process.stdout.write(JSON.stringify(value) + '\\n')
}

lines.on('line', (line) => {
  const command = JSON.parse(line)
  appendFileSync(commandLog, JSON.stringify(command) + '\\n')
  const response = {
    command: command.type,
    id: command.id,
    success: true,
    type: 'response'
  }
  if (command.type === 'get_state') {
    response.data = { isStreaming: false, sessionId: 'stub-session' }
  }
  send(response)
  if (command.type === 'steer' && holdUntilSteer) {
    setTimeout(() => {
      send({
        message: {
          content: [{ text: 'steered:' + command.message, type: 'text' }],
          role: 'assistant',
          stopReason: 'stop'
        },
        type: 'message_end'
      })
      send({ type: 'agent_settled' })
    }, 10)
    return
  }
  if (command.type !== 'prompt') return
  if (holdUntilSteer) return
  setTimeout(() => {
    if (command.message === '/xai-usage') {
      send({
        id: 'usage-notice',
        message: 'xAI usage (unofficial, revision-pinned):\\nSubscription: SuperGrok\\nIncluded usage: 2%\\nReset: 2026-08-28T00:00:00Z',
        method: 'notify',
        notifyType: 'info',
        type: 'extension_ui_request'
      })
      return
    }
    promptCount += 1
    const turnEvents = dynamicReplies
      ? [
          {
            message: {
              content: [{ text: String(process.pid) + ':' + String(promptCount), type: 'text' }],
              role: 'assistant',
              stopReason: 'stop'
            },
            type: 'message_end'
          },
          { type: 'agent_settled' }
        ]
      : events
    for (const event of turnEvents) send(event)
    if (exitAfterPrompt) process.exit(0)
  }, 10)
})
`
  await writeFile(executable, source)
  await chmod(executable, 0o755)
  return { commandLog, executable, root }
}

async function dispatch(router: PiAgentRouter) {
  return router.dispatch({
    effort: 'high',
    model: 'xai-auth/grok-4.6',
    prompt: 'Finish the bounded task.'
  })
}

describe('PiAgentRouter completion', () => {
  test('reads bounded provider usage through the installed Pi command', async () => {
    const stub = await createPiStub({ events: [] })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      expect(await router.providerUsage('xAI')).toMatchObject({
        provider: 'xAI',
        remainingPercent: 98,
        subscription: 'SuperGrok',
        usedPercent: 2
      })
      expect(await router.providerUsage('Cursor')).toBeNull()
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('assigns a unique identity to every concurrently running overflow worker', async () => {
    const stub = await createPiStub({ events: [] })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workerCount: 4,
      workspaceRoot: process.cwd()
    })

    try {
      const receipts = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          router.dispatch({
            effort: 'high',
            model: 'xai-auth/grok-4.6',
            prompt: `Finish bounded task ${String(index + 1)}.`
          })
        )
      )
      const workerIds = receipts.map((receipt) => router.conversation(receipt.threadId)?.workerId)

      expect(workerIds).toEqual([
        'worker-1',
        'worker-2',
        'worker-3',
        'worker-4',
        'worker-5',
        'worker-6'
      ])
      expect(new Set(workerIds)).toHaveLength(6)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('keeps one resident Pi RPC process across completed follow-ups', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const first = await dispatch(router)
      const firstJob = await router.waitForJob(first.jobId, 3_000)
      const second = await router.followUp(first.threadId, 'Continue in the same Pi session.')
      const secondJob = await router.waitForJob(second.jobId, 3_000)
      const firstPid = firstJob?.response.split(':')[0]
      const secondPid = secondJob?.response.split(':')[0]
      const thread = router.conversation(first.threadId)

      expect(firstJob).toMatchObject({ state: 'completed' })
      expect(secondJob).toMatchObject({ state: 'completed' })
      expect(firstPid).toBeTruthy()
      expect(secondPid).toBe(firstPid)
      expect(thread?.messages.filter((message) => message.role === 'user')).toHaveLength(2)
      expect(
        thread?.messages
          .filter((message) => message.role === 'user')
          .every((message) => Boolean(message.completedAt))
      ).toBe(true)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('steers an active follow-up through Pi RPC without aborting or queueing a new turn', async () => {
    const stub = await createPiStub({ holdUntilSteer: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const first = await dispatch(router)
      const steering = await router.followUp(first.threadId, 'Use the smaller implementation.')
      const job = await router.waitForJob(first.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { message?: string; type: string })
      const thread = router.conversation(first.threadId)

      expect(steering).toMatchObject({ jobId: first.jobId, state: 'running' })
      expect(commands.some((command) => command.type === 'abort')).toBe(false)
      expect(commands.filter((command) => command.type === 'prompt')).toHaveLength(1)
      expect(commands.find((command) => command.type === 'steer')).toMatchObject({
        message: 'Use the smaller implementation.'
      })
      expect(job).toMatchObject({
        response: 'steered:Use the smaller implementation.',
        state: 'completed'
      })
      expect(thread?.messages.filter((message) => message.role === 'user')).toHaveLength(2)
      expect(
        thread?.messages
          .filter((message) => message.role === 'user')
          .every((message) => Boolean(message.completedAt))
      ).toBe(true)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('does not complete an unfinished Pi tool', async () => {
    const stub = await createPiStub({
      events: [
        { type: 'agent_start' },
        {
          args: { path: 'README.md' },
          toolCallId: 'call-unfinished',
          toolName: 'read',
          type: 'tool_execution_start'
        },
        { type: 'agent_settled' }
      ]
    })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await dispatch(router)
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const thread = router.conversation(receipt.threadId)
      const tool = thread?.messages
        .flatMap((message) => message.parts ?? [])
        .find((part) => part.type === 'tool' && part.name === 'read')

      expect(job).toMatchObject({ state: 'failed', threadId: receipt.threadId })
      expect(thread).toMatchObject({
        recentUpdate: 'Pi stopped without a final response.',
        state: 'needs_attention'
      })
      expect(tool).toMatchObject({ name: 'read', type: 'tool' })
      expect(tool?.type === 'tool' ? tool.state : undefined).not.toBe('success')
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('does not complete a turn when Pi exits without a final assistant answer', async () => {
    const stub = await createPiStub({ exitAfterPrompt: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await dispatch(router)
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const thread = router.conversation(receipt.threadId)

      expect(job).toMatchObject({ state: 'failed', threadId: receipt.threadId })
      expect(thread?.state).toBe('needs_attention')
      expect(thread?.state).not.toBe('completed')
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })
})
