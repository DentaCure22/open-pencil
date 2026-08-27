import { nextTick, type ComputedRef, type Ref } from 'vue'

export function createConversationScrollMemory() {
  const positions = new Map<string, number>()
  return {
    read: (identity: string) => positions.get(identity),
    remember: (identity: string, scrollTop: number) => positions.set(identity, scrollTop)
  }
}

type ConversationScrollOptions = {
  identity: ComputedRef<string>
  panel: Ref<HTMLElement | null>
}

export function useConversationScrollMemory(options: ConversationScrollOptions) {
  const memory = createConversationScrollMemory()

  function viewport(): HTMLElement | null {
    return (
      options.panel.value?.querySelector<HTMLElement>(
        '[data-test-id="ai-conversation-viewport"]'
      ) ?? null
    )
  }

  function retain() {
    const identity = options.identity.value
    const element = viewport()
    if (identity && element) memory.remember(identity, element.scrollTop)
  }

  async function restore(identity: string) {
    const scrollTop = memory.read(identity)
    if (scrollTop === undefined) return
    await nextTick()
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve())
        return
      }
      resolve()
    })
    if (options.identity.value !== identity) return
    const element = viewport()
    if (element) element.scrollTop = scrollTop
  }

  return { read: memory.read, restore, retain }
}
