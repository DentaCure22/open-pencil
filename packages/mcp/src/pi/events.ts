import { createHash } from 'node:crypto'

import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'

import {
  isRecord,
  latestUserTurnStart,
  piEventText,
  safeActivityText,
  upsertMessage
} from './event-core'
import { MAX_IMAGE_BASE64_LENGTH } from './image-preview'
import { closingTextForFamily, piClosingFamily } from './providers/closing'
import {
  normalizeProviderToolOutput,
  providerOwnsThinking,
  providerThinkingBlockKey,
  syncProviderActivities,
  syncProviderThought
} from './providers/events'
import { collapseDuplicateTurnResponses, normalizedThreadText } from './thread-memory'

const MAX_STATUS_TEXT = 160

export { piEventText } from './event-core'

type PiImage = { data: string; mimeType: string }

function piEventImages(value: unknown): PiImage[] {
  if (Array.isArray(value)) return value.flatMap(piEventImages)
  if (!isRecord(value)) return []
  if (
    value.type === 'image' &&
    typeof value.data === 'string' &&
    value.data.length <= MAX_IMAGE_BASE64_LENGTH &&
    typeof value.mimeType === 'string' &&
    value.mimeType.startsWith('image/')
  ) {
    return [{ data: value.data, mimeType: value.mimeType }]
  }
  return Array.isArray(value.content) ? piEventImages(value.content) : []
}

function toolImages(value: unknown, name: string): Array<{ alt: string; url: string }> {
  return piEventImages(value).map((image) => ({
    alt: name === 'openpencil_board_screenshot' ? 'Board screenshot' : `${name} image`,
    url: `data:${image.mimeType};base64,${image.data}`
  }))
}

function toolName(event: Record<string, unknown>, previousName?: string): string {
  if ((event.toolName === 'mcp' || event.name === 'mcp') && isRecord(event.args)) {
    if (typeof event.args.tool === 'string' && event.args.tool) return event.args.tool
    if (typeof event.args.search === 'string' && event.args.search) return 'connected_app_search'
    if (typeof event.args.describe === 'string' && event.args.describe) {
      return 'connected_app_search'
    }
  }
  if (
    (event.toolName === 'mcp' || event.name === 'mcp') &&
    previousName &&
    previousName !== 'mcp'
  ) {
    return previousName
  }
  if (typeof event.toolName === 'string' && event.toolName) return event.toolName
  if (typeof event.name === 'string' && event.name) return event.name
  return 'tool'
}

function toolId(event: Record<string, unknown>, turnKey: string): string {
  const raw =
    (typeof event.toolCallId === 'string' && event.toolCallId) ||
    (typeof event.id === 'string' && event.id) ||
    createHash('sha256').update(JSON.stringify(event)).digest('hex').slice(0, 16)
  return `pi-tool:${turnKey}:${raw}`
}

function assistantId(event: Record<string, unknown>, turnKey: string): string {
  const message = isRecord(event.message) ? event.message : null
  const raw =
    (typeof event.id === 'string' && event.id) ||
    (message && typeof message.id === 'string' && message.id) ||
    (message && typeof message.responseId === 'string' && message.responseId) ||
    (message && typeof message.timestamp === 'number' && String(message.timestamp)) ||
    createHash('sha256')
      .update(JSON.stringify(message ?? event))
      .digest('hex')
      .slice(0, 16)
  return `pi-agent:${turnKey}:${raw}`
}

function streamingAssistantId(turnKey: string): string {
  return `pi-agent:${turnKey}:assistant`
}

