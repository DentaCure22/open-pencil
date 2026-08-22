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

type LoggedPiPrompt = {
  images?: unknown
  message?: unknown
  type: string
}

function messageApprovalRequest(id = 'message-approval') {
  return {
    id,
    method: 'select',
    options: ['Allow once', 'Allow for session', 'Deny'],
    title:
      'MCP: messages__send wants to run send_message\n\nArguments:\n' +
      JSON.stringify({
        chat_guid: 'iMessage;-;test-recipient',
        recipient_label: 'Test Recipient',
        text: 'This is only a fake test.'
      }),
    type: 'extension_ui_request'
  }
}

async function createPiStub(input: {
  approvalRequest?: Record<string, unknown>
  dynamicReplies?: boolean
  events?: Array<Record<string, unknown>>
  exitAfterPrompt?: boolean
  holdUntilSteer?: boolean
  reportStreamingAfterPrompt?: boolean
  streamBeforeSteer?: string
}): Promise<PiStub> {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-router-'))
  const executable = path.join(root, 'pi-rpc-stub')
  const commandLog = path.join(root, 'commands.jsonl')
  const source = `#!/usr/bin/env node
const readline = require('node:readline')
const { appendFileSync } = require('node:fs')
const approvalRequest = ${JSON.stringify(input.approvalRequest ?? null)}
const events = ${JSON.stringify(input.events ?? [])}
const dynamicReplies = ${JSON.stringify(input.dynamicReplies === true)}
const exitAfterPrompt = ${JSON.stringify(input.exitAfterPrompt === true)}
const holdUntilSteer = ${JSON.stringify(input.holdUntilSteer === true)}
const reportStreamingAfterPrompt = ${JSON.stringify(input.reportStreamingAfterPrompt === true)}
const streamBeforeSteer = ${JSON.stringify(input.streamBeforeSteer ?? '')}
const commandLog = ${JSON.stringify(commandLog)}
const lines = readline.createInterface({ input: process.stdin })
let promptCount = 0
let promptStarted = false

function send(value) {
  process.stdout.write(JSON.stringify(value) + '\\n')
}

lines.on('line', (line) => {
  const command = JSON.parse(line)
  appendFileSync(commandLog, JSON.stringify(command) + '\\n')
  if (command.type === 'extension_ui_response') {
    const approved = command.value === 'Allow once' || command.confirmed === true
    send({
      message: {
        content: [{ text: approved ? 'Fake message send completed.' : 'Fake message send cancelled.', type: 'text' }],
        role: 'assistant',
        stopReason: 'stop'
      },
      type: 'message_end'
    })
    send({ type: 'agent_settled' })
    return
  }
  const response = {
    command: command.type,
    id: command.id,
    success: true,
    type: 'response'
  }
  if (command.type === 'get_state') {
    response.data = { isStreaming: promptStarted && reportStreamingAfterPrompt, sessionId: 'stub-session' }
  }
  if (command.type === 'get_entries') {
    response.data = { entries: [], leafId: null }
  }
  send(response)
  if (command.type === 'steer' && holdUntilSteer) {
    send({
      assistantMessageEvent: { contentIndex: 0, delta: 'Taking the correction. ', type: 'text_delta' },
      type: 'message_update'
    })
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
  promptStarted = true
  if (holdUntilSteer) {
    if (streamBeforeSteer) {
      send({
        assistantMessageEvent: { contentIndex: 0, delta: streamBeforeSteer, type: 'text_delta' },
        type: 'message_update'
      })
    }
    return
  }
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
    if (approvalRequest) {
      send(approvalRequest)
      return
    }
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

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Pi stub event.')
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }
}

describe('PiAgentRouter completion', () => {
  test('holds a Messages tool call until the visible approval response arrives', async () => {
    const stub = await createPiStub({ approvalRequest: messageApprovalRequest() })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await dispatch(router)
      await waitForCondition(
        () => router.conversation(receipt.threadId)?.pendingUiRequests?.length === 1
      )
      const pending = router.conversation(receipt.threadId)
      const commandsBeforeApproval = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string })

      expect(pending).toMatchObject({
        pendingUiRequests: [
          {
            id: 'message-approval',
            method: 'select',
            options: ['Allow once', 'Allow for session', 'Deny']
          }
        ],
        recentUpdate: 'Waiting for your approval.',
        state: 'needs_attention'
      })
      expect(
        commandsBeforeApproval.some((command) => command.type === 'extension_ui_response')
      ).toBe(false)

      expect(
        router.respondToUiRequest(receipt.threadId, 'message-approval', {
          value: 'Allow once'
        })
      ).toBe(true)
      expect(
        router.respondToUiRequest(receipt.threadId, 'message-approval', {
          value: 'Allow once'
        })
      ).toBe(false)
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; value?: string })

      expect(job).toMatchObject({ response: 'Fake message send completed.', state: 'completed' })
      expect(commands).toContainEqual(
        expect.objectContaining({ type: 'extension_ui_response', value: 'Allow once' })
      )
      expect(router.conversation(receipt.threadId)?.pendingUiRequests).toBeUndefined()
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('passes denial back to Pi without approving the fake Messages call', async () => {
    const stub = await createPiStub({ approvalRequest: messageApprovalRequest('message-denial') })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await dispatch(router)
      await waitForCondition(
        () => router.conversation(receipt.threadId)?.pendingUiRequests?.length === 1
      )
      expect(router.respondToUiRequest(receipt.threadId, 'message-denial', { value: 'Deny' })).toBe(
        true
      )
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; value?: string })

      expect(job).toMatchObject({ response: 'Fake message send cancelled.', state: 'completed' })
      expect(commands).toContainEqual(
        expect.objectContaining({ type: 'extension_ui_response', value: 'Deny' })
      )
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

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

  test('assigns a unique identity to every worker without a slot limit', async () => {
    const stub = await createPiStub({ events: [] })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
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
    const stub = await createPiStub({
      holdUntilSteer: true,
      streamBeforeSteer: 'I started the first answer.'
    })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const first = await dispatch(router)
      await waitForCondition(() =>
        Boolean(
          router
            .conversation(first.threadId)
            ?.messages.some(
              (message) =>
                message.role === 'assistant' && message.text === 'I started the first answer.'
            )
        )
      )
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
      expect(thread?.messages.map((message) => [message.role, message.text])).toEqual([
        ['user', 'Finish the bounded task.'],
        ['assistant', 'I started the first answer.'],
        ['user', 'Use the smaller implementation.'],
        ['assistant', 'steered:Use the smaller implementation.']
      ])
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

  test('sends Board evidence and attachment frames as images Pi can see directly', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ text: 'I used the image.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop'
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ]
    })
    const evidencePath = path.join(stub.root, 'evidence.png')
    const attachmentPath = path.join(stub.root, 'video-contact-sheet.jpg')
    await writeFile(evidencePath, Buffer.from([137, 80, 78, 71]))
    await writeFile(attachmentPath, Buffer.from([255, 216, 255]))
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await router.dispatch({
        effort: 'high',
        evidencePath,
        imagePaths: [attachmentPath],
        model: 'xai-auth/grok-4.6',
        prompt: 'Use the visual evidence.'
      })
      await router.waitForJob(receipt.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as LoggedPiPrompt)
      const prompt = commands.find((command) => command.type === 'prompt')

      expect(prompt?.images).toEqual([
        {
          data: Buffer.from([137, 80, 78, 71]).toString('base64'),
          mimeType: 'image/png',
          type: 'image'
        },
        {
          data: Buffer.from([255, 216, 255]).toString('base64'),
          mimeType: 'image/jpeg',
          type: 'image'
        }
      ])
      expect(prompt?.message).toContain(evidencePath)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('persists submitted images and files on the visible user turn', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await router.dispatch({
        attachments: [
          {
            alt: 'reference.png',
            type: 'image',
            url: 'data:image/png;base64,cG5n'
          },
          {
            mediaType: 'video/quicktime',
            name: 'walkthrough.mov',
            size: 11,
            type: 'attachment'
          }
        ],
        displayPrompt: 'What is happening here?',
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        prompt: 'What is happening here?\n\nAttached files:\n- walkthrough.mov'
      })
      await router.waitForJob(receipt.jobId, 3_000)
      const userMessage = router
        .conversation(receipt.threadId)
        ?.messages.find((message) => message.role === 'user')

      expect(userMessage).toMatchObject({
        parts: [
          { alt: 'reference.png', type: 'image' },
          {
            mediaType: 'video/quicktime',
            name: 'walkthrough.mov',
            size: 11,
            type: 'attachment'
          }
        ],
        text: 'What is happening here?'
      })

      const followUp = await router.followUp(receipt.threadId, 'Inspect the video.', {
        attachments: [
          {
            mediaType: 'video/quicktime',
            name: 'second-pass.mov',
            size: 12,
            type: 'attachment'
          }
        ],
        displayPrompt: 'Inspect the video.'
      })
      await router.waitForJob(followUp.jobId, 3_000)
      const followUpMessage = router
        .conversation(receipt.threadId)
        ?.messages.filter((message) => message.role === 'user')
        .at(-1)
      expect(followUpMessage).toMatchObject({
        parts: [
          {
            mediaType: 'video/quicktime',
            name: 'second-pass.mov',
            size: 12,
            type: 'attachment'
          }
        ],
        text: 'Inspect the video.'
      })
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('stops and releases a Pi process that stays streaming without activity', async () => {
    const stub = await createPiStub({ events: [], reportStreamingAfterPrompt: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      stallTimeoutMs: 50,
      watchdogProbeMs: 10,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await dispatch(router)
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const thread = router.conversation(receipt.threadId)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string })

      expect(job?.state).toBe('failed')
      expect(thread).toMatchObject({ state: 'needs_attention' })
      expect(thread?.recentUpdate).toContain('saved session is ready to resume')
      expect(commands.some((command) => command.type === 'get_state')).toBe(true)
      expect(commands.some((command) => command.type === 'abort')).toBe(true)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })
})
