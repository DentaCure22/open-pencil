<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'

import {
  addContextCommentImageAnnotation,
  closeContextComment,
  contextCommentAnnotationAnchorLabel,
  contextCommentDictationActive,
  contextCommentDictationAvailable,
  contextCommentDictationError,
  contextCommentState,
  dispatchContextComment,
  removeContextCommentImageAnnotation,
  resolveContextCommentAnnotationAnchor,
  setContextCommentText,
  startContextCommentCapture,
  startContextCommentDictation,
  stopContextCommentDictation,
  updateContextCommentImageAnnotation
} from '@/app/context-comment'
import { CONTEXT_COMMENT_MODEL_SCOPE, conversationSelection } from '@/app/agent-chat/models'
import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { readNarratedTraceEvidenceImage } from '@/app/narrated-trace'
import { toast } from '@/app/shell/ui'
import AiModelAndEffortSelect from '@/components/ai-elements/AiModelAndEffortSelect.vue'
import { transparencyCheckerboardClass } from '@/components/ui/transparency'

const image = ref<HTMLImageElement | null>(null)
const store = useEditorStore()
const root = ref<HTMLElement | null>(null)
const annotationInput = ref<HTMLInputElement | null>(null)
const preview = ref<string | null>(null)
const commentMode = ref(true)
const editingAnnotationId = ref<string | null>(null)
const viewportInsets = ref(editorViewportInsets())
const hostWidth = ref(window.innerWidth)

const draft = computed(() => contextCommentState.draft)
const isAgentImage = computed(
  () => draft.value?.imageEdit || draft.value?.destination?.kind === 'agent-conversation'
)
const modelScope = computed(
  () =>
    draft.value?.modelScope ?? draft.value?.destination?.modelScope ?? CONTEXT_COMMENT_MODEL_SCOPE
)
const completedAnnotations = computed(
  () => draft.value?.annotations.filter((annotation) => annotation.comment.trim()) ?? []
)
const canSend = computed(
  () =>
    Boolean(draft.value?.capture) &&
    Boolean(draft.value?.text.trim() || completedAnnotations.value.length) &&
    !contextCommentState.dispatching
)
const editingAnnotation = computed(() =>
  draft.value?.annotations.find((annotation) => annotation.id === editingAnnotationId.value)
)
const editingAnnotationAnchorLabel = computed(() => {
  const anchor = editingAnnotation.value?.anchor
  return anchor ? contextCommentAnnotationAnchorLabel(anchor) : null
})
const editingAnnotationIndex = computed(() => {
  const id = editingAnnotationId.value
  return id ? (draft.value?.annotations.findIndex((annotation) => annotation.id === id) ?? -1) : -1
})
const annotationEditorStyle = computed(() => {
  const annotation = editingAnnotation.value
  if (!annotation) return {}
  const opensLeft = annotation.x > 0.62
  return {
    left: `${String(annotation.x * 100)}%`,
    top: `${String(Math.min(0.92, Math.max(0.08, annotation.y)) * 100)}%`,
    transform: opensLeft ? 'translate(calc(-100% - 22px), -50%)' : 'translate(22px, -50%)'
  }
})
const editorPaddingStyle = computed(() => ({
  paddingBottom: `${String((viewportInsets.value.bottom ?? 0) + 86)}px`,
  paddingLeft: `${String((viewportInsets.value.left ?? 0) + 24)}px`,
  paddingRight: `${String((viewportInsets.value.right ?? 0) + 24)}px`,
  paddingTop: `${String((viewportInsets.value.top ?? 0) + 66)}px`
}))
const composerStyle = computed(() => {
  const leftInset = viewportInsets.value.left ?? 0
  const rightInset = viewportInsets.value.right ?? 0
  const availableWidth = Math.max(320, hostWidth.value - leftInset - rightInset - 24)
  return {
    bottom: `${String(viewportInsets.value.bottom ?? 0)}px`,
    left: `${String(leftInset + (hostWidth.value - leftInset - rightInset) / 2)}px`,
    width: `${String(Math.min(760, availableWidth))}px`
  }
})

function syncViewportInsets() {
  viewportInsets.value = editorViewportInsets()
  hostWidth.value = root.value?.clientWidth ?? window.innerWidth
}

watch(
  () => draft.value?.capture?.evidenceId,
  async () => {
    editingAnnotationId.value = null
    commentMode.value = true
    const capture = draft.value?.capture
    preview.value = capture ? await readNarratedTraceEvidenceImage(capture) : null
    await nextTick()
    syncViewportInsets()
  },
  { immediate: true }
)

watch(editingAnnotationId, async (id) => {
  if (!id) return
  await nextTick()
  annotationInput.value?.focus({ preventScroll: true })
})

function annotationStyle(x: number, y: number) {
  return {
    left: `${String(x * 100)}%`,
    top: `${String(y * 100)}%`
  }
}

function finishEditingAnnotation() {
  const annotation = editingAnnotation.value
  if (annotation && !annotation.comment.trim()) {
    removeContextCommentImageAnnotation(annotation.id)
  }
  editingAnnotationId.value = null
}

