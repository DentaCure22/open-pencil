import { CornerDownLeft, TerminalSquare } from 'lucide-react'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import {
  closeAgentWorkspaceTerminal,
  createAgentWorkspaceTerminal,
  readAgentWorkspaceTerminal,
  writeAgentWorkspaceTerminal,
  type AgentWorkspaceTerminalChunk
} from '@/app/agent-chat/workspace'

export default function T3TerminalSurface(props: { active: boolean }) {
  const [sessionId, setSessionId] = useState('')
  const [chunks, setChunks] = useState<AgentWorkspaceTerminalChunk[]>([])
  const [command, setCommand] = useState('')
  const [running, setRunning] = useState(true)
  const [error, setError] = useState('')
  const output = useRef<HTMLDivElement>(null)
  const session = useRef('')
  const lastSequence = chunks.reduce((maximum, chunk) => Math.max(maximum, chunk.sequence), 0)

  useEffect(() => {
    let cancelled = false
    const startTerminal = async () => {
      try {
        const snapshot = await createAgentWorkspaceTerminal()
        if (cancelled) {
          void closeAgentWorkspaceTerminal(snapshot.id)
          return
        }
        session.current = snapshot.id
        setSessionId(snapshot.id)
        setChunks(snapshot.chunks)
        setRunning(snapshot.running)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      }
    }
    void startTerminal()
    return () => {
      cancelled = true
      if (session.current) void closeAgentWorkspaceTerminal(session.current)
    }
  }, [])

  useEffect(() => {
    if (!props.active || !sessionId || !running) return undefined
    const interval = window.setInterval(() => {
      const refreshTerminal = async () => {
        try {
          const snapshot = await readAgentWorkspaceTerminal(sessionId, lastSequence)
          if (snapshot.chunks.length) setChunks((current) => [...current, ...snapshot.chunks])
          setRunning(snapshot.running)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      }
      void refreshTerminal()
    }, 250)
    return () => window.clearInterval(interval)
  }, [lastSequence, props.active, running, sessionId])

  useEffect(() => {
    output.current?.scrollTo({ behavior: 'smooth', top: output.current.scrollHeight })
  }, [chunks])

  function submit(event: FormEvent) {
    event.preventDefault()
    const value = command
    if (!sessionId || !running || !value.trim()) return
    setCommand('')
    setChunks((current) => [
      ...current,
      { sequence: -Date.now(), stream: 'stdout', text: `$ ${value}\n` }
    ])
    const writeCommand = async () => {
      try {
        await writeAgentWorkspaceTerminal(sessionId, `${value}\n`)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    }
    void writeCommand()
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-[#111214] text-[#e6e7e9]"
      data-test-id="t3-terminal-surface"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/8 px-3 text-[11px] text-white/55">
        <TerminalSquare className="size-3.5" />
        <span>Workspace shell</span>
        <span
          className={`ml-auto size-1.5 rounded-full ${running ? 'bg-emerald-400' : 'bg-white/25'}`}
        />
      </div>
      <div
        ref={output}
        className="scrollbar-panel min-h-0 flex-1 overflow-auto p-3 font-mono text-[12px] leading-5 whitespace-pre-wrap break-words select-text"
      >
        <div className="text-white/45">OpenPencil workspace terminal</div>
        {chunks.map((chunk, index) => (
          <span
            key={`${String(chunk.sequence)}:${String(index)}`}
            className={chunk.stream === 'stderr' ? 'text-red-300' : 'text-white/90'}
          >
            {chunk.text}
          </span>
        ))}
        {error ? <div className="text-red-300">{error}</div> : null}
      </div>
      <form
        className="flex min-h-10 shrink-0 items-center border-t border-white/8 px-3"
        onSubmit={submit}
      >
        <span className="mr-2 font-mono text-[12px] text-emerald-400">$</span>
        <input
          value={command}
          aria-label="Terminal command"
          autoComplete="off"
          disabled={!sessionId || !running}
          placeholder={sessionId ? 'Enter command' : 'Starting shell…'}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-white outline-none placeholder:text-white/25"
          onChange={(event) => setCommand(event.target.value)}
        />
        <button
          type="submit"
          aria-label="Run terminal command"
          disabled={!sessionId || !running || !command.trim()}
          className="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-white/45 hover:bg-white/8 hover:text-white disabled:opacity-20"
        >
          <CornerDownLeft className="size-3.5" />
        </button>
      </form>
    </div>
  )
}