function streamingCommentaryMessageId(
  thread: AgentConversationThread,
  turnKey: string,
  text = ''
): string {
  const base = streamingAssistantId(turnKey)
  const candidates = thread.messages
    .slice(latestUserTurnStart(thread))
    .filter((message) => message.id === base || message.id.startsWith(`${base}:commentary:`))
  const needle = normalizedThreadText(text)
  const exact = needle
    ? candidates.findLast((message) =>
        message.parts?.some(
          (part) => part.type === 'commentary' && normalizedThreadText(part.text) === needle
        )
      )
    : undefined
  if (exact) return exact.id
  const latest = candidates.at(-1)
  if (!latest) return base
  const latestIndex = thread.messages.indexOf(latest)
  const followedByTool = thread.messages
    .slice(latestIndex + 1)
    .some((message) => message.parts?.some((part) => part.type === 'tool'))
  if (!followedByTool) return latest.id
  let ordinal = candidates.length
  while (
    thread.messages.some((message) => message.id === `${base}:commentary:${String(ordinal)}`)
  ) {
    ordinal += 1
  }
  return `${base}:commentary:${String(ordinal)}`
}

function preSteerAssistantId(turnKey: string, steeringMessageId: string): string {
  return `${streamingAssistantId(turnKey)}:before-steer:${steeringMessageId}`
}

function streamingAssistantText(message?: AgentConversationMessage): string {
  if (!message) return ''
  if (message.text) return message.text
  const progressPart = message.parts?.find(
    (part) => part.type === 'commentary' || part.type === 'reasoning'
  )
  return progressPart?.type === 'commentary' || progressPart?.type === 'reasoning'
    ? progressPart.text
    : ''
}

export function finalizePiStreamingAssistant(
  thread: AgentConversationThread,
  turnKey: string,
  steeringMessageId: string,
  completedAt: string
): boolean {
  const id = streamingAssistantId(turnKey)
  const current = thread.messages.find((message) => message.id === id)
  if (!current) return false
  const text = streamingAssistantText(current)
  if (!text.trim()) return false
  const index = thread.messages.indexOf(current)
  const commentary = current.parts?.some((part) => part.type === 'commentary')
  thread.messages[index] = {
    completedAt,
    createdAt: current.createdAt,
    id: preSteerAssistantId(turnKey, steeringMessageId),
    role: 'assistant',
    ...(commentary
      ? { parts: [{ state: 'complete' as const, text, type: 'commentary' as const }], text: '' }
      : { text })
  }
  return true
}

export function restorePiStreamingAssistant(
  thread: AgentConversationThread,
  turnKey: string,
  steeringMessageId: string
): void {
  const current = thread.messages.find(
    (message) => message.id === preSteerAssistantId(turnKey, steeringMessageId)
  )
  if (!current) return
  current.id = streamingAssistantId(turnKey)
  Reflect.deleteProperty(current, 'completedAt')
}

function providerReasoningId(turnKey: string, contentIndex: number): string {
  return `pi-thinking:${turnKey}:${String(contentIndex)}`
}

function providerReasoningMessageId(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number,
  text: string
): string {
  const base = providerReasoningId(turnKey, contentIndex)
  const turnStart = latestUserTurnStart(thread)
  const candidates = thread.messages
    .slice(turnStart)
    .filter((message) => message.id === base || message.id.startsWith(`${base}:`))
  const needle = normalizedThreadText(text)
  const exact = needle
    ? candidates.findLast((message) =>
        message.parts?.some(
          (part) => part.type === 'reasoning' && normalizedThreadText(part.text) === needle
        )
      )
    : undefined
  if (exact) return exact.id
  const latest = candidates.at(-1)
  if (!latest) return base
  const latestIndex = thread.messages.indexOf(latest)
  const followedByTool = thread.messages
    .slice(latestIndex + 1)
    .some((message) => message.parts?.some((part) => part.type === 'tool'))
  if (!followedByTool) return latest.id
  let ordinal = candidates.length
  while (thread.messages.some((message) => message.id === `${base}:${String(ordinal)}`)) {
    ordinal += 1
  }
  return `${base}:${String(ordinal)}`
}

function latestProviderReasoningId(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number
): string {
  const base = providerReasoningId(turnKey, contentIndex)
  return (
    thread.messages
      .slice(latestUserTurnStart(thread))
      .findLast((message) => message.id === base || message.id.startsWith(`${base}:`))?.id ?? base
  )
}

function isPlaceholderReasoning(text: string): boolean {
  return ['thinking', 'thought'].includes(text.trim().toLowerCase())
}