function addAnnotation(event: MouseEvent) {
  if (!commentMode.value || !image.value || contextCommentState.dispatching) return
  finishEditingAnnotation()
  const bounds = image.value.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) return
  const point = {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height
  }
  const current = draft.value
  if (!current) return
  const anchor = resolveContextCommentAnnotationAnchor(store, current, point)
  editingAnnotationId.value = addContextCommentImageAnnotation(point, anchor)
}

function openAnnotation(id: string) {
  finishEditingAnnotation()
  editingAnnotationId.value = id
  commentMode.value = true
}

function updateAnnotationComment(event: Event) {
  const id = editingAnnotationId.value
  if (!id) return
  updateContextCommentImageAnnotation(id, (event.target as HTMLInputElement).value)
}

function removeEditingAnnotation() {
  const id = editingAnnotationId.value
  if (id) removeContextCommentImageAnnotation(id)
  editingAnnotationId.value = null
}

function annotationKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault()
    finishEditingAnnotation()
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    finishEditingAnnotation()
  }
}

function updateText(event: Event) {
  setContextCommentText((event.target as HTMLTextAreaElement).value)
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

function resizeCapture() {
  finishEditingAnnotation()
  startContextCommentCapture()
}

function removeCapture() {
  stopContextCommentDictation()
  closeContextComment()
}

async function submit() {
  const current = draft.value
  if (!current || !canSend.value) return
  const agentImage = Boolean(
    current.imageEdit || current.destination?.kind === 'agent-conversation'
  )
  finishEditingAnnotation()
  if (
    !current.text.trim() &&
    !current.annotations.some((annotation) => annotation.comment.trim())
  ) {
    return
  }
  stopContextCommentDictation()
  contextCommentState.dispatching = true
  contextCommentState.error = null
  try {
    await dispatchContextComment(current, conversationSelection(modelScope.value))
    closeContextComment()
    toast.info(agentImage ? 'Image edit sent' : 'Task started')
  } catch (error) {
    contextCommentState.error =
      error instanceof Error ? error.message : 'Screenshot comment dispatch failed.'
  } finally {
    contextCommentState.dispatching = false
  }
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !draft.value?.capture || contextCommentState.captureMode) return
  if (editingAnnotationId.value) {
    event.preventDefault()
    finishEditingAnnotation()
    return
  }
  removeCapture()
})
useEventListener(window, 'resize', syncViewportInsets)
</script>

