import { reactive } from 'vue'

import type { AiMessage } from './types'

type OptimisticConversation = {
  error: string
  requestId: string
  response: string
  startedAt: string
  state: 'completed' | 'error' | 'stopped' | 'submitted' | 'thinking'
  text: string
}

const conversations = reactive<Partial<Record<string, OptimisticConversation>>>({})

function requestId(): string {
  return crypto.randomUUID()
}

export function beginOptimisticConversation(threadId: string, text: string): string {
  const id = requestId()
  conversations[threadId] = {
    error: '',
    requestId: id,
    response: '',
    startedAt: new Date().toISOString(),
    state: 'submitted',
    text
  }
  return id
}

export function acceptOptimisticConversation(threadId: string, id: string) {
  const pending = conversations[threadId]
  if (pending?.requestId === id) pending.state = 'thinking'
}

export function completeOptimisticConversation(threadId: string, id: string, response: string) {
  const pending = conversations[threadId]
  if (!pending || pending.requestId !== id) return
  pending.response = response
  pending.state = 'completed'
}

export function failOptimisticConversation(threadId: string, id: string, error: string) {
  const pending = conversations[threadId]
  if (!pending || pending.requestId !== id) return
  pending.error = error
  pending.state = 'error'
}

export function stopOptimisticConversation(threadId: string) {
  const pending = conversations[threadId]
  if (pending) pending.state = 'stopped'
}

export function optimisticConversation(threadId: string): OptimisticConversation | undefined {
  return conversations[threadId]
}

function matchesAuthoritativeUser(message: AiMessage, pending: OptimisticConversation): boolean {
  return (
    message.role === 'user' &&
    message.text.trim() === pending.text &&
    Date.parse(message.createdAt) >= Date.parse(pending.startedAt) - 2_000
  )
}

export function mergeOptimisticMessages(threadId: string, messages: AiMessage[]): AiMessage[] {
  const pending = conversations[threadId]
  if (!pending) return messages
  const hasUser = messages.some((message) => matchesAuthoritativeUser(message, pending))
  const hasResponse = messages.some(
    (message) =>
      message.role === 'assistant' && Date.parse(message.createdAt) >= Date.parse(pending.startedAt)
  )
  if (hasResponse) {
    Reflect.deleteProperty(conversations, threadId)
    return messages
  }
  const optimisticMessages: AiMessage[] = [...messages]
  if (!hasUser) {
    optimisticMessages.push({
      createdAt: pending.startedAt,
      id: `optimistic:${pending.requestId}`,
      role: 'user',
      text: pending.text
    })
  }
  if (pending.state === 'completed' && pending.response.trim()) {
    optimisticMessages.push({
      createdAt: new Date().toISOString(),
      id: `optimistic-response:${pending.requestId}`,
      role: 'assistant',
      text: pending.response.trim()
    })
  }
  return optimisticMessages
}
