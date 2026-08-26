import { randomUUID } from 'node:crypto'
import { chmod, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'

import {
  evaluateStraightThroughEligibility,
  planStraightThroughRelease,
  type StraightThroughFinalPlan,
  type StraightThroughRunInput
} from './straight-through'

const REQUEST_MAX_BYTES = 2 * 1024 * 1024

export const TERMINAL_RELEASE_SOCKET_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_SOCKET'
export const TERMINAL_RELEASE_NONCE_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_NONCE'
export const TERMINAL_RELEASE_TIMEOUT_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_TIMEOUT_MS'
export const TERMINAL_RELEASE_WATCHDOG_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_WATCHDOG_MS'

interface TerminalReleaseRequest {
  contract: 'board-build-terminal-release/v1'
  nonce: string
  release: unknown
}

export interface StraightThroughReleaseAcceptance {
  envelope: unknown
  observed_at_ms: number
  observed_monotonic_ms: number
  plan: StraightThroughFinalPlan
}

export interface StraightThroughReleaseSupervisor {
  acceptance: Promise<StraightThroughReleaseAcceptance | null>
  attachProcessGroup(pid: number): void
  close(): Promise<void>
  env: Record<string, string>
}

export interface StraightThroughReleaseSupervisorOptions {
  canAccept: () => boolean
  input: StraightThroughRunInput
  platform?: NodeJS.Platform
}

function request(value: unknown): TerminalReleaseRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (
    Reflect.get(value, 'contract') !== 'board-build-terminal-release/v1' ||
    typeof Reflect.get(value, 'nonce') !== 'string'
  ) {
    return null
  }
  return {
    contract: 'board-build-terminal-release/v1',
    nonce: Reflect.get(value, 'nonce'),
    release: Reflect.get(value, 'release')
  }
}

function acknowledgement(nonce: string, decision: 'accept' | 'fallback'): string {
  return `${JSON.stringify({
    contract: 'board-build-terminal-release/v1',
    decision,
    nonce
  })}\n`
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  await chmod(socketPath, 0o600)
}

async function waitUntilAcceptable(canAccept: () => boolean): Promise<boolean> {
  const deadline = performance.now() + 500
  while (!canAccept() && performance.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
  }
  return canAccept()
}

export async function createStraightThroughReleaseSupervisor(
  options: StraightThroughReleaseSupervisorOptions
): Promise<StraightThroughReleaseSupervisor | null> {
  if ((options.platform ?? process.platform) === 'win32') return null
  if (evaluateStraightThroughEligibility(options.input).status !== 'eligible') return null

  const nonce = randomUUID()
  const socketPath = `/tmp/openpencil-ptb-${process.pid}-${randomUUID().slice(0, 8)}.sock`
  const sockets = new Set<Socket>()
  let processGroupPid: number | null = null
  let handled = false
  let closed = false
  let resolveAcceptance: (value: StraightThroughReleaseAcceptance | null) => void = () => undefined
  const acceptance = new Promise<StraightThroughReleaseAcceptance | null>((resolve) => {
    resolveAcceptance = resolve
  })

  const server = createServer((socket) => {
    sockets.add(socket)
    socket.setEncoding('utf8')
    let input = ''

    const fallback = () => {
      if (!socket.destroyed) socket.end(acknowledgement(nonce, 'fallback'))
    }

    socket.on('data', (chunk: string) => {
      if (handled) return
      input += chunk
      if (Buffer.byteLength(input, 'utf8') > REQUEST_MAX_BYTES) {
        handled = true
        fallback()
        return
      }
      const newline = input.indexOf('\n')
      if (newline === -1) return
      handled = true
      let parsed: unknown
      try {
        parsed = JSON.parse(input.slice(0, newline))
      } catch {
        fallback()
        return
      }
      const candidate = request(parsed)
      if (!candidate || candidate.nonce !== nonce || !processGroupPid) {
        fallback()
        return
      }
      const pid = processGroupPid
      void (async () => {
        if (!(await waitUntilAcceptable(options.canAccept)) || socket.destroyed) {
          fallback()
          return
        }
        const release = planStraightThroughRelease({
          ...options.input,
          envelope: candidate.release
        })
        if (release.status !== 'release') {
          fallback()
          return
        }
        try {
          process.kill(-pid, 0)
        } catch {
          fallback()
          return
        }
        socket.write(acknowledgement(nonce, 'accept'), (error) => {
          if (error) {
            socket.destroy()
            return
          }
          const observedAtMs = Date.now()
          const observedMonotonicMs = performance.now()
          resolveAcceptance({
            envelope: candidate.release,
            observed_at_ms: observedAtMs,
            observed_monotonic_ms: observedMonotonicMs,
            plan: release.plan
          })
        })
      })()
    })
    socket.once('error', () => undefined)
    socket.once('close', () => sockets.delete(socket))
  })

  try {
    await listen(server, socketPath)
  } catch (error) {
    server.close()
    await rm(socketPath, { force: true })
    throw error
  }

  return {
    acceptance,
    attachProcessGroup(pid) {
      if (!Number.isInteger(pid) || pid <= 0 || processGroupPid !== null) {
        throw new Error('Straight-through release supervisor requires one positive process PID.')
      }
      processGroupPid = pid
    },
    async close() {
      if (closed) return
      closed = true
      resolveAcceptance(null)
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      await rm(socketPath, { force: true })
    },
    env: {
      [TERMINAL_RELEASE_NONCE_ENV]: nonce,
      [TERMINAL_RELEASE_SOCKET_ENV]: socketPath,
      [TERMINAL_RELEASE_TIMEOUT_ENV]: '1000',
      [TERMINAL_RELEASE_WATCHDOG_ENV]: '5000'
    }
  }
}
