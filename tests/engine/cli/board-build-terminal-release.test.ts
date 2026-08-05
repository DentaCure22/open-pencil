import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'

import { boardBuildReleaseEnvelope } from '#cli/board-build/release'
import {
  BOARD_BUILD_RELEASE_NONCE_ENV,
  BOARD_BUILD_RELEASE_SOCKET_ENV,
  BOARD_BUILD_RELEASE_TIMEOUT_ENV,
  BOARD_BUILD_RELEASE_WATCHDOG_ENV,
  tryTerminalBoardBuildRelease,
  type BoardBuildTerminalReleaseRequest
} from '#cli/board-build/terminal-release'

const target = {
  boardRevision: 42,
  contentDocumentId: 'content:1',
  documentId: 'tab:1',
  documentName: 'Product work',
  pageId: 'page:1',
  pageName: 'Launch map',
  runtimeInstanceId: 'runtime:1',
  workspaceId: 'workspace:1'
}

type ReleaseServer = {
  close: () => Promise<void>
  requests: BoardBuildTerminalReleaseRequest[]
  socketPath: string
}

const releaseServers: ReleaseServer[] = []

function readyRelease() {
  return boardBuildReleaseEnvelope(
    {
      owner_id: 'node:1',
      persistence: { authority_revision: 42, status: 'durable' },
      proof: { durable_readback: 'passed' },
      readback: { card: { id: 'node:1' } },
      receipt: { appliedRevision: 42, requestId: 'request:1', status: 'applied' },
      status: { command: 'completed', mutation: 'applied' },
      timing: { total_ms: 20 }
    },
    target
  )
}

function stoppedRelease() {
  return boardBuildReleaseEnvelope(
    {
      status: { command: 'refused', mutation: 'not_applied', reason: 'invalid_plan' }
    },
    target
  )
}

async function closeServer(server: Server, sockets: Set<Socket>, socketPath: string) {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve()
    })
  })
  await rm(socketPath, { force: true })
}

