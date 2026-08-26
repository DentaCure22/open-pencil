import { useLocalStorage } from '@vueuse/core'

import type { AgentConversationState, AgentConversationThread } from './conversations'
import { agentConversationTitle } from './presentation'
import type { AiMessage, AiMessagePart } from './types'

export type AgentConversationPreference = {
  archived?: boolean
  pinned?: boolean
  title?: string
  unread?: boolean
}

const preferences = useLocalStorage<Record<string, AgentConversationPreference>>(
  'open-pencil:agent-thread-preferences-v1',
  {}
)

function updatePreference(threadId: string, patch: AgentConversationPreference): void {
  const merged = { ...preferences.value[threadId], ...patch }
  const next = Object.fromEntries(Object.entries(merged).filter(([, value]) => Boolean(value)))
  const { [threadId]: _current, ...remaining } = preferences.value
  preferences.value = Object.keys(next).length ? { ...remaining, [threadId]: next } : remaining
}

export function agentConversationPreference(threadId: string): AgentConversationPreference {
  return preferences.value[threadId] ?? {}
}

export function agentConversationDisplayTitle(thread: AgentConversationThread): string {
  return agentConversationPreference(thread.nativeThreadId).title ?? agentConversationTitle(thread)
}

export function isAgentConversationArchived(thread: AgentConversationThread): boolean {
  return agentConversationPreference(thread.nativeThreadId).archived === true
}

export function isAgentConversationPinned(thread: AgentConversationThread): boolean {
  return agentConversationPreference(thread.nativeThreadId).pinned === true
}

export function isAgentConversationUnread(thread: AgentConversationThread): boolean {
  return agentConversationPreference(thread.nativeThreadId).unread === true
}

export function setAgentConversationArchived(
  thread: AgentConversationThread,
  archived: boolean
): void {
  updatePreference(thread.nativeThreadId, { archived })
}

export function setAgentConversationPinned(thread: AgentConversationThread, pinned: boolean): void {
  updatePreference(thread.nativeThreadId, { pinned })
}

export function setAgentConversationTitle(thread: AgentConversationThread, title: string): void {
  updatePreference(thread.nativeThreadId, { title: title.trim() || undefined })
}

export function setAgentConversationUnread(thread: AgentConversationThread, unread: boolean): void {
  updatePreference(thread.nativeThreadId, { unread })
}

export function shouldMarkFinishedConversationUnread(input: {
  open: boolean
  previousState?: AgentConversationState
  state: AgentConversationState
}): boolean {
  return !input.open && input.previousState === 'running' && input.state === 'completed'
}

export function agentConversationLastUserMessageAt(
  thread: Pick<AgentConversationThread, 'createdAt' | 'messages'> & {
    lastUserMessageAt?: string
  }
): string {
  const fromField = thread.lastUserMessageAt
  const fromMessages = thread.messages.findLast((message) => message.role === 'user')?.createdAt
  if (fromField && fromMessages) return fromField > fromMessages ? fromField : fromMessages
  return fromField ?? fromMessages ?? thread.createdAt
}

export function sortAgentConversationThreads(
  threads: readonly AgentConversationThread[]
): AgentConversationThread[] {
  return [...threads].sort((left, right) => {
    const pinDifference =
      Number(isAgentConversationPinned(right)) - Number(isAgentConversationPinned(left))
    if (pinDifference) return pinDifference
    const byUser = agentConversationLastUserMessageAt(right).localeCompare(
      agentConversationLastUserMessageAt(left)
    )
    return byUser || right.updatedAt.localeCompare(left.updatedAt)
  })
}

function partCopyText(part: AiMessagePart): string {
  if (part.type === 'attachment') return `[Attachment: ${part.name}]`
  if (part.type === 'image') return part.url ? `![${part.alt || 'Image'}](${part.url})` : '[Image]'
  if (part.type === 'source') return `[${part.title}](${part.url})`
  if (part.type === 'code') {
    return `\`\`\`${part.language ?? ''}\n${part.code}\n\`\`\``
  }
  if (part.type === 'text') return part.text.trim()
  return ''
}

function messageCopyText(message: AiMessage): string {
  const text = message.text.trim()
  if (text) return text
  return (message.parts ?? []).map(partCopyText).filter(Boolean).join('\n\n')
}

function messageRoleLabel(message: AiMessage): string {
  if (message.role === 'assistant') return 'Agent'
  if (message.role === 'user') return 'You'
  return 'System'
}

export function agentConversationCopyText(thread: AgentConversationThread): string {
  const transcript = thread.messages.flatMap((message) => {
    const text = messageCopyText(message)
    return text ? [`**${messageRoleLabel(message)}**\n\n${text}`] : []
  })
  return [`# ${agentConversationDisplayTitle(thread)}`, ...transcript].join('\n\n')
}

export function agentConversationLastResponseText(thread: AgentConversationThread): string {
  const response = [...thread.messages]
    .reverse()
    .find((message) => message.role === 'assistant' && messageCopyText(message))
  return response ? messageCopyText(response) : ''
}
