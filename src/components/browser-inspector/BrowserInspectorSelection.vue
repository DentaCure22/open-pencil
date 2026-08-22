<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { browserElementLabel } from '@/app/browser-inspector/context'
import type {
  BrowserElementAnnotation,
  BrowserElementSelection
} from '@/app/browser-inspector/contracts'
import { writeBrowserCaptureDrag } from '@/app/browser-inspector/drag'
import {
  browserCaptureSessions,
  browserInspectorState,
  clearBrowserElementAnnotationRequest,
  getBrowserCaptureSession,
  removeBrowserCaptureRecording,
  removeBrowserCaptureSession,
  removeBrowserElementSelection,
  selectBrowserCaptureSession,
  updateBrowserElementAnnotations
} from '@/app/browser-inspector/state'
import { useDialogUI } from '@/components/ui/dialog'

const sessions = browserCaptureSessions
const dialog = useDialogUI({
  content:
    'flex max-h-[calc(100vh-3rem)] w-[min(920px,calc(100vw-3rem))] flex-col overflow-hidden rounded-[18px] bg-chrome-raised p-0',
  overlay: 'bg-black/60 backdrop-blur-[2px]'
})
const editing = ref<{ selectionId: string; sessionId: string } | null>(null)
const editingAnnotationId = ref<string | null>(null)
const annotationInput = ref<HTMLInputElement | null>(null)

const expandedSession = computed(() =>
  browserInspectorState.expandedSessionId
    ? getBrowserCaptureSession(browserInspectorState.expandedSessionId)
    : undefined
)
const editingSelection = computed(() => {
  const identity = editing.value
  if (!identity) return null
  return (
    getBrowserCaptureSession(identity.sessionId)?.selections.find(
      (selection) => selection.id === identity.selectionId
    ) ?? null
  )
})
const editingAnnotation = computed(() =>
  editingSelection.value?.annotations?.find(
    (annotation) => annotation.id === editingAnnotationId.value
  )
)

function itemCount(session: (typeof sessions.value)[number]) {
  return session.selections.length + session.recordings.length
}

function durationLabel(durationMs: number) {
  return `${String(Math.max(1, Math.round(durationMs / 1_000)))}s`
}

function sessionDrag(event: DragEvent, sessionId: string) {
  writeBrowserCaptureDrag(event, { sessionId })
}

function selectionDrag(event: DragEvent, sessionId: string, selectionId: string) {
  writeBrowserCaptureDrag(event, { selectionId, sessionId })
}

function recordingDrag(event: DragEvent, sessionId: string, recordingId: string) {
  writeBrowserCaptureDrag(event, { recordingId, sessionId })
}

function openAnnotationReview(sessionId: string, selectionId: string) {
  editing.value = { selectionId, sessionId }
  editingAnnotationId.value = null
  clearBrowserElementAnnotationRequest()
}

function annotationsFor(selection: BrowserElementSelection) {
  return selection.annotations ?? []
}

function saveAnnotations(annotations: BrowserElementAnnotation[]) {
  const identity = editing.value
  if (identity) {
    updateBrowserElementAnnotations(identity.sessionId, identity.selectionId, annotations)
  }
}

function removeBlankAnnotation() {
  const selection = editingSelection.value
  const annotation = editingAnnotation.value
  if (selection && annotation && !annotation.comment.trim()) {
    saveAnnotations(annotationsFor(selection).filter((candidate) => candidate.id !== annotation.id))
  }
}

function closeAnnotationReview() {
  removeBlankAnnotation()
  editing.value = null
  editingAnnotationId.value = null
}

async function addAnnotation(event: MouseEvent) {
  const selection = editingSelection.value
  const image = event.currentTarget
  if (!selection || !(image instanceof HTMLImageElement)) return
  removeBlankAnnotation()
  const bounds = image.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const annotation: BrowserElementAnnotation = {
    comment: '',
    id: globalThis.crypto.randomUUID(),
    x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
    y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height))
  }
  saveAnnotations([...annotationsFor(selection), annotation])
  editingAnnotationId.value = annotation.id
  await nextTick()
  annotationInput.value?.focus({ preventScroll: true })
}

async function openAnnotation(annotationId: string) {
  removeBlankAnnotation()
  editingAnnotationId.value = annotationId
  await nextTick()
  annotationInput.value?.focus({ preventScroll: true })
}

function updateAnnotationComment(event: Event) {
  const selection = editingSelection.value
  const annotationId = editingAnnotationId.value
  const input = event.target
  if (!selection || !annotationId || !(input instanceof HTMLInputElement)) return
  saveAnnotations(
    annotationsFor(selection).map((annotation) =>
      annotation.id === annotationId ? { ...annotation, comment: input.value } : annotation
    )
  )
}

