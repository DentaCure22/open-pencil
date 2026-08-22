import { createHash } from 'node:crypto'

import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'

import {
  antigravityActivities,
  antigravityToolImages,
  pendingAntigravityOutput,
  type AntigravityActivity
} from './antigravity-activity'
import { MAX_IMAGE_BASE64_LENGTH } from './image-preview'

const MAX_ACTIVITY_TEXT = 12_000
const MAX_STATUS_TEXT = 160

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function piEventText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(piEventText).filter(Boolean).join('\n')
  if (!isRecord(value)) return ''
  if (typeof value.text === 'string') return value.text
  if (Array.isArray(value.content)) return piEventText(value.content)
  if (typeof value.summary === 'string') return value.summary
  if (typeof value.message === 'string') return value.message
  if (typeof value.errorMessage === 'string') return value.errorMessage
  return ''
}

function serialized(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function safeActivityText(value: unknown): string {
  return (piEventText(value).trim() || serialized(value))
    .replace(/(bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(
      /("(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)"\s*:\s*)"[^"]*"/gi,
      '$1"[redacted]"'
    )
    .replace(
      /((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)\s*[=:]\s*)[^\s,"']+/gi,
      '$1[redacted]'
    )
    .slice(0, MAX_ACTIVITY_TEXT)
}

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

function upsertMessage(thread: AgentConversationThread, message: AgentConversationMessage): void {
  const index = thread.messages.findIndex((candidate) => candidate.id === message.id)
  if (index !== -1) {
    const previous = thread.messages[index]
    const previousPart = previous.parts?.length === 1 ? previous.parts[0] : undefined
    const nextPart = message.parts?.length === 1 ? message.parts[0] : undefined
    const parts =
      previousPart?.type === 'tool' && nextPart?.type === 'tool'
        ? [{ ...previousPart, ...nextPart }]
        : message.parts
    thread.messages[index] = {
      ...message,
      createdAt: previous.createdAt,
      ...(parts ? { parts } : {})
    }
    return
  }
  thread.messages.push(message)
}

function toolName(event: Record<string, unknown>, previousName?: string): string {
  if ((event.toolName === 'mcp' || event.name === 'mcp') && isRecord(event.args)) {
    if (typeof event.args.tool === 'string' && event.args.tool) return event.args.tool
    if (typeof event.args.search === 'string' && event.args.search) return 'connected_app_search'
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

function preSteerAssistantId(turnKey: string, steeringMessageId: string): string {
  return `${streamingAssistantId(turnKey)}:before-steer:${steeringMessageId}`
}

function streamingAssistantText(message?: AgentConversationMessage): string {
  if (!message) return ''
  if (message.text) return message.text
  const legacyPart = message.parts?.find((part) => part.type === 'reasoning')
  return legacyPart?.type === 'reasoning' ? legacyPart.text : ''
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
  thread.messages[index] = {
    completedAt,
    createdAt: current.createdAt,
    id: preSteerAssistantId(turnKey, steeringMessageId),
    role: 'assistant',
    text
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

function thinkingId(turnKey: string, contentIndex: number): string {
  return `pi-thinking:${turnKey}:${String(contentIndex)}`
}

function antigravityToolPrefix(turnKey: string, contentIndex: number): string {
  return `pi-agy-tool:${turnKey}:${String(contentIndex)}:`
}

type AgentToolPart = Extract<
  NonNullable<AgentConversationMessage['parts']>[number],
  { type: 'tool' }
>

function antigravityActivityIdentity(activity: AntigravityActivity): {
  input?: string
  name: string
} {
  const input = activity.input ?? (activity.type === 'edit' ? activity.description : undefined)
  return {
    ...(input ? { input } : {}),
    name: activity.type === 'edit' ? 'edit' : activity.name
  }
}

function antigravityActivityStatus(activity: AntigravityActivity): string {
  return activity.type === 'edit'
    ? `Editing ${activity.description}…`
    : `${activity.name.replaceAll('_', ' ')}…`
}

function previousAntigravityTool(
  thread: AgentConversationThread,
  prefix: string,
  offset: number
): { message: AgentConversationMessage; part: AgentToolPart } | null {
  const message = thread.messages.find(
    (candidate) => candidate.id === `${prefix}${String(offset - 1)}`
  )
  const part = message?.parts?.length === 1 ? message.parts[0] : undefined
  return message && part?.type === 'tool' ? { message, part } : null
}

function completeRepeatedAntigravityActivity(
  thread: AgentConversationThread,
  prefix: string,
  offset: number,
  activity: AntigravityActivity | undefined,
  now: string
): string | null {
  if (!activity) return null
  const previous = previousAntigravityTool(thread, prefix, offset)
  if (!previous) return null
  const { input, name } = antigravityActivityIdentity(activity)
  if (
    previous.part.name !== name ||
    previous.part.input !== input ||
    !pendingAntigravityOutput(previous.part.output) ||
    pendingAntigravityOutput(activity.output)
  ) {
    return null
  }
  const images =
    activity.type === 'tool' ? antigravityToolImages(activity.name, activity.output ?? '') : []
  upsertMessage(thread, {
    completedAt: now,
    createdAt: previous.message.createdAt,
    id: previous.message.id,
    parts: [
      {
        ...(images.length ? { images } : {}),
        ...(input ? { input } : {}),
        name,
        ...(activity.output ? { output: activity.output } : {}),
        state: 'success',
        type: 'tool'
      }
    ],
    role: 'assistant',
    text: ''
  })
  return antigravityActivityStatus(activity)
}

function completePreviousAntigravityActivity(
  thread: AgentConversationThread,
  prefix: string,
  offset: number,
  now: string
): void {
  const previous = previousAntigravityTool(thread, prefix, offset)
  if (!previous || previous.part.state !== 'running') return
  upsertMessage(thread, {
    ...previous.message,
    completedAt: now,
    parts: [{ ...previous.part, state: 'success' }]
  })
}

function appendAntigravityActivities(
  thread: AgentConversationThread,
  activities: AntigravityActivity[],
  prefix: string,
  offset: number,
  now: string,
  append: boolean
): void {
  for (const [index, activity] of activities.entries()) {
    const { input, name } = antigravityActivityIdentity(activity)
    const images =
      activity.type === 'tool' ? antigravityToolImages(activity.name, activity.output ?? '') : []
    const running = append && index === activities.length - 1
    upsertMessage(thread, {
      ...(running ? {} : { completedAt: now }),
      createdAt: now,
      id: `${prefix}${String(offset + index)}`,
      parts: [
        {
          ...(input ? { input } : {}),
          ...(images.length ? { images } : {}),
          name,
          ...(activity.output ? { output: activity.output } : {}),
          state: running ? 'running' : 'success',
          type: 'tool'
        }
      ],
      role: 'assistant',
      text: ''
    })
  }
}

function syncAntigravityActivities(
  thread: AgentConversationThread,
  value: unknown,
  turnKey: string,
  contentIndex: number,
  now: string,
  append: boolean
): string | null {
  const activities = antigravityActivities(value, safeActivityText)
  if (!activities.length) return null
  const prefix = antigravityToolPrefix(turnKey, contentIndex)
  const offset = append
    ? thread.messages.filter((message) => message.id.startsWith(prefix)).length
    : 0
  if (append && offset > 0 && activities.length === 1) {
    const completed = completeRepeatedAntigravityActivity(
      thread,
      prefix,
      offset,
      activities[0],
      now
    )
    if (completed) return completed
  }
  if (append && offset > 0) completePreviousAntigravityActivity(thread, prefix, offset, now)
  appendAntigravityActivities(thread, activities, prefix, offset, now, append)
  const latest = activities.at(-1)
  return latest ? antigravityActivityStatus(latest) : null
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
  const ended = event.type === 'tool_execution_end'
  const input = safeActivityText(event.args)
  const output = safeActivityText(event.result ?? event.partialResult)
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
    upsertMessage(thread, {
      ...(complete ? { completedAt: now } : {}),
      createdAt: now,
      id: thinkingId(turnKey, contentIndex),
      parts: [
        {
          state: complete ? 'complete' : 'streaming',
          text: complete ? 'Thought' : 'Thinking',
          type: 'reasoning'
        }
      ],
      role: 'assistant',
      text: ''
    })
    const activityStatus = syncAntigravityActivities(
      thread,
      complete ? update.content : update.delta,
      turnKey,
      contentIndex,
      now,
      !complete
    )
    thread.recentUpdate = activityStatus ?? (complete ? 'Thinking complete.' : 'Thinking…')
    return true
  }
  if (update.type === 'text_delta' && typeof update.delta === 'string') {
    const id = streamingAssistantId(turnKey)
    const existing = thread.messages.find((message) => message.id === id)
    const previous = streamingAssistantText(existing)
    const text = `${previous}${update.delta}`
    upsertMessage(thread, {
      createdAt: now,
      id,
      role: 'assistant',
      text
    })
    thread.recentUpdate = text.trim().slice(0, 500) || 'Writing response…'
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
    upsertMessage(thread, {
      completedAt: now,
      createdAt: now,
      id: thinkingId(turnKey, index),
      parts: [{ state: 'complete', text: 'Thought', type: 'reasoning' }],
      role: 'assistant',
      text: ''
    })
    syncAntigravityActivities(thread, content.thinking, turnKey, index, now, false)
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
  const text = piEventText(message ?? event.assistantMessageEvent).trim()
  if (!text) return markRunning(thread)
  thread.recentUpdate = text.slice(0, 500)
  const toolTurn = Boolean(
    message &&
    (message.stopReason === 'toolUse' ||
      (Array.isArray(message.content) &&
        message.content.some((part) => isRecord(part) && part.type === 'toolCall')))
  )
  const id = assistantId(event, turnKey)
  const streamingId = streamingAssistantId(turnKey)
  const streamingIndex = thread.messages.findIndex((candidate) => candidate.id === streamingId)
  if (streamingIndex !== -1 && streamingId !== id) thread.messages.splice(streamingIndex, 1)
  upsertMessage(thread, {
    completedAt: now,
    createdAt: now,
    id,
    ...(toolTurn
      ? { parts: [{ state: 'complete' as const, text, type: 'reasoning' as const }] }
      : {}),
    role: 'assistant',
    text: toolTurn ? '' : text
  })
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
    /^MCP extension session shutdown\b/i.test(text)
  )
}
