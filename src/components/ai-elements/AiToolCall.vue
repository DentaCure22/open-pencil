<script setup lang="ts">
import { computed, ref } from 'vue'

import AiAttachments from './AiAttachments.vue'
import { shortToolInput, toolCallKind, toolCallLabel, toolCallProgressLabel } from './model'
import type { AiMessagePart, AiToolState } from './types'

type RenderedToolState = AiToolState | 'stopped'

const { error, images, input, name, output, state } = defineProps<{
  error?: string
  images?: Array<{ alt?: string; url: string }>
  input?: string
  name: string
  output?: string
  state: RenderedToolState
}>()

const expanded = ref(false)
const detailInput = computed(() => shortToolInput(input))
const hasDetail = computed(() => Boolean(input || output || error || images?.length))
const detail = computed(() => error ?? output)
const imageParts = computed(() =>
  (images ?? []).map(
    (image): Extract<AiMessagePart, { type: 'image' }> => ({ ...image, type: 'image' })
  )
)
const running = computed(() => state === 'pending' || state === 'running')
const kind = computed(() => toolCallKind(name, input))
const label = computed(() =>
  running.value ? toolCallProgressLabel(name, input) : toolCallLabel(name, input)
)
const statusLabel = computed(() => {
  if (running.value) return 'In progress'
  if (state === 'success') return 'Completed'
  if (state === 'error') return 'Failed'
  if (state === 'approval') return 'Needs approval'
  return 'Stopped'
})
</script>

<template>
  <div
    data-test-id="ai-tool-call"
    :data-kind="kind"
    :data-state="state"
    class="group/tool min-w-0 py-0.5 text-[12px] leading-5 text-muted"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <span
        class="flex size-4 shrink-0 items-center justify-center"
        :class="[
          running
            ? 'text-accent'
            : state === 'error'
              ? 'text-red-400'
              : state === 'approval'
                ? 'text-amber-400'
                : 'text-muted/85',
          running ? 'animate-pulse' : ''
        ]"
        aria-hidden="true"
        data-test-id="ai-tool-kind-icon"
      >
        <IconlyIcon name="search" v-if="kind === 'search'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-mail v-else-if="kind === 'mail'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-terminal v-else-if="kind === 'command'" class="size-3.5 stroke-[1.6]" />
        <IconlyIcon name="document" v-else-if="kind === 'read'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-pencil-line v-else-if="kind === 'edit'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-list-tree v-else-if="kind === 'list'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-plug-zap v-else-if="kind === 'connected-app'" class="size-3.5 stroke-[1.6]" />
        <IconlyIcon name="chat" v-else-if="kind === 'message'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-git-fork v-else-if="kind === 'handoff'" class="size-3.5 stroke-[1.6]" />
        <IconlyIcon name="image" v-else-if="kind === 'image'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-globe-2 v-else-if="kind === 'web'" class="size-3.5 stroke-[1.6]" />
        <icon-lucide-wrench v-else class="size-3.5 stroke-[1.6]" />
      </span>
      <span class="sr-only">{{ statusLabel }}: </span>
      <span class="shrink-0 font-sans text-surface/85" data-test-id="ai-tool-label">{{
        label
      }}</span>
      <span
        v-if="detailInput"
        class="min-w-0 flex-1 truncate font-sans text-[12px] font-normal text-muted"
        data-test-id="ai-tool-input"
        >{{ detailInput }}</span
      >
      <span v-else class="min-w-0 flex-1" />
      <button
        v-if="hasDetail"
        type="button"
        data-test-id="ai-tool-disclosure"
        class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-[background-color,color] duration-150 group-hover/tool:opacity-100 hover:bg-hover hover:text-surface focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-component/30 group-focus-within/tool:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        :aria-expanded="expanded"
        :aria-label="expanded ? 'Hide tool details' : 'Show tool details'"
        @click="expanded = !expanded"
      >
        <IconlyIcon
          name="arrow-down"
          v-if="expanded"
          class="size-3.5"
          data-direction="down"
          data-test-id="ai-disclosure-chevron"
        />
        <IconlyIcon
          name="arrow-right"
          v-else
          class="size-3.5"
          data-direction="right"
          data-test-id="ai-disclosure-chevron"
        />
      </button>
    </div>
    <Transition
      enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-200 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
      enter-to-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity,transform] duration-150 ease-in motion-reduce:transition-none"
      leave-from-class="grid-rows-[1fr] translate-y-0 opacity-100"
      leave-to-class="-translate-y-0.5 grid-rows-[0fr] opacity-0"
    >
      <div v-if="expanded" data-test-id="ai-tool-detail-panel">
        <div class="min-h-0 overflow-hidden">
          <p v-if="input" class="mt-1 text-[10px] font-medium tracking-wide text-muted uppercase">
            Input
          </p>
          <pre
            v-if="input"
            data-test-id="ai-tool-detail-input"
            class="mt-1 max-h-40 overflow-auto rounded-[7px] border border-border/70 bg-input px-2.5 py-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-surface overscroll-contain"
            >{{ input }}</pre
          >
          <p v-if="detail" class="mt-1 text-[10px] font-medium tracking-wide text-muted uppercase">
            {{ error ? 'Error' : 'Result' }}
          </p>
          <pre
            v-if="detail"
            data-test-id="ai-tool-output"
            class="mt-1 max-h-40 overflow-auto rounded-[7px] border border-border/70 bg-input px-2.5 py-2 font-mono text-[11px] leading-[1.55] whitespace-pre-wrap text-surface overscroll-contain"
            :class="error ? 'text-red-300' : ''"
            >{{ detail }}</pre
          >
          <AiAttachments v-if="imageParts.length" :parts="imageParts" />
        </div>
      </div>
    </Transition>
  </div>
</template>
