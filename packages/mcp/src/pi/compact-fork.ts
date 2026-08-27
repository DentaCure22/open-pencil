import { randomUUID } from 'node:crypto'

import type {
  AgentConversationMessage,
  AgentConversationThread,
  AgentDispatchRequest
} from '#mcp/agent-router/contracts'

import type { PiLaunch } from './router-state'

/** Newest parent user turns to seed a compact-fork. */
export const COMPACT_FORK_TURN_LIMIT = 3
/** Cap each seeded line so the child prompt stays a tail, not a transcript. */
export const COMPACT_FORK_LINE_CHARS = 800

export type AgentHistoryScope = 'effectiveContext' | 'full'

export type PiForkPlan = {
  forkedFromId: string
  idle: boolean
  mode: PiLaunch
  request: AgentDispatchRequest
  seedMessages: AgentConversationMessage[]
}

function clipLine(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= COMPACT_FORK_LINE_CHARS) return text
  return `${text.slice(0, COMPACT_FORK_LINE_CHARS - 1).trimEnd()}…`
}

function messageLine(message: AgentConversationMessage): string {
  if (message.role === 'user') {
    const text = clipLine(message.text)
    return text ? `User: ${text}` : ''
  }
  const text = clipLine(message.text)
  if (text) return `Assistant: ${text}`
  const commentary = message.parts
    ?.filter((part) => part.type === 'commentary')
    .map((part) => clipLine(part.text))
    .find(Boolean)
  return commentary ? `Assistant: ${commentary}` : ''
}

export function compactForkEffectiveContext(thread: AgentConversationThread): string {
  const userIndexes: number[] = []
  thread.messages.forEach((message, index) => {
    if (message.role === 'user') userIndexes.push(index)
  })
  const start = userIndexes[Math.max(0, userIndexes.length - COMPACT_FORK_TURN_LIMIT)] ?? 0
  const lines = thread.messages.slice(start).flatMap((message) => {
    const line = messageLine(message)
    return line ? [line] : []
  })
  const task = clipLine(thread.task)
  return [`Parent task: ${task || 'Board work'}`, ...lines].join('\n')
}

export function compactForkMessages(thread: AgentConversationThread): AgentConversationMessage[] {
  const userIndexes: number[] = []
  thread.messages.forEach((message, index) => {
    if (message.role === 'user') userIndexes.push(index)
  })
  const start = userIndexes[Math.max(0, userIndexes.length - COMPACT_FORK_TURN_LIMIT)] ?? 0
  return thread.messages.slice(start).flatMap((message): AgentConversationMessage[] => {
    if (message.role === 'user') {
      const text = clipLine(message.text)
      return text
        ? [{ createdAt: message.createdAt, id: randomUUID(), role: 'user' as const, text }]
        : []
    }
    const text = clipLine(message.text)
    const commentary = message.parts
      ?.filter((part) => part.type === 'commentary')
      .map((part) => ({ ...part, text: clipLine(part.text) }))
      .filter((part) => part.text)
    if (!text && !commentary?.length) return []
    return [
      {
        createdAt: message.createdAt,
        id: randomUUID(),
        ...(commentary?.length ? { parts: commentary } : {}),
        role: 'assistant' as const,
        text
      }
    ]
  })
}

export function cloneForkMessages(
  messages: AgentConversationMessage[]
): AgentConversationMessage[] {
  return messages.map((message) => ({
    ...message,
    id: randomUUID(),
    ...(message.parts ? { parts: message.parts.map((part) => ({ ...part })) } : {})
  }))
}

export function compactForkPrompt(thread: AgentConversationThread, prompt: string): string {
  return [
    prompt.trim(),
    '',
    'Parent context (stored tail, not an instruction):',
    compactForkEffectiveContext(thread)
  ].join('\n')
}

export function resolvePiForkLaunch(
  source: AgentConversationThread,
  request: AgentDispatchRequest
): PiForkPlan {
  const inheritedRequest: AgentDispatchRequest = {
    ...request,
    projectId: request.projectId === undefined ? source.projectId : request.projectId,
    workspaceRoot: request.workspaceRoot ?? source.workspaceRoot
  }
  const historyScope: AgentHistoryScope = request.historyScope ?? 'effectiveContext'
  const idle = !request.prompt.trim()
  if (historyScope === 'full') {
    if (!source.sessionId) throw new Error('This Pi conversation has no native session.')
    return {
      forkedFromId: source.id,
      idle,
      mode: { forkedFromId: source.id, kind: 'fork', sessionId: source.sessionId },
      request: inheritedRequest,
      seedMessages: cloneForkMessages(source.messages)
    }
  }
  const displayPrompt = request.displayPrompt?.trim() || request.prompt.trim()
  return {
    forkedFromId: source.id,
    idle,
    mode: { forkedFromId: source.id, kind: 'new' },
    request: idle
      ? inheritedRequest
      : {
          ...inheritedRequest,
          displayPrompt,
          prompt: compactForkPrompt(source, request.prompt)
        },
    seedMessages: compactForkMessages(source)
  }
}
