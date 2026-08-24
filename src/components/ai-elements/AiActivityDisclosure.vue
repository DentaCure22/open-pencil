<script setup lang="ts">
import { useNow } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { groupActivityTimeline } from './activity-timeline'
import AiCommentary from './AiCommentary.vue'
import AiReasoning from './AiReasoning.vue'
import AiToolGroup from './AiToolGroup.vue'
import {
  formatElapsedDuration,
  isMediaGenerationTool,
  isVideoGenerationTool,
  latestMessageCreatedAt,
  messageParts,
  resolveCommentaryActivityState,
  resolveToolActivityState
} from './model'
import type { AiConversationStatus, AiMessage, AiMessagePart } from './types'

const { endedAt, messages, startedAt, status } = defineProps<{
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

type ActivityPart = Extract<AiMessagePart, { type: 'commentary' | 'tool' }>
type ActivityItem = {
  index: number
  key: string
  part: ActivityPart
}

const rawActivity = computed(() =>
  messages.flatMap((message): ActivityItem[] =>
    messageParts(message).flatMap((part, index): ActivityItem[] => {
      if (part.type === 'tool' && !isMediaGenerationTool(part.name, part.input)) {
        return [{ index: 0, key: `${message.id}:${String(index)}`, part }]
      }
      if (part.type === 'commentary' && part.text.trim() && !mediaFocused.value) {
        return [{ index: 0, key: `${message.id}:${String(index)}`, part }]
      }
      return []
    })
  )
)
const indexedActivity = computed(() => rawActivity.value.map((item, index) => ({ ...item, index })))
const activity = computed(() =>
  groupActivityTimeline(indexedActivity.value, status, (item) =>
    resolveToolActivityState(item.part.state, item.index, rawActivity.value.length, status)
  )
)
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
const commentaries = computed(() =>
  activity.value.flatMap((item) => (item.type === 'commentary' ? [item] : []))
)
const reasonings = computed(() =>
  messages.flatMap((message) =>
    messageParts(message).flatMap((part, index) => {
      if (part.type !== 'reasoning' || !part.text.trim() || mediaFocused.value) return []
      return [
        {
          index: 0,
          key: `${message.id}:${String(index)}`,
          part
        }
      ]
    })
  )
)
const toolGroups = computed(() =>
  activity.value.flatMap((item) => (item.type === 'tools' ? [item] : []))
)
const hasWork = computed(() => reasonings.value.length > 0)
const shimmering = computed(() => busy.value || Boolean(mediaFocused.value))
const label = computed(() => {
  if (mediaFocused.value) {
    const medium = mediaFocused.value === 'video' ? 'video' : 'image'
    return elapsedMs.value === undefined || elapsedMs.value < 1_000
      ? `Creating ${medium}`
      : `Creating ${medium} for ${duration.value}`
  }
  if (busy.value) {
    if (elapsedMs.value === undefined || elapsedMs.value < 1_000) return 'Thinking'
    return 'Thinking'
  }
  if (status === 'stopped') return duration.value ? `Stopped after ${duration.value}` : 'Stopped'
  if (status === 'needs_attention') {
    return duration.value ? `Needs attention after ${duration.value}` : 'Needs attention'
  }
  if (status === 'error') {
    return duration.value ? `Failed after ${duration.value}` : 'Failed'
  }
  return duration.value ? `Thought for ${duration.value}` : 'Thought'
})
</script>

<template>
  <div data-test-id="ai-activity-disclosure" aria-live="off" class="my-1 flex flex-col font-sans">
    <AiCommentary
      v-for="item in commentaries"
      :key="item.key"
      :state="
        resolveCommentaryActivityState(
          item.item.part.state,
          item.item.index,
          rawActivity.length,
          status
        )
      "
      :text="item.item.part.text"
    />
    <button
      type="button"
      data-test-id="ai-turn-duration"
      class="flex w-fit max-w-full items-center gap-1 py-1 pr-1 text-left text-[13px] leading-5 font-medium text-surface select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30"
      :aria-expanded="expanded"
      :aria-label="expanded ? 'Hide thought' : 'Show thought'"
      @click="expanded = !expanded"
    >
      <span
        class="min-w-0 truncate tabular-nums"
        :class="shimmering ? 'agent-thought-shimmer' : ''"
      >
        {{ label }}
      </span>
      <span
        class="flex size-5 shrink-0 items-center justify-center text-surface"
        aria-hidden="true"
      >
        <icon-lucide-chevron-down
          v-if="expanded"
          class="size-3.5 stroke-[2]"
          data-direction="down"
          data-test-id="ai-disclosure-chevron"
        />
        <icon-lucide-chevron-right
          v-else
          class="size-3.5 stroke-[2]"
          data-direction="right"
          data-test-id="ai-disclosure-chevron"
        />
      </span>
    </button>
    <div data-test-id="ai-activity-timeline" class="flex flex-col">
      <Transition
        :css="!busy"
        enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
        enter-from-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
        enter-to-class="grid-rows-[1fr] translate-y-0 opacity-100"
        leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-150 ease-in motion-reduce:transition-none"
        leave-from-class="grid-rows-[1fr] translate-y-0 opacity-100"
        leave-to-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
      >
        <div v-if="expanded && hasWork">
          <div class="min-h-0 overflow-hidden">
            <AiReasoning
              v-for="item in reasonings"
              :key="item.key"
              :state="item.part.state"
              :text="item.part.text"
            />
          </div>
        </div>
      </Transition>
      <AiToolGroup
        v-for="item in toolGroups"
        :key="item.key"
        :activity-count="rawActivity.length"
        :open="item.open"
        :status="status"
        :tools="item.items"
      />
    </div>
  </div>
</template>
