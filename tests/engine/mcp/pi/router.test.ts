import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { FALLBACK_PI_MODELS } from '#mcp/pi/board-model-catalog'
import { DefaultPiProviderRuntime } from '#mcp/pi/providers'
import { PiAgentRouter } from '#mcp/pi/router'
import type { ConversationTitleGenerator, ConversationTitleInput } from '#mcp/pi/title-generator'
import { readUsageTurns } from '#mcp/pi/usage-ledger'
import { boardWorkerPrompt } from '#mcp/pi/worker-mcp'

type PiStub = {
  commandLog: string
  executable: string
  launchLog: string
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
  omitPromptAck?: boolean
  reportStreamingAfterPrompt?: boolean
  settleDelayMs?: number
  streamBeforeSteer?: string
}): Promise<PiStub> {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-pi-router-'))
  const executable = path.join(root, 'pi-rpc-stub')
  const commandLog = path.join(root, 'commands.jsonl')
  const launchLog = path.join(root, 'launch.json')
  const source = `#!/usr/bin/env node
const readline = require('node:readline')
const { appendFileSync, writeFileSync } = require('node:fs')
const approvalRequest = ${JSON.stringify(input.approvalRequest ?? null)}
const events = ${JSON.stringify(input.events ?? [])}
const dynamicReplies = ${JSON.stringify(input.dynamicReplies === true)}
const exitAfterPrompt = ${JSON.stringify(input.exitAfterPrompt === true)}
const holdUntilSteer = ${JSON.stringify(input.holdUntilSteer === true)}
const omitPromptAck = ${JSON.stringify(input.omitPromptAck === true)}
const reportStreamingAfterPrompt = ${JSON.stringify(input.reportStreamingAfterPrompt === true)}
const settleDelayMs = ${JSON.stringify(input.settleDelayMs ?? 10)}
const streamBeforeSteer = ${JSON.stringify(input.streamBeforeSteer ?? '')}
const commandLog = ${JSON.stringify(commandLog)}
const launchLog = ${JSON.stringify(launchLog)}
writeFileSync(launchLog, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }))
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
  if (!(command.type === 'prompt' && omitPromptAck)) send(response)
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
  }, settleDelayMs)
})
`
  await writeFile(executable, source)
  await chmod(executable, 0o755)
  return { commandLog, executable, launchLog, root }
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
  test('persists the exact workspace changes on the turn that produced them', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ text: 'Updated the app.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop'
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ],
      settleDelayMs: 250
    })
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-turn-workspace-'))
    const runGit = async (...args: string[]) => {
      const process = Bun.spawn(['git', '-C', workspaceRoot, ...args], {
        stderr: 'pipe',
        stdout: 'ignore'
      })
      if ((await process.exited) === 0) return
      throw new Error(await new Response(process.stderr).text())
    }
    await runGit('init', '--quiet')
    await runGit('config', 'user.email', 'openpencil@example.com')
    await runGit('config', 'user.name', 'OpenPencil Test')
    await writeFile(path.join(workspaceRoot, 'app.ts'), 'const before = true\n')
    await runGit('add', '.')
    await runGit('commit', '--quiet', '-m', 'baseline')
    const boardWorkerWorkspaceRoot = path.join(stub.root, 'neutral-worker')
    await mkdir(boardWorkerWorkspaceRoot)
    const router = new PiAgentRouter({
      boardWorkerWorkspaceRoot,
      executable: stub.executable,
      historyPath: path.join(stub.root, 'history.json'),
      models: FALLBACK_PI_MODELS,
      sessionDir: stub.root,
      warmPoolSize: 0,
      workspaceRoot
    })

    try {
      const receipt = await router.dispatch({
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        prompt: 'Update the app.',
        toolScope: 'board-worker'
      })
      await writeFile(
        path.join(workspaceRoot, 'app.ts'),
        'const before = true\nconst after = true\n'
      )
      await router.waitForJob(receipt.jobId, 3_000)

      const prompt = router
        .conversation(receipt.threadId)
        ?.messages.find((message) => message.role === 'user')
      expect(prompt?.changes?.files[0]?.patch).toContain('+const after = true')
      expect(prompt?.changes).toMatchObject({
        additions: 1,
        deletions: 0,
        files: [
          expect.objectContaining({
            additions: 1,
            deletions: 0,
            path: 'app.ts',
            status: 'modified'
          })
        ]
      })
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
      await rm(workspaceRoot, { force: true, recursive: true })
    }
  })

  test('replaces the provisional prompt title with a persisted background title', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const historyPath = path.join(stub.root, 'history.json')
    let captured: ConversationTitleInput | null = null
    let closed = false
    let resolveTitle: (title: string | null) => void = () => undefined
    const generatedTitle = new Promise<string | null>((resolve) => {
      resolveTitle = resolve
    })
    const titleGenerator: ConversationTitleGenerator = {
      close() {
        closed = true
      },
      generate(input) {
        captured = input
        return generatedTitle
      }
    }
    const router = new PiAgentRouter({
      executable: stub.executable,
      historyPath,
      models: FALLBACK_PI_MODELS,
      titleGenerator,
      warmPoolSize: 0,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await router.dispatch({
        displayPrompt: 'How can chats receive summarized names?',
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        prompt: 'Internal routed prompt that should not become the title.'
      })

      expect(captured).toMatchObject({ message: 'How can chats receive summarized names?' })
      expect(router.conversation(receipt.threadId)?.title).toBeUndefined()

      resolveTitle('Generate summarized chat names')
      await waitForCondition(
        () => router.conversation(receipt.threadId)?.title === 'Generate summarized chat names'
      )
      const persisted = JSON.parse(await readFile(historyPath, 'utf8')) as Array<{
        id: string
        title?: string
      }>

      expect(
        router.conversationPreviews().find((thread) => thread.id === receipt.threadId)?.title
      ).toBe('Generate summarized chat names')
      expect(persisted.find((thread) => thread.id === receipt.threadId)?.title).toBe(
        'Generate summarized chat names'
      )
    } finally {
      router.close()
      expect(closed).toBe(true)
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('generates a title when an existing untitled conversation is opened', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const historyPath = path.join(stub.root, 'history.json')
    const originalRouter = new PiAgentRouter({
      executable: stub.executable,
      historyPath,
      models: FALLBACK_PI_MODELS,
      warmPoolSize: 0,
      workspaceRoot: process.cwd()
    })
    const receipt = await dispatch(originalRouter)
    await originalRouter.waitForJob(receipt.jobId, 3_000)
    originalRouter.close()

    let calls = 0
    let captured: ConversationTitleInput | null = null
    const router = new PiAgentRouter({
      executable: stub.executable,
      historyPath,
      models: FALLBACK_PI_MODELS,
      titleGenerator: {
        close: () => undefined,
        async generate(input) {
          calls += 1
          captured = input
          return 'Finish the bounded task'
        }
      },
      warmPoolSize: 0,
      workspaceRoot: process.cwd()
    })

    try {
      expect(router.conversation(receipt.threadId)?.title).toBeUndefined()
      expect(router.ensureTitle(receipt.threadId)).toBe(true)
      expect(router.ensureTitle(receipt.threadId)).toBe(true)
      await waitForCondition(
        () => router.conversation(receipt.threadId)?.title === 'Finish the bounded task'
      )

      expect(calls).toBe(1)
      expect(captured).toMatchObject({ message: 'Finish the bounded task.' })
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('activates the OpenPencil skill for a newly launched Board worker', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const boardWorkerWorkspaceRoot = path.join(stub.root, 'neutral-worker')
    await mkdir(boardWorkerWorkspaceRoot)
    const userMcpConfig = path.join(stub.root, 'user-mcp.json')
    await writeFile(
      userMcpConfig,
      JSON.stringify({
        mcpServers: {
          openpencil: { command: '/opt/openpencil/dispatch' }
        }
      })
    )
    const router = new PiAgentRouter({
      boardWorkerWorkspaceRoot,
      executable: stub.executable,
      mcpConfigPath: userMcpConfig,
      models: FALLBACK_PI_MODELS,
      sessionDir: stub.root,
      warmPoolSize: 0,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await router.dispatch({
        displayPrompt: 'Make a cool object on the Board.',
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        prompt: 'Make a cool object on the Board.',
        toolScope: 'board-worker'
      })
      await router.waitForJob(receipt.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as LoggedPiPrompt)
      const launch = JSON.parse(await readFile(stub.launchLog, 'utf8')) as {
        argv: string[]
        cwd: string
      }
      const thread = router.conversation(receipt.threadId)

      expect(await realpath(launch.cwd)).toBe(await realpath(boardWorkerWorkspaceRoot))
      expect(launch.argv).not.toContain('--no-context-files')
      expect(commands.find((command) => command.type === 'prompt')?.message).toBe(
        boardWorkerPrompt('Make a cool object on the Board.')
      )
      expect(thread?.toolScope).toBe('board-worker')
      expect(thread?.messages.find((message) => message.role === 'user')?.text).toBe(
        'Make a cool object on the Board.'
      )
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('holds a Messages tool call until the visible approval response arrives', async () => {
    const stub = await createPiStub({
      approvalRequest: messageApprovalRequest()
    })
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

      expect(job).toMatchObject({
        response: 'Fake message send completed.',
        state: 'completed'
      })
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: 'extension_ui_response',
          value: 'Allow once'
        })
      )
      expect(router.conversation(receipt.threadId)?.pendingUiRequests).toBeUndefined()
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('passes denial back to Pi without approving the fake Messages call', async () => {
    const stub = await createPiStub({
      approvalRequest: messageApprovalRequest('message-denial')
    })
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
      expect(
        router.respondToUiRequest(receipt.threadId, 'message-denial', {
          value: 'Deny'
        })
      ).toBe(true)
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; value?: string })

      expect(job).toMatchObject({
        response: 'Fake message send cancelled.',
        state: 'completed'
      })
      expect(commands).toContainEqual(
        expect.objectContaining({
          type: 'extension_ui_response',
          value: 'Deny'
        })
      )
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('supersedes a pending approval before steering with a newer user message', async () => {
    const stub = await createPiStub({
      approvalRequest: messageApprovalRequest('message-steer')
    })
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

      await router.steer(receipt.threadId, 'Use the newer wording instead.')

      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line) as {
              cancelled?: boolean
              message?: string
              type: string
              value?: string
            }
        )
      const cancelledIndex = commands.findIndex(
        (command) => command.type === 'extension_ui_response' && command.cancelled === true
      )
      const steerIndex = commands.findIndex(
        (command) =>
          command.type === 'steer' && command.message === 'Use the newer wording instead.'
      )

      expect(cancelledIndex).toBeGreaterThanOrEqual(0)
      expect(steerIndex).toBeGreaterThan(cancelledIndex)
      expect(commands.some((command) => command.value === 'Allow once')).toBe(false)
      expect(router.conversation(receipt.threadId)?.pendingUiRequests).toBeUndefined()
      expect(
        router
          .conversation(receipt.threadId)
          ?.messages.findLast((message) => message.role === 'user')
      ).toMatchObject({
        role: 'user',
        text: 'Use the newer wording instead.'
      })
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

      expect(router.conversation(receipts[0]?.threadId ?? '')?.activeTurnStartedAt).toBe(
        receipts[0]?.dispatchedAt
      )
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

  test('keeps the turn running when Pi is slow to acknowledge prompt', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ text: 'Hello. What do you want to work on?', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop'
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ],
      omitPromptAck: true
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

      expect(receipt.state).toBe('running')
      expect(job).toMatchObject({
        response: 'Hello. What do you want to work on?',
        state: 'completed'
      })
      expect(thread).toMatchObject({
        recentUpdate: 'Hello. What do you want to work on?',
        state: 'completed'
      })
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
      expect(thread?.activeTurnStartedAt).toBeUndefined()
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

  test('starts a prepared Todo on its first message without replacing the chat', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      sessionDir: stub.root,
      workspaceRoot: process.cwd()
    })

    try {
      const draft = router.createTodoDraft({
        brief: {
          goal: 'Shape patient history shortcuts',
          knownFacts: ['The dental chart should stay visible.'],
          openQuestions: ['Which history sections are highest value?']
        },
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        projectId: 'project:dental',
        threadId: 'todo-chat:patient-history',
        title: 'Add patient history shortcuts',
        todoId: 'todo:patient-history'
      })

      expect(draft).toMatchObject({
        id: 'todo-chat:patient-history',
        messages: [],
        sessionId: null,
        state: 'completed'
      })
      const receipt = await router.followUp(draft.id, 'Let’s compare two interaction directions.')
      await router.waitForJob(receipt.jobId, 3_000)
      const thread = router.conversation(draft.id)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as LoggedPiPrompt)
      const prompt = commands.find((command) => command.type === 'prompt')?.message

      expect(receipt.threadId).toBe(draft.id)
      expect(thread?.id).toBe(draft.id)
      expect(thread?.messages.find((message) => message.role === 'user')).toMatchObject({
        role: 'user',
        text: 'Let’s compare two interaction directions.'
      })
      expect(String(prompt)).toContain('Prepared brief:')
      expect(String(prompt)).toContain('Shape patient history shortcuts')
      expect(String(prompt)).toContain('keep any plan flexible')
      expect(String(prompt)).not.toContain('work-plan skill')
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

  test('passes continue through the active native thread without rewriting it', async () => {
    const stub = await createPiStub({ holdUntilSteer: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: process.cwd()
    })

    try {
      const first = await dispatch(router)
      await router.followUp(first.threadId, 'continue')
      await router.waitForJob(first.jobId, 3_000)

      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { message?: string; type: string })
      expect(commands.find((command) => command.type === 'steer')?.message).toBe('continue')
      expect(router.conversation(first.threadId)?.id).toBe(first.threadId)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('recovers a failed bare continuation in a fresh session using only the active chat', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const historyPath = path.join(stub.root, 'pi-conversations.json')
    const current: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-25T04:07:46.504Z',
      effort: 'high',
      id: 'thread-current',
      messages: [
        {
          createdAt: '2026-08-25T04:07:46.504Z',
          id: 'current-user',
          parts: [
            {
              alt: 'chapter-rail.png',
              type: 'image',
              url: 'data:image/png;base64,iVBORw0KGgo='
            }
          ],
          role: 'user',
          text: ''
        },
        {
          createdAt: '2026-08-25T04:08:05.178Z',
          id: 'current-assistant',
          parts: [
            {
              state: 'complete',
              text: 'Move the chapter rail left and match the chat scrollbar to thread history.',
              type: 'commentary'
            }
          ],
          role: 'assistant',
          text: ''
        }
      ],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Request timed out.',
      sessionId: 'broken-native-session',
      state: 'needs_attention',
      task: 'Screenshot',
      updatedAt: '2026-08-25T04:13:05.200Z',
      workerId: 'worker-1'
    }
    const unrelated: AgentConversationThread = {
      canFollowUp: true,
      createdAt: '2026-08-25T04:08:18.647Z',
      effort: 'high',
      id: 'thread-unrelated',
      messages: [
        {
          createdAt: '2026-08-25T04:12:18.861Z',
          id: 'unrelated-user',
          role: 'user',
          text: 'Make the Dental Chart stay sharp at 75 percent.'
        }
      ],
      model: 'xai-auth/grok-4.6',
      recentUpdate: 'Changing the chart zoom threshold.',
      sessionId: 'unrelated-native-session',
      state: 'completed',
      task: 'Dental Chart zoom',
      updatedAt: '2026-08-25T04:13:59.543Z',
      workerId: 'worker-2'
    }
    await writeFile(historyPath, JSON.stringify([current, unrelated]))
    const router = new PiAgentRouter({
      executable: stub.executable,
      historyPath,
      models: FALLBACK_PI_MODELS,
      warmPoolSize: 0,
      workspaceRoot: process.cwd()
    })

    try {
      const receipt = await router.followUp(current.id, 'continue')
      await router.waitForJob(receipt.jobId, 3_000)

      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as LoggedPiPrompt)
      const prompt = commands.find((command) => command.type === 'prompt')
      const launch = JSON.parse(await readFile(stub.launchLog, 'utf8')) as {
        argv: string[]
      }
      const sessionIdIndex = launch.argv.indexOf('--session-id')
      const thread = router.conversation(current.id)

      expect(receipt.threadId).toBe(current.id)
      expect(prompt?.message).toContain(
        'Move the chapter rail left and match the chat scrollbar to thread history.'
      )
      expect(prompt?.message).toContain('Use only the saved context from this chat')
      expect(prompt?.message).not.toContain('Dental Chart stay sharp')
      expect(prompt?.images).toHaveLength(1)
      expect(launch.argv[sessionIdIndex + 1]).not.toBe('broken-native-session')
      expect(thread?.messages.findLast((message) => message.role === 'user')?.text).toBe('continue')
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

      expect(job).toMatchObject({
        state: 'failed',
        threadId: receipt.threadId
      })
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

      expect(job).toMatchObject({
        state: 'failed',
        threadId: receipt.threadId
      })
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
        ?.messages.findLast((message) => message.role === 'user')
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
    const stub = await createPiStub({
      events: [],
      reportStreamingAfterPrompt: true
    })
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

  test('starts a new session from a warm Pi process without empty-session handshake', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ text: 'Warm session is ready.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop'
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ]
    })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      warmPoolSize: 1,
      workspaceRoot: process.cwd()
    })

    try {
      expect(await router.waitForWarmProcess()).toBe(true)
      const receipt = await dispatch(router)
      const job = await router.waitForJob(receipt.jobId, 3_000)
      const commands = (await readFile(stub.commandLog, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string })
      const thread = router.conversation(receipt.threadId)

      const promptIndex = commands.findIndex((command) => command.type === 'prompt')
      const entriesIndex = commands.findIndex((command) => command.type === 'get_entries')

      expect(job).toMatchObject({ state: 'completed' })
      expect(thread?.sessionId).toMatch(/^stub-session$/)
      expect(promptIndex).toBeGreaterThanOrEqual(0)
      expect(commands.some((command) => command.type === 'get_session_stats')).toBe(false)
      expect(commands.some((command) => command.type === 'set_model')).toBe(false)
      expect(commands.some((command) => command.type === 'set_thinking_level')).toBe(false)
      expect(entriesIndex).toBeGreaterThan(promptIndex)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('keeps a second new session on a freshly warmed process', async () => {
    const stub = await createPiStub({ dynamicReplies: true })
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      warmPoolSize: 1,
      workspaceRoot: process.cwd()
    })

    try {
      expect(await router.waitForWarmProcess()).toBe(true)
      const first = await dispatch(router)
      const firstJob = await router.waitForJob(first.jobId, 3_000)
      expect(await router.waitForWarmProcess()).toBe(true)
      const second = await router.dispatch({
        effort: 'high',
        model: 'xai-auth/grok-4.6',
        prompt: 'Start another bounded task.'
      })
      const secondJob = await router.waitForJob(second.jobId, 3_000)
      const firstPid = firstJob?.response.split(':')[0]
      const secondPid = secondJob?.response.split(':')[0]

      expect(firstJob).toMatchObject({ state: 'completed' })
      expect(secondJob).toMatchObject({ state: 'completed' })
      expect(first.threadId).not.toBe(second.threadId)
      expect(firstPid).toBeTruthy()
      expect(secondPid).toBeTruthy()
      expect(secondPid).not.toBe(firstPid)
    } finally {
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('appends measured cache and usage after a settled turn', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ text: 'Cached follow-up.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop',
            usage: {
              cacheRead: 28_800,
              cacheWrite: 0,
              input: 145,
              output: 12,
              reasoning: 4,
              totalTokens: 28_957
            }
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ]
    })
    const ledgerPath = path.join(stub.root, 'turns.jsonl')
    const previous = process.env.OPENPENCIL_MODEL_METER_LOG
    process.env.OPENPENCIL_MODEL_METER_LOG = ledgerPath
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: stub.root
    })

    try {
      const receipt = await dispatch(router)
      await router.waitForJob(receipt.jobId, 3_000)
      const turns = await readUsageTurns(ledgerPath)
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({
        cacheHitPercent: 99.5,
        cacheRead: 28_800,
        input: 145,
        model: 'grok-4.6',
        provider: 'xai-auth',
        source: 'live',
        turnIndex: 1,
        usageSource: 'pi-event'
      })
    } finally {
      if (previous === undefined) delete process.env.OPENPENCIL_MODEL_METER_LOG
      else process.env.OPENPENCIL_MODEL_METER_LOG = previous
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('aggregates every model call in a settled turn for cache metering', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ name: 'read', type: 'toolCall' }],
            role: 'assistant',
            stopReason: 'toolUse',
            usage: {
              cacheRead: 12_800,
              cacheWrite: 0,
              input: 600,
              output: 40,
              reasoning: 10,
              totalTokens: 13_450
            }
          },
          type: 'message_end'
        },
        {
          message: {
            content: [{ text: 'Finished after the tool call.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop',
            usage: {
              cacheRead: 13_312,
              cacheWrite: 0,
              input: 188,
              output: 16,
              reasoning: 3,
              totalTokens: 13_519
            }
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ]
    })
    const ledgerPath = path.join(stub.root, 'turns.jsonl')
    const previous = process.env.OPENPENCIL_MODEL_METER_LOG
    process.env.OPENPENCIL_MODEL_METER_LOG = ledgerPath
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      workspaceRoot: stub.root
    })

    try {
      const receipt = await dispatch(router)
      await router.waitForJob(receipt.jobId, 3_000)
      const turns = await readUsageTurns(ledgerPath)
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({
        cacheRead: 26_112,
        input: 788,
        output: 56,
        reasoning: 13,
        usageSource: 'pi-event'
      })
    } finally {
      if (previous === undefined) delete process.env.OPENPENCIL_MODEL_METER_LOG
      else process.env.OPENPENCIL_MODEL_METER_LOG = previous
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })

  test('writes measured Antigravity cacheRead from the sqlite reader', async () => {
    const stub = await createPiStub({
      events: [
        {
          message: {
            content: [{ text: 'Measured Antigravity turn.', type: 'text' }],
            role: 'assistant',
            stopReason: 'stop',
            usage: {
              cacheRead: 0,
              cacheWrite: 0,
              input: 0,
              output: 0,
              totalTokens: 0
            }
          },
          type: 'message_end'
        },
        { type: 'agent_settled' }
      ]
    })
    const ledgerPath = path.join(stub.root, 'turns.jsonl')
    const previous = process.env.OPENPENCIL_MODEL_METER_LOG
    process.env.OPENPENCIL_MODEL_METER_LOG = ledgerPath
    const router = new PiAgentRouter({
      executable: stub.executable,
      models: FALLBACK_PI_MODELS,
      providers: new DefaultPiProviderRuntime({
        antigravity: {
          capture: async () => ({
            conversationId: 'agy-conversation',
            maxGenerationIndex: 0
          }),
          read: async () => ({
            cacheRead: 20_331,
            generation: 80,
            input: 4_207,
            output: 80,
            reasoning: 20
          })
        }
      }),
      workspaceRoot: stub.root
    })

    try {
      const receipt = await router.dispatch({
        effort: 'high',
        model: 'antigravity/gemini-3-7-flash',
        prompt: 'Finish the bounded task.'
      })
      await router.waitForJob(receipt.jobId, 3_000)
      const conversation = router.conversation(receipt.threadId)
      expect(conversation?.contextUsage).toMatchObject({
        cacheHitPercent: 82.9,
        tokens: 24_618
      })
      const turns = await readUsageTurns(ledgerPath)
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({
        cacheHitPercent: 82.9,
        cacheRead: 20_331,
        input: 4_207,
        model: 'gemini-3-7-flash',
        provider: 'antigravity',
        source: 'live',
        usageSource: 'agy-sqlite'
      })
    } finally {
      if (previous === undefined) delete process.env.OPENPENCIL_MODEL_METER_LOG
      else process.env.OPENPENCIL_MODEL_METER_LOG = previous
      router.close()
      await rm(stub.root, { force: true, recursive: true })
    }
  })
})
