import { reactive } from 'vue'

import type { AiMessage, AiMessagePart } from './types'

type OptimisticConversation = {
  error: string
  parts: AiMessagePart[]
  previewUrls: string[]
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

function releasePreviewUrls(conversation: OptimisticConversation | undefined): void {
  if (!conversation) return
  for (const url of conversation.previewUrls) URL.revokeObjectURL(url)
  conversation.previewUrls = []
}

function optimisticAttachmentParts(files: File[]): {
  parts: AiMessagePart[]
  previewUrls: string[]
} {
  const previewUrls: string[] = []
  const parts = files.map((file): AiMessagePart => {
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file)
      previewUrls.push(url)
      return { alt: file.name, type: 'image', url }
    }
    return {
      ...(file.type ? { mediaType: file.type } : {}),
      name: file.name,
      size: file.size,
      type: 'attachment'
    }
  })
  return { parts, previewUrls }
}

export function beginOptimisticConversation(
  threadId: string,
  text: string,
  attachments: File[] = []
): string {
  const id = requestId()
  releasePreviewUrls(conversations[threadId])
  const preview = optimisticAttachmentParts(attachments)
  conversations[threadId] = {
    error: '',
    parts: preview.parts,
    previewUrls: preview.previewUrls,
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

export function clearOptimisticConversation(threadId: string) {
  const pending = conversations[threadId]
  if (!pending) return
  releasePreviewUrls(pending)
  Reflect.deleteProperty(conversations, threadId)
}

export function moveOptimisticConversation(
  sourceThreadId: string,
  targetThreadId: string
): boolean {
  const pending = conversations[sourceThreadId]
  if (!pending || !targetThreadId) return false
  if (sourceThreadId === targetThreadId) return true
  releasePreviewUrls(conversations[targetThreadId])
  conversations[targetThreadId] = pending
  Reflect.deleteProperty(conversations, sourceThreadId)
  return true
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

function hasAttachmentParts(message: AiMessage): boolean {
  return Boolean(message.parts?.some((part) => part.type === 'attachment' || part.type === 'image'))
}

export function mergeOptimisticMessages(threadId: string, messages: AiMessage[]): AiMessage[] {
  const pending = conversations[threadId]
  if (!pending) return messages
  const authoritativeUser = messages.find((message) => matchesAuthoritativeUser(message, pending))
  const hasUser = Boolean(authoritativeUser)
  const hasAuthoritativeAttachments = Boolean(
    authoritativeUser && hasAttachmentParts(authoritativeUser)
  )
  const hasResponse = messages.some(
    (message) =>
      message.role === 'assistant' && Date.parse(message.createdAt) >= Date.parse(pending.startedAt)
  )
  if (hasResponse) {
    releasePreviewUrls(pending)
    Reflect.deleteProperty(conversations, threadId)
    return messages
  }
  if (hasAuthoritativeAttachments) releasePreviewUrls(pending)
  const optimisticMessages: AiMessage[] = messages.map((message) => {
    if (
      pending.parts.length &&
      matchesAuthoritativeUser(message, pending) &&
      !hasAttachmentParts(message)
    ) {
      return { ...message, parts: pending.parts }
    }
    return message
  })
  if (!hasUser) {
    optimisticMessages.push({
      createdAt: pending.startedAt,
      id: `optimistic:${pending.requestId}`,
      ...(pending.parts.length ? { parts: pending.parts } : {}),
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