function syncProviderReasoning(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number,
  value: unknown,
  complete: boolean,
  now: string
): void {
  if (providerOwnsThinking(thread)) return
  const text = (typeof value === 'string' ? value : piEventText(value)).trim()
  const id = providerReasoningMessageId(thread, turnKey, contentIndex, text)
  if (!text || isPlaceholderReasoning(text)) {
    if (!complete) return
    const index = thread.messages.findIndex((message) => message.id === id)
    if (index !== -1) thread.messages.splice(index, 1)
    return
  }
  upsertMessage(thread, {
    ...(complete ? { completedAt: now } : {}),
    createdAt: now,
    id,
    parts: [
      {
        state: complete ? 'complete' : 'streaming',
        text,
        type: 'reasoning'
      }
    ],
    role: 'assistant',
    text: ''
  })
}

const thinkingBuffers = new WeakMap<AgentConversationThread, Map<string, string>>()

function thinkingBufferKey(turnKey: string, contentIndex: number): string {
  return `${turnKey}:${String(contentIndex)}`
}

function thinkingBufferFor(thread: AgentConversationThread): Map<string, string> {
  let buffers = thinkingBuffers.get(thread)
  if (!buffers) {
    buffers = new Map()
    thinkingBuffers.set(thread, buffers)
  }
  return buffers
}

function accumulateThinking(
  thread: AgentConversationThread,
  turnKey: string,
  contentIndex: number,
  update: Record<string, unknown>
): string {
  const buffers = thinkingBufferFor(thread)
  const key = thinkingBufferKey(turnKey, contentIndex)
  if (update.type === 'thinking_start') {
    buffers.delete(key)
    return ''
  }
  if (update.type === 'thinking_end') {
    const content = typeof update.content === 'string' ? update.content : (buffers.get(key) ?? '')
    buffers.set(key, content)
    return content
  }
  if (typeof update.delta === 'string') {
    const next = `${buffers.get(key) ?? ''}${update.delta}`
    buffers.set(key, next)
    return next
  }
  return buffers.get(key) ?? ''
}

function markRunning(thread: AgentConversationThread, detail = 'Pi is running.'): boolean {
  const current = thread.recentUpdate.trim()
  if (
    current &&
    current !== 'Starting Pi.' &&
    current !== 'Forking relevant Pi context.' &&
    current !== 'Pi is running.' &&
    !current.startsWith('Still working')
  ) {
    return false
  }
  if (thread.recentUpdate === detail) return false
  thread.recentUpdate = detail
  return true
}

function applySession(thread: AgentConversationThread, event: Record<string, unknown>): boolean {
  const sessionId =
    (typeof event.id === 'string' && event.id) ||
    (typeof event.sessionId === 'string' && event.sessionId) ||
    thread.id
  thread.sessionId = sessionId
  thread.canFollowUp = true
  return markRunning(thread)
}

function applyTool(
  thread: AgentConversationThread,
  event: Record<string, unknown>,
  turnKey: string,
  now: string
): boolean {
  const id = toolId(event, turnKey)
  const existingPart = thread.messages
    .find((message) => message.id === id)
    ?.parts?.find((part) => part.type === 'tool')
  const name = toolName(event, existingPart?.name)
  if (name === 'memory_search' || name === 'memory_read') return false
  const ended = event.type === 'tool_execution_end'
  const input = safeActivityText(event.args)
  const output = normalizeProviderToolOutput(
    name,
    safeActivityText(event.result ?? event.partialResult)
  )
  const images = ended ? toolImages(event.result ?? event.partialResult, name) : []
  const failed = ended && (event.isError === true || piToolOutputFailed(output))
  thread.recentUpdate = (ended ? (failed ? `${name} failed.` : name) : `${name}…`).slice(
    0,
    MAX_STATUS_TEXT
  )
  let state: 'error' | 'running' | 'success' = 'running'
  if (failed) state = 'error'
  else if (ended) state = 'success'
  upsertMessage(thread, {
    ...(ended ? { completedAt: now } : {}),
    createdAt: now,
    id,
    parts: [
      {
        ...(failed ? { error: output || `${name} failed.` } : {}),
        ...(images.length ? { images } : {}),
        ...(input ? { input } : {}),
        name,
        ...(!failed && output ? { output } : {}),
        state,
        type: 'tool'
      }
    ],
    role: 'assistant',
    text: ''
  })
  return true
}

