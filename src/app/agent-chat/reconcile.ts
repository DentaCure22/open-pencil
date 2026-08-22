import type { AgentConversationHistory, AgentConversationThread } from './client'
import type { AiMessage, AiMessagePart } from './types'

function sameReasoningPart(
  previous: Extract<AiMessagePart, { type: 'reasoning' }>,
  next: Extract<AiMessagePart, { type: 'reasoning' }>
) {
  return previous.state === next.state && previous.text === next.text
}

function sameToolPart(
  previous: Extract<AiMessagePart, { type: 'tool' }>,
  next: Extract<AiMessagePart, { type: 'tool' }>
) {
  const previousImages = previous.images
  const nextImages = next.images
  const sameImages = (() => {
    if (previousImages === nextImages) return true
    if (!previousImages || !nextImages || previousImages.length !== nextImages.length) {
      return false
    }
    return previousImages.every(
      (image, index) => image.url === nextImages[index]?.url && image.alt === nextImages[index]?.alt
    )
  })()
  return (
    previous.name === next.name &&
    previous.state === next.state &&
    previous.input === next.input &&
    previous.output === next.output &&
    previous.error === next.error &&
    sameImages &&
    previous.approval?.id === next.approval?.id &&
    previous.approval?.state === next.approval?.state
  )
}

function sameCodePart(
  previous: Extract<AiMessagePart, { type: 'code' }>,
  next: Extract<AiMessagePart, { type: 'code' }>
) {
  return (
    previous.code === next.code &&
    previous.filename === next.filename &&
    previous.language === next.language
  )
}

function sameAttachmentPart(
  previous: Extract<AiMessagePart, { type: 'attachment' }>,
  next: Extract<AiMessagePart, { type: 'attachment' }>
) {
  return (
    previous.name === next.name &&
    previous.size === next.size &&
    previous.mediaType === next.mediaType &&
    previous.url === next.url
  )
}

function samePart(previous: AiMessagePart, next: AiMessagePart): boolean {
  if (previous.type !== next.type) return false
  if (previous.type === 'text' && next.type === 'text') return previous.text === next.text
  if (previous.type === 'reasoning' && next.type === 'reasoning') {
    return sameReasoningPart(previous, next)
  }
  if (previous.type === 'tool' && next.type === 'tool') {
    return sameToolPart(previous, next)
  }
  if (previous.type === 'code' && next.type === 'code') {
    return sameCodePart(previous, next)
  }
  if (previous.type === 'attachment' && next.type === 'attachment') {
    return sameAttachmentPart(previous, next)
  }
  if (previous.type === 'image' && next.type === 'image') {
    return previous.url === next.url && previous.alt === next.alt
  }
  if (previous.type === 'source' && next.type === 'source') {
    return (
      previous.url === next.url && previous.title === next.title && previous.label === next.label
    )
  }
  return false
}

function sameParts(
  previous: AiMessagePart[] | undefined,
  next: AiMessagePart[] | undefined
): boolean {
  if (previous === next) return true
  if (!previous || !next || previous.length !== next.length) {
    return (previous?.length ?? 0) === 0 && (next?.length ?? 0) === 0
  }
  return previous.every((part, index) => samePart(part, next[index]))
}

function sameMessage(previous: AiMessage, next: AiMessage): boolean {
  return (
    previous.id === next.id &&
    previous.role === next.role &&
    previous.text === next.text &&
    previous.createdAt === next.createdAt &&
    previous.completedAt === next.completedAt &&
    sameParts(previous.parts, next.parts)
  )
}

function sameThread(previous: AgentConversationThread, next: AgentConversationThread): boolean {
  const sameMetadata = [
    previous.id === next.id,
    previous.updatedAt === next.updatedAt,
    previous.state === next.state,
    previous.recentUpdate === next.recentUpdate,
    previous.task === next.task,
    previous.canFollowUp === next.canFollowUp,
    previous.nativeThreadId === next.nativeThreadId,
    previous.model === next.model,
    previous.effort === next.effort,
    previous.createdAt === next.createdAt,
    JSON.stringify(previous.contextUsage ?? null) === JSON.stringify(next.contextUsage ?? null)
  ].every(Boolean)
  return (
    sameMetadata &&
    previous.messages.length === next.messages.length &&
    previous.messages.every((message, index) => sameMessage(message, next.messages[index]))
  )
}

function reconcileMessages(previous: AiMessage[], next: AiMessage[]): AiMessage[] {
  const previousById = new Map(previous.map((message) => [message.id, message]))
  return next.map((message) => {
    const current = previousById.get(message.id)
    return current && sameMessage(current, message) ? current : message
  })
}

function messageHasActivityParts(message: AiMessage): boolean {
  return Boolean(message.parts?.some((part) => part.type === 'tool' || part.type === 'reasoning'))
}

function preferRetainedMessage(previous: AiMessage, preview: AiMessage): AiMessage {
  if (sameMessage(previous, preview)) return previous
  if (messageHasActivityParts(previous) && !messageHasActivityParts(preview)) return previous
  return preview
}

export function retainedTranscriptNeedsHydrate(input: {
  hydratedMessageCount?: number
  hydratedUpdatedAt?: string
  retainedMessageCount: number
  updatedAt: string
}): boolean {
  if (input.hydratedUpdatedAt !== input.updatedAt) return true
  if (input.hydratedMessageCount === undefined) return true
  return input.retainedMessageCount < input.hydratedMessageCount
}

export function reconcileRetainedConversationMessages(
  previous: AiMessage[],
  preview: AiMessage[]
): AiMessage[] {
  const previewById = new Map(preview.map((message) => [message.id, message]))
  const previousIds = new Set(previous.map((message) => message.id))
  return [
    ...previous.map((message) => {
      const next = previewById.get(message.id)
      return next ? preferRetainedMessage(message, next) : message
    }),
    ...preview.filter((message) => !previousIds.has(message.id))
  ]
}

function reconcileThread(
  previous: AgentConversationThread | undefined,
  next: AgentConversationThread
): AgentConversationThread {
  if (!previous) return next
  if (sameThread(previous, next)) return previous
  return {
    ...next,
    messages: reconcileMessages(previous.messages, next.messages)
  }
}

export function reconcileAgentConversationHistory(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory
): AgentConversationHistory {
  if (!previous) return next
  const previousById = new Map(previous.threads.map((thread) => [thread.id, thread]))
  return {
    ...next,
    threads: next.threads.map((thread) => reconcileThread(previousById.get(thread.id), thread))
  }
}
