import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const MAX_CHUNKS = 800
const MAX_SESSIONS = 12
const IDLE_TTL_MS = 30 * 60 * 1_000

export type WorkspaceTerminalChunk = {
  sequence: number
  stream: 'stderr' | 'stdout'
  text: string
}

export type WorkspaceTerminalSnapshot = {
  chunks: WorkspaceTerminalChunk[]
  id: string
  running: boolean
}

type WorkspaceTerminalSession = {
  chunks: WorkspaceTerminalChunk[]
  id: string
  lastUsedAt: number
  process: ChildProcessWithoutNullStreams
  running: boolean
  sequence: number
}

function defaultShell(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { args: ['-NoLogo', '-NoProfile'], command: 'powershell.exe' }
  }
  return { args: ['-l'], command: process.env.SHELL || '/bin/sh' }
}

export class WorkspaceTerminalSessions {
  readonly #sessions = new Map<string, WorkspaceTerminalSession>()

  create(workspaceRoot: string): WorkspaceTerminalSnapshot {
    this.#prune()
    if (this.#sessions.size >= MAX_SESSIONS) {
      const oldest = [...this.#sessions.values()].sort(
        (left, right) => left.lastUsedAt - right.lastUsedAt
      ).at(0)
      if (oldest) this.close(oldest.id)
    }
    const id = randomUUID()
    const shell = defaultShell()
    const child = spawn(shell.command, shell.args, {
      cwd: workspaceRoot,
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const session: WorkspaceTerminalSession = {
      chunks: [],
      id,
      lastUsedAt: Date.now(),
      process: child,
      running: true,
      sequence: 0
    }
    this.#sessions.set(id, session)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (text: string) => this.#append(session, 'stdout', text))
    child.stderr.on('data', (text: string) => this.#append(session, 'stderr', text))
    child.once('exit', (code, signal) => {
      session.running = false
      const detail = signal ? `signal ${signal}` : `code ${String(code ?? 0)}`
      this.#append(session, 'stderr', `\n[process exited with ${detail}]\n`)
    })
    child.once('error', (error) => {
      session.running = false
      this.#append(session, 'stderr', `\n[terminal error: ${error.message}]\n`)
    })
    return this.read(id)
  }

  read(id: string, after = 0): WorkspaceTerminalSnapshot {
    const session = this.#required(id)
    session.lastUsedAt = Date.now()
    return {
      chunks: session.chunks.filter((chunk) => chunk.sequence > after),
      id,
      running: session.running
    }
  }

  write(id: string, data: string): WorkspaceTerminalSnapshot {
    const session = this.#required(id)
    if (!session.running || !session.process.stdin.writable) throw new Error('Terminal is closed')
    session.lastUsedAt = Date.now()
    session.process.stdin.write(data)
    return this.read(id)
  }

  close(id: string): boolean {
    const session = this.#sessions.get(id)
    if (!session) return false
    this.#sessions.delete(id)
    session.running = false
    session.process.stdin.end()
    session.process.kill('SIGTERM')
    return true
  }

  #append(
    session: WorkspaceTerminalSession,
    stream: WorkspaceTerminalChunk['stream'],
    text: string
  ) {
    if (!text) return
    session.sequence += 1
    session.chunks.push({ sequence: session.sequence, stream, text })
    if (session.chunks.length > MAX_CHUNKS) {
      session.chunks.splice(0, session.chunks.length - MAX_CHUNKS)
    }
  }

  #prune() {
    const oldest = Date.now() - IDLE_TTL_MS
    for (const [id, session] of this.#sessions) {
      if (session.lastUsedAt < oldest) this.close(id)
    }
  }

  #required(id: string): WorkspaceTerminalSession {
    this.#prune()
    const session = this.#sessions.get(id)
    if (!session) throw new Error('Terminal session not found')
    return session
  }
}
