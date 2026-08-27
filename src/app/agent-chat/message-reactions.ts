import { useLocalStorage } from '@vueuse/core'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export const AGENT_MESSAGE_REACTIONS = ['like', 'love', 'smile'] as const

export type AgentMessageReactionKind = (typeof AGENT_MESSAGE_REACTIONS)[number]

export type AgentMessageReactionEvent = {
  actorId: string
  channel: 'imessage' | 'openpencil'
  createdAt: string
  id: string
  kind: AgentMessageReactionKind
}

const LOCAL_ACTOR_ID = 'viewer'
const reactionLabels: Record<AgentMessageReactionKind, string> = {
  like: 'Like',
  love: 'Love',
  smile: 'Smile'
}

const reactionEvents = useLocalStorage<Record<string, AgentMessageReactionEvent[]>>(
  'open-pencil:agent-message-reactions-v1',
  {}
)

function isReactionKind(value: unknown): value is AgentMessageReactionKind {
  return AGENT_MESSAGE_REACTIONS.includes(value as AgentMessageReactionKind)
}

function isReactionEvent(value: unknown): value is AgentMessageReactionEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<AgentMessageReactionEvent>
  return (
    typeof event.actorId === 'string' &&
    (event.channel === 'imessage' || event.channel === 'openpencil') &&
    typeof event.createdAt === 'string' &&
    typeof event.id === 'string' &&
    isReactionKind(event.kind)
  )
}

export function agentMessageReactionKey(threadId: string | undefined, messageId: string): string {
  return JSON.stringify([threadId ?? null, messageId])
}

export function agentMessageReactionLabel(reaction: AgentMessageReactionKind): string {
  return reactionLabels[reaction]
}

export function useAgentMessageReaction(
  threadId: MaybeRefOrGetter<string | undefined>,
  messageId: MaybeRefOrGetter<string>
) {
  const key = computed(() => agentMessageReactionKey(toValue(threadId), toValue(messageId)))
  const events = computed(() => {
    const stored = reactionEvents.value[key.value]
    return Array.isArray(stored) ? stored.filter(isReactionEvent) : []
  })
  const reaction = computed(() =>
    events.value.find((event) => event.actorId === LOCAL_ACTOR_ID && event.channel === 'openpencil')
  )
  const count = computed(() =>
    reaction.value ? events.value.filter((event) => event.kind === reaction.value?.kind).length : 0
  )

  function toggle(next: AgentMessageReactionKind): void {
    const current = reaction.value
    const remainingEvents = events.value.filter(
      (event) => !(event.actorId === LOCAL_ACTOR_ID && event.channel === 'openpencil')
    )
    const nextEvents =
      current?.kind === next
        ? remainingEvents
        : [
            ...remainingEvents,
            {
              actorId: LOCAL_ACTOR_ID,
              channel: 'openpencil' as const,
              createdAt: new Date().toISOString(),
              id: `local:${key.value}:${Date.now().toString(36)}`,
              kind: next
            }
          ]
    const { [key.value]: _currentEvents, ...remainingMessages } = reactionEvents.value
    reactionEvents.value = nextEvents.length
      ? { ...remainingMessages, [key.value]: nextEvents }
      : remainingMessages
  }

  return { count, reaction, toggle }
}