function assistantEvent(event: Record<string, unknown>): Record<string, unknown> | null {
  return isRecord(event.assistantMessageEvent) ? event.assistantMessageEvent : null
}

type AssistantTextPhase = 'commentary' | 'final_answer'

type AssistantTextBlock = {
  index: number
  phase?: AssistantTextPhase
  text: string
}

function textSignaturePhase(value: unknown): AssistantTextPhase | undefined {
  if (typeof value !== 'string' || !value.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return undefined
    return parsed.phase === 'commentary' || parsed.phase === 'final_answer'
      ? parsed.phase
      : undefined
  } catch {
    return undefined
  }
}

function assistantTextBlocks(message: Record<string, unknown> | null): AssistantTextBlock[] {
  if (!message || !Array.isArray(message.content)) return []
  return message.content.flatMap((part, index) => {
    if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') return []
    const phase = textSignaturePhase(part.textSignature)
    return [{ index, ...(phase ? { phase } : {}), text: part.text }]
  })
}

function updateTextPhase(
  update: Record<string, unknown>,
  contentIndex: number
): AssistantTextPhase | undefined {
  if (!isRecord(update.partial)) return undefined
  return assistantTextBlocks(update.partial).find((part) => part.index === contentIndex)?.phase
}

function syncStreamingCommentary(
  thread: AgentConversationThread,
  id: string,
  text: string,
  complete: boolean,
  now: string
): void {
  if (!text.trim()) return
  upsertMessage(thread, {
    ...(complete ? { completedAt: now } : {}),
    createdAt: now,
    id,
    parts: [
      {
        state: complete ? 'complete' : 'streaming',
        text,
        type: 'commentary'
      }
    ],
    role: 'assistant',
    text: ''
  })
}

function applyMessageUpdate(
  thread: AgentConversationThread,
  event: Record<string, unknown>,
  turnKey: string,
  now: string
): boolean {
  const update = assistantEvent(event)
  if (!update || typeof update.type !== 'string') return markRunning(thread)
  const contentIndex = typeof update.contentIndex === 'number' ? update.contentIndex : 0
  if (update.type.startsWith('thinking_')) {
    const complete = update.type === 'thinking_end'
    const thinking = accumulateThinking(thread, turnKey, contentIndex, update)
    if (providerOwnsThinking(thread)) {
      const blockKey = providerThinkingBlockKey(
        thread,
        turnKey,
        contentIndex,
        update.type === 'thinking_start'
      )
      const thought = syncProviderThought(thread, thinking, blockKey, contentIndex, now, complete)
      const activityStatus = syncProviderActivities(
        thread,
        thinking,
        blockKey,
        contentIndex,
        now,
        !complete
      )
      thread.recentUpdate =
        activityStatus ?? (thought ? thought.slice(0, MAX_STATUS_TEXT) : 'Working…')
      return true
    }
    const activityStatus = syncProviderActivities(
      thread,
      thinking,
      turnKey,
      contentIndex,
      now,
      !complete
    )
    if (activityStatus) {
      const index = thread.messages.findIndex(
        (message) => message.id === latestProviderReasoningId(thread, turnKey, contentIndex)
      )
      if (index !== -1) thread.messages.splice(index, 1)
      thread.recentUpdate = activityStatus.slice(0, MAX_STATUS_TEXT)
    } else {
      syncProviderReasoning(thread, turnKey, contentIndex, thinking, complete, now)
      if (!/ · \d+s$/.test(thread.recentUpdate) && !thread.recentUpdate.endsWith('…')) {
        thread.recentUpdate = 'Working…'
      }
    }
    return true
  }
  if (update.type === 'text_delta' && typeof update.delta === 'string') {
    const id = streamingAssistantId(turnKey)
    const phase = updateTextPhase(update, contentIndex)
    const commentaryId = phase === 'commentary' ? streamingCommentaryMessageId(thread, turnKey) : id
    const existing = thread.messages.find((message) => message.id === commentaryId)
    const previous =
      phase === 'commentary'
        ? (existing?.parts?.find((part) => part.type === 'commentary')?.text ?? '')
        : (existing?.text ?? '')
    const text = `${previous}${update.delta}`
    if (phase === 'commentary') {
      syncStreamingCommentary(thread, commentaryId, text, false, now)
      if (!/ · \d+s$/.test(thread.recentUpdate) && !thread.recentUpdate.endsWith('…')) {
        thread.recentUpdate = 'Working…'
      }
      return true
    }
    upsertMessage(thread, {
      createdAt: now,
      id,
      role: 'assistant',
      text
    })
    thread.recentUpdate = 'Writing response…'
    return true
  }
  if (update.type === 'text_end' && typeof update.content === 'string') {
    if (updateTextPhase(update, contentIndex) === 'commentary') {
      syncStreamingCommentary(
        thread,
        streamingCommentaryMessageId(thread, turnKey, update.content),
        update.content,
        true,
        now
      )
      thread.recentUpdate = update.content.trim().slice(0, 500)
      return true
    }
    thread.recentUpdate = 'Writing response…'
    return true
  }
  if (update.type.startsWith('text_')) {
    thread.recentUpdate = 'Writing response…'
    return true
  }
  return markRunning(thread)
}

