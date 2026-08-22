import type { ChatTransport, UIMessage } from 'ai'
import { shallowRef } from 'vue'

export type ChatTransportFactory = () => ChatTransport<UIMessage>

export const chatTransportOverride = shallowRef<ChatTransportFactory | null>(null)

export function setChatTransportOverride(factory: ChatTransportFactory | null) {
  chatTransportOverride.value = factory
}
