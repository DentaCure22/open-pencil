import type { AgentConversationHistory, AgentConversationThread } from './conversations'
import { boundLoadedTranscript } from './replay-buffer'
import type { AiMessage, AiMessagePart } from './types'

function sameProgressPart(
  previous: Extract<AiMessagePart, { type: 'commentary' | 'reasoning' }>,
  next: Extract<AiMessagePart, { type: 'commentary' | 'reasoning' }>
) {
  return previous.state === next.state && previous.text === next.text
}

function isProgressPart(
  part: AiMessagePart
): part is Extract<AiMessagePart, { type: 'commentary' | 'reasoning' }> {
  return part.type === 'commentary' || part.type === 'reasoning'
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
  const previousVideos = previous.videos
  const nextVideos = next.videos
  const sameVideos = (() => {
    if (previousVideos === nextVideos) return true
    if (!previousVideos || !nextVideos || previousVideos.length !== nextVideos.length) {
      return false
    }
    return previousVideos.every((video, index) => {
      const nextVideo = nextVideos[index]
      return (
        video.url === nextVideo.url &&
        video.name === nextVideo.name &&
        video.mimeType === nextVideo.mimeType
      )
    })
  })()
  return (
    previous.name === next.name &&
    previous.state === next.state &&
    previous.input === next.input &&
    previous.output === next.output &&
    previous.error === next.error &&
    sameImages &&
    sameVideos &&
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
  if (isProgressPart(previous) && isProgressPart(next)) {
    return sameProgressPart(previous, next)
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
    previous.activeTurnStartedAt === next.activeTurnStartedAt,
    previous.updatedAt === next.updatedAt,
    previous.state === next.state,
    previous.recentUpdate === next.recentUpdate,
    previous.task === next.task,
    previous.title === next.title,
    previous.canFollowUp === next.canFollowUp,
    previous.nativeThreadId === next.nativeThreadId,
    previous.model === next.model,
    previous.effort === next.effort,
    previous.createdAt === next.createdAt,
    JSON.stringify(previous.pendingUiRequests) === JSON.stringify(next.pendingUiRequests),
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
  const messages = next.map((message) => {
    const current = previousById.get(message.id)
    return current && sameMessage(current, message) ? current : message
  })
  if (
    messages.length === previous.length &&
    messages.every((message, index) => message === previous[index])
  ) {
    return previous
  }
  return messages
}

export function sameAgentConversationHistory(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory
): boolean {
  if (!previous) return false
  return (
    previous.threads.length === next.threads.length &&
    previous.threads.every((thread, index) => thread === next.threads[index])
  )
}

function messageHasActivityParts(message: AiMessage): boolean {
  return Boolean(
    message.parts?.some(
      (part) => part.type === 'commentary' || part.type === 'reasoning' || part.type === 'tool'
    )
  )
}

function preferRetainedMessage(previous: AiMessage, preview: AiMessage): AiMessage {
  if (sameMessage(previous, preview)) return previous
  if (messageHasActivityParts(previous) && !messageHasActivityParts(preview)) {
    if (!preview.text.trim()) return previous
    return {
      ...previous,
      ...(preview.completedAt ? { completedAt: preview.completedAt } : {}),
      text: preview.text
    }
  }
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

export function applyConversationPreviewMetadata(
  current: AgentConversationThread,
  preview: AgentConversationThread
): AgentConversationThread {
  return {
    ...preview,
    messages: current.messages,
    ...(current.contextUsage && !preview.contextUsage
      ? { contextUsage: current.contextUsage }
      : {}),
    ...(current.hasOlder === undefined ? {} : { hasOlder: current.hasOlder }),
    ...(current.hasNewer === undefined ? {} : { hasNewer: current.hasNewer }),
    ...(current.messageTotal === undefined ? {} : { messageTotal: current.messageTotal }),
    ...(current.newerAfter === undefined ? {} : { newerAfter: current.newerAfter }),
    ...(current.olderBefore === undefined ? {} : { olderBefore: current.olderBefore }),
    ...(current.turns ? { turns: current.turns } : {})
  }
}

function messageOrder(left: AiMessage, right: AiMessage): number {
  const byCreated = left.createdAt.localeCompare(right.createdAt)
  if (byCreated) return byCreated
  return left.id.localeCompare(right.id)
}

export function mergeConversationPageMessages(
  current: AiMessage[],
  page: AiMessage[]
): AiMessage[] {
  const merged = new Map<string, AiMessage>()
  for (const message of current) merged.set(message.id, message)
  for (const message of page) {
    const existing = merged.get(message.id)
    merged.set(message.id, existing && sameMessage(existing, message) ? existing : message)
  }
  return [...merged.values()].sort(messageOrder)
}

export function applyConversationPage(
  current: AgentConversationThread,
  page: AgentConversationThread,
  mode: 'delta' | 'older' | 'tail'
): AgentConversationThread {
  const messages = boundLoadedTranscript(
    mergeConversationPageMessages(current.messages, page.messages)
  )
  const turns = page.turns?.length ? page.turns : current.turns
  return {
    ...page,
    hasNewer: page.hasNewer === true,
    hasOlder: mode === 'delta' ? current.hasOlder : page.hasOlder,
    messages,
    newerAfter: page.newerAfter ?? current.newerAfter,
    olderBefore: mode === 'delta' ? current.olderBefore : page.olderBefore,
    ...(turns ? { turns } : {})
  }
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

export function mapAgentConversationHistory(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory,
  mapThread: (
    previousThread: AgentConversationThread | undefined,
    nextThread: AgentConversationThread
  ) => AgentConversationThread
): AgentConversationHistory {
  if (!previous) return next
  const previousById = new Map(previous.threads.map((thread) => [thread.id, thread]))
  return {
    ...next,
    threads: next.threads.map((thread) => mapThread(previousById.get(thread.id), thread))
  }
}

export function retainMissingOpenTranscripts(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory,
  openThreadIds: Iterable<string>
): AgentConversationHistory {
  if (!previous) return next
  const open = new Set(openThreadIds)
  if (open.size === 0) return next
  const nextIds = new Set(next.threads.map((thread) => thread.id))
  const retained = previous.threads.filter(
    (thread) => open.has(thread.id) && !nextIds.has(thread.id)
  )
  return retained.length ? { ...next, threads: [...next.threads, ...retained] } : next
}

export function reconcileAgentConversationHistory(
  previous: AgentConversationHistory | null,
  next: AgentConversationHistory
): AgentConversationHistory {
  return mapAgentConversationHistory(previous, next, reconcileThread)
}
