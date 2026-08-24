import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'

function singleReasoningPart(message: AgentConversationMessage) {
  if (message.parts?.length !== 1) return null
  const part = message.parts[0]
  return part.type === 'reasoning' ? part : null
}

function placeholderReasoning(message: AgentConversationMessage): boolean {
  const part = singleReasoningPart(message)
  return Boolean(part && ['thinking', 'thought'].includes(part.text.trim().toLowerCase()))
}

function legacyCommentary(message: AgentConversationMessage): boolean {
  return Boolean(singleReasoningPart(message) && message.id.startsWith('pi-agent:'))
}

/**
 * Older bridges used one `reasoning` part for both provider summaries and
 * user-facing preambles. Keep provider reasoning, and move `pi-agent:`
 * preambles to commentary.
 */
export function migrateProviderActivityHistory(thread: AgentConversationThread): boolean {
  let changed = false
  const messages: AgentConversationMessage[] = []
  for (const message of thread.messages) {
    if (placeholderReasoning(message)) {
      changed = true
      continue
    }
    if (legacyCommentary(message)) {
      const part = singleReasoningPart(message)
      if (!part) continue
      messages.push({
        ...message,
        parts: [{ ...part, type: 'commentary' }]
      })
      changed = true
      continue
    }
    messages.push(message)
  }
  if (changed) thread.messages = messages
  return changed
}
