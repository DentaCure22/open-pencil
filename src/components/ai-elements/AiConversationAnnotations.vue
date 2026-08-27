<script setup lang="ts">
import { refAutoReset, useClipboard, useEventListener } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'

import type { AgentPromptAnnotation } from '@/app/agent-chat/models'
import {
  speechDictationActiveOwner,
  speechDictationAvailable,
  startSpeechDictation,
  stopSpeechDictation
} from '@/app/speech-dictation'
import { parseT3DiffAnnotationSourceId } from './t3-right-panel.logic'

type AnnotationTarget = Pick<
  AgentPromptAnnotation,
  'endOffset' | 'quote' | 'sourceMessageId' | 'startOffset'
>

type FixedRect = {
  height: number
  left: number
  top: number
  width: number
}

type AnnotationMarker = {
  annotation: AgentPromptAnnotation
  index: number
  left: number
  top: number
}

const { annotations, contentRevision, surface } = defineProps<{
  annotations: AgentPromptAnnotation[]
  contentRevision: number
  surface: HTMLElement | null
}>()

const emit = defineEmits<{
  'open-diff-annotation': [annotation: AgentPromptAnnotation]
  'update:annotations': [value: AgentPromptAnnotation[]]
}>()

const copiedSelection = refAutoReset(false, 1_500)
const selectedText = ref('')
const pendingSelection = ref<AnnotationTarget | null>(null)
const selectionActions = ref<HTMLElement | null>(null)
const selectionPosition = ref({ left: 0, placeBelow: false, top: 0 })
const selectionActionStyle = computed(() => ({
  left: `${String(selectionPosition.value.left)}px`,
  top: `${String(selectionPosition.value.top)}px`,
  transform: `translate(-50%, ${selectionPosition.value.placeBelow ? '0' : '-100%'})`
}))
const { copy } = useClipboard()
const markerPositions = ref<Record<string, { left: number; top: number }>>({})
const activeHighlightRects = ref<FixedRect[]>([])
const editingAnnotationId = ref<string | null>(null)
const annotationComment = ref('')
const annotationEditor = ref<HTMLElement | null>(null)
const annotationInput = ref<HTMLInputElement | null>(null)
const annotationEditorPosition = ref({ left: 16, top: 16, width: 320 })
const annotationEditorStyle = computed(() => ({
  left: `${String(annotationEditorPosition.value.left)}px`,
  top: `${String(annotationEditorPosition.value.top)}px`,
  width: `${String(annotationEditorPosition.value.width)}px`
}))
const annotationDictationOwner = `ai-annotation-${useId()}`
const dictatingAnnotation = computed(
  () => speechDictationActiveOwner.value === annotationDictationOwner
)
const annotationMarkers = computed<AnnotationMarker[]>(() =>
  annotations.flatMap((annotation, index) => {
    const position = markerPositions.value[annotation.id]
    return position ? [{ annotation, index, ...position }] : []
  })
)

function selectionNodeInsideTranscript(node: Node | null): boolean {
  const viewport = surface?.querySelector('[data-test-id="ai-conversation-viewport"]')
  return Boolean(node && viewport?.contains(node))
}

function messageElementForNode(node: Node | null): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest<HTMLElement>('[data-message-id]') ?? null
}

function textOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange()
  range.selectNodeContents(root)
  try {
    range.setEnd(node, offset)
  } catch {
    return -1
  }
  return range.toString().length
}