function syncCompletedThinking(
  thread: AgentConversationThread,
  event: Record<string, unknown>,
  turnKey: string,
  now: string
): void {
  if (!isRecord(event.message) || !Array.isArray(event.message.content)) return
  for (let index = 0; index < event.message.content.length; index += 1) {
    const content = event.message.content[index]
    if (!isRecord(content) || content.type !== 'thinking') continue
    if (providerOwnsThinking(thread)) {
      const blockKey = providerThinkingBlockKey(thread, turnKey, index, false)
      syncProviderThought(thread, content.thinking, blockKey, index, now, true)
      syncProviderActivities(thread, content.thinking, blockKey, index, now, false)
      continue
    }
    const activityStatus = syncProviderActivities(
      thread,
      content.thinking,
      turnKey,
      index,
      now,
      false
    )
    if (!activityStatus) {
      syncProviderReasoning(thread, turnKey, index, content.thinking, true, now)
    }
  }
}

function assistantTurnUsesTools(message: Record<string, unknown> | null): boolean {
  return Boolean(
    message &&
    (message.stopReason === 'toolUse' ||
      (Array.isArray(message.content) &&
        message.content.some((part) => isRecord(part) && part.type === 'toolCall')))
  )
}

function visibleAssistantText(
  blocks: AssistantTextBlock[],
  toolTurn: boolean
): { commentary: AssistantTextBlock[]; finalText: string } {
  const commentary = blocks.filter(
    (part) => part.phase === 'commentary' || (toolTurn && part.phase !== 'final_answer')
  )
  const finalText = blocks
    .filter((part) => part.phase === 'final_answer' || (!toolTurn && part.phase !== 'commentary'))
    .map((part) => part.text)
    .join('')
    .trim()
  return { commentary, finalText }
}

function closingAssistantText(
  blocks: AssistantTextBlock[],
  toolTurn: boolean,
  message: Record<string, unknown> | null,
  fallbackModelId?: string
): { commentary: AssistantTextBlock[]; finalText: string } {
  if (toolTurn) return visibleAssistantText(blocks, true)
  const provider = message && typeof message.provider === 'string' ? message.provider : undefined
  const model =
    message && typeof message.model === 'string'
      ? message.model
      : message && typeof message.responseModel === 'string'
        ? message.responseModel
        : fallbackModelId
  return {
    commentary: [],
    finalText: closingTextForFamily(
      piClosingFamily(provider, model),
      blocks.map((block) => ({
        ...(block.phase ? { phase: block.phase } : {}),
        text: block.text.trim()
      }))
    )
  }
}

