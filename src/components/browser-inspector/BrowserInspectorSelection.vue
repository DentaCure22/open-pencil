<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { browserElementLabel, compactBrowserElementTitle } from '@/app/browser-inspector/context'
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
  setBrowserCaptureSessionExpanded,
  updateBrowserElementAnnotations
} from '@/app/browser-inspector/state'
import { useDialogUI } from '@/components/ui/dialog'
import { usePopoverUI } from '@/components/ui/popover'

const sessions = browserCaptureSessions
const dialog = useDialogUI({
  content:
    'flex max-h-[calc(100vh-3rem)] w-[min(920px,calc(100vw-3rem))] flex-col overflow-hidden rounded-[18px] bg-chrome-raised p-0 ring-1 ring-chrome-border data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150',
  overlay:
    'bg-black/35 backdrop-blur-[6px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-150'
})
const sessionPopover = usePopoverUI({
  content:
    'z-[120] w-[268px] max-h-[min(280px,50vh)] overflow-y-auto rounded-[12px] border-chrome-border bg-chrome-raised p-1 shadow-chrome-menu backdrop-blur-2xl'
})
const editing = ref<{ selectionId: string; sessionId: string } | null>(null)
const editingAnnotationId = ref<string | null>(null)
const annotationInput = ref<HTMLInputElement | null>(null)
const sessionRowExpanded = ref(true)

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
const annotationEditorStyle = computed(() => {
  const annotation = editingAnnotation.value
  if (!annotation) return {}
  const opensLeft = annotation.x > 0.62
  return {
    left: `${String(annotation.x * 100)}%`,
    top: `${String(Math.min(0.92, Math.max(0.08, annotation.y)) * 100)}%`,
    transform: opensLeft ? 'translate(calc(-100% - 18px), -50%)' : 'translate(18px, -50%)'
  }
})

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

function updateSessionOpen(sessionId: string, open: boolean) {
  setBrowserCaptureSessionExpanded(open ? sessionId : null)
}

function toggleSessionRow() {
  sessionRowExpanded.value = !sessionRowExpanded.value
  if (!sessionRowExpanded.value) setBrowserCaptureSessionExpanded(null)
}

