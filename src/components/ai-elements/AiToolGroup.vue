<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import AiToolCall from './AiToolCall.vue'
import { resolveToolActivityState, toolGroupLabel } from './model'
import type { AiConversationStatus, AiMessagePart } from './types'

type ToolPart = Extract<AiMessagePart, { type: 'tool' }>
type ToolItem = {
  index: number
  key: string
  part: ToolPart
}

const {
  activityCount,
  open = false,
  status,
  tools
} = defineProps<{
  activityCount: number
  open?: boolean
  status: AiConversationStatus
  tools: ToolItem[]
}>()

const expanded = ref(open)
const busy = computed(() => ['streaming', 'submitted'].includes(status))
watch(
  () => open,
  (value) => {
    expanded.value = value
  }
)
const renderedTools = computed(() =>
  tools.map((tool) => ({
    ...tool,
    state: resolveToolActivityState(tool.part.state, tool.index, activityCount, status)
  }))
)
const active = computed(() =>
  renderedTools.value.some((tool) => tool.state === 'pending' || tool.state === 'running')
)
const label = computed(() =>
  toolGroupLabel(
    renderedTools.value.map((tool) => ({
      input: tool.part.input,
      name: tool.part.name,
      state: tool.state
    }))
  )
)
</script>

<template>
  <div class="min-w-0 py-0.5 text-[12px] leading-5 text-muted" data-test-id="ai-tool-group">
    <button
      type="button"
      class="group flex w-full min-w-0 items-center gap-1.5 rounded-[5px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Hide tool calls' : 'Show tool calls'"
      data-test-id="ai-tool-group-toggle"
      @click="expanded = !expanded"
    >
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        :class="active ? 'animate-pulse text-accent' : 'text-muted/85'"
        aria-hidden="true"
      >
        <icon-lucide-wrench class="size-3.5 stroke-[1.6]" />
      </span>
      <span class="min-w-0 flex-1 truncate text-surface/85">{{ label }}</span>
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-hover hover:text-surface group-focus-within:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        aria-hidden="true"
      >
        <icon-lucide-chevron-down
          v-if="expanded"
          class="size-3.5"
          data-direction="down"
          data-test-id="ai-disclosure-chevron"
        />
        <icon-lucide-chevron-right
          v-else
          class="size-3.5"
          data-direction="right"
          data-test-id="ai-disclosure-chevron"
        />
      </span>
    </button>
    <Transition
      :css="!busy"
      enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
      enter-to-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-150 ease-in motion-reduce:transition-none"
      leave-from-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-to-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
    >
      <div v-if="expanded" data-test-id="ai-tool-group-content">
        <div class="min-h-0 overflow-hidden">
          <TransitionGroup
            tag="div"
            :css="!busy"
            enter-active-class="transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none"
            enter-from-class="-translate-y-1 opacity-0"
            enter-to-class="translate-y-0 opacity-100"
            leave-active-class="transition-[opacity,transform] duration-150 ease-in motion-reduce:transition-none"
            leave-from-class="translate-y-0 opacity-100"
            leave-to-class="-translate-y-1 opacity-0"
          >
            <AiToolCall
              v-for="tool in renderedTools"
              :key="tool.key"
              :error="tool.part.error"
              :images="tool.part.images"
              :input="tool.part.input"
              :name="tool.part.name"
              :output="tool.part.output"
              :state="tool.state"
            />
          </TransitionGroup>
        </div>
      </div>
    </Transition>
  </div>
</template>
