import type { AgentConversationThread } from '#mcp/agent-router/contracts'

import { applyPiEvent, piEventText } from './events'
import type { PiRpcProcess } from './rpc-process'

type SessionEntry = {
  id: string
  message?: Record<string, unknown>
  timestamp?: string
  type: string
}

type SessionEntries = {
  entries: SessionEntry[]
  leafId: string | null
}

export type PiHistoryReconciliation = {
  applied: boolean
  finalResponse: string
  toolError: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sessionEntries(value: unknown): SessionEntries | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null
  const entries = value.entries.flatMap((entry): SessionEntry[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.type !== 'string')
      return []
    return [entry as SessionEntry]
  })
  return {
    entries,
    leafId: typeof value.leafId === 'string' ? value.leafId : null
  }
}

function messageContent(message: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(message.content) ? message.content.filter(isRecord) : []
}

function finalAssistantText(message: Record<string, unknown>): string {
  if (message.role !== 'assistant' || message.stopReason === 'toolUse') return ''
  if (messageContent(message).some((part) => part.type === 'toolCall')) return ''
  return piEventText(message).trim()
}

function entryTimestamp(entry: SessionEntry, message: Record<string, unknown>): string {
  if (typeof message.timestamp === 'number') return new Date(message.timestamp).toISOString()
  if (typeof entry.timestamp === 'string') return entry.timestamp
  return new Date().toISOString()
}

function applyBaselineTail(thread: AgentConversationThread, entries: SessionEntry[]): string {
  const lastUserIndex = entries.findLastIndex((entry) => entry.message?.role === 'user')
  const finalEntry = entries
    .slice(lastUserIndex + 1)
    .findLast((entry) => entry.message && finalAssistantText(entry.message))
  if (!finalEntry?.message) return ''
  const text = finalAssistantText(finalEntry.message)
  const latestUserIndex = thread.messages.findLastIndex((message) => message.role === 'user')
  if (
    thread.messages
      .slice(latestUserIndex + 1)
      .some((message) => message.role === 'assistant' && message.text === text)
  ) {
    return text
  }
  const timestamp = entryTimestamp(finalEntry, finalEntry.message)
  thread.messages.push({
    completedAt: timestamp,
    createdAt: timestamp,
    id: `pi-session:${finalEntry.id}`,
    role: 'assistant',
    text
  })
  return text
}

function applyIncrementalEntries(
  thread: AgentConversationThread,
  entries: SessionEntry[],
  turnKey: string
): PiHistoryReconciliation {
  let applied = false
  let finalResponse = ''
  let toolError = ''
  for (const entry of entries) {
    const message = entry.message
    if (!message) continue
    if (message.role === 'assistant') {
      if (applyPiEvent(thread, { message, type: 'message_end' }, turnKey)) applied = true
      const text = finalAssistantText(message)
      if (text) finalResponse = text
      for (const part of messageContent(message)) {
        if (part.type !== 'toolCall' || typeof part.id !== 'string') continue
        if (
          applyPiEvent(
            thread,
            {
              args: part.arguments,
              toolCallId: part.id,
              toolName: typeof part.name === 'string' ? part.name : 'tool',
              type: 'tool_execution_start'
            },
            turnKey
          )
        ) {
          applied = true
        }
      }
      continue
    }
    if (
      message.role !== 'toolResult' ||
      typeof message.toolCallId !== 'string' ||
      typeof message.toolName !== 'string'
    ) {
      continue
    }
    const result = message.content
    if (
      applyPiEvent(
        thread,
        {
          isError: message.isError === true,
          result,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          type: 'tool_execution_end'
        },
        turnKey
      )
    ) {
      applied = true
    }
    if (message.isError === true) toolError = `${message.toolName} failed.`
  }
  return { applied, finalResponse, toolError }
}

export async function reconcilePiSessionHistory(
  thread: AgentConversationThread,
  process: Pick<PiRpcProcess, 'command'>,
  turnKey: string
): Promise<PiHistoryReconciliation> {
  const cursor = thread.lastPiEntryId
  let response = await process.command({
    ...(cursor ? { since: cursor } : {}),
    type: 'get_entries'
  })
  let incremental = thread.piHistoryInitialized === true
  if (!response.success && cursor) {
    response = await process.command({ type: 'get_entries' })
    incremental = false
  }
  if (!response.success) return { applied: false, finalResponse: '', toolError: '' }
  const result = sessionEntries(response.data)
  if (!result) return { applied: false, finalResponse: '', toolError: '' }
  const reconciled = incremental
    ? applyIncrementalEntries(thread, result.entries, turnKey)
    : {
        applied: false,
        finalResponse: applyBaselineTail(thread, result.entries),
        toolError: ''
      }
  if (result.leafId) thread.lastPiEntryId = result.leafId
  thread.piHistoryInitialized = true
  return reconciled
}
