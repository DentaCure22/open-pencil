import { messageParts } from './model'
import type { AiMessage } from './types'

const MAX_PROMPT_PREVIEW_LENGTH = 400
const MAX_RESPONSE_PREVIEW_LENGTH = 1_600

export type ConversationNavigationItem = {
  id: string
  prompt: string
  response: string
}

function boundedPreview(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value
  return `${value.slice(0, maximumLength - 1).trimEnd()}…`
}

function navigationMessageText(message: AiMessage): string {
  const text = message.text.trim()
  if (text) return text

  return messageParts(message)
    .flatMap((part) => {
      if (part.type === 'text') return [part.text.trim()]
      if (part.type === 'code') return [part.code.trim()]
      if (part.type === 'attachment') return [`Attachment: ${part.name}`]
      if (part.type === 'image') return [part.alt?.trim() || 'Image']
      return []
    })
    .filter(Boolean)
    .join('\n\n')
}

export function conversationNavigationItems(
  messages: readonly AiMessage[]
): ConversationNavigationItem[] {
  const items: ConversationNavigationItem[] = []
  let current: ConversationNavigationItem | undefined

  for (const message of messages) {
    if (message.role === 'user') {
      current = {
        id: message.id,
        prompt: boundedPreview(
          navigationMessageText(message) || '(No content)',
          MAX_PROMPT_PREVIEW_LENGTH
        ),
        response: ''
      }
      items.push(current)
      continue
    }

    if (message.role !== 'assistant' || !current) continue
    const response = navigationMessageText(message)
    if (!response) continue
    current.response = boundedPreview(
      [current.response, response].filter(Boolean).join('\n\n'),
      MAX_RESPONSE_PREVIEW_LENGTH
    )
  }

  return items
}
