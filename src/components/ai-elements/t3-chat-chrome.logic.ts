/*
 * Interaction logic adapted from T3 Code's Sidebar.logic and composer-logic at
 * 5d7665396083d285132d67038813862a93337ca5 (MIT, T3 Tools Inc.).
 * See THIRD_PARTY_NOTICES.md.
 */
import type { AgentConversationThread } from '@/app/agent-chat/conversations'

export type T3ThreadStatusTone = 'amber' | 'emerald' | 'indigo' | 'red' | 'sky' | 'zinc'

export type T3ThreadStatus = {
  label: string
  pulse: boolean
  tone: T3ThreadStatusTone
}

export function resolveT3ThreadStatus(
  thread: Pick<AgentConversationThread, 'pendingUiRequests' | 'recentUpdate' | 'state'>,
  options: { connecting?: boolean; unread?: boolean } = {}
): T3ThreadStatus | null {
  const pending = thread.pendingUiRequests.at(-1)
  if (pending?.method === 'confirm') {
    return { label: 'Pending Approval', pulse: false, tone: 'amber' }
  }
  if (pending?.method === 'select') {
    return { label: 'Awaiting Input', pulse: false, tone: 'indigo' }
  }
  if (options.connecting) return { label: 'Connecting', pulse: true, tone: 'sky' }
  if (thread.state === 'running') return { label: 'Working', pulse: true, tone: 'sky' }
  if (thread.state === 'needs_attention') {
    return { label: 'Failed', pulse: false, tone: 'red' }
  }
  if (thread.state === 'stopped') {
    return /\b(error|fail(?:ed|ure)?)\b/i.test(thread.recentUpdate)
      ? { label: 'Failed', pulse: false, tone: 'red' }
      : { label: 'Stopped', pulse: false, tone: 'zinc' }
  }
  if (options.unread) {
    return { label: 'Completed', pulse: false, tone: 'emerald' }
  }
  return null
}

export type T3ComposerTriggerKind = 'path' | 'slash-command' | 'skill'

export type T3ComposerTrigger = {
  kind: T3ComposerTriggerKind
  query: string
  rangeEnd: number
  rangeStart: number
}

function clampedCursor(text: string, input: number): number {
  if (!Number.isFinite(input)) return text.length
  return Math.max(0, Math.min(text.length, Math.floor(input)))
}

function tokenStart(text: string, cursor: number): number {
  let index = cursor - 1
  while (index >= 0 && !/\s/.test(text[index] ?? '')) index -= 1
  return index + 1
}

export function detectT3ComposerTrigger(
  text: string,
  cursorInput: number
): T3ComposerTrigger | null {
  const cursor = clampedCursor(text, cursorInput)
  const lineStart = text.lastIndexOf('\n', Math.max(0, cursor - 1)) + 1
  const linePrefix = text.slice(lineStart, cursor)

  if (linePrefix.startsWith('/')) {
    const skillMatch = /^\/skill:([^\s]*)$/i.exec(linePrefix)
    if (skillMatch) {
      return {
        kind: 'skill',
        query: skillMatch[1],
        rangeEnd: cursor,
        rangeStart: lineStart
      }
    }
    const commandMatch = /^\/(\S*)$/.exec(linePrefix)
    if (commandMatch) {
      return {
        kind: 'slash-command',
        query: commandMatch[1],
        rangeEnd: cursor,
        rangeStart: lineStart
      }
    }
  }

  const start = tokenStart(text, cursor)
  const token = text.slice(start, cursor)
  if (token.startsWith('@')) {
    return { kind: 'path', query: token.slice(1), rangeEnd: cursor, rangeStart: start }
  }
  return null
}

export function replaceT3ComposerTrigger(
  text: string,
  trigger: Pick<T3ComposerTrigger, 'rangeEnd' | 'rangeStart'>,
  replacement: string
): { cursor: number; text: string } {
  const start = Math.max(0, Math.min(text.length, trigger.rangeStart))
  const end = Math.max(start, Math.min(text.length, trigger.rangeEnd))
  const next = `${text.slice(0, start)}${replacement}${text.slice(end)}`
  return { cursor: start + replacement.length, text: next }
}

export type T3ComposerCommandItem = {
  description: string
  id: string
  kind: 'command' | 'path' | 'skill'
  label: string
  value: string
}

export const T3_COMPOSER_COMMANDS: readonly T3ComposerCommandItem[] = [
  {
    description: 'Switch the model for this conversation',
    id: 'command:model',
    kind: 'command',
    label: '/model',
    value: 'model'
  },
  {
    description: 'Browse skills available to the agent',
    id: 'command:skills',
    kind: 'command',
    label: '/skills',
    value: 'skills'
  },
  {
    description: 'Retry the latest stopped or failed response',
    id: 'command:retry',
    kind: 'command',
    label: '/retry',
    value: 'retry'
  },
  {
    description: 'Stop the response currently in progress',
    id: 'command:stop',
    kind: 'command',
    label: '/stop',
    value: 'stop'
  }
]

export const T3_COMPOSER_SKILLS: readonly T3ComposerCommandItem[] = [
  {
    description: 'Work with the live OpenPencil Board',
    id: 'skill:openpencil',
    kind: 'skill',
    label: '/skill:openpencil',
    value: 'openpencil'
  }
]

export function filterT3ComposerItems(
  items: readonly T3ComposerCommandItem[],
  query: string
): T3ComposerCommandItem[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...items]
  return items.filter((item) =>
    `${item.label} ${item.description} ${item.value}`.toLowerCase().includes(normalized)
  )
}
