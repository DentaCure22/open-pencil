import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  isConversationThread,
  previewAgentConversation,
  type AgentConversationThread
} from './contracts'

export function conversationThreadBodiesDirectory(historyPath: string): string {
  const extension = path.extname(historyPath)
  const base = extension ? path.basename(historyPath, extension) : path.basename(historyPath)
  return path.join(path.dirname(historyPath), `${base}-threads`)
}

export function conversationThreadBodyPath(historyPath: string, threadId: string): string {
  return path.join(
    conversationThreadBodiesDirectory(historyPath),
    `${encodeURIComponent(threadId)}.json`
  )
}

export function conversationPersistSignature(thread: AgentConversationThread): string {
  return [
    thread.updatedAt,
    thread.state,
    thread.recentUpdate,
    thread.lastPiEntryId ?? '',
    String(thread.messages.length),
    thread.messages
      .map((message) => {
        const partMarks = (message.parts ?? [])
          .map((part) => {
            if (!part || typeof part !== 'object') return '0'
            const record = part as Record<string, unknown>
            const output = typeof record.output === 'string' ? record.output.length : 0
            const input = typeof record.input === 'string' ? record.input.length : 0
            return `${record.type ?? ''}:${output}:${input}`
          })
          .join('.')
        return `${message.id}:${message.completedAt ?? ''}:${String(message.text.length)}:${partMarks}`
      })
      .join(',')
  ].join('|')
}

function readThreadBody(historyPath: string, threadId: string): AgentConversationThread | null {
  try {
    const value: unknown = JSON.parse(
      readFileSync(conversationThreadBodyPath(historyPath, threadId), 'utf8')
    )
    return isConversationThread(value) ? value : null
  } catch {
    return null
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp`
  writeFileSync(temporary, JSON.stringify(value))
  renameSync(temporary, filePath)
}

export function readAgentConversationHistory(historyPath?: string): AgentConversationThread[] {
  if (!historyPath) return []
  try {
    const value: unknown = JSON.parse(readFileSync(historyPath, 'utf8'))
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
      if (!isConversationThread(entry)) return []
      return [readThreadBody(historyPath, entry.id) ?? entry]
    })
  } catch {
    return []
  }
}

export function writeAgentConversationHistory(
  historyPath: string,
  threads: readonly AgentConversationThread[],
  written: Map<string, string>
): void {
  const live = new Set(threads.map((thread) => thread.id))
  for (const [threadId, signature] of written) {
    if (live.has(threadId)) continue
    try {
      unlinkSync(conversationThreadBodyPath(historyPath, threadId))
    } catch {
      // The body may already be gone.
    }
    written.delete(threadId)
  }
  for (const thread of threads) {
    const signature = conversationPersistSignature(thread)
    if (written.get(thread.id) === signature) continue
    writeJsonFile(conversationThreadBodyPath(historyPath, thread.id), thread)
    written.set(thread.id, signature)
  }
  writeJsonFile(
    historyPath,
    threads.map((thread) => previewAgentConversation(thread))
  )
}
