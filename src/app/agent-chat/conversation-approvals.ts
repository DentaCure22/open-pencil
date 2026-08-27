import { computed, ref, type ComputedRef } from 'vue'

import {
  messageApprovalPreview,
  messageToolPreview,
  type AgentExtensionUiResponse,
  type MessageApprovalPreview,
  type MessageApprovalState
} from './approval'
import type { AgentConversationThread } from './conversations'
import type { AiMessage } from './types'

type MessageApprovalFeedback = {
  preview: MessageApprovalPreview
  requestId: string
  requestedAt: string
  state: Exclude<MessageApprovalState, 'pending'>
  threadId: string
}

export type MessageApprovalCard = {
  key: string
  preview?: MessageApprovalPreview
  request?: AgentConversationThread['pendingUiRequests'][number]
  runId: string
  state: MessageApprovalState
}

type ConversationApprovalsOptions = {
  selectedThread: ComputedRef<AgentConversationThread | null>
  visibleMessages: ComputedRef<AiMessage[]>
}

function samePreview(left: MessageApprovalPreview, right: MessageApprovalPreview): boolean {
  return (
    left.recipient === right.recipient &&
    left.texts.length === right.texts.length &&
    left.texts.every((text, index) => text === right.texts[index])
  )
}

function runIdFor(messages: AiMessage[], requestedAt: string): string {
  if (!messages.length) return 'unattached'
  const requestedTime = Date.parse(requestedAt)
  const first = messages[0]
  let runId = first.role === 'user' ? first.id : `run:${first.id}`
  for (const message of messages) {
    if (message.role !== 'user') continue
    if (Number.isFinite(requestedTime) && Date.parse(message.createdAt) > requestedTime) break
    runId = message.id
  }
  return runId
}

function latestRunId(messages: AiMessage[]): string {
  const latestUser = [...messages].reverse().find((message) => message.role === 'user')
  if (latestUser) return latestUser.id
  return messages.length ? `run:${messages[0].id}` : 'unattached'
}

function feedbackState(
  feedback: MessageApprovalFeedback,
  messages: AiMessage[]
): Exclude<MessageApprovalState, 'pending'> {
  if (feedback.state !== 'sending') return feedback.state
  for (const message of [...messages].reverse()) {
    for (const part of [...(message.parts ?? [])].reverse()) {
      if (part.type !== 'tool') continue
      const preview = messageToolPreview(part)
      if (!preview || !samePreview(preview, feedback.preview)) continue
      if (part.state === 'success') return 'sent'
      if (part.state === 'error') return 'failed'
      return feedback.state
    }
  }
  return feedback.state
}

function hasNewerUserMessage(messages: AiMessage[], requestedAt: string): boolean {
  const requestedTime = Date.parse(requestedAt)
  if (!Number.isFinite(requestedTime)) return false
  return messages.some(
    (message) => message.role === 'user' && Date.parse(message.createdAt) > requestedTime
  )
}

function buildCards(
  thread: AgentConversationThread | null,
  messages: AiMessage[],
  feedbackEntries: MessageApprovalFeedback[]
): MessageApprovalCard[] {
  if (!thread) return []
  const toolCards: MessageApprovalCard[] = []
  for (const message of messages) {
    for (const [partIndex, part] of (message.parts ?? []).entries()) {
      if (part.type !== 'tool') continue
      const preview = messageToolPreview(part)
      if (!preview) continue
      let state: MessageApprovalState = 'sending'
      if (part.state === 'success') state = 'sent'
      else if (part.state === 'error') state = 'failed'
      toolCards.push({
        key: `tool:${message.id}:${String(partIndex)}`,
        preview,
        runId: runIdFor(messages, message.createdAt),
        state
      })
    }
  }

  const feedback = feedbackEntries.filter((item) => item.threadId === thread.id)
  const cards: MessageApprovalCard[] = feedback
    .filter((item) => {
      const runId = runIdFor(messages, item.requestedAt)
      return !toolCards.some(
        (card) => card.preview && card.runId === runId && samePreview(card.preview, item.preview)
      )
    })
    .map((item) => ({
      key: `feedback:${item.requestId}`,
      preview: item.preview,
      runId: runIdFor(messages, item.requestedAt),
      state: feedbackState(item, thread.messages)
    }))
  cards.push(...toolCards)

  const feedbackIds = new Set(feedback.map((item) => item.requestId))
  for (const request of thread.pendingUiRequests) {
    if (feedbackIds.has(request.id)) continue
    const preview = messageApprovalPreview(request)
    const runId = runIdFor(messages, request.requestedAt)
    if (
      preview &&
      toolCards.some(
        (card) => card.preview && card.runId === runId && samePreview(card.preview, preview)
      )
    ) {
      continue
    }
    const superseded = hasNewerUserMessage(messages, request.requestedAt)
    if (superseded && !preview) continue
    cards.push({
      key: `request:${request.id}`,
      ...(preview ? { preview } : {}),
      ...(superseded ? {} : { request }),
      runId,
      state: superseded ? 'cancelled' : 'pending'
    })
  }
  return cards
}

export function useConversationApprovals(options: ConversationApprovalsOptions) {
  const feedback = ref<MessageApprovalFeedback[]>([])
  const cards = computed(() =>
    buildCards(options.selectedThread.value, options.visibleMessages.value, feedback.value)
  )
  const hasSurface = computed(() =>
    cards.value.some((card) => card.runId === latestRunId(options.visibleMessages.value))
  )

  function record(entry: MessageApprovalFeedback): void {
    const index = feedback.value.findIndex(
      (item) => item.threadId === entry.threadId && item.requestId === entry.requestId
    )
    if (index === -1) {
      feedback.value = [...feedback.value, entry]
      return
    }
    feedback.value = feedback.value.map((item, itemIndex) => (itemIndex === index ? entry : item))
  }

  function remove(threadId: string, requestId: string): void {
    feedback.value = feedback.value.filter(
      (item) => item.threadId !== threadId || item.requestId !== requestId
    )
  }

  function supersedePending(thread: AgentConversationThread): string[] {
    const requestIds: string[] = []
    for (const request of thread.pendingUiRequests) {
      const preview = messageApprovalPreview(request)
      if (!preview) continue
      requestIds.push(request.id)
      record({
        preview,
        requestId: request.id,
        requestedAt: request.requestedAt,
        state: 'cancelled',
        threadId: thread.id
      })
    }
    return requestIds
  }

  function beginResponse(
    thread: AgentConversationThread,
    requestId: string,
    response: AgentExtensionUiResponse
  ): boolean {
    const request = thread.pendingUiRequests.find((candidate) => candidate.id === requestId)
    const preview = request ? messageApprovalPreview(request) : null
    if (!request || !preview) return false
    const approved = response.confirmed === true || /^allow once$/i.test(response.value ?? '')
    record({
      preview,
      requestId,
      requestedAt: request.requestedAt,
      state: approved ? 'sending' : 'cancelled',
      threadId: thread.id
    })
    return true
  }

  function cardsForRun(runId: string): MessageApprovalCard[] {
    return cards.value.filter((card) => card.runId === runId)
  }

  return {
    beginResponse,
    cardsForRun,
    hasSurface,
    remove,
    supersedePending
  }
}
