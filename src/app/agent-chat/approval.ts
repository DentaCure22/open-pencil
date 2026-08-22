import type { AgentExtensionUiRequest, AgentExtensionUiResponse } from './client'

export type MessageApprovalPreview = {
  recipient: string
  text: string
}

export type MessageApprovalState = 'cancelled' | 'failed' | 'pending' | 'sending' | 'sent'

type MessageToolPreviewInput = {
  input?: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function messagePreviewFromArguments(value: unknown): MessageApprovalPreview | null {
  if (!isRecord(value) || typeof value.text !== 'string' || !value.text) return null
  const label = typeof value.recipient_label === 'string' ? value.recipient_label.trim() : ''
  const chatGuid = typeof value.chat_guid === 'string' ? value.chat_guid.trim() : ''
  if (!label && !chatGuid) return null
  return { recipient: label || chatGuid, text: value.text }
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
