<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'

import type { AgentWorkMapInboxItem } from '@/app/agent-chat/work-map'
import { createInboxBriefingCodeObjectDocument } from '@/app/code-object/inbox-briefing'
import { createCodeObjectBoardClient, dispatchCodeObjectBoardAction } from '@/app/code-object/model'
import { loadCodeObjectRuntime, loadedCodeObjectRuntime } from '@/app/code-object/runtime'
import { useEditorStore } from '@/app/editor/active-store'
import { useAppTheme } from '@/app/shell/theme'

const { briefing, title } = defineProps<{
  briefing: NonNullable<AgentWorkMapInboxItem['briefing']>
  title: string
}>()

const emit = defineEmits<{ 'open-related-chat': [] }>()

const store = useEditorStore()
const { resolvedTheme } = useAppTheme()
const host = useTemplateRef<HTMLDivElement>('host')
const error = ref('')
let renderEpoch = 0
let runtimeId: string | null = null

function disposeRuntime() {
  if (runtimeId) loadedCodeObjectRuntime()?.disposeCodeObject(runtimeId)
  runtimeId = null
}

async function renderBriefing() {
  const epoch = ++renderEpoch
  await nextTick()
  const element = host.value
  if (!element) return

  try {
    const document = createInboxBriefingCodeObjectDocument({
      ...briefing,
      title
    })
    const nextRuntimeId = `inbox-briefing:${briefing.id}`
    const runtime = await loadCodeObjectRuntime()
    if (epoch !== renderEpoch) return
    if (runtimeId && runtimeId !== nextRuntimeId) runtime.disposeCodeObject(runtimeId)
    runtimeId = nextRuntimeId
    error.value = ''

    const dispatchBoardAction = async (
      action: Parameters<typeof dispatchCodeObjectBoardAction>[2]
    ) =>
      dispatchCodeObjectBoardAction(store, nextRuntimeId, action, {
        interactionEnabled: false
      })

    runtime.attachCodeObject(nextRuntimeId, element)
    runtime.renderCodeObject(nextRuntimeId, document, () => undefined, {
      board: createCodeObjectBoardClient(store, nextRuntimeId, dispatchBoardAction),
      dispatchBoardAction,
      interactionEnabled: false,
      theme: resolvedTheme.value
    })
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    disposeRuntime()
  }
}

watch([() => briefing, () => title, resolvedTheme], () => void renderBriefing(), {
  deep: true,
  flush: 'post'
})

onMounted(() => void renderBriefing())

onUnmounted(() => {
  renderEpoch += 1
  disposeRuntime()
})
</script>

<template>
  <section
    data-test-id="inbox-briefing-object"
    class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
  >
    <header class="flex h-10 shrink-0 items-center gap-2 px-4">
      <div class="min-w-0 flex-1 truncate text-[12px] font-medium text-surface">
        {{ title }}
      </div>
      <button
        type="button"
        data-test-id="inbox-briefing-open-message"
        class="flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2 text-[10.5px] text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
        @click="emit('open-related-chat')"
      >
        <icon-lucide-message-circle class="size-3.5 stroke-[1.6]" />
        Message
      </button>
    </header>
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <div ref="host" class="size-full min-h-0" data-test-id="inbox-briefing-code-object-host" />
      <div
        v-if="error"
        class="absolute inset-0 flex items-center justify-center px-8 text-center text-[12px] leading-5 text-muted"
        data-test-id="inbox-briefing-code-object-error"
      >
        {{ error }}
      </div>
    </div>
  </section>
</template>
