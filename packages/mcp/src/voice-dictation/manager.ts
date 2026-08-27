import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseVoiceDictationContext } from './context'

export type AgyVoiceDictationPhase =
  | 'cancelled'
  | 'connecting'
  | 'error'
  | 'finishing'
  | 'ready'
  | 'recording'
  | 'starting'

export type AgyVoiceDictationSnapshot = {
  code?: string
  error?: string
  phase: AgyVoiceDictationPhase
  sessionId: string
  transcript: string
  updatedAt: string
}

type HelperEvent = {
  code?: unknown
  error?: unknown
  phase?: unknown
  transcript?: unknown
}

type VoiceSession = {
  micSocket: Socket | null
  pendingAudio: Uint8Array[]
  pendingAudioBytes: number
  process: ChildProcessWithoutNullStreams
  snapshot: AgyVoiceDictationSnapshot
  stderr: string
  stdoutBuffer: string
}

type VoiceManagerOptions = {
  agyBinary?: string
  cwd: string
  helperPath?: string
  historyPath?: string
  pythonBinary?: string
}

const TERMINAL_PHASES = new Set<AgyVoiceDictationPhase>(['cancelled', 'error', 'ready'])
const MAX_DIAGNOSTIC_BYTES = 16_384
const MAX_AUDIO_CHUNK_BYTES = 128 * 1024
const MAX_PENDING_AUDIO_BYTES = 16_000 * 2 * 30
const MAX_RETAINED_SESSIONS = 5

function isPhase(value: unknown): value is AgyVoiceDictationPhase {
  return (
    value === 'cancelled' ||
    value === 'connecting' ||
    value === 'error' ||
    value === 'finishing' ||
    value === 'ready' ||
    value === 'recording' ||
    value === 'starting'
  )
}

function helperPath(): string {
  return fileURLToPath(new URL('./agy-voice-helper.py', import.meta.url))
}

function agyBinary(configured?: string): string {
  const explicit = configured || process.env.AGY_BIN?.trim()
  if (explicit) return explicit
  const localBinary = path.join(homedir(), '.local', 'bin', 'agy')
  return existsSync(localBinary) ? localBinary : 'agy'
}

function clippedDiagnostic(value: string): string {
  return value.length <= MAX_DIAGNOSTIC_BYTES ? value : value.slice(-MAX_DIAGNOSTIC_BYTES)
}

function copySnapshot(snapshot: AgyVoiceDictationSnapshot): AgyVoiceDictationSnapshot {
  return { ...snapshot }
}

export class AgyVoiceDictationManager {
  private readonly sessions = new Map<string, VoiceSession>()
  private readonly micServer: Server
  private readonly micReady: Promise<void>
  private activeSessionId: string | null = null
  private micAddress: string | null = null

  constructor(private readonly options: VoiceManagerOptions) {
    this.micServer = createServer((socket) => this.acceptMicClient(socket))
    this.micReady = new Promise<void>((resolve, reject) => {
      this.micServer.once('error', reject)
      this.micServer.listen(0, '127.0.0.1', () => {
        this.micServer.off('error', reject)
        const address = this.micServer.address()
        if (!address || typeof address === 'string') {
          reject(new Error('Could not open the Antigravity microphone bridge'))
          return
        }
        this.micAddress = `127.0.0.1:${String(address.port)}`
        resolve()
      })
    })
  }

  ready(): Promise<void> {
    return this.micReady
  }

  start(context?: unknown): AgyVoiceDictationSnapshot {
    if (!this.micAddress) throw new Error('Antigravity microphone bridge is not ready')
    const active = this.activeSessionId ? this.sessions.get(this.activeSessionId) : null
    if (active && !TERMINAL_PHASES.has(active.snapshot.phase)) {
      throw new Error('Antigravity voice dictation is already active')
    }

    const sessionId = `agy-voice:${randomUUID()}`
    parseVoiceDictationContext(context)
    const child = spawn(
      this.options.pythonBinary || process.env.OPENPENCIL_PYTHON_BIN?.trim() || 'python3',
      [
        this.options.helperPath || helperPath(),
        '--agy',
        agyBinary(this.options.agyBinary),
        '--cwd',
        this.options.cwd,
        ...(this.options.historyPath ? ['--history', this.options.historyPath] : [])
      ],
      {
        cwd: this.options.cwd,
        env: { ...process.env, ANTIGRAVITY_MIC: this.micAddress },
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    const session: VoiceSession = {
      micSocket: null,
      pendingAudio: [],
      pendingAudioBytes: 0,
      process: child,
      snapshot: {
        phase: 'starting',
        sessionId,
        transcript: '',
        updatedAt: new Date().toISOString()
      },
      stderr: '',
      stdoutBuffer: ''
    }
    this.sessions.set(sessionId, session)
    this.activeSessionId = sessionId
    this.pruneSessions()

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(sessionId, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      session.stderr = clippedDiagnostic(session.stderr + chunk)
    })
    child.once('error', (error) => {
      this.update(sessionId, {
        code: 'agy_voice_start_failed',
        error: `Antigravity voice input could not start: ${error.message}`,
        phase: 'error'
      })
    })
    child.once('exit', (code, signal) => {
      const latest = this.sessions.get(sessionId)
      if (!latest || TERMINAL_PHASES.has(latest.snapshot.phase)) return
      const diagnostic = latest.stderr.trim()
      this.update(sessionId, {
        code: 'agy_voice_exited',
        error:
          diagnostic ||
          `Antigravity voice input exited before returning a transcript (${signal || code || 'unknown'}).`,
        phase: 'error'
      })
    })
    return copySnapshot(session.snapshot)
  }

  read(sessionId: string): AgyVoiceDictationSnapshot | null {
    const session = this.sessions.get(sessionId)
    return session ? copySnapshot(session.snapshot) : null
  }

  active(): AgyVoiceDictationSnapshot | null {
    const session = this.activeSessionId ? this.sessions.get(this.activeSessionId) : null
    return session ? copySnapshot(session.snapshot) : null
  }

  writeAudio(sessionId: string, audio: Uint8Array): boolean | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    if (TERMINAL_PHASES.has(session.snapshot.phase)) return false
    if (audio.byteLength === 0) return true
    if (audio.byteLength > MAX_AUDIO_CHUNK_BYTES) {
      throw new Error('Voice audio chunk is too large')
    }

    const chunk = Uint8Array.from(audio)
    if (session.micSocket?.writable) {
      session.micSocket.write(chunk)
      return true
    }

    session.pendingAudio.push(chunk)
    session.pendingAudioBytes += chunk.byteLength
    while (session.pendingAudioBytes > MAX_PENDING_AUDIO_BYTES && session.pendingAudio.length > 1) {
      const removed = session.pendingAudio.shift()
      session.pendingAudioBytes -= removed?.byteLength ?? 0
    }
    return true
  }