function assistantHasVisibleAnswer(message: AgentConversationMessage): boolean {
  return Boolean(message.role === 'assistant' && message.text.trim())
}

function messagesAfterLastUser(thread: AgentConversationThread): AgentConversationMessage[] {
  const lastUserIndex = thread.messages.findLastIndex((message) => message.role === 'user')
  return thread.messages.slice(lastUserIndex + 1)
}

function findTurnAnswer(
  thread: AgentConversationThread,
  answer: string
): AgentConversationMessage | undefined {
  const needle = normalizedThreadText(answer)
  if (!needle) return undefined
  return messagesAfterLastUser(thread).find(
    (candidate) => candidate.role === 'assistant' && normalizedThreadText(candidate.text) === needle
  )
}

function findTurnCommentary(
  thread: AgentConversationThread,
  text: string
): AgentConversationMessage | undefined {
  const needle = normalizedThreadText(text)
  if (!needle) return undefined
  return messagesAfterLastUser(thread).findLast((candidate) =>
    candidate.parts?.some(
      (part) => part.type === 'commentary' && normalizedThreadText(part.text) === needle
    )
  )
}

export function threadClosingText(thread: AgentConversationThread): string {
  const tail = messagesAfterLastUser(thread)
  const text = [...tail].reverse().find(assistantHasVisibleAnswer)?.text.trim()
  if (text) return text
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const commentary = tail[index]?.parts?.find(
      (part) => part.type === 'commentary' && part.text.trim()
    )
    if (commentary?.type === 'commentary') return commentary.text.trim()
  }
  return ''
}

export function ensureVisibleFinalResponse(
  thread: AgentConversationThread,
  text: string,
  now: string
): boolean {
  const answer = text.trim()
  if (!answer) return false
  if (messagesAfterLastUser(thread).some(assistantHasVisibleAnswer)) return false
  thread.messages.push({
    completedAt: now,
    createdAt: now,
    id: `pi-final:${thread.id}:${now}`,
    role: 'assistant',
    text: answer
  })
  return true
}

function syncCompletedCommentary(
  thread: AgentConversationThread,
  id: string,
  commentary: AssistantTextBlock[],
  now: string,
  streamingId?: string
): void {
  if (commentary.length === 1 && streamingId) {
    const existing = thread.messages.find((message) => message.id === streamingId)
    const text = commentary[0]?.text.trim() ?? ''
    if (existing && text) {
      upsertMessage(thread, {
        completedAt: now,
        createdAt: existing.createdAt,
        id: streamingId,
        parts: [{ state: 'complete', text, type: 'commentary' }],
        role: 'assistant',
        text: ''
      })
      return
    }
  }
  for (const part of commentary) {
    const text = part.text.trim()
    if (!text) continue
    const existing = findTurnCommentary(thread, text)
    if (existing) {
      existing.completedAt = now
      const existingPart = existing.parts?.find(
        (candidate) =>
          candidate.type === 'commentary' &&
          normalizedThreadText(candidate.text) === normalizedThreadText(text)
      )
      if (existingPart?.type === 'commentary') existingPart.state = 'complete'
      continue
    }
    upsertMessage(thread, {
      completedAt: now,
      createdAt: now,
      id: `${id}:commentary:${String(part.index)}`,
      parts: [{ state: 'complete', text, type: 'commentary' }],
      role: 'assistant',
      text: ''
    })
  }
}

