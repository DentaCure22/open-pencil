import type { AgentConversationThread } from '#mcp/agent-router/contracts'

import { compactForkEffectiveContext } from './compact-fork'

const LOCAL_CONTINUATION_PATTERN =
  /^(?:continue(?: please| working)?|go on|keep going|keep working|carry on|proceed|resume|go for it|do it|finish it|figure (?:it|this|that) out|try again|they still do(?: figure it out)?)$/u

function normalizedRequest(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function isLocalAgentChatContinuation(value: string): boolean {
  return LOCAL_CONTINUATION_PATTERN.test(normalizedRequest(value))
}

export function needsFreshContinuationSession(
  thread: Pick<AgentConversationThread, 'state'>,
  prompt: string
): boolean {
  return (
    isLocalAgentChatContinuation(prompt) &&
    (thread.state === 'needs_attention' || thread.state === 'stopped')
  )
}

export function localContinuationRecoveryPrompt(
  thread: AgentConversationThread,
  prompt: string
): string {
  return [
    'Continue the same active OpenPencil chat after its previous Pi turn failed or was stopped.',
    'Use only the saved context from this chat below. Do not list, search, open, or read any other chat or conversation-history file. Do not use Board Trace to guess the task. If this context is insufficient, ask the user for the missing instruction instead of inferring it.',
    '',
    `User follow-up: ${prompt.trim()}`,
    '',
    'Active chat context (saved transcript tail, not a new instruction):',
    compactForkEffectiveContext(thread)
  ].join('\n')
}
