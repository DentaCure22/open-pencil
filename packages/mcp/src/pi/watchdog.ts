import type { AgentConversationThread } from '#mcp/agent-router/contracts'

import { isRecord, type PiSession } from './router-state'

const DEFAULT_STALL_TIMEOUT_MS = 15 * 60_000
const DEFAULT_WATCHDOG_PROBE_MS = 30_000

type PiSessionWatchdogHooks = {
  applyState(thread: AgentConversationThread, value: unknown): void
  isCurrent(thread: AgentConversationThread, session: PiSession): boolean
  onFailure(thread: AgentConversationThread, session: PiSession, detail: string): void
  onIdle(thread: AgentConversationThread, session: PiSession): void
}

export class PiSessionWatchdog {
  readonly intervalMs: number
  private readonly probeMs: number
  private readonly stallMs: number

  constructor(
    config: { stallTimeoutMs?: number; watchdogProbeMs?: number },
    private readonly hooks: PiSessionWatchdogHooks
  ) {
    this.probeMs = Math.max(10, config.watchdogProbeMs ?? DEFAULT_WATCHDOG_PROBE_MS)
    this.stallMs = Math.max(this.probeMs, config.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS)
    this.intervalMs = Math.min(8_000, this.probeMs)
  }

  tick(thread: AgentConversationThread, session: PiSession, now: number): void {
    if (
      session.recovering ||
      session.settling ||
      session.probeInFlight ||
      !session.activeJobId ||
      !this.hooks.isCurrent(thread, session)
    ) {
      return
    }
    const silentFor = now - session.lastEventAt
    if (silentFor >= this.stallMs) {
      this.hooks.onFailure(
        thread,
        session,
        `Pi was stopped after ${String(Math.round(silentFor / 1_000))}s without activity. Its saved session is ready to resume.`
      )
      return
    }
    if (silentFor < this.probeMs) return
    session.probeInFlight = true
    void session.process
      .command({ type: 'get_state' }, Math.min(5_000, Math.max(100, this.probeMs)))
      .then((response) => {
        if (!response.success) {
          throw new Error(response.error || 'Pi did not answer its liveness probe.')
        }
        if (this.hooks.isCurrent(thread, session) && session.activeJobId) {
          session.lastProbeAt = Date.now()
          this.hooks.applyState(thread, response.data)
          if (isRecord(response.data) && response.data.isStreaming === false) {
            this.hooks.onIdle(thread, session)
          }
        }
        return undefined
      })
      .catch(() => {
        this.hooks.onFailure(
          thread,
          session,
          'Pi stopped responding. Its saved session is ready to resume.'
        )
      })
      .finally(() => {
        session.probeInFlight = false
      })
  }
}
