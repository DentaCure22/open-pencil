import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CodexAppServerSession,
  projectCodexAppServerNotification,
  type CodexAppServerNotification,
  type ProjectedCodexJsonEvent
} from '../src/codex-app-server'

interface FakeAppServer {
  binary: string
  requestLog: string
}

async function fakeAppServer(
  options: {
    missingCacheWriteUsage?: boolean
    postReleaseResponse?: boolean
    serverRequestCollision?: boolean
  } = {}
): Promise<FakeAppServer> {
  const directory = join(tmpdir(), `openpencil-app-server-${randomUUID()}`)
  const binary = join(directory, 'fake-codex')
  const requestLog = join(directory, 'requests.jsonl')
  await mkdir(directory, { recursive: true })
  await writeFile(
    binary,
    `#!${process.execPath}
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
const postReleaseResponse = ${JSON.stringify(options.postReleaseResponse === true)}
const missingCacheWriteUsage = ${JSON.stringify(options.missingCacheWriteUsage === true)}
const serverRequestCollision = ${JSON.stringify(options.serverRequestCollision === true)}
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n')
const input = createInterface({ input: process.stdin })
for await (const line of input) {
  appendFileSync(process.env.FAKE_APP_SERVER_REQUEST_LOG, line + '\\n')
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send({ id: message.id, result: { codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake' } })
  } else if (message.method === 'thread/start') {
    if (serverRequestCollision) {
      send({ id: message.id, method: 'item/commandExecution/requestApproval', params: { command: ['unsafe'], itemId: 'approval-1', threadId: 'thread-1', turnId: 'turn-1' } })
      continue
    }
    send({ id: message.id, result: { thread: { id: 'thread-1' } } })
    send({ method: 'thread/started', params: { thread: { id: 'thread-1' } } })
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1' } } })
    send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' }, turnId: 'turn-1' } })
    send({ method: 'item/started', params: { threadId: 'thread-1', turnId: 'turn-1', item: {
      command: 'openpencil board build --request-id request-1', id: 'command-1', status: 'inProgress', type: 'commandExecution'
    } } })
  } else if (message.method === 'turn/interrupt') {
    send({ id: message.id, result: {} })
    if (postReleaseResponse) {
      send({ method: 'rawResponse/completed', params: { responseId: 'response-after-release', threadId: 'thread-1', turnId: 'turn-1', usage: null } })
    }
    send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: {
      last: { cacheWriteInputTokens: 3, cachedInputTokens: 70, inputTokens: 100, outputTokens: 15, reasoningOutputTokens: 5, totalTokens: 115 },
      total: { ...(missingCacheWriteUsage ? {} : { cacheWriteInputTokens: 3 }), cachedInputTokens: 70, inputTokens: 100, outputTokens: 15, reasoningOutputTokens: 5, totalTokens: 115 }
    } } })
    send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } })
  }
}
`,
    'utf8'
  )
  await chmod(binary, 0o755)
  return { binary, requestLog }
}

function startInput() {
  return {
    cwd: tmpdir(),
    ephemeral: true,
    model: 'gpt-test',
    prompt: 'Build it.',
    reasoningEffort: 'high' as const,
    sandbox: 'workspace-write' as const,
    serviceTier: 'priority' as const
  }
}

