import type { AgentConversationHistory, AgentConversationThread } from './client'
import type { AiMessage, AiMessagePart } from './types'

function cheapHash(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) | 0
  }
  return String(hash)
}

function imageFingerprint(image: { alt?: string; url: string }): string {
  return `${image.alt ?? ''}:${String(image.url.length)}:${cheapHash(image.url)}`
}

function videoFingerprint(video: { mimeType?: string; name?: string; url: string }): string {
  return `${video.name ?? ''}:${video.mimeType ?? ''}:${String(video.url.length)}:${cheapHash(video.url)}`
}

function partFingerprint(part: AiMessagePart): string {
  if (part.type === 'text') return `x${String(part.text.length)}`
  if (part.type === 'commentary') return `m${part.state ?? ''}${String(part.text.length)}`
  if (part.type === 'reasoning') return `r${part.state ?? ''}${String(part.text.length)}`
  if (part.type === 'tool') {
    const images = part.images?.map(imageFingerprint).join(',') ?? ''
    const videos = part.videos?.map(videoFingerprint).join(',') ?? ''
    return `t${part.name}:${part.state}:${String(part.output?.length ?? 0)}:${String(part.error?.length ?? 0)}:${images}:${videos}`
  }
  if (part.type === 'code') return `c${part.language ?? ''}${String(part.code.length)}`
  if (part.type === 'attachment') return `a${part.name}${String(part.size ?? 0)}`
  if (part.type === 'image') return `i${imageFingerprint(part)}`
  return `s${part.url}`
}

function messageFingerprint(message: AiMessage): string {
  const parts = message.parts?.map(partFingerprint).join('') ?? ''
  return `${message.id}:${message.role}:${message.completedAt ?? ''}:${String(message.text.length)}:${cheapHash(message.text)}:${parts}`
}

function threadFingerprint(thread: AgentConversationThread): string {
  return [
    thread.id,
    thread.updatedAt,
    thread.state,
    thread.recentUpdate,
    thread.task,
    thread.canFollowUp ? '1' : '0',
    thread.nativeThreadId,
    thread.model,
    thread.effort,
    JSON.stringify(thread.pendingUiRequests),
    JSON.stringify(thread.contextUsage ?? null),
    String(thread.messages.length),
    thread.messages.map(messageFingerprint).join(',')
  ].join('|')
}

export function agentHistorySignature(history: AgentConversationHistory): string {
  return history.threads.map(threadFingerprint).join(';')
}