async function startReleaseServer(
  reply: (request: BoardBuildTerminalReleaseRequest, socket: Socket) => void
): Promise<ReleaseServer> {
  const socketPath = `/tmp/openpencil-release-${process.pid}-${crypto.randomUUID()}.sock`
  const requests: BoardBuildTerminalReleaseRequest[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    let input = ''
    socket.on('data', (chunk: string) => {
      input += chunk
      const newline = input.indexOf('\n')
      if (newline === -1) return
      const request = JSON.parse(input.slice(0, newline)) as BoardBuildTerminalReleaseRequest
      requests.push(request)
      reply(request, socket)
    })
    socket.once('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  const releaseServer = {
    close: () => closeServer(server, sockets, socketPath),
    requests,
    socketPath
  }
  releaseServers.push(releaseServer)
  return releaseServer
}

function releaseEnvironment(socketPath: string, nonce = 'nonce:one'): NodeJS.ProcessEnv {
  return {
    [BOARD_BUILD_RELEASE_NONCE_ENV]: nonce,
    [BOARD_BUILD_RELEASE_SOCKET_ENV]: socketPath,
    [BOARD_BUILD_RELEASE_TIMEOUT_ENV]: '100'
  }
}

async function waitForRequest(requests: BoardBuildTerminalReleaseRequest[]): Promise<void> {
  const deadline = performance.now() + 1_000
  while (requests.length === 0 && performance.now() < deadline) await Bun.sleep(10)
  if (requests.length === 0) throw new Error('Terminal release request did not arrive.')
}

afterEach(async () => {
  await Promise.all(releaseServers.splice(0).map((server) => server.close()))
})

describe('Board build terminal release', () => {
  test('is disabled unless both an absolute socket path and nonce are configured', async () => {
    expect(await tryTerminalBoardBuildRelease(readyRelease(), { env: {} })).toBe('fallback')
    expect(
      await tryTerminalBoardBuildRelease(readyRelease(), {
        env: {
          [BOARD_BUILD_RELEASE_NONCE_ENV]: 'nonce:one',
          [BOARD_BUILD_RELEASE_SOCKET_ENV]: 'relative.sock'
        }
      })
    ).toBe('fallback')
  })

  test('turns a synchronous socket-path failure into normal fallback', async () => {
    expect(
      await tryTerminalBoardBuildRelease(readyRelease(), {
        env: releaseEnvironment('/tmp/openpencil\0release.sock')
      })
    ).toBe('fallback')
  })

  test('holds the child with no stdout after explicit acceptance until its supervisor terminates it', async () => {
    const server = await startReleaseServer((request, socket) => {
      socket.write(
        `${JSON.stringify({
          contract: 'board-build-terminal-release/v1',
          decision: 'accept',
          nonce: request.nonce
        })}\n`
      )
    })
    const moduleUrl = new URL(
      '../../../packages/cli/src/board-build/terminal-release.ts',
      import.meta.url
    ).href
    const child = spawn(
      process.execPath,
      [
        '-e',
        `import { tryTerminalBoardBuildRelease } from ${JSON.stringify(moduleUrl)};
await tryTerminalBoardBuildRelease({ release_summary: { status: 'ready' } });
process.stdout.write('fallback\\n');`
      ],
      {
        env: {
          ...process.env,
          ...releaseEnvironment(server.socketPath),
          [BOARD_BUILD_RELEASE_WATCHDOG_ENV]: '1000'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let stderr = ''
    let stdout = ''
    child.stderr.setEncoding('utf8')
    child.stdout.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => (stderr += chunk))
    child.stdout.on('data', (chunk: string) => (stdout += chunk))

    await waitForRequest(server.requests)
    await Bun.sleep(50)

    expect(server.requests[0]).toMatchObject({
      contract: 'board-build-terminal-release/v1',
      nonce: 'nonce:one',
      release: { release_summary: { status: 'ready' } }
    })
    expect(child.exitCode).toBeNull()
    expect(stdout).toBe('')
    expect(stderr).toBe('')

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => {
        resolve()
      })
    })
    child.kill('SIGTERM')
    await exited

    expect(stdout).toBe('')
  })

  test('falls back after an explicit fallback or a nonce mismatch', async () => {
    const release = readyRelease()
    const fallbackServer = await startReleaseServer((request, socket) => {
      socket.end(
        `${JSON.stringify({
          contract: 'board-build-terminal-release/v1',
          decision: 'fallback',
          nonce: request.nonce
        })}\n`
      )
    })
    expect(
      await tryTerminalBoardBuildRelease(release, {
        env: releaseEnvironment(fallbackServer.socketPath)
      })
    ).toBe('fallback')
    expect(fallbackServer.requests[0]?.release).toEqual(release)

    const wrongNonceServer = await startReleaseServer((_request, socket) => {
      socket.end(
        `${JSON.stringify({
          contract: 'board-build-terminal-release/v1',
          decision: 'accept',
          nonce: 'nonce:wrong'
        })}\n`
      )
    })
    expect(
      await tryTerminalBoardBuildRelease(readyRelease(), {
        env: releaseEnvironment(wrongNonceServer.socketPath)
      })
    ).toBe('fallback')
  })

  test('falls back within the configured bound when the receiver never acknowledges', async () => {
    const server = await startReleaseServer(() => undefined)
    const startedAt = performance.now()

    const outcome = await tryTerminalBoardBuildRelease(readyRelease(), {
      env: {
        ...releaseEnvironment(server.socketPath),
        [BOARD_BUILD_RELEASE_TIMEOUT_ENV]: '20'
      }
    })

    expect(outcome).toBe('fallback')
    expect(performance.now() - startedAt).toBeLessThan(500)
    expect(server.requests).toHaveLength(1)
  })

  test('falls back when an accepting supervisor misses its termination watchdog', async () => {
    const server = await startReleaseServer((request, socket) => {
      socket.write(
        `${JSON.stringify({
          contract: 'board-build-terminal-release/v1',
          decision: 'accept',
          nonce: request.nonce
        })}\n`
      )
    })
    const startedAt = performance.now()

    const outcome = await tryTerminalBoardBuildRelease(readyRelease(), {
      env: {
        ...releaseEnvironment(server.socketPath),
        [BOARD_BUILD_RELEASE_WATCHDOG_ENV]: '100'
      }
    })

    expect(outcome).toBe('fallback')
    expect(performance.now() - startedAt).toBeLessThan(500)
    expect(server.requests).toHaveLength(1)
  })

  test('never opens the socket for a non-ready release', async () => {
    const server = await startReleaseServer(() => undefined)

    expect(
      await tryTerminalBoardBuildRelease(stoppedRelease(), {
        env: releaseEnvironment(server.socketPath)
      })
    ).toBe('fallback')
    expect(server.requests).toHaveLength(0)
  })
})