function applyAssistantText(
  thread: AgentConversationThread,
  event: Record<string, unknown>,
  turnKey: string,
  now: string
): boolean {
  if (event.type === 'message_update') return applyMessageUpdate(thread, event, turnKey, now)
  if (isRecord(event.message) && event.message.role && event.message.role !== 'assistant') {
    return false
  }
  syncCompletedThinking(thread, event, turnKey, now)
  const message = isRecord(event.message) ? event.message : null
  const toolTurn = assistantTurnUsesTools(message)
  const textBlocks = assistantTextBlocks(message)
  const { commentary, finalText } = closingAssistantText(
    textBlocks,
    toolTurn,
    message,
    thread.model
  )
  const fallbackText = textBlocks.length
    ? ''
    : piEventText(message ?? event.assistantMessageEvent).trim()
  const id = assistantId(event, turnKey)
  const streamingId = streamingAssistantId(turnKey)
  const streamingIndex = thread.messages.findIndex((candidate) => candidate.id === streamingId)
  const streaming = streamingIndex === -1 ? undefined : thread.messages[streamingIndex]
  const streamedText = streaming?.text.trim() ?? ''
  const answer = finalText || (!toolTurn ? fallbackText || streamedText : '')
  if (!commentary.length && !answer) return markRunning(thread)
  const reuseStreamingAnswer = Boolean(answer) && Boolean(streamedText)
  const completedCommentaryText = commentary.length === 1 ? commentary[0]?.text.trim() : ''
  const streamedCommentary = completedCommentaryText
    ? (findTurnCommentary(thread, completedCommentaryText) ??
      messagesAfterLastUser(thread).findLast((candidate) =>
        candidate.parts?.some((part) => part.type === 'commentary' && part.state === 'streaming')
      ))
    : undefined
  const reuseStreamingCommentary = Boolean(streamedCommentary)
  if (
    streamingIndex !== -1 &&
    streamingId !== id &&
    !reuseStreamingCommentary &&
    !reuseStreamingAnswer
  ) {
    thread.messages.splice(streamingIndex, 1)
  }
  syncCompletedCommentary(thread, id, commentary, now, streamedCommentary?.id)
  if (answer) {
    const existing = findTurnAnswer(thread, answer)
    if (existing) {
      existing.completedAt = now
    } else {
      upsertMessage(thread, {
        completedAt: now,
        createdAt: now,
        id: reuseStreamingAnswer ? streamingId : id,
        role: 'assistant',
        text: answer
      })
    }
  }
  collapseDuplicateTurnResponses(thread)
  const latest = answer || commentary.at(-1)?.text.trim() || fallbackText
  thread.recentUpdate = latest.slice(0, 500)
  return true
}

const EVENT_HANDLERS: Partial<
  Record<
    string,
    (
      thread: AgentConversationThread,
      event: Record<string, unknown>,
      turnKey: string,
      now: string
    ) => boolean
  >
> = {
  agent_end: () => true,
  agent_settled: () => true,
  agent_start: (thread) => markRunning(thread),
  message_end: applyAssistantText,
  message_update: applyAssistantText,
  session: applySession,
  session_start: applySession,
  tool_execution_end: applyTool,
  tool_execution_start: applyTool,
  tool_execution_update: applyTool,
  turn_end: applyAssistantText,
  turn_start: (thread) => markRunning(thread)
}

export function applyPiJsonEvent(
  thread: AgentConversationThread,
  line: string,
  turnKey = ''
): boolean {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch {
    return false
  }
  if (!isRecord(value) || typeof value.type !== 'string') return false
  return applyPiEvent(thread, value, turnKey)
}

export function applyPiEvent(
  thread: AgentConversationThread,
  value: Record<string, unknown>,
  turnKey = ''
): boolean {
  if (typeof value.type !== 'string') return false
  const handler = EVENT_HANDLERS[value.type]
  if (handler) return handler(thread, value, turnKey, new Date().toISOString())
  if (value.type === 'auto_retry_start') {
    thread.recentUpdate = 'Retrying…'
    return true
  }
  const error = piEventText(value.error ?? value.errorMessage)
  if (error && value.type.includes('error')) {
    thread.recentUpdate = error.slice(0, MAX_STATUS_TEXT)
    return true
  }
  return false
}

export function piToolOutputFailed(output: string): boolean {
  const text = output.trim()
  return (
    /^Failed to (?:call|connect to)\b/i.test(text) ||
    /^MCP extension session shutdown\b/i.test(text) ||
    /^MCP server .+ not available\b/i.test(text) ||
    /^Encountered error in step execution\b/i.test(text) ||
    /^The user declined approval\b/i.test(text)
  )
}