function removeEditingAnnotation() {
  const selection = editingSelection.value
  const annotationId = editingAnnotationId.value
  if (!selection || !annotationId) return
  saveAnnotations(annotationsFor(selection).filter((annotation) => annotation.id !== annotationId))
  editingAnnotationId.value = null
}

function annotationStyle(annotation: BrowserElementAnnotation) {
  return { left: `${String(annotation.x * 100)}%`, top: `${String(annotation.y * 100)}%` }
}

watch(
  () => browserInspectorState.annotationRequest,
  (request) => {
    if (request) openAnnotationReview(request.sessionId, request.selectionId)
  }
)
</script>

<template>
  <section
    v-if="sessions.length || browserInspectorState.error"
    data-test-id="browser-inspector-selection-panel"
    class="border-border/55 shrink-0 border-b px-2.5 py-2"
    aria-label="Chrome capture sessions"
  >
    <div
      v-if="sessions.length"
      data-test-id="browser-inspector-session-strip"
      class="scrollbar-none flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5"
    >
      <div
        v-for="session in sessions"
        :key="session.id"
        data-test-id="browser-inspector-session"
        draggable="true"
        class="border-chrome-control-border bg-chrome-detail flex h-8 max-w-[190px] shrink-0 items-center rounded-[8px] border text-[10px] transition-colors hover:border-accent/45"
        :class="
          browserInspectorState.expandedSessionId === session.id
            ? 'border-accent/55 bg-accent/[0.06]'
            : ''
        "
        @dragstart="sessionDrag($event, session.id)"
      >
        <button
          type="button"
          class="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-surface"
          :aria-expanded="browserInspectorState.expandedSessionId === session.id"
          :aria-label="`${session.title}, ${String(itemCount(session))} items`"
          @click="selectBrowserCaptureSession(session.id)"
        >
          <span class="max-w-[112px] truncate font-medium">{{ session.title }}</span>
          <span class="shrink-0 tabular-nums text-muted">{{ itemCount(session) }}</span>
          <icon-lucide-chevron-down
            class="size-3 shrink-0 text-muted transition-transform"
            :class="browserInspectorState.expandedSessionId === session.id ? 'rotate-180' : ''"
          />
        </button>
        <button
          type="button"
          class="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
          :aria-label="`Remove ${session.title} from sidebar`"
          @click.stop="removeBrowserCaptureSession(session.id)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </div>
    </div>

    <div
      v-if="expandedSession"
      data-test-id="browser-inspector-session-children"
      class="scrollbar-none mt-1.5 max-h-44 space-y-1 overflow-y-auto"
    >
      <div
        v-for="(selection, index) in expandedSession.selections"
        :key="selection.id"
        data-test-id="browser-inspector-selection"
        draggable="true"
        class="group border-border/45 hover:border-border/80 hover:bg-hover/45 flex h-9 min-w-0 items-center gap-2 rounded-[7px] border px-2 transition-colors"
        @dragstart="selectionDrag($event, expandedSession.id, selection.id)"
      >
        <span
          class="bg-accent/12 flex size-4 shrink-0 items-center justify-center rounded-full text-[8.5px] font-semibold text-accent"
        >
          {{ index + 1 }}
        </span>
        <icon-lucide-mouse-pointer-click class="size-3.5 shrink-0 text-muted" />
        <span class="min-w-0 flex-1 truncate text-[10.5px] text-surface">
          {{ browserElementLabel(selection) }}
        </span>
        <span
          v-if="selection.annotations?.length"
          class="shrink-0 text-[9px] tabular-nums text-accent"
        >
          {{ selection.annotations.length }}
        </span>
        <div
          class="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-accent"
            :aria-label="`Annotate ${browserElementLabel(selection)}`"
            @click="openAnnotationReview(expandedSession.id, selection.id)"
          >
            <icon-lucide-pen-line class="size-3" />
          </button>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded-[5px] text-muted hover:bg-red-400/10 hover:text-red-400"
            :aria-label="`Remove ${browserElementLabel(selection)} from session`"
            @click="removeBrowserElementSelection(expandedSession.id, selection.id)"
          >
            <icon-lucide-x class="size-3" />
          </button>
        </div>
      </div>

      <div
        v-for="recording in expandedSession.recordings"
        :key="recording.id"
        data-test-id="browser-inspector-recording"
        draggable="true"
        class="group border-border/45 hover:border-border/80 hover:bg-hover/45 flex h-9 min-w-0 items-center gap-2 rounded-[7px] border px-2 transition-colors"
        @dragstart="recordingDrag($event, expandedSession.id, recording.id)"
      >
        <span class="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-400/12">
          <span class="size-1.5 rounded-full bg-red-400" />
        </span>
        <icon-lucide-video class="size-3.5 shrink-0 text-muted" />
        <span class="min-w-0 flex-1 truncate text-[10.5px] text-surface">Motion recording</span>
        <span class="shrink-0 text-[9px] tabular-nums text-muted">
          {{ durationLabel(recording.durationMs) }}
        </span>
        <button
          type="button"
          class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-red-400/10 hover:text-red-400"
          aria-label="Remove motion recording from session"
          @click="removeBrowserCaptureRecording(expandedSession.id, recording.id)"
        >
          <icon-lucide-x class="size-3" />
        </button>
      </div>

      <div
        v-if="expandedSession.recordingStatus === 'recording'"
        class="flex h-8 items-center gap-2 px-2 text-[10px] text-muted"
        role="status"
      >
        <span class="size-2 animate-pulse rounded-full bg-red-400" />
        Recording motion…
      </div>

      <p
        v-if="!expandedSession.selections.length && !expandedSession.recordings.length"
        class="px-2 py-1 text-[10px] text-muted"
      >
        Select elements in Chrome. Each click is saved to this session and Trace.
      </p>
    </div>

    <p
      v-if="browserInspectorState.error"
      data-test-id="browser-inspector-error"
      class="mt-1.5 text-[10px] leading-4 text-red-400"
      role="status"
    >
      {{ browserInspectorState.error }}
    </p>
  </section>

  <DialogRoot :open="Boolean(editing)" @update:open="!$event && closeAnnotationReview()">
    <DialogPortal>
      <DialogOverlay :class="dialog.overlay" />
      <DialogContent
        v-if="editingSelection"
        data-test-id="browser-inspector-annotation-review"
        :class="dialog.content"
      >
        <header
          class="border-border/60 flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3"
        >
          <div class="min-w-0">
            <DialogTitle :class="dialog.title" class="truncate">
              {{ browserElementLabel(editingSelection) }}
            </DialogTitle>
            <DialogDescription :class="`${dialog.description} mt-0.5`">
              Click the screenshot to pin a comment. Annotations are optional.
            </DialogDescription>
          </div>
          <DialogClose
            type="button"
            aria-label="Close annotation review"
            class="flex size-8 shrink-0 items-center justify-center rounded-[7px] text-muted hover:bg-hover hover:text-surface"
          >
            <icon-lucide-x class="size-4" />
          </DialogClose>
        </header>

        <div class="min-h-0 flex-1 overflow-auto bg-black/45 p-4">
          <div
            class="relative mx-auto w-fit max-w-full overflow-visible rounded-[10px] shadow-2xl ring-1 ring-white/10"
          >
            <img
              :src="editingSelection.snapshot.dataUrl"
              alt="Chrome capture ready for annotation"
              draggable="false"
              class="block max-h-[calc(100vh-16rem)] max-w-full cursor-crosshair rounded-[10px] object-contain select-none"
              @click="addAnnotation"
            />
            <button
              v-for="(annotation, index) in annotationsFor(editingSelection)"
              :key="annotation.id"
              type="button"
              data-test-id="browser-inspector-annotation-marker"
              :aria-label="`Open screenshot comment ${String(index + 1)}`"
              class="absolute z-10 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-lg ring-2 ring-white/90"
              :style="annotationStyle(annotation)"
              @click.stop="openAnnotation(annotation.id)"
            >
              {{ index + 1 }}
            </button>
          </div>
        </div>

        <form
          v-if="editingAnnotation"
          data-test-id="browser-inspector-annotation-editor"
          class="border-border/60 flex shrink-0 items-center gap-2 border-t px-4 py-3"
          @submit.prevent="editingAnnotationId = null"
        >
          <span
            class="bg-accent flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          >
            {{
              annotationsFor(editingSelection).findIndex(
                (candidate) => candidate.id === editingAnnotation?.id
              ) + 1
            }}
          </span>
          <input
            ref="annotationInput"
            :value="editingAnnotation.comment"
            aria-label="Screenshot comment"
            placeholder="What should the agent notice here?"
            class="border-border bg-input h-9 min-w-0 flex-1 rounded-[8px] border px-3 text-[12px] text-surface outline-none placeholder:text-muted focus:border-accent"
            @input="updateAnnotationComment"
          />
          <button
            type="button"
            aria-label="Remove screenshot comment"
            class="flex size-9 shrink-0 items-center justify-center rounded-[8px] text-muted hover:bg-red-400/10 hover:text-red-400"
            @click="removeEditingAnnotation"
          >
            <icon-lucide-trash-2 class="size-4" />
          </button>
          <button
            type="submit"
            class="bg-accent hover:bg-accent/90 h-9 shrink-0 rounded-[8px] px-3 text-[12px] font-medium text-white"
          >
            Done
          </button>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
