import { randomUUID } from 'node:crypto'

import { piRpcArguments } from './arguments'
import { PiRpcProcess, type PiRpcRecord } from './rpc-process'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

const MAX_WARM_POOL_SIZE = 4
const DEFAULT_WARM_POOL_SIZE = 1

export type PiWarmProcess = {
  effort: string
  model: string
  poolSessionId: string
  process: PiRpcProcess
  sessionId: string
  state: unknown
}

export type PiProcessPoolOptions = {
  cwd: string
  effort: string
  env: NodeJS.ProcessEnv
  envForSession?: (sessionId: string) => NodeJS.ProcessEnv
  executable: string
  mcpConfigPath?: string
  model: string
  sessionDir?: string
  size?: number
}

export function resolveWarmPoolSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_WARM_POOL_SIZE
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_WARM_POOL_SIZE, Math.trunc(value)))
}

export class PiProcessPool {
  private closed = false
  private readonly filling = new Set<Promise<void>>()
  private readonly options: PiProcessPoolOptions & { size: number }
  private readonly ready: PiWarmProcess[] = []

  constructor(options: PiProcessPoolOptions) {
    this.options = {
      ...options,
      size: resolveWarmPoolSize(options.size)
    }
  }

  get readyCount(): number {
    return this.ready.length
  }

  ensure(): void {
    if (this.closed) return
    const needed = this.options.size - this.ready.length - this.filling.size
    for (let index = 0; index < needed; index += 1) this.queueFill()
  }

  async claim(): Promise<PiWarmProcess | null> {
    if (this.closed || this.options.size <= 0) return null
    const available = this.takeReady()
    if (available) {
      this.ensure()
      return available
    }
    if (this.filling.size === 0) this.ensure()
    const pending = this.filling.values().next().value
    if (!pending) return null
    await pending
    const claimed = this.takeReady()
    if (claimed) this.ensure()
    return claimed
  }

  async waitUntilReady(count = 1, timeoutMs = 3_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    this.ensure()
    while (this.ready.length < count) {
      if (this.closed || Date.now() >= deadline) return false
      const pending = this.filling.values().next().value
      if (!pending) return this.ready.length >= count
      await pending
    }
    return true
  }

  close(): void {
    this.closed = true
    for (const item of this.ready) item.process.close()
    this.ready.length = 0
  }

  private takeReady(): PiWarmProcess | null {
    while (this.ready.length) {
      const item = this.ready.pop()
      if (item?.process.isAlive) return item
    }
    return null
  }

  private queueFill(): void {
    const task = this.fillOne().finally(() => {
      this.filling.delete(task)
    })
    this.filling.add(task)
  }

  private async fillOne(): Promise<void> {
    if (this.closed) return
    const sessionId = randomUUID()
    const args = piRpcArguments({
      effort: this.options.effort,
      ...(this.options.mcpConfigPath ? { mcpConfigPath: this.options.mcpConfigPath } : {}),
      mode: 'new',
      model: this.options.model,
      ...(this.options.sessionDir ? { sessionDir: this.options.sessionDir } : {}),
      sessionId
    })
    let rpc: PiRpcProcess | null = null
    try {
      rpc = await PiRpcProcess.start({
        args,
        cwd: this.options.cwd,
        env: this.options.envForSession?.(sessionId) ?? this.options.env,
        executable: this.options.executable,
        onEvent: (event) => this.handleIdleEvent(rpc, event),
        onExit: () => this.handleIdleExit(rpc)
      })
      if (this.closed) {
        rpc.close()
        return
      }
      const state = await rpc.command({ type: 'get_state' })
      if (this.closed || !state.success || !rpc.isAlive) {
        rpc.close()
        return
      }
      this.ready.push({
        effort: this.options.effort,
        model: this.options.model,
        poolSessionId: sessionId,
        process: rpc,
        sessionId:
          isRecord(state.data) && typeof state.data.sessionId === 'string'
            ? state.data.sessionId
            : sessionId,
        state: state.data
      })
    } catch {
      rpc?.close()
    }
  }

  private handleIdleEvent(rpc: PiRpcProcess | null, event: PiRpcRecord): void {
    if (!rpc || !this.owns(rpc)) return
    if (event.type !== 'extension_ui_request' || typeof event.id !== 'string') return
    try {
      rpc.write({ cancelled: true, id: event.id, type: 'extension_ui_response' })
    } catch {
      rpc.close()
    }
  }

  private handleIdleExit(rpc: PiRpcProcess | null): void {
    if (!rpc) return
    const index = this.ready.findIndex((item) => item.process === rpc)
    if (index === -1) return
    this.ready.splice(index, 1)
    if (!this.closed) this.ensure()
  }

  private owns(rpc: PiRpcProcess): boolean {
    return this.ready.some((item) => item.process === rpc)
  }
}
