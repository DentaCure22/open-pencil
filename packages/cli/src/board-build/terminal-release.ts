import { createConnection } from 'node:net'
import { isAbsolute } from 'node:path'

import type { BoardBuildReleaseEnvelope } from '#cli/board-build/release'

export const BOARD_BUILD_RELEASE_SOCKET_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_SOCKET'
export const BOARD_BUILD_RELEASE_NONCE_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_NONCE'
export const BOARD_BUILD_RELEASE_TIMEOUT_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_TIMEOUT_MS'
export const BOARD_BUILD_RELEASE_WATCHDOG_ENV = 'OPENPENCIL_BOARD_BUILD_RELEASE_WATCHDOG_MS'

const ACK_MAX_BYTES = 8 * 1024
const DEFAULT_TIMEOUT_MS = 250
const DEFAULT_WATCHDOG_MS = 5_000
const MAX_TIMEOUT_MS = 2_000
const MAX_WATCHDOG_MS = 30_000
const MIN_TIMEOUT_MS = 10
const MIN_WATCHDOG_MS = 100

export type BoardBuildTerminalReleaseOutcome = 'fallback'

export type BoardBuildTerminalReleaseRequest = {
  contract: 'board-build-terminal-release/v1'
  nonce: string
  release: BoardBuildReleaseEnvelope
}

type BoardBuildTerminalReleaseAcknowledgement = {
  contract: 'board-build-terminal-release/v1'
  decision: 'accept' | 'fallback'
  nonce: string
}

type TerminalReleaseConfig = {
  acknowledgementTimeoutMs: number
  nonce: string
  socketPath: string
  watchdogMs: number
}

type TerminalReleaseOptions = {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

function positiveBoundedTimeout(
  value: string | undefined,
  defaults: { fallback: number; maximum: number; minimum: number }
): number {
  if (value === undefined) return defaults.fallback
  const timeout = Number(value)
  if (!Number.isFinite(timeout) || !Number.isInteger(timeout)) return defaults.fallback
  return Math.min(defaults.maximum, Math.max(defaults.minimum, timeout))
}

function terminalReleaseConfig(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): TerminalReleaseConfig | null {
  if (platform === 'win32') return null
  const socketPath = env[BOARD_BUILD_RELEASE_SOCKET_ENV]?.trim()
  const nonce = env[BOARD_BUILD_RELEASE_NONCE_ENV]?.trim()
  if (
    !socketPath ||
    !isAbsolute(socketPath) ||
    socketPath.includes('\0') ||
    !nonce ||
    nonce.length > 1_024
  ) {
    return null
  }
  return {
    acknowledgementTimeoutMs: positiveBoundedTimeout(env[BOARD_BUILD_RELEASE_TIMEOUT_ENV], {
      fallback: DEFAULT_TIMEOUT_MS,
      maximum: MAX_TIMEOUT_MS,
      minimum: MIN_TIMEOUT_MS
    }),
    nonce,
    socketPath,
    watchdogMs: positiveBoundedTimeout(env[BOARD_BUILD_RELEASE_WATCHDOG_ENV], {
      fallback: DEFAULT_WATCHDOG_MS,
      maximum: MAX_WATCHDOG_MS,
      minimum: MIN_WATCHDOG_MS
    })
  }
}

function parseAcknowledgement(
  value: string,
  nonce: string
): BoardBuildTerminalReleaseAcknowledgement | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (
    !('contract' in parsed) ||
    parsed.contract !== 'board-build-terminal-release/v1' ||
    !('nonce' in parsed) ||
    parsed.nonce !== nonce ||
    !('decision' in parsed) ||
    (parsed.decision !== 'accept' && parsed.decision !== 'fallback')
  ) {
    return null
  }
  return parsed as BoardBuildTerminalReleaseAcknowledgement
}

/**
 * Gives an opt-in local supervisor one bounded opportunity to consume the final
 * authoritative release before normal CLI stdout. A validated acceptance holds
 * the process until its supervisor terminates it; only fallback resolves. This
 * function never retries, mutates the Board, or turns transport failure into a
 * command failure.
 */
export async function tryTerminalBoardBuildRelease(
  release: BoardBuildReleaseEnvelope,
  options: TerminalReleaseOptions = {}
): Promise<BoardBuildTerminalReleaseOutcome> {
  if (release.release_summary.status !== 'ready') return 'fallback'
  const config = terminalReleaseConfig(
    options.env ?? process.env,
    options.platform ?? process.platform
  )
  if (!config) return 'fallback'

  const request: BoardBuildTerminalReleaseRequest = {
    contract: 'board-build-terminal-release/v1',
    nonce: config.nonce,
    release
  }
  let requestLine: string
  try {
    requestLine = `${JSON.stringify(request)}\n`
  } catch {
    return 'fallback'
  }

  /* oxlint-disable promise/no-multiple-resolved -- all socket races use the guarded settle path */
  try {
    return await new Promise((resolve) => {
      let acknowledgement = ''
      let accepted = false
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const socket = createConnection({ path: config.socketPath })
      socket.setEncoding('utf8')

      const settle = (outcome: BoardBuildTerminalReleaseOutcome) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        socket.destroy()
        resolve(outcome)
      }
      const armFallback = (milliseconds: number) => {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => settle('fallback'), milliseconds)
      }
      armFallback(config.acknowledgementTimeoutMs)

      socket.once('connect', () => {
        try {
          socket.write(requestLine)
        } catch {
          settle('fallback')
        }
      })
      socket.on('data', (chunk: string) => {
        if (accepted) return
        acknowledgement += chunk
        if (Buffer.byteLength(acknowledgement) > ACK_MAX_BYTES) {
          settle('fallback')
          return
        }
        const newline = acknowledgement.indexOf('\n')
        if (newline === -1) return
        const parsed = parseAcknowledgement(acknowledgement.slice(0, newline), config.nonce)
        if (parsed?.decision !== 'accept') {
          settle('fallback')
          return
        }
        accepted = true
        armFallback(config.watchdogMs)
      })
      socket.once('error', () => settle('fallback'))
      socket.once('close', () => settle('fallback'))
    })
  } catch {
    return 'fallback'
  }
  /* oxlint-enable promise/no-multiple-resolved */
}