<template>
  <section
    v-if="draft?.capture && preview && !contextCommentState.captureMode"
    ref="root"
    data-test-id="context-comment-screenshot-editor"
    data-narrated-trace-overlay="true"
    :aria-label="isAgentImage ? 'Annotate generated image' : 'Annotate Board screenshot'"
    class="absolute inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
    :style="editorPaddingStyle"
    @pointerdown.self="finishEditingAnnotation"
  >
    <div class="relative max-h-full max-w-full">
      <div
        role="toolbar"
        :aria-label="isAgentImage ? 'Image annotation tools' : 'Screenshot tools'"
        class="border-chrome-border bg-chrome-raised absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 items-center gap-1 rounded-full border p-1.5 text-surface shadow-[0_12px_40px_rgba(0,0,0,0.3)] ring-1 ring-black/15 backdrop-blur-2xl"
      >
        <button
          type="button"
          data-test-id="context-comment-mode"
          :aria-pressed="commentMode"
          class="flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition-colors hover:bg-hover aria-pressed:bg-accent/15 aria-pressed:text-accent"
          @click="commentMode = !commentMode"
        >
          <icon-lucide-message-circle-plus class="size-[18px]" />
          Comment
        </button>
        <button
          type="button"
          data-test-id="context-comment-remove-capture"
          class="flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition-colors hover:bg-hover"
          @click="removeCapture"
        >
          <icon-lucide-eraser class="size-[18px]" />
          Remove
        </button>
        <button
          v-if="!isAgentImage"
          type="button"
          data-test-id="context-comment-resize-capture"
          class="flex h-9 items-center gap-2 rounded-full px-3 text-[13px] font-medium transition-colors hover:bg-hover"
          @click="resizeCapture"
        >
          <icon-lucide-scan class="size-[18px]" />
          Resize
        </button>
      </div>

      <div
        class="relative overflow-visible rounded-[18px] shadow-[0_28px_90px_rgba(0,0,0,0.42)] ring-1 ring-black/20"
        :class="transparencyCheckerboardClass"
      >
        <img
          ref="image"
          :src="preview"
          :alt="isAgentImage ? 'Generated image being annotated' : 'Captured Board region'"
          data-test-id="context-comment-capture-image"
          draggable="false"
          class="block max-h-[calc(100vh-13rem)] max-w-[calc(100vw-15rem)] cursor-crosshair object-contain select-none"
          :class="[
            commentMode ? 'cursor-crosshair' : 'cursor-default',
            isAgentImage ? '' : 'rounded-[18px]'
          ]"
          @click="addAnnotation"
        />

        <button
          v-for="(annotation, index) in draft.annotations"
          :key="annotation.id"
          type="button"
          data-test-id="context-comment-image-marker"
          :aria-label="`Open ${isAgentImage ? 'image' : 'screenshot'} comment ${String(index + 1)}`"
          class="absolute z-10 size-9 -translate-x-1/2 -translate-y-1/2 text-blue-500 drop-shadow-[0_3px_8px_rgba(0,0,0,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          :style="annotationStyle(annotation.x, annotation.y)"
          @click.stop="openAnnotation(annotation.id)"
        >
          <IconlyIcon name="chat" class="size-9 fill-current stroke-[1.5] [&>path]:fill-current" />
          <span
            class="absolute inset-x-0 top-[7px] text-center text-[12px] leading-none font-semibold text-white"
          >
            {{ index + 1 }}
          </span>
        </button>

        <form
          v-if="editingAnnotation"
          data-test-id="context-comment-annotation-editor"
          class="border-chrome-border bg-chrome-raised absolute z-20 flex h-12 w-[min(360px,calc(100vw-5rem))] items-center gap-1 rounded-full border p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.35)] ring-1 ring-black/15 backdrop-blur-2xl"
          :style="annotationEditorStyle"
          @submit.prevent="finishEditingAnnotation"
          @pointerdown.stop
        >
          <span
            v-if="editingAnnotationAnchorLabel"
            data-test-id="context-comment-annotation-anchor"
            class="max-w-28 shrink-0 truncate rounded-full bg-accent/12 px-2.5 py-1 text-[10px] font-semibold tracking-[0.01em] text-accent"
          >
            {{ editingAnnotationAnchorLabel }}
          </span>
          <input
            ref="annotationInput"
            :value="editingAnnotation.comment"
            :aria-label="`${isAgentImage ? 'Image' : 'Screenshot'} comment ${String(editingAnnotationIndex + 1)}`"
            placeholder="Add a comment…"
            class="h-9 min-w-0 flex-1 bg-transparent px-3 text-[14px] text-surface outline-none placeholder:text-muted/70"
            @input="updateAnnotationComment"
            @keydown="annotationKeydown"
          />
          <button
            type="button"
            :aria-label="`Remove ${isAgentImage ? 'image' : 'screenshot'} comment`"
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-400/10 hover:text-red-400"
            @click="removeEditingAnnotation"
          >
            <IconlyIcon name="delete" class="size-4" />
          </button>
        </form>
      </div>
    </div>

    <form
      data-test-id="context-comment-screenshot-composer"
      class="border-chrome-border bg-chrome-raised absolute flex h-[58px] -translate-x-1/2 items-center gap-1 rounded-full border p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.36),0_8px_24px_rgba(0,0,0,0.24)] ring-1 ring-black/20 backdrop-blur-2xl"
      :style="composerStyle"
      @submit.prevent="submit"
    >
      <div
        class="flex size-11 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-400"
      >
        <IconlyIcon name="image" class="size-[20px]" />
      </div>
      <textarea
        :value="draft.text"
        data-test-id="context-comment-input"
        aria-label="Additional instructions"
        placeholder="Additional instructions…"
        rows="1"
        class="h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[14px] leading-6 text-surface outline-none placeholder:text-muted/70"
        :disabled="contextCommentState.dispatching"
        @input="updateText"
        @keydown="inputKeydown"
      />
      <div class="min-w-0 shrink-0">
        <AiModelAndEffortSelect :scope="modelScope" />
      </div>
      <button
        v-if="!canSend || contextCommentDictationActive"
        type="button"
        data-test-id="context-comment-dictation"
        :aria-label="contextCommentDictationActive ? 'Stop dictation' : 'Start dictation'"
        :aria-pressed="contextCommentDictationActive"
        :disabled="!contextCommentDictationAvailable || contextCommentState.dispatching"
        class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-panel shadow-sm transition-colors hover:opacity-90 disabled:opacity-40 aria-pressed:bg-accent aria-pressed:text-white"
        @click="toggleDictation"
      >
        <icon-lucide-square v-if="contextCommentDictationActive" class="size-3.5" />
        <IconlyIcon name="voice" v-else class="size-[22px]" />
      </button>
      <button
        v-else
        type="submit"
        data-test-id="context-comment-send"
        :aria-label="isAgentImage ? 'Send image edit' : 'Send screenshot comments'"
        :disabled="!canSend"
        class="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-panel shadow-sm transition-[opacity,transform] hover:opacity-90 active:scale-95 disabled:opacity-30 disabled:active:scale-100"
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
        class="border-chrome-border bg-chrome absolute right-3 bottom-full mb-1 max-w-[24rem] rounded-lg border px-2.5 py-1.5 text-[11px] text-[var(--color-danger-text)] shadow-lg"
      >
        {{ contextCommentState.error || contextCommentDictationError }}
      </p>
    </form>
  </section>
</template>
