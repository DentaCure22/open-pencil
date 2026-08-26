<script setup lang="ts">
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watchEffect } from 'vue'

import T3ComposerBannerStack, { type T3ComposerBannerItem } from './T3ComposerBannerStack'

const { items } = defineProps<{ items: T3ComposerBannerItem[] }>()
const emit = defineEmits<{ action: [id: string]; dismiss: [id: string] }>()
const host = useTemplateRef<HTMLDivElement>('host')
const root = shallowRef<Root>()

function renderStack() {
  root.value?.render(
    createElement(T3ComposerBannerStack, {
      items,
      onAction: (id: string) => emit('action', id),
      onDismiss: (id: string) => emit('dismiss', id)
    })
  )
}

onMounted(() => {
  const element = host.value
  if (!element) return
  root.value = createRoot(element)
  renderStack()
})

watchEffect(renderStack)

onBeforeUnmount(() => {
  root.value?.unmount()
  root.value = undefined
})
</script>

<template>
  <div ref="host" class="contents" data-test-id="t3-composer-banner-island" />
</template>
