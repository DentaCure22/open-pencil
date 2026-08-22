import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'

const COMMAND_TIMEOUT_MS = 15_000

export type PiRpcRecord = Record<string, unknown> & { type: string }

export type PiRpcResponse = PiRpcRecord & {
  command: string
  error?: string
  id?: string
  success: boolean
  type: 'response'
}

type ResponseWaiter = {
  reject(error: Error): void
  resolve(response: PiRpcResponse): void
  timer: ReturnType<typeof setTimeout>
}

export type PiRpcProcessOptions = {
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  executable: string
  onEvent(event: PiRpcRecord): void
  onExit(code: number | null, signal: NodeJS.Signals | null, stderr: string): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function rpcRecord(line: string): PiRpcRecord | null {
  try {
    const value = JSON.parse(line) as unknown
    if (!isRecord(value) || typeof value.type !== 'string') return null
    return value as PiRpcRecord
  } catch {
    return null
  }
}

function rpcResponse(event: PiRpcRecord): PiRpcResponse | null {
  if (
    event.type !== 'response' ||
    typeof event.command !== 'string' ||
    typeof event.success !== 'boolean'
  ) {
    return null
  }
  return event as PiRpcResponse
}

export class PiRpcProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly decoder = new StringDecoder('utf8')
  private readonly responseWaiters = new Map<string, ResponseWaiter>()
  private closing = false
  private pending = ''
  private stderr = ''

  private constructor(private readonly options: PiRpcProcessOptions) {
    this.child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.consume(this.decoder.write(chunk))
    })
    this.child.stdout.once('end', () => {
      this.consume(this.decoder.end(), true)
    })
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-16_000)
    })
    this.child.once('exit', (code, signal) => {
      const detail = this.stderr.trim()
      for (const waiter of this.responseWaiters.values()) {
        clearTimeout(waiter.timer)
        waiter.reject(new Error(detail || 'Pi RPC process exited.'))
      }
      this.responseWaiters.clear()
      options.onExit(code, signal, detail)
    })
  }

  static async start(options: PiRpcProcessOptions): Promise<PiRpcProcess> {
    const process = new PiRpcProcess(options)
    await new Promise<void>((resolve, reject) => {
      process.child.once('spawn', resolve)
      process.child.once('error', reject)
    })
    return process
  }

  get isClosing(): boolean {
    return this.closing
  }

  async command(
    command: Record<string, unknown> & { type: string },
    timeoutMs = COMMAND_TIMEOUT_MS
  ): Promise<PiRpcResponse> {
    const id = typeof command.id === 'string' && command.id ? command.id : randomUUID()
    const response = new Promise<PiRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseWaiters.delete(id)
        reject(new Error(`Pi RPC ${command.type} timed out.`))
      }, timeoutMs)
      timer.unref()
      this.responseWaiters.set(id, { reject, resolve, timer })
    })
    try {
      this.write({ ...command, id })
    } catch (error) {
      const waiter = this.responseWaiters.get(id)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.responseWaiters.delete(id)
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    return response
  }

  write(command: Record<string, unknown> & { type: string }): void {
    if (this.closing || this.child.stdin.destroyed) {
      throw new Error('Pi RPC process is not writable.')
    }
    this.child.stdin.write(`${JSON.stringify(command)}\n`)
  }

  close(): void {
    if (this.closing) return
    this.closing = true
    this.child.kill('SIGTERM')
  }

  private consume(chunk: string, flush = false): void {
    this.pending += chunk
    for (;;) {
      const newline = this.pending.indexOf('\n')
      if (newline === -1) break
      const line = this.pending.slice(0, newline).replace(/\r$/, '')
      this.pending = this.pending.slice(newline + 1)
      this.consumeLine(line)
    }
    if (!flush || !this.pending) return
    const line = this.pending.replace(/\r$/, '')
    this.pending = ''
    this.consumeLine(line)
  }

  private consumeLine(line: string): void {
    const event = rpcRecord(line)
    if (!event) return
    const response = rpcResponse(event)
    if (response?.id) {
      const waiter = this.responseWaiters.get(response.id)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.responseWaiters.delete(response.id)
        waiter.resolve(response)
        return
      }
    }
    this.options.onEvent(event)
  }
}