function targetFromSelection(selection: Selection): AnnotationTarget | null {
  if (selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const startRoot = messageElementForNode(range.startContainer)
  const endRoot = messageElementForNode(range.endContainer)
  const sourceMessageId = startRoot?.dataset.messageId
  if (!startRoot || startRoot !== endRoot || !sourceMessageId) return null

  const rawQuote = range.toString()
  const quote = rawQuote.trim()
  if (!quote) return null
  const leadingWhitespace = rawQuote.length - rawQuote.trimStart().length
  const trailingWhitespace = rawQuote.length - rawQuote.trimEnd().length
  const rawStartOffset = textOffset(startRoot, range.startContainer, range.startOffset)
  const rawEndOffset = textOffset(startRoot, range.endContainer, range.endOffset)
  if (rawStartOffset < 0 || rawEndOffset < 0) return null
  return {
    endOffset: rawEndOffset - trailingWhitespace,
    quote,
    sourceMessageId,
    startOffset: rawStartOffset + leadingWhitespace
  }
}

function selectionIsBackward(selection: Selection): boolean {
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection
  if (!anchorNode || !focusNode) return false
  if (anchorNode === focusNode) return anchorOffset > focusOffset
  const probe = document.createRange()
  try {
    probe.setStart(anchorNode, anchorOffset)
    probe.setEnd(focusNode, focusOffset)
  } catch {
    return false
  }
  return probe.collapsed
}

function messageElement(messageId: string): HTMLElement | null {
  return (
    [...(surface?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find(
      (element) => element.dataset.messageId === messageId
    ) ?? null
  )
}

function rangePoint(
  root: HTMLElement,
  targetOffset: number
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let consumed = 0
  let node = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    if (targetOffset <= consumed + text.length) {
      return { node: node as Text, offset: Math.max(0, targetOffset - consumed) }
    }
    consumed += text.length
    node = walker.nextNode()
  }
  return null
}

function rangeForAnnotation(annotation: AnnotationTarget): Range | null {
  const root = messageElement(annotation.sourceMessageId)
  if (!root || annotation.startOffset < 0 || annotation.endOffset <= annotation.startOffset) {
    return null
  }
  const start = rangePoint(root, annotation.startOffset)
  const end = rangePoint(root, annotation.endOffset)
  if (!start || !end) return null
  const range = document.createRange()
  try {
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
  } catch {
    return null
  }
  return range
}

function visibleRects(range: Range): FixedRect[] {
  return [...range.getClientRects()]
    .filter(
      (rect) =>
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight &&
        rect.right > 0 &&
        rect.left < window.innerWidth
    )
    .map((rect) => ({
      height: rect.height,
      left: rect.left,
      top: rect.top,
      width: rect.width
    }))
}

function createAnnotationId(): string {
  const values = crypto.getRandomValues(new Uint32Array(2))
  const [first = 0, second = 0] = values
  return `annotation-${first.toString(36)}-${second.toString(36)}`
}

function positionAnnotationEditor(range: Range) {
  const rects = visibleRects(range)
  const anchor = rects.at(-1) ?? range.getBoundingClientRect()
  const width = Math.min(420, Math.max(240, window.innerWidth - 32))
  const left = Math.min(window.innerWidth - width - 16, Math.max(16, anchor.left))
  const anchorBottom = anchor.top + anchor.height
  const placeAbove = anchorBottom + 60 > window.innerHeight && anchor.top > 60
  annotationEditorPosition.value = {
    left,
    top: placeAbove
      ? Math.max(12, anchor.top - 56)
      : Math.min(window.innerHeight - 56, anchorBottom + 10),
    width
  }
}

function restoreNativeSelection(range: Range) {
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function hasAnnotationLayout() {
  return annotations.length > 0 || Boolean(editingAnnotationId.value)
}

function refreshAnnotationGeometry() {
  if (!hasAnnotationLayout()) {
    if (Object.keys(markerPositions.value).length) markerPositions.value = {}
    if (activeHighlightRects.value.length) activeHighlightRects.value = []
    return
  }
  const positions: Record<string, { left: number; top: number }> = {}
  const occupied = new Map<number, number>()
  for (const annotation of annotations) {
    const range = rangeForAnnotation(annotation)
    if (!range) continue
    const rects = visibleRects(range)
    const anchor = rects.at(-1)
    if (!anchor) continue
    const lane = Math.round(
      Math.min(window.innerWidth - 28, Math.max(4, anchor.left + anchor.width + 6))
    )
    const previousTop = occupied.get(lane)
    let top = Math.min(window.innerHeight - 28, Math.max(4, anchor.top + anchor.height / 2 - 12))
    if (previousTop !== undefined && Math.abs(top - previousTop) < 20) top = previousTop + 18
    occupied.set(lane, top)
    positions[annotation.id] = { left: lane, top }
  }
  markerPositions.value = positions

  const active = annotations.find((annotation) => annotation.id === editingAnnotationId.value)
  if (!active) {
    if (editingAnnotationId.value) {
      stopSpeechDictation(annotationDictationOwner)
      editingAnnotationId.value = null
    }
    activeHighlightRects.value = []
    return
  }
  const range = rangeForAnnotation(active)
  if (!range) return
  activeHighlightRects.value = visibleRects(range)
  positionAnnotationEditor(range)
}

function syncSelectionActions() {
  if (editingAnnotationId.value) {
    selectedText.value = ''
    return
  }
  const selection = window.getSelection()
  if (
    !selection ||
    selection.isCollapsed ||
    !selection.rangeCount ||
    !selectionNodeInsideTranscript(selection.anchorNode) ||
    !selectionNodeInsideTranscript(selection.focusNode)
  ) {
    selectedText.value = ''
    pendingSelection.value = null
    return
  }
  const quote = selection.toString().trim()
  if (!quote) {
    selectedText.value = ''
    pendingSelection.value = null
    return
  }
  const range = selection.getRangeAt(0)
  const rects = visibleRects(range)
  const rect =
    (selectionIsBackward(selection) ? rects[0] : rects.at(-1)) ?? range.getBoundingClientRect()
  if (!rect.width && !rect.height) {
    selectedText.value = ''
    pendingSelection.value = null
    return
  }
  selectedText.value = quote
  pendingSelection.value = targetFromSelection(selection)
  const left = Math.min(window.innerWidth - 112, Math.max(112, rect.left + rect.width / 2))
  const placeBelow = rect.top < 58
  selectionPosition.value = {
    left,
    placeBelow,
    top: placeBelow ? rect.top + rect.height + 8 : rect.top - 8
  }
}

async function copySelectedText() {
  if (!selectedText.value) return
  await copy(selectedText.value)
  copiedSelection.value = true
}

async function addSelectedTextToChat() {
  const target = pendingSelection.value
  if (!target) return
  const annotation: AgentPromptAnnotation = {
    ...target,
    comment: '',
    id: createAnnotationId()
  }
  emit('update:annotations', [...annotations, annotation])
  selectedText.value = ''
  pendingSelection.value = null
  editingAnnotationId.value = annotation.id
  annotationComment.value = ''
  const range = rangeForAnnotation(annotation)
  if (range) {
    restoreNativeSelection(range)
    activeHighlightRects.value = visibleRects(range)
    positionAnnotationEditor(range)
  }
  await nextTick()
  refreshAnnotationGeometry()
  annotationInput.value?.focus({ preventScroll: true })
}

function updateAnnotationComment(value: string) {
  annotationComment.value = value
  if (!editingAnnotationId.value) return
  emit(
    'update:annotations',
    annotations.map((annotation) =>
      annotation.id === editingAnnotationId.value ? { ...annotation, comment: value } : annotation
    )
  )
}

function annotationCommentInput(event: Event) {
  const target = event.target
  if (target instanceof HTMLInputElement) updateAnnotationComment(target.value)
}

async function openAnnotation(annotationId: string) {
  const annotation = annotations.find((candidate) => candidate.id === annotationId)
  if (!annotation) return
  if (parseT3DiffAnnotationSourceId(annotation.sourceMessageId)) {
    emit('open-diff-annotation', annotation)
    return
  }
  const root = messageElement(annotation.sourceMessageId)
  if (!root) return
  root.scrollIntoView({ block: 'nearest' })
  await nextTick()
  const range = rangeForAnnotation(annotation)
  if (!range) return
  editingAnnotationId.value = annotation.id
  annotationComment.value = annotation.comment
  restoreNativeSelection(range)
  activeHighlightRects.value = visibleRects(range)
  positionAnnotationEditor(range)
  selectedText.value = ''
  pendingSelection.value = null
  await nextTick()
  refreshAnnotationGeometry()
  annotationInput.value?.focus({ preventScroll: true })
}

function closeAnnotationEditor() {
  stopSpeechDictation(annotationDictationOwner)
  editingAnnotationId.value = null
  activeHighlightRects.value = []
  window.getSelection()?.removeAllRanges()
}

function removeEditingAnnotation() {
  const annotationId = editingAnnotationId.value
  if (!annotationId) return
  emit(
    'update:annotations',
    annotations.filter((annotation) => annotation.id !== annotationId)
  )
  closeAnnotationEditor()
}

function annotationEditorKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || (event.key === 'Enter' && !event.isComposing)) {
    event.preventDefault()
    closeAnnotationEditor()
  }
}

function toggleAnnotationDictation() {
  if (dictatingAnnotation.value) {
    stopSpeechDictation(annotationDictationOwner)
    return
  }
  startSpeechDictation(annotationDictationOwner, annotationComment.value, updateAnnotationComment)
}

function closeAnnotationOnOutsidePointer(event: PointerEvent) {
  if (!editingAnnotationId.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (annotationEditor.value?.contains(target)) return
  if (target instanceof Element && target.closest('[data-test-id="ai-annotation-marker"]')) return
  closeAnnotationEditor()
}

function closeSelectionActionsOnOutsidePointer(event: PointerEvent) {
  if (!selectedText.value) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (surface?.contains(target) || selectionActions.value?.contains(target)) return
  selectedText.value = ''
  pendingSelection.value = null
  window.getSelection()?.removeAllRanges()
}

function handleSurfaceScroll() {
  selectedText.value = ''
  pendingSelection.value = null
  if (hasAnnotationLayout()) refreshAnnotationGeometry()
}

// Wait until the gesture ends before rendering selection actions. Updating this
// component during `selectionchange` can replace streamed Markdown text nodes
// while the pointer is still down, collapsing the browser's growing range.
useEventListener(document, 'pointerup', syncSelectionActions)
useEventListener(document, 'pointerdown', closeAnnotationOnOutsidePointer)
useEventListener(document, 'pointerdown', closeSelectionActionsOnOutsidePointer, { capture: true })
useEventListener(window, 'resize', () => {
  syncSelectionActions()
  if (hasAnnotationLayout()) refreshAnnotationGeometry()
})

function annotationLayoutSignature() {
  if (!hasAnnotationLayout()) return '0'
  return `${annotations
    .map(
      (annotation) =>
        `${annotation.id}:${annotation.sourceMessageId}:${annotation.startOffset}:${annotation.endOffset}:${annotation.quote.length}`
    )
    .join('|')}:${String(contentRevision)}`
}

watch(
  annotationLayoutSignature,
  async () => {
    if (!hasAnnotationLayout()) {
      refreshAnnotationGeometry()
      return
    }
    await nextTick()
    refreshAnnotationGeometry()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  stopSpeechDictation(annotationDictationOwner)
})

defineExpose({ handleSurfaceScroll, openAnnotation, syncSelectionActions })
</script>

<template>
  <Teleport to="body">
    <div
      v-for="(rect, index) in activeHighlightRects"
      :key="`highlight-${String(index)}`"
      aria-hidden="true"
      data-test-id="ai-annotation-highlight"
      class="pointer-events-none fixed z-[154] rounded-[2px] bg-accent/25 ring-1 ring-accent/40"
      :style="{
        height: `${String(rect.height)}px`,
        left: `${String(rect.left)}px`,
        top: `${String(rect.top)}px`,
        width: `${String(rect.width)}px`
      }"
    />
    <button
      v-for="marker in annotationMarkers"
      :key="marker.annotation.id"
      type="button"
      data-test-id="ai-annotation-marker"
      :aria-label="`Open annotation ${String(marker.index + 1)}`"
      class="fixed z-[158] flex size-6 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white shadow-chrome-menu ring-2 ring-agent-surface hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      :style="{
        left: `${String(marker.left)}px`,
        top: `${String(marker.top)}px`
      }"
      @pointerdown.stop
      @click="openAnnotation(marker.annotation.id)"
    >
      {{ marker.index + 1 }}
    </button>
    <form
      v-if="editingAnnotationId"
      ref="annotationEditor"
      data-test-id="ai-annotation-editor"
      class="border-chrome-control-border bg-chrome-raised fixed z-[162] flex h-12 items-center rounded-full border px-3 shadow-chrome-menu"
      :style="annotationEditorStyle"
      @keydown="annotationEditorKeydown"
      @pointerdown.stop
      @submit.prevent="closeAnnotationEditor"
    >
      <input
        ref="annotationInput"
        aria-label="Annotation comment"
        :value="annotationComment"
        class="min-w-0 flex-1 border-0 bg-transparent px-1 font-sans text-[13px] text-surface outline-none placeholder:text-muted/70"
        placeholder="Add an optional comment…"
        @input="annotationCommentInput"
      />
      <button
        type="button"
        data-test-id="ai-annotation-remove"
        aria-label="Remove annotation"
        class="flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-red-400/10 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/35"
        @click="removeEditingAnnotation"
      >
        <IconlyIcon name="delete" class="size-4" />
      </button>
      <button
        v-if="speechDictationAvailable"
        type="button"
        data-test-id="ai-annotation-dictation"
        :aria-label="
          dictatingAnnotation ? 'Stop annotation dictation' : 'Start annotation dictation'
        "
        :aria-pressed="dictatingAnnotation"
        class="flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 aria-pressed:bg-accent aria-pressed:text-white"
        @click="toggleAnnotationDictation"
      >
        <icon-lucide-mic-off v-if="dictatingAnnotation" class="size-4" />
        <IconlyIcon name="voice" v-else class="size-4" />
      </button>
    </form>
    <div
      v-if="selectedText"
      ref="selectionActions"
      data-test-id="ai-selection-actions"
      class="fixed z-[160] flex items-center overflow-hidden rounded-[11px] border border-border/90 bg-chrome-raised/98 text-[11px] font-medium text-surface shadow-chrome-menu backdrop-blur-xl select-none"
      :style="selectionActionStyle"
      @pointerdown.prevent
    >
      <button
        v-if="pendingSelection"
        type="button"
        class="flex h-9 items-center gap-1.5 px-3 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
        @click="addSelectedTextToChat"
      >
        <icon-lucide-message-square-plus class="size-3.5" />
        <span>Add to chat</span>
      </button>
      <span v-if="pendingSelection" aria-hidden="true" class="h-5 w-px bg-border/80" />
      <button
        type="button"
        :aria-label="copiedSelection ? 'Selection copied' : 'Copy selection'"
        class="flex size-9 items-center justify-center hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
        @click="copySelectedText"
      >
        <icon-lucide-check v-if="copiedSelection" class="size-3.5" />
        <icon-lucide-copy v-else class="size-3.5" />
      </button>
    </div>
  </Teleport>
</template>
