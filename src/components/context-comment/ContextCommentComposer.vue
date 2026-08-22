<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'

import {
  closeContextComment,
  contextCommentDictationActive,
  contextCommentDictationAvailable,
  contextCommentDictationError,
  contextCommentState,
  dispatchContextComment,
  prepareContextCommentScreenCapture,
  setContextCommentText,
  startContextCommentDictation,
  stopContextCommentCapture,
  stopContextCommentDictation
} from '@/app/context-comment'
import { CONTEXT_COMMENT_MODEL_SCOPE, conversationSelection } from '@/app/agent-chat/models'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import AiModelAndEffortSelect from '@/components/ai-elements/AiModelAndEffortSelect.vue'

const store = useEditorStore()
const composer = ref<HTMLElement | null>(null)
const input = ref<HTMLTextAreaElement | null>(null)
const hostSize = ref({ height: 0, width: 0 })

const COMMENT_COMPOSER_GAP = 10
const COMMENT_COMPOSER_HEIGHT = 54
const COMMENT_COMPOSER_LIVE_WIDTH = 600
const COMMENT_COMPOSER_MARGIN = 12
const COMMENT_COMPOSER_WIDTH = 540

const draft = computed(() => contextCommentState.draft)
const hasText = computed(() => Boolean(draft.value?.text.trim()))
const canSend = computed(() => hasText.value && !contextCommentState.dispatching)
const composerStyle = computed(() => {
  const target = draft.value?.target
  const bounds = target?.anchorBounds ?? target?.bounds
  const hostWidth = hostSize.value.width || window.innerWidth
  const hostHeight = hostSize.value.height || window.innerHeight
  const liveContainer = target?.kind === 'live-container'
  const width = Math.min(
    liveContainer ? COMMENT_COMPOSER_LIVE_WIDTH : COMMENT_COMPOSER_WIDTH,
    Math.max(320, hostWidth - COMMENT_COMPOSER_MARGIN * 2)
  )
  if (!bounds) {
    return {
      bottom: '16px',
      left: `${Math.max(COMMENT_COMPOSER_MARGIN, (hostWidth - width) / 2)}px`,
      width: `${width}px`
    }
  }

  const zoom = Math.max(store.state.zoom, 0.01)
  const targetLeft = bounds.x * zoom + store.state.panX
  const targetTop = bounds.y * zoom + store.state.panY
  const targetBottom = targetTop + bounds.height * zoom
  const below = targetBottom + COMMENT_COMPOSER_GAP
  let top = below
  if (!liveContainer && below + COMMENT_COMPOSER_HEIGHT + COMMENT_COMPOSER_MARGIN > hostHeight) {
    top = Math.max(
      COMMENT_COMPOSER_MARGIN,
      targetTop - COMMENT_COMPOSER_HEIGHT - COMMENT_COMPOSER_GAP
    )
  }
  const desiredLeft = liveContainer ? targetLeft + (bounds.width * zoom - width) / 2 : targetLeft
  const left = Math.min(
    Math.max(COMMENT_COMPOSER_MARGIN, desiredLeft),
    Math.max(COMMENT_COMPOSER_MARGIN, hostWidth - width - COMMENT_COMPOSER_MARGIN)
  )
  return {
    height: `${COMMENT_COMPOSER_HEIGHT}px`,
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`
  }
})

function syncHostSize() {
  const host = composer.value?.parentElement
  hostSize.value = {
    height: host?.clientHeight ?? window.innerHeight,
    width: host?.clientWidth ?? window.innerWidth
  }
}

function ensureComposerBelowLiveTarget() {
  const target = draft.value?.target
  const bounds = target?.anchorBounds ?? target?.bounds
  if (target?.kind !== 'live-container' || !bounds) return

  const hostHeight = hostSize.value.height || window.innerHeight
  const zoom = Math.max(store.state.zoom, 0.01)
  const targetBottom = (bounds.y + bounds.height) * zoom + store.state.panY
  const composerBottom =
    targetBottom + COMMENT_COMPOSER_GAP + COMMENT_COMPOSER_HEIGHT + COMMENT_COMPOSER_MARGIN
  const overflow = composerBottom - hostHeight
  if (overflow > 0) store.pan(0, -overflow)
}

watch(
  () => draft.value?.id,
  async (id) => {
    if (!id) return
    await nextTick()
    syncHostSize()
    ensureComposerBelowLiveTarget()
    await nextTick()
    syncHostSize()
    input.value?.focus()
  }
)

function updateText(event: Event) {
  setContextCommentText((event.target as HTMLTextAreaElement).value)
}

function beginCapture() {
  void prepareContextCommentScreenCapture(store)
}

function inputKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void submit()
}

function toggleDictation() {
  if (contextCommentDictationActive.value) {
    stopContextCommentDictation()
    return
  }
  startContextCommentDictation(draft.value?.text ?? '', setContextCommentText)
}

function close() {
  stopContextCommentDictation()
  closeContextComment()
}

async function submit() {
  const current = draft.value
  if (!current?.text.trim() || contextCommentState.dispatching) return
  stopContextCommentDictation()
  contextCommentState.dispatching = true
  contextCommentState.error = null
  try {
    await dispatchContextComment(current, conversationSelection(CONTEXT_COMMENT_MODEL_SCOPE))
    closeContextComment()
    toast.info('Task started')
  } catch (error) {
    contextCommentState.error = error instanceof Error ? error.message : 'Comment dispatch failed.'
  } finally {
    contextCommentState.dispatching = false
  }
}

useEventListener(window, 'resize', syncHostSize)
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  if (contextCommentState.captureMode) {
    event.preventDefault()
    const cancelScreenshotFlow = draft.value?.flow === 'screenshot' && !draft.value.capture
    stopContextCommentCapture()
    if (cancelScreenshotFlow) close()
    return
  }
  if (draft.value?.capture) return
  if (draft.value) close()
})
</script>

<template>
  <section
    v-if="
      draft &&
      draft.flow === 'comment' &&
      !draft.capture &&
      !contextCommentState.captureMode &&
      !contextCommentState.capturePreparing
    "
    ref="composer"
    data-test-id="context-comment-composer"
    class="bg-chrome-raised/97 absolute z-[80] flex max-w-[calc(100%-24px)] items-center gap-1 overflow-visible rounded-full border border-surface/20 p-1 shadow-[0_24px_70px_rgba(0,0,0,0.34),0_8px_24px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-black/20 backdrop-blur-2xl"
    :style="composerStyle"
    :aria-label="`Comment on ${draft.target?.label ?? 'image'}`"
  >
    <button
      type="button"
      data-test-id="context-comment-capture"
      aria-label="Attach screenshot region"
      :disabled="contextCommentState.dispatching"
      class="flex size-11 shrink-0 items-center justify-center rounded-full bg-chrome-control text-surface ring-1 ring-inset ring-chrome-control-border transition-colors hover:bg-hover disabled:opacity-40"
      @click="beginCapture"
    >
      <icon-lucide-plus class="size-[22px]" />
    </button>

    <textarea
      ref="input"
      :value="draft.text"
      data-test-id="context-comment-input"
      placeholder="Add a comment…"
      rows="1"
      class="h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[14px] leading-6 text-surface outline-none placeholder:text-muted/70"
      :disabled="contextCommentState.dispatching"
      @input="updateText"
      @keydown="inputKeydown"
    />

    <div class="min-w-0 shrink-0">
      <AiModelAndEffortSelect :scope="CONTEXT_COMMENT_MODEL_SCOPE" />
    </div>

    <button
      v-if="!hasText || contextCommentDictationActive"
      type="button"
      data-test-id="context-comment-dictation"
      :aria-label="contextCommentDictationActive ? 'Stop dictation' : 'Start dictation'"
      :aria-pressed="contextCommentDictationActive"
      :disabled="!contextCommentDictationAvailable || contextCommentState.dispatching"
      class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-panel shadow-sm transition-colors hover:opacity-90 disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-white"
      @click="toggleDictation"
    >
      <icon-lucide-square v-if="contextCommentDictationActive" class="size-3.5" />
      <icon-lucide-mic v-else class="size-[22px]" />
    </button>

    <button
      v-else
      type="button"
      data-test-id="context-comment-send"
      aria-label="Send comment"
      :disabled="!canSend"
      class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-panel shadow-sm transition-[opacity,transform] hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:active:scale-100"
      @click="submit"
    >
      <icon-lucide-loader-circle
        v-if="contextCommentState.dispatching"
        class="size-[22px] animate-spin"
      />
      <icon-lucide-arrow-up v-else class="size-[22px]" />
    </button>

    <p
      v-if="contextCommentState.error || contextCommentDictationError"
      data-test-id="context-comment-error"
      class="border-chrome-border bg-chrome absolute top-full right-3 mt-1 max-w-[24rem] rounded-lg border px-2.5 py-1.5 text-[11px] text-[var(--color-danger-text)] shadow-lg"
    >
      {{ contextCommentState.error || contextCommentDictationError }}
    </p>
  </section>
</template>
