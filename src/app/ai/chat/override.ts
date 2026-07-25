import type { ChatTransport, UIMessage } from 'ai'
import { shallowRef } from 'vue'

export type ChatTransportFactory = () => ChatTransport<UIMessage>

export const chatTransportOverride = shallowRef<ChatTransportFactory | null>(null)

const listeners = new Set<(factory: ChatTransportFactory | null) => void>()

export function setChatTransportOverride(factory: ChatTransportFactory | null) {
  chatTransportOverride.value = factory
  for (const listener of listeners) listener(factory)
}

export function onChatTransportOverride(listener: (factory: ChatTransportFactory | null) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
