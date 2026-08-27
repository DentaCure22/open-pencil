import type { ConversationRun } from './conversation-runs'

export type BotPresencePhase = 'thinking' | 'typing' | 'working'

function hasStreamingAnswer(run: ConversationRun): boolean {
  return run.visible.some(
    (message) =>
      message.role === 'assistant' &&
      !message.completedAt &&
      (Boolean(message.text.trim()) ||
        Boolean(
          message.parts?.some(
            (part) =>
              (part.type === 'text' || part.type === 'code') &&
              ('text' in part ? Boolean(part.text.trim()) : Boolean(part.code.trim()))
          )
        ))
  )
}

export function botPresencePhase(run: ConversationRun): BotPresencePhase {
  if (hasStreamingAnswer(run)) return 'typing'

  for (const message of [...run.activity].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      if (part.type === 'tool' && (part.state === 'pending' || part.state === 'running')) {
        return 'working'
      }
      if (part.type === 'reasoning' && part.state === 'streaming') return 'thinking'
      if (part.type === 'commentary' && part.state === 'streaming') return 'working'
    }
  }
  if (run.activity.length) return 'working'
  return 'thinking'
}