  stop(sessionId: string): AgyVoiceDictationSnapshot | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    if (!TERMINAL_PHASES.has(session.snapshot.phase) && session.process.stdin.writable) {
      session.process.stdin.write(`${JSON.stringify({ command: 'stop' })}\n`)
      this.update(sessionId, { phase: 'finishing' })
    }
    return copySnapshot(session.snapshot)
  }

  cancel(sessionId: string): AgyVoiceDictationSnapshot | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null
    if (!TERMINAL_PHASES.has(session.snapshot.phase)) {
      if (session.process.stdin.writable) {
        session.process.stdin.write(`${JSON.stringify({ command: 'cancel' })}\n`)
      }
      this.update(sessionId, { phase: 'cancelled' })
      const process = session.process
      setTimeout(() => {
        if (process.exitCode === null && process.signalCode === null) process.kill('SIGTERM')
      }, 1_500)
    }
    return copySnapshot(session.snapshot)
  }

  close(): void {
    for (const session of this.sessions.values()) {
      if (session.process.exitCode !== null || session.process.signalCode !== null) continue
      if (session.process.stdin.writable) {
        session.process.stdin.write(`${JSON.stringify({ command: 'cancel' })}\n`)
      }
      session.process.kill('SIGTERM')
      session.micSocket?.destroy()
    }
    this.sessions.clear()
    this.activeSessionId = null
    this.micServer.close()
  }

  private acceptMicClient(socket: Socket): void {
    const sessionId = this.activeSessionId
    const session = sessionId ? this.sessions.get(sessionId) : null
    if (!session || TERMINAL_PHASES.has(session.snapshot.phase)) {
      socket.destroy()
      return
    }

    session.micSocket?.destroy()
    session.micSocket = socket
    socket.setNoDelay(true)
    socket.on('error', () => undefined)
    socket.once('close', () => {
      if (session.micSocket === socket) session.micSocket = null
    })
    for (const chunk of session.pendingAudio) socket.write(chunk)
    session.pendingAudio = []
    session.pendingAudioBytes = 0
  }

  private consumeStdout(sessionId: string, chunk: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.stdoutBuffer += chunk
    for (;;) {
      const newline = session.stdoutBuffer.indexOf('\n')
      if (newline === -1) break
      const line = session.stdoutBuffer.slice(0, newline).trim()
      session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1)
      if (!line) continue
      let event: HelperEvent
      try {
        event = JSON.parse(line) as HelperEvent
      } catch {
        session.stderr = clippedDiagnostic(`${session.stderr}\nInvalid helper event: ${line}`)
        continue
      }
      if (!isPhase(event.phase)) continue
      this.update(sessionId, {
        ...(typeof event.code === 'string' ? { code: event.code } : {}),
        ...(typeof event.error === 'string' ? { error: event.error } : {}),
        phase: event.phase,
        ...(typeof event.transcript === 'string' ? { transcript: event.transcript } : {})
      })
    }
  }

  private update(
    sessionId: string,
    patch: Partial<Omit<AgyVoiceDictationSnapshot, 'sessionId' | 'updatedAt'>>
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.snapshot = {
      ...session.snapshot,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString()
    }
    if (TERMINAL_PHASES.has(session.snapshot.phase) && this.activeSessionId === sessionId) {
      this.activeSessionId = null
      session.micSocket?.destroy()
      session.micSocket = null
      session.pendingAudio = []
      session.pendingAudioBytes = 0
    }
  }

  private pruneSessions(): void {
    if (this.sessions.size <= MAX_RETAINED_SESSIONS) return
    for (const [sessionId, session] of this.sessions) {
      if (this.sessions.size <= MAX_RETAINED_SESSIONS) break
      if (sessionId === this.activeSessionId || !TERMINAL_PHASES.has(session.snapshot.phase))
        continue
      this.sessions.delete(sessionId)
    }
  }
}
