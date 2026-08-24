import type { AgentExtensionUiRequest, AgentExtensionUiResponse } from './client'

export type MessageApprovalPreview = {
  recipient: string
  texts: string[]
}

export type MessageApprovalState = 'cancelled' | 'failed' | 'pending' | 'sending' | 'sent'

type MessageToolPreviewInput = {
  input?: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function nestedMessageArguments(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (typeof value.text === 'string' || Array.isArray(value.texts)) return value
  for (const key of ['Arguments', 'arguments', 'args']) {
    const nested = value[key]
    if (isRecord(nested)) {
      const result = nestedMessageArguments(nested)
      if (result) return result
    }
  }
  return null
}

function messageTexts(args: Record<string, unknown>): string[] | null {
  const hasText = typeof args.text === 'string'
  const hasTexts = Array.isArray(args.texts)
  if (hasText === hasTexts) return null
  if (typeof args.text === 'string') return args.text ? [args.text] : null
  const texts = args.texts as unknown[]
  if (!texts.length || texts.some((text) => typeof text !== 'string' || !text)) return null
  return texts as string[]
}

function messagePreviewFromArguments(value: unknown): MessageApprovalPreview | null {
  const args = nestedMessageArguments(value)
  if (!args) return null
  const texts = messageTexts(args)
  if (!texts) return null
  const label = typeof args.recipient_label === 'string' ? args.recipient_label.trim() : ''
  const chatGuid = typeof args.chat_guid === 'string' ? args.chat_guid.trim() : ''
  if (!label && !chatGuid) return null
  return { recipient: label || chatGuid, texts }
}

export function messageApprovalPreview(
  request: AgentExtensionUiRequest
): MessageApprovalPreview | null {
  const marker = '\n\nArguments:\n'
  const markerIndex = request.title.lastIndexOf(marker)
  if (markerIndex === -1) return null
  const heading = request.title.slice(0, markerIndex)
  if (!/\bwants to run\s+send_message\b/i.test(heading)) return null
  try {
    return messagePreviewFromArguments(JSON.parse(request.title.slice(markerIndex + marker.length)))
  } catch {
    return null
  }
}

export function messageToolPreview(tool: MessageToolPreviewInput): MessageApprovalPreview | null {
  const name = tool.name.toLowerCase()
  if (
    name !== 'send_message' &&
    !name.includes('messages__send') &&
    !name.includes('messages.send_message')
  ) {
    return null
  }
  if (!tool.input) return null
  try {
    return messagePreviewFromArguments(JSON.parse(tool.input))
  } catch {
    return null
  }
}

export function approveExtensionUiRequest(
  request: AgentExtensionUiRequest
): AgentExtensionUiResponse | null {
  if (request.method === 'confirm') return { confirmed: true }
  const value = request.options?.find((option) => /^allow once$/i.test(option))
  return value ? { value } : null
}

export function denyExtensionUiRequest(request: AgentExtensionUiRequest): AgentExtensionUiResponse {
  if (request.method === 'confirm') return { confirmed: false }
  const value = request.options?.find((option) => /^deny$/i.test(option))
  return value ? { value } : { cancelled: true }
}