describe('isolated Codex app-server straight-through transport', () => {
  test('interrupts the exact turn and drains exact total usage without another response', async () => {
    const fake = await fakeAppServer()
    const rawLines: string[] = []
    const projected: ProjectedCodexJsonEvent[] = []
    const session: CodexAppServerSession = new CodexAppServerSession({
      binary: fake.binary,
      cwd: tmpdir(),
      env: { ...process.env, FAKE_APP_SERVER_REQUEST_LOG: fake.requestLog },
      onNotification(notification) {
        projected.push(...projectCodexAppServerNotification(notification, session.latestUsage))
      },
      onRawLine(line) {
        rawLines.push(line)
      }
    })

    await expect(session.start(startInput())).resolves.toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1'
    })
    session.freezeReleaseBoundary()
    const drain = await session.interruptAndDrain(500)
    const exit = await session.close()

    expect(drain).toMatchObject({
      post_release_boundary_basis: 'emitted_at_ms_with_observation_fallback',
      post_release_raw_response_count: 0,
      turn_completed: true,
      turn_status: 'interrupted',
      usage: {
        cache_write_input_tokens: 3,
        cached_input_tokens: 70,
        input_tokens: 100,
        output_tokens: 15,
        reasoning_output_tokens: 5,
        total_tokens: 115,
        uncached_input_tokens: 30
      },
      usage_unavailable_reason: null
    })
    expect(drain.turn_completed_observed_at_ms).toBeNumber()
    expect(drain.turn_completed_observed_monotonic_ms).toBeNumber()
    expect(projected).toContainEqual({ type: 'thread.started', thread_id: 'thread-1' })
    expect(projected).toContainEqual({ type: 'turn.started' })
    expect(projected).toContainEqual({
      item: {
        aggregated_output: '',
        command: 'openpencil board build --request-id request-1',
        exit_code: null,
        id: 'command-1',
        status: 'inProgress',
        type: 'command_execution'
      },
      type: 'item.started'
    })
    expect(projected.at(-1)).toEqual({
      type: 'turn.completed',
      usage: {
        cache_write_input_tokens: 3,
        cached_input_tokens: 70,
        input_tokens: 100,
        output_tokens: 15,
        reasoning_output_tokens: 5,
        total_tokens: 115,
        uncached_input_tokens: 30
      }
    })
    expect(rawLines.some((line) => line.includes('thread/tokenUsage/updated'))).toBeTrue()
    expect(exit).toEqual({ code: 0, signal: null })
    const requests = (await Bun.file(fake.requestLog).text())
      .trim()
      .split(/\n/u)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(requests.find(({ method }) => method === 'thread/start')).toMatchObject({
      params: { approvalPolicy: 'never', sandbox: 'workspace-write' }
    })
    expect(requests.find(({ method }) => method === 'initialize')).toMatchObject({
      params: { capabilities: { experimentalApi: true, requestAttestation: false } }
    })
    expect(requests.find(({ method }) => method === 'turn/start')).toMatchObject({
      params: {
        sandboxPolicy: {
          excludeSlashTmp: false,
          excludeTmpdirEnvVar: false,
          networkAccess: false,
          type: 'workspaceWrite',
          writableRoots: [tmpdir()]
        }
      }
    })
    expect(requests.find(({ method }) => method === 'turn/interrupt')).toMatchObject({
      params: { threadId: 'thread-1', turnId: 'turn-1' }
    })
  })

  test('detects a raw model response emitted after the release boundary', async () => {
    const fake = await fakeAppServer({ postReleaseResponse: true })
    const notifications: CodexAppServerNotification[] = []
    const session = new CodexAppServerSession({
      binary: fake.binary,
      cwd: tmpdir(),
      env: { ...process.env, FAKE_APP_SERVER_REQUEST_LOG: fake.requestLog },
      onNotification(value) {
        notifications.push(value)
      }
    })
    await session.start(startInput())
    session.freezeReleaseBoundary()
    const drain = await session.interruptAndDrain(500)
    await session.close()

    expect(drain.post_release_raw_response_count).toBe(1)
    expect(notifications.some(({ method }) => method === 'rawResponse/completed')).toBeTrue()
  })

  test('does not invent missing exact usage fields', async () => {
    const fake = await fakeAppServer({ missingCacheWriteUsage: true })
    const session = new CodexAppServerSession({
      binary: fake.binary,
      cwd: tmpdir(),
      env: { ...process.env, FAKE_APP_SERVER_REQUEST_LOG: fake.requestLog }
    })
    await session.start(startInput())
    session.freezeReleaseBoundary()
    const drain = await session.interruptAndDrain(500)
    await session.close()

    expect(drain.usage).toBeNull()
    expect(drain.usage_unavailable_reason).toContain('without a final exact thread token usage')
  })

  test('fails closed on a colliding bidirectional server request', async () => {
    const fake = await fakeAppServer({ serverRequestCollision: true })
    const session = new CodexAppServerSession({
      binary: fake.binary,
      cwd: tmpdir(),
      env: { ...process.env, FAKE_APP_SERVER_REQUEST_LOG: fake.requestLog }
    })

    await expect(session.start(startInput())).rejects.toThrow(
      'Unsupported Codex app-server request: item/commandExecution/requestApproval.'
    )
    await session.close()
    const requests = (await Bun.file(fake.requestLog).text())
      .trim()
      .split(/\n/u)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(requests).toContainEqual({
      error: {
        code: -32601,
        message:
          'OpenPencil evaluator does not support app-server request item/commandExecution/requestApproval.'
      },
      id: 2
    })
  })
})
