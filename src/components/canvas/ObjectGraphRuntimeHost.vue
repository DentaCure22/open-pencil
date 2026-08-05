<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useEditorStore } from '@/app/editor/active-store'
import { ObjectGraphSurface } from '@/app/object-graph/surface'

const store = useEditorStore()
const host = ref<HTMLDivElement | null>(null)
let root: Root | null = null

onMounted(() => {
  if (!host.value) return
  root = createRoot(host.value)
  root.render(createElement(ObjectGraphSurface, { store }))
})

onUnmounted(() => {
  root?.unmount()
  root = null
})
</script>

<template>
  <div
    ref="host"
    class="pointer-events-none absolute inset-0 z-[12] size-full"
    aria-label="Board connections"
    data-test-id="object-graph-runtime"
  />
</template>
