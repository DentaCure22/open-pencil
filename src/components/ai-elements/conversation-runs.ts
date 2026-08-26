import { isRetiredMemoryTool, latestMessageCreatedAt } from './model'
import type { AiMessage, AiTurnChanges } from './types'

export type ConversationRun = {
  activity: AiMessage[]
  changes?: AiTurnChanges
  endedAt?: string
  id: string
  missingResponse: boolean
  prompt?: AiMessage & { completedAt?: string }
  startedAt?: string
  visible: AiMessage[]
}

export function hasVisibleMessageContent(message: AiMessage): boolean {
  if (message.text.trim()) return true
  return Boolean(
    message.parts?.some((part) => {
      if (part.type === 'commentary' || part.type === 'reasoning' || part.type === 'tool') {
        return false
      }
      if (part.type === 'text') return Boolean(part.text.trim())
      if (part.type === 'code') return Boolean(part.code.trim())
      return true
    })
  )
}

function withoutRetiredMemoryTools(message: AiMessage): AiMessage | null {
  const parts = message.parts?.filter(
    (part) => part.type !== 'tool' || !isRetiredMemoryTool(part.name)
  )
  if (parts && parts.length === (message.parts?.length ?? 0)) return message
  if (!parts?.length && !message.text.trim()) return null
  return { ...message, parts }
}

function commentaryFromText(message: AiMessage): AiMessage {
  const text = message.text.trim()
  const already = message.parts?.some(
    (part) => part.type === 'commentary' && part.text.trim() === text
  )
  return {
    ...message,
    parts: already
      ? message.parts
      : [{ state: 'complete', text, type: 'commentary' }, ...(message.parts ?? [])],
    text: ''
  }
}

export function conversationRuns(
  messages: readonly AiMessage[],
  options: { active?: boolean } = {}
): ConversationRun[] {
  const grouped: Array<{
    id: string
    messages: AiMessage[]
    prompt?: AiMessage & { completedAt?: string }
  }> = []
  for (const message of messages) {
    if (message.role === 'user') {
      grouped.push({ id: message.id, messages: [], prompt: message })
      continue
    }
    if (!grouped.length) grouped.push({ id: `run:${message.id}`, messages: [] })
    grouped.at(-1)?.messages.push(message)
  }

  return grouped.map((run) => {
    const answers = run.messages.filter((message) => message.text.trim())
    const lastAnswer = answers.at(-1)
    const earlierAnswers = new Set(answers.slice(0, -1).map((message) => message.id))
    const lastAnswerIndex = lastAnswer ? run.messages.indexOf(lastAnswer) : -1
    const compactUnfinishedText = Boolean(
      lastAnswer &&
      !lastAnswer.completedAt &&
      lastAnswer.text.length <= 240 &&
      !lastAnswer.text.includes('\n')
    )
    const followedByRunningTool = Boolean(
      lastAnswer &&
      run.messages
        .slice(lastAnswerIndex + 1)
        .some((message) =>
          message.parts?.some(
            (part) => part.type === 'tool' && (part.state === 'pending' || part.state === 'running')
          )
        )
    )
    const activePreamble = Boolean(
      options.active &&
      lastAnswer &&
      !lastAnswer.completedAt &&
      (compactUnfinishedText || followedByRunningTool)
    )
    if (activePreamble && lastAnswer) earlierAnswers.add(lastAnswer.id)
    const media = run.messages.filter(
      (message) => !message.text.trim() && hasVisibleMessageContent(message)
    )
    const visible =
      lastAnswer && !activePreamble
        ? [...media.filter((message) => message.id !== lastAnswer.id), lastAnswer]
        : media

    const activity = run.messages.flatMap((message) => {
      const parked = earlierAnswers.has(message.id) ? commentaryFromText(message) : message
      const kept = withoutRetiredMemoryTools(parked)
      const hasActivity = kept?.parts?.some(
        (part) =>
          part.type === 'commentary' ||
          part.type === 'reasoning' ||
          (part.type === 'tool' && !isRetiredMemoryTool(part.name))
      )
      return hasActivity && kept ? [kept] : []
    })

    return {
      activity,
      ...(run.prompt?.changes ? { changes: run.prompt.changes } : {}),
      endedAt: run.prompt?.completedAt ?? latestMessageCreatedAt(run.messages),
      id: run.id,
      missingResponse: Boolean(run.prompt && !visible.length),
      prompt: run.prompt,
      startedAt: run.prompt?.createdAt ?? run.messages[0]?.createdAt,
      visible
    }
  })
}