async function openAnnotationReview(sessionId: string, selectionId: string) {
  setBrowserCaptureSessionExpanded(null)
  editing.value = { selectionId, sessionId }
  clearBrowserElementAnnotationRequest()
  const selection = getBrowserCaptureSession(sessionId)?.selections.find(
    (candidate) => candidate.id === selectionId
  )
  if (!selection) return
  const existing = annotationsFor(selection).at(-1)
  if (existing) {
    editingAnnotationId.value = existing.id
  } else {
    const annotation: BrowserElementAnnotation = {
      comment: '',
      id: globalThis.crypto.randomUUID(),
      x: 0.5,
      y: 0.5
    }
    saveAnnotations([annotation])
    editingAnnotationId.value = annotation.id
  }
  await nextTick()
  annotationInput.value?.focus({ preventScroll: true })
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

function finishEditingAnnotation() {
  removeBlankAnnotation()
  editingAnnotationId.value = null
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
  if (editingAnnotationId.value === annotationId) {
    annotationInput.value?.focus({ preventScroll: true })
    return
  }
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

function annotationStyle(annotation: BrowserElementAnnotation) {
  return { left: `${String(annotation.x * 100)}%`, top: `${String(annotation.y * 100)}%` }
}

watch(
  () => browserInspectorState.annotationRequest,
  (request) => {
    if (request) void openAnnotationReview(request.sessionId, request.selectionId)
  }
)
</script>

<template>
  <section
    v-if="sessions.length || browserInspectorState.error"
    data-test-id="browser-inspector-selection-panel"
    data-openpencil-browser-inspector-ui
    class="group/session-row relative shrink-0 px-2.5 transition-[padding] duration-150"
    :class="sessionRowExpanded ? 'py-2' : 'py-1'"
    aria-label="Chrome capture sessions"
  >
    <div v-if="sessions.length" class="relative min-h-4">
      <div
        v-show="sessionRowExpanded"
        id="browser-inspector-session-strip"
        data-test-id="browser-inspector-session-strip"
        class="scrollbar-none flex min-w-0 gap-1.5 overflow-x-auto overscroll-x-contain pb-0.5"
      >
        <PopoverRoot
          v-for="session in sessions"
          :key="session.id"
          :open="browserInspectorState.expandedSessionId === session.id"
          @update:open="updateSessionOpen(session.id, $event)"
        >
          <div
            data-test-id="browser-inspector-session"
            draggable="true"
            class="group border-chrome-control-border bg-chrome-raised flex h-8 max-w-[212px] shrink-0 items-center rounded-[8px] border text-[10px] transition-colors hover:border-accent/45"
            :class="
              browserInspectorState.expandedSessionId === session.id ? 'border-accent/55' : ''
            "
            @dragstart="sessionDrag($event, session.id)"
          >
            <PopoverTrigger as-child>
              <button
                type="button"
                class="grid h-full min-w-0 flex-1 grid-cols-[minmax(0,1fr)_18px] items-center pl-2 text-left text-surface outline-none"
                :aria-expanded="browserInspectorState.expandedSessionId === session.id"
                :aria-label="`${session.title}, ${String(itemCount(session))} items`"
              >
                <span class="truncate font-medium">{{ session.title }}</span>
                <span class="text-center tabular-nums text-muted">{{ itemCount(session) }}</span>
              </button>
            </PopoverTrigger>
            <button
              type="button"
              class="pointer-events-none flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted opacity-0 transition-[color,background-color,opacity] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-hover hover:text-surface"
              :aria-label="`Remove ${session.title} from sidebar`"
              @click.stop="removeBrowserCaptureSession(session.id)"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </div>

          <PopoverPortal>
            <PopoverContent
              data-test-id="browser-inspector-session-children"
              data-openpencil-browser-inspector-ui
              :class="sessionPopover.content"
              :side-offset="6"
              :collision-padding="12"
              side="bottom"
              align="start"
              @open-auto-focus="$event.preventDefault()"
              @close-auto-focus="$event.preventDefault()"
            >
              <div>
                <div
                  v-for="(selection, index) in session.selections"
                  :key="selection.id"
                  data-test-id="browser-inspector-selection"
                  draggable="true"
                  class="group hover:bg-hover/45 focus-within:bg-hover/45 grid h-9 min-w-0 grid-cols-[minmax(0,1fr)_24px] items-center rounded-[7px] px-2 transition-colors"
                  @dragstart="selectionDrag($event, session.id, selection.id)"
                >
                  <button
                    type="button"
                    class="grid h-full min-w-0 cursor-pointer grid-cols-[18px_18px_minmax(0,1fr)] items-center gap-1 text-left outline-none"
                    :aria-label="`Open ${browserElementLabel(selection)} annotation`"
                    @click="openAnnotationReview(session.id, selection.id)"
                  >
                    <span
                      class="bg-accent/12 flex size-[18px] items-center justify-center rounded-full text-[8.5px] font-semibold text-accent"
                    >
                      {{ index + 1 }}
                    </span>
                    <span class="flex size-[18px] items-center justify-center">
                      <icon-lucide-mouse-pointer-click class="size-3.5 text-muted" />
                    </span>
                    <span class="truncate text-[10.5px] text-surface">
                      {{ browserElementLabel(selection) }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="pointer-events-none flex size-6 items-center justify-center rounded-[5px] text-muted/70 opacity-0 transition-[color,background-color,opacity] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-red-400/10 hover:text-red-400"
                    :aria-label="`Remove ${browserElementLabel(selection)} from session`"
                    @click.stop="removeBrowserElementSelection(session.id, selection.id)"
                  >
                    <icon-lucide-x class="size-3" />
                  </button>
                </div>

                <div
                  v-for="recording in session.recordings"
                  :key="recording.id"
                  data-test-id="browser-inspector-recording"
                  draggable="true"
                  class="group hover:bg-hover/45 grid h-9 min-w-0 grid-cols-[18px_18px_minmax(0,1fr)_auto_24px] items-center gap-1 rounded-[7px] px-2 transition-colors"
                  @dragstart="recordingDrag($event, session.id, recording.id)"
                >
                  <span
                    class="flex size-[18px] items-center justify-center rounded-full bg-red-400/12"
                  >
                    <span class="size-1.5 rounded-full bg-red-400" />
                  </span>
                  <span class="flex size-[18px] items-center justify-center">
                    <icon-lucide-video class="size-3.5 text-muted" />
                  </span>
                  <span class="truncate text-[10.5px] text-surface">Motion recording</span>
                  <span class="text-[9px] tabular-nums text-muted">
                    {{ durationLabel(recording.durationMs) }}
                  </span>
                  <button
                    type="button"
                    class="pointer-events-none flex size-6 items-center justify-center rounded-[5px] text-muted/70 opacity-0 transition-[color,background-color,opacity] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-red-400/10 hover:text-red-400"
                    aria-label="Remove motion recording from session"
                    @click="removeBrowserCaptureRecording(session.id, recording.id)"
                  >
                    <icon-lucide-x class="size-3" />
                  </button>
                </div>

                <div
                  v-if="session.recordingStatus === 'recording'"
                  class="flex h-9 items-center gap-2 px-1 text-[10px] text-muted"
                  role="status"
                >
                  <span class="size-2 animate-pulse rounded-full bg-red-400" />
                  Recording motion…
                </div>

                <p
                  v-if="!session.selections.length && !session.recordings.length"
                  class="px-1 py-2 text-[10px] leading-4 text-muted"
                >
                  Select elements in Chrome. Each click is saved to this session and Trace.
                </p>
              </div>
            </PopoverContent>
          </PopoverPortal>
        </PopoverRoot>
      </div>

      <button
        type="button"
        data-test-id="browser-inspector-session-row-toggle"
        class="border-chrome-control-border bg-chrome-raised pointer-events-none absolute top-1/2 right-0 z-20 flex size-6 -translate-y-1/2 items-center justify-center rounded-[7px] border text-muted opacity-0 shadow-sm transition-[color,background-color,opacity] group-hover/session-row:pointer-events-auto group-hover/session-row:opacity-100 group-focus-within/session-row:pointer-events-auto group-focus-within/session-row:opacity-100 hover:bg-hover hover:text-surface focus-visible:pointer-events-auto focus-visible:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
        :aria-expanded="sessionRowExpanded"
        aria-controls="browser-inspector-session-strip"
        :aria-label="
          sessionRowExpanded
            ? 'Collapse Chrome capture session row'
            : 'Expand Chrome capture session row'
        "
        @click="toggleSessionRow"
      >
        <icon-lucide-chevron-down
          class="size-3 transition-transform"
          :class="sessionRowExpanded ? 'rotate-180' : ''"
        />
      </button>
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
      <DialogOverlay data-openpencil-browser-inspector-ui :class="dialog.overlay" />
      <DialogContent
        v-if="editingSelection"
        data-test-id="browser-inspector-annotation-review"
        data-openpencil-browser-inspector-ui
        :class="dialog.content"
      >
        <header
          data-test-id="browser-inspector-annotation-header"
          class="group bg-chrome-raised flex shrink-0 items-center justify-between gap-3 px-4 py-3"
        >
          <DialogTitle
            :class="dialog.title"
            class="min-w-0 flex-1 truncate"
            :aria-label="browserElementLabel(editingSelection)"
          >
            {{ compactBrowserElementTitle(browserElementLabel(editingSelection)) }}
          </DialogTitle>
          <DialogClose
            type="button"
            data-test-id="browser-inspector-annotation-close"
            aria-label="Close annotation review"
            class="pointer-events-none flex size-8 shrink-0 items-center justify-center rounded-[7px] text-muted opacity-0 transition-[color,background-color,opacity] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 hover:bg-hover hover:text-surface focus-visible:pointer-events-auto focus-visible:opacity-100"
          >
            <icon-lucide-x class="size-4" />
          </DialogClose>
        </header>

        <div
          data-test-id="browser-inspector-annotation-stage"
          class="bg-chrome-raised min-h-0 flex-1 overflow-auto p-5"
          @pointerdown.self="finishEditingAnnotation"
        >
          <div
            class="relative mx-auto w-fit max-w-full overflow-visible rounded-[14px] shadow-[0_22px_70px_rgba(15,23,42,0.18)] ring-1 ring-chrome-border"
          >
            <img
              :src="editingSelection.snapshot.dataUrl"
              alt="Chrome capture ready for annotation"
              draggable="false"
              class="block max-h-[calc(100vh-12rem)] max-w-full cursor-crosshair rounded-[14px] object-contain select-none"
              @click="addAnnotation"
            />
            <button
              v-for="(annotation, index) in annotationsFor(editingSelection)"
              :key="annotation.id"
              type="button"
              data-test-id="browser-inspector-annotation-marker"
              :aria-label="`Open screenshot comment ${String(index + 1)}`"
              class="absolute z-10 size-9 -translate-x-1/2 -translate-y-1/2 text-blue-500 drop-shadow-[0_3px_8px_rgba(0,0,0,0.3)] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              :class="editingAnnotationId === annotation.id ? 'scale-110' : ''"
              :style="annotationStyle(annotation)"
              @click.stop="openAnnotation(annotation.id)"
            >
              <icon-lucide-message-circle
                class="size-9 fill-current stroke-[1.5] [&>path]:fill-current"
              />
              <span
                class="absolute inset-x-0 top-[7px] text-center text-[12px] leading-none font-semibold text-white"
              >
                {{ index + 1 }}
              </span>
            </button>

            <form
              v-if="editingAnnotation"
              data-test-id="browser-inspector-annotation-editor"
              class="border-chrome-border bg-chrome-raised absolute z-20 flex h-12 w-[min(360px,calc(100vw-5rem))] items-center gap-1 rounded-full border p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.28)] ring-1 ring-black/10 backdrop-blur-2xl"
              :style="annotationEditorStyle"
              @submit.prevent="finishEditingAnnotation"
              @pointerdown.stop
            >
              <input
                ref="annotationInput"
                :value="editingAnnotation.comment"
                aria-label="Screenshot comment"
                placeholder="Add a comment…"
                class="h-9 min-w-0 flex-1 bg-transparent px-3 text-[14px] text-surface outline-none placeholder:text-muted/70"
                @input="updateAnnotationComment"
                @keydown="annotationKeydown"
              />
              <button
                type="button"
                aria-label="Remove screenshot comment"
                class="flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-red-400/10 hover:text-red-400"
                @click="removeEditingAnnotation"
              >
                <icon-lucide-trash-2 class="size-4" />
              </button>
            </form>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
