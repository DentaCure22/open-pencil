<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import AiReasoning from './AiReasoning.vue'
import AiToolGroup from './AiToolGroup.vue'
import {
  formatElapsedDuration,
  isMediaGenerationTool,
  isVideoGenerationTool,
  latestMessageCreatedAt,
  messageParts,
  resolveReasoningActivityState
} from './model'
import type { AiConversationStatus, AiMessage, AiMessagePart } from './types'

const { endedAt, messages, startedAt, status, workingLabel } = defineProps<{
  endedAt?: string
  messages: AiMessage[]
  startedAt?: string
  status: AiConversationStatus
  workingLabel?: string
}>()

const now = useNow({ interval: 1_000 })
const busy = computed(() => ['streaming', 'submitted'].includes(status))
const runningMediaKind = computed<'image' | 'video' | null>(() => {
  let kind: 'image' | 'video' | null = null
  for (const message of messages) {
    for (const part of messageParts(message)) {
      if (
        part.type !== 'tool' ||
        (part.state !== 'pending' && part.state !== 'running') ||
        !isMediaGenerationTool(part.name, part.input)
      ) {
        continue
      }
      const next = isVideoGenerationTool(part.name, part.input) ? 'video' : 'image'
      if (kind && kind !== next) return null
      kind = next
    }
  }
  return kind
})
const hasOtherToolActivity = computed(() =>
  messages.some((message) =>
    messageParts(message).some(
      (part) => part.type === 'tool' && !isMediaGenerationTool(part.name, part.input)
    )
  )
)
const mediaFocused = computed(() =>
  runningMediaKind.value && !hasOtherToolActivity.value ? runningMediaKind.value : null
)
const requiresInteraction = computed(
  () =>
    status === 'needs_attention' &&
    messages.some((message) =>
      messageParts(message).some((part) => part.type === 'tool' && part.state === 'approval')
    )
)
const hasTerminalToolFailure = computed(
  () =>
    ['error', 'needs_attention'].includes(status) &&
    messages.some((message) =>
      messageParts(message).some((part) => part.type === 'tool' && part.state === 'error')
    )
)
const staysOpen = computed(
  () =>
    busy.value ||
    Boolean(mediaFocused.value) ||
    requiresInteraction.value ||
    hasTerminalToolFailure.value
)
const expanded = ref(staysOpen.value)
watch(staysOpen, (value) => {
  expanded.value = value
})

type ActivityPart = Extract<AiMessagePart, { type: 'reasoning' | 'tool' }>
type ActivityItem = {
  index: number
  key: string
  part: ActivityPart
}

const rawActivity = computed(() =>
  messages.flatMap((message): ActivityItem[] =>
    messageParts(message).flatMap((part, index) =>
      (part.type === 'reasoning' && !mediaFocused.value) ||
      (part.type === 'tool' && !isMediaGenerationTool(part.name, part.input))
        ? [{ index: 0, key: `${message.id}:${String(index)}`, part }]
        : []
    )
  )
)
const indexedActivity = computed(() => rawActivity.value.map((item, index) => ({ ...item, index })))
type ActivityGroup =
  | {
      item: ActivityItem & { part: Extract<ActivityPart, { type: 'reasoning' }> }
      key: string
      type: 'reasoning'
    }
  | {
      items: Array<ActivityItem & { part: Extract<ActivityPart, { type: 'tool' }> }>
      key: string
      type: 'tools'
    }
const activity = computed(() => {
  const groups: ActivityGroup[] = []
  for (const item of indexedActivity.value) {
    if (item.part.type === 'reasoning') {
      const reasoning = { ...item, part: item.part }
      groups.push({ item: reasoning, key: item.key, type: 'reasoning' })
      continue
    }
    const previous = groups.at(-1)
    const tool = { ...item, part: item.part }
    if (previous?.type === 'tools') {
      previous.items.push(tool)
    } else {
      groups.push({ items: [tool], key: `tools:${item.key}`, type: 'tools' })
    }
  }
  return groups
})
const resolvedEndAt = computed(() => endedAt ?? latestMessageCreatedAt(messages) ?? startedAt)
const elapsedMs = computed(() => {
  const start = Date.parse(startedAt ?? '')
  const end =
    busy.value || mediaFocused.value ? now.value.getTime() : Date.parse(resolvedEndAt.value ?? '')
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : undefined
})
const duration = computed(() =>
  elapsedMs.value === undefined ? '' : formatElapsedDuration(elapsedMs.value)
)
const label = computed(() => {
  if (mediaFocused.value) {
    const medium = mediaFocused.value === 'video' ? 'video' : 'image'
    return elapsedMs.value === undefined || elapsedMs.value < 1_000
      ? `Creating ${medium}`
      : `Creating ${medium} for ${duration.value}`
  }
  if (busy.value) {
    if (elapsedMs.value === undefined || elapsedMs.value < 1_000) {
      return workingLabel || 'Working'
    }
    return `Working for ${duration.value}`
  }
  if (status === 'stopped') return duration.value ? `Stopped after ${duration.value}` : 'Stopped'
  if (status === 'needs_attention') {
    return duration.value ? `Needs attention after ${duration.value}` : 'Needs attention'
  }
  if (status === 'error') {
    return duration.value ? `Failed after ${duration.value}` : 'Failed'
  }
  return duration.value ? `Worked for ${duration.value}` : 'Activity'
})
</script>

<template>
  <div
    data-test-id="ai-activity-disclosure"
    aria-live="off"
    class="my-1 flex flex-col font-sans text-[12px] text-muted"
  >
    <button
      v-if="activity.length"
      type="button"
      data-test-id="ai-turn-duration"
      class="group flex min-h-7 items-center gap-1.5 rounded-[6px] py-1 text-left select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-[5px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        aria-hidden="true"
      >
        <icon-lucide-chevron-down
          v-if="expanded"
          class="size-3.5 stroke-[1.6]"
          data-direction="down"
          data-test-id="ai-disclosure-chevron"
        />
        <icon-lucide-chevron-right
          v-else
          class="size-3.5 stroke-[1.6]"
          data-direction="right"
          data-test-id="ai-disclosure-chevron"
        />
      </span>
    </button>
    <div
      v-else
      data-test-id="ai-turn-duration"
      class="flex min-h-7 cursor-default items-center py-1"
    >
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
    </div>
    <Transition
      enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
      enter-to-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-150 ease-in motion-reduce:transition-none"
      leave-from-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-to-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
    >
      <div v-if="expanded && activity.length">
        <div class="min-h-0 overflow-hidden">
          <div aria-live="off" class="mt-0.5 flex flex-col" data-test-id="ai-activity-timeline">
            <template v-for="item in activity" :key="item.key">
              <AiReasoning
                v-if="item.type === 'reasoning'"
                :state="
                  resolveReasoningActivityState(
                    item.item.part.state,
                    item.item.index,
                    rawActivity.length,
                    status
                  )
                "
                :text="item.item.part.text"
              />
              <AiToolGroup
                v-else
                :activity-count="rawActivity.length"
                :status="status"
                :tools="item.items"
              />
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
