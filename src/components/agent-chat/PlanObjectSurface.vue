<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { createCodeObjectBoardClient, dispatchCodeObjectBoardAction } from '@/app/code-object/model'
import { cachedCodeObjectDocument } from '@/app/code-object/overlays'
import { loadCodeObjectRuntime, loadedCodeObjectRuntime } from '@/app/code-object/runtime'
import { isWorkPlanDocument } from '@/app/code-object/work-plan-link'
import { useAppTheme } from '@/app/shell/theme'

const { objectId } = defineProps<{ objectId: string }>()

const store = useEditorStore()
const { resolvedTheme } = useAppTheme()
const host = useTemplateRef<HTMLDivElement>('host')
const error = ref('')
let renderEpoch = 0
let runtimeId: string | null = null
let unsubscribe: Array<() => void> = []

function disposeRuntime() {
  if (runtimeId) loadedCodeObjectRuntime()?.disposeCodeObject(runtimeId)
  runtimeId = null
}

async function renderPlan() {
  const epoch = ++renderEpoch
  await nextTick()
  const element = host.value
  const node = store.graph.getNode(objectId)
  const document = node ? cachedCodeObjectDocument(node) : null
  if (!element || !node || !isWorkPlanDocument(document) || !document) {
    error.value = 'This Plan is not available in the current workspace.'
    disposeRuntime()
    return
  }

  const nextRuntimeId = `object-panel-plan:${objectId}`
  const runtime = await loadCodeObjectRuntime()
  if (epoch !== renderEpoch) return
  if (runtimeId && runtimeId !== nextRuntimeId) runtime.disposeCodeObject(runtimeId)
  runtimeId = nextRuntimeId
  error.value = ''

  const dispatchBoardAction = async (action: Parameters<typeof dispatchCodeObjectBoardAction>[2]) =>
    dispatchCodeObjectBoardAction(store, objectId, action, {
      interactionEnabled: false
    })

  runtime.attachCodeObject(nextRuntimeId, element)
  runtime.renderCodeObject(nextRuntimeId, document, () => undefined, {
    board: createCodeObjectBoardClient(store, objectId, dispatchBoardAction),
    dispatchBoardAction,
    interactionEnabled: false,
    theme: resolvedTheme.value
  })
}

watch([() => objectId, resolvedTheme], () => void renderPlan(), { flush: 'post' })

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', () => void renderPlan()),
    store.onEditorEvent('node:deleted', (id) => {
      if (id === objectId) void renderPlan()
    }),
    store.onEditorEvent('node:updated', (id, changes) => {
      if (id === objectId && 'pluginData' in changes) void renderPlan()
    })
  ]
  void renderPlan()
})

onUnmounted(() => {
  renderEpoch += 1
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  disposeRuntime()
})
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 overflow-hidden bg-agent-surface"
    data-test-id="plan-object-surface"
  >
    <div ref="host" class="size-full min-h-0" data-test-id="plan-object-host" />
    <div
      v-if="error"
      class="absolute inset-0 flex items-center justify-center px-8 text-center text-[12px] leading-5 text-muted"
      data-test-id="plan-object-error"
    >
      {{ error }}
    </div>
  </section>
</template>
