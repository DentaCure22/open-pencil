<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watchEffect } from 'vue'

import T3ComposerCommandMenu from './T3ComposerCommandMenu'
import type { T3ComposerCommandItem, T3ComposerTriggerKind } from './t3-chat-chrome.logic'

const { activeItemId, emptyStateText, isLoading, items, triggerKind } = defineProps<{
  activeItemId: string | null
  emptyStateText?: string
  isLoading: boolean
  items: T3ComposerCommandItem[]
  triggerKind: T3ComposerTriggerKind
}>()
const emit = defineEmits<{ highlight: [id: string]; select: [id: string] }>()
const host = useTemplateRef<HTMLDivElement>('host')
const root = shallowRef<Root>()

function renderMenu() {
  root.value?.render(
    createElement(T3ComposerCommandMenu, {
      activeItemId,
      emptyStateText,
      isLoading,
      items,
      onHighlight: (id: string) => emit('highlight', id),
      onSelect: (id: string) => emit('select', id),
      triggerKind
    })
  )
}

onMounted(() => {
  const element = host.value
  if (!element) return
  root.value = createRoot(element)
  renderMenu()
})

watchEffect(renderMenu)

onBeforeUnmount(() => {
  root.value?.unmount()
  root.value = undefined
})
</script>

<template>
  <div ref="host" class="contents" data-test-id="t3-composer-command-island" />
</template>
