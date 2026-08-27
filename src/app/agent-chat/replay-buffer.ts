import type { AiMessage, AiMessagePart } from './types'

/** Keep the start of a leftover tool dump so the invocation stays readable. */
export const REPLAY_BUFFER_HEAD_CHARS = 1_200
/** Keep the end of a leftover tool dump so the result stays readable. */
export const REPLAY_BUFFER_TAIL_CHARS = 1_200
/** Leave this many newest user turns unclipped in the open Vue transcript. */
export const LOADED_TRANSCRIPT_FULL_TURN_LIMIT = 2

export function clipReplayText(
  value: string,
  head = REPLAY_BUFFER_HEAD_CHARS,
  tail = REPLAY_BUFFER_TAIL_CHARS
): string {
  const marker = '\n…\n'
  const budget = Math.max(0, head) + Math.max(0, tail)
  if (budget <= 0) return ''
  if (value.length <= budget) return value
  if (head <= 0) return value.slice(-Math.min(tail, budget))
  if (tail <= 0) {
    const take = Math.max(0, budget - 1)
    return `${value.slice(0, take).trimEnd()}…`
  }
  const available = Math.max(0, budget - marker.length)
  if (available <= 0) return '…'
  const headTake = Math.min(head, Math.ceil(available / 2))
  const tailTake = Math.max(0, available - headTake)
  return `${value.slice(0, headTake).trimEnd()}${marker}${value.slice(-tailTake).trimStart()}`
}

function clipToolPart(
  part: Extract<AiMessagePart, { type: 'tool' }>
): Extract<AiMessagePart, { type: 'tool' }> {
  const input = typeof part.input === 'string' ? clipReplayText(part.input) : part.input
  const output = typeof part.output === 'string' ? clipReplayText(part.output) : part.output
  if (input === part.input && output === part.output) return part
  return {
    ...part,
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output })
  }
}

function clipMessageTools(message: AiMessage): AiMessage {
  if (!message.parts?.length) return message
  const parts = message.parts.map((part) => {
    if (part.type !== 'tool') return part
    return clipToolPart(part)
  })
  const changed = parts.some((part, index) => part !== message.parts?.at(index))
  return changed ? { ...message, parts } : message
}

export function boundLoadedTranscript(messages: AiMessage[]): AiMessage[] {
  const userIndexes: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') userIndexes.push(index)
  })
  if (userIndexes.length === 0) return messages
  const keepFullFrom = userIndexes.at(-LOADED_TRANSCRIPT_FULL_TURN_LIMIT) ?? userIndexes.at(0) ?? 0
  const next = messages.map((message, index) => {
    if (index >= keepFullFrom) return message
    return clipMessageTools(message)
  })
  const changed = next.some((message, index) => message !== messages.at(index))
  return changed ? next : messages
}
