<script setup lang="ts">
import { refAutoReset, useClipboard, useDebounceFn } from '@vueuse/core'
import { computed, onMounted, ref, shallowRef, watch } from 'vue'

import {
  checkNarratedTraceSpeechAvailability,
  continueNarratedTraceRecording,
  editNarratedTraceEventText,
  formatNarratedTraceTime,
  narratedTraceContextMarkdown,
  narratedTraceError,
  narratedTraceHistory,
  narratedTraceIncludedCount,
  narratedTraceInterimText,
  narratedTracePointsPath,
  narratedTraceRemovedCount,
  narratedTraceSession,
  narratedTraceSpeechAvailability,
  narratedTraceStatus,
  narratedTraceViewMode,
  noteNarratedTraceEvent,
  openNarratedTraceRecord,
  pauseNarratedTraceRecording,
  removeNarratedTraceEventFromContext,
  readNarratedTraceEvidenceImage,
  removeNarratedTraceRecord,
  renameNarratedTraceTitle,
  restoreNarratedTraceEventToContext,
  resumeNarratedTraceRecording,
  startNarratedTraceActionRecording,
  startNarratedTraceRecording,
  stopNarratedTraceRecording,
  isNarratedTraceSupportingEvent
} from '@/app/narrated-trace'
import type { NarratedTraceContextEntry, NarratedTraceRow } from '@/app/narrated-trace'
import NarratedTraceHeader from '@/components/narrated-trace/NarratedTraceHeader.vue'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const showRemoved = ref(false)
const showBackground = ref(false)
const expandedEventIds = ref(new Set<string>())
const copiedEvidenceId = refAutoReset<string | null>(null, 2000)
const pendingDeleteRecordId = refAutoReset<string | null>(null, 3000)
const evidenceImages = shallowRef<Record<string, string>>({})
const { copy, copied } = useClipboard({ copiedDuring: 2000 })

const isActive = computed(
  () => narratedTraceStatus.value === 'recording' || narratedTraceStatus.value === 'paused'
)

function contextFor(eventId: string): NarratedTraceContextEntry {
  return (
    narratedTraceSession.value?.contextDraft.find((entry) => entry.sourceEventId === eventId) ?? {
      included: true,
      removed: false,
      sourceEventId: eventId
    }
  )
}

const rows = computed<NarratedTraceRow[]>(() =>
  (narratedTraceSession.value?.events ?? []).map((event) => ({
    context: contextFor(event.id),
    event
  }))
)
const visibleRows = computed(() => rows.value.filter((row) => !row.context.removed))
function selectionKey(row: NarratedTraceRow) {
  return (row.event.target?.name || rowText(row)).replace(/^C-selected\s+/i, '').toLowerCase()
}

const reviewCandidateRows = computed(() => {
  const candidates = visibleRows.value.filter(
    (row) => row.event.kind !== 'tool' && row.event.kind !== 'viewport'
  )
  return candidates.filter((row, index) => {
    if (row.event.kind !== 'selection') return true
    const next = candidates[index + 1]
    return !(
      next?.event.kind === 'selection' &&
      next.event.atMs - row.event.atMs <= 1000 &&
      selectionKey(next) === selectionKey(row)
    )
  })
})
const timelineRows = computed(() =>
  isActive.value
    ? reviewCandidateRows.value
    : reviewCandidateRows.value.filter((row) => !isNarratedTraceSupportingEvent(row.event))
)
const backgroundRows = computed(() =>
  visibleRows.value.filter(
    (row) =>
      row.event.kind === 'tool' ||
      row.event.kind === 'viewport' ||
      (!isActive.value && row.event.kind === 'selection')
  )
)
const removedRows = computed(() => rows.value.filter((row) => row.context.removed))
watch(
  rows,
  async (nextRows) => {
    const evidence = nextRows.flatMap((row) => (row.event.evidence ? [row.event.evidence] : []))
    const loaded = await Promise.all(
      evidence.map(
        async (item) => [item.evidenceId, await readNarratedTraceEvidenceImage(item)] as const
      )
    )
    evidenceImages.value = Object.fromEntries(
      loaded.filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
    )
  },
  { immediate: true }
)

const setupLabel = computed(() => {
  if (narratedTraceSpeechAvailability.value === 'unavailable') return 'Record canvas actions'
  if (narratedTraceStatus.value === 'review') return 'Start a new trace'
  return 'Start narrated trace'
})

const setupHint = computed(() => {
  if (narratedTraceSpeechAvailability.value === 'unavailable') {
    return 'Voice is unavailable here, but selections and edits can still be captured.'
  }
  return 'Your browser may process speech online. OpenPencil never saves the audio.'
})

const traceNotice = computed(() => {
  if (narratedTraceStatus.value === 'review') return null
  const error = narratedTraceError.value?.trim()
  if (!error) return null
  if (/no[- ]speech/i.test(error)) {
    return isActive.value
      ? 'Voice paused. Canvas actions are still recording.'
      : 'No speech was detected.'
  }
  return error
})

function rowText(row: NarratedTraceRow) {
  return row.context.editedText || row.event.text || row.event.label
}

function eventKindLabel(row: NarratedTraceRow) {
  const labels = {
    edit: 'Edit made',
    ink: 'Ink created',
    navigation: 'Navigation',
    note: 'Note',
    redo: 'Redo',
    screenshot: 'Focus moment',
    selection: 'Selection changed',
    shape: 'Shape created',
    tool: 'Tool changed',
    transcript: 'Spoken note',
    undo: 'Undo',
    viewport: 'Canvas moved'
  }
  return labels[row.event.kind]
}

function markerClass(row: NarratedTraceRow) {
  const classes = {
    edit: 'text-muted',
    ink: 'text-muted',
    navigation: 'text-muted',
    note: 'text-muted',
    redo: 'text-muted',
    screenshot: 'text-violet-200',
    selection: 'text-muted',
    shape: 'text-muted',
    tool: 'text-muted',
    transcript: 'text-violet-200',
    undo: 'text-muted',
    viewport: 'text-muted'
  }
  return classes[row.event.kind]
}

function rowObjectTitle(row: NarratedTraceRow) {
  if (row.event.kind === 'transcript') return rowText(row)
  if (row.event.kind === 'selection' || row.event.kind === 'edit' || row.event.kind === 'shape') {
    const targetName = row.event.target?.name?.trim()
    if (targetName) return targetName
    return rowText(row).replace(/^(?:C-selected|Selected|Created|Edited)\s+/i, '')
  }
  return rowText(row)
}

function rowActionLabel(row: NarratedTraceRow) {
  const labels = {
    edit: 'Edited',
    navigation: 'Opened',
    redo: 'Redone',
    selection: 'Selected',
    shape: 'Created',
    tool: 'Tool changed',
    undo: 'Undone',
    viewport: 'Canvas moved'
  } as const
  return row.event.kind in labels ? labels[row.event.kind as keyof typeof labels] : null
}

function compactValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  const text = String(value).trim()
  const numeric = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ? Number(text) : null
  if (numeric !== null && Number.isFinite(numeric)) {
    return numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
  return text.length > 24 ? `${text.slice(0, 21)}…` : text
}

function propertyLabel(property: string) {
  const leaf = property.split('.').at(-1) ?? property
  const spaced = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function rowDetail(row: NarratedTraceRow) {
  const change = row.event.changes?.[0]
  if (change) {
    return `${propertyLabel(change.property)} ${compactValue(change.before)} → ${compactValue(change.after)}`
  }
  if (row.event.viewport) return 'Zoom ' + Math.round(row.event.viewport.zoom * 100) + '%'
  if (row.event.evidence) return `${row.event.evidence.width} × ${row.event.evidence.height} crop`
  return null
}

function visibleRowDetail(row: NarratedTraceRow) {
  if (!isActive.value && row.event.evidence && !row.event.changes?.length) return null
  return rowDetail(row)
}

function shortTargetPath(row: NarratedTraceRow) {
  const path = row.event.target?.path ?? []
  const collapsedPath = path.filter((part, index) => part !== path[index - 1])
  const visiblePath = collapsedPath.slice(-2)
  return (collapsedPath.length > visiblePath.length ? '… / ' : '') + visiblePath.join(' / ')
}

function rowMetadata(row: NarratedTraceRow) {
  const details: string[] = []
  const target = row.event.target
  if (target?.route) details.push(target.route)
  if (target?.path.length) {
    const path = shortTargetPath(row)
    if (path !== target.name && !details.includes(path)) details.push(path)
  }
  if (target?.frameId) details.push(`Frame ${target.frameId}`)
  if (row.event.evidence) {
    details.push(`${row.event.evidence.width} × ${row.event.evidence.height} crop`)
  }
  return [...new Set(details)].join(' · ')
}

function timelineTimeLabel(row: NarratedTraceRow, index: number) {
  const current = formatNarratedTraceTime(row.event.atMs)
  const previous = timelineRows.value[index - 1]
  if (!previous) return current
  return formatNarratedTraceTime(previous.event.atMs) === current ? '' : current
}

function evidenceTargetLabel(row: NarratedTraceRow) {
  return row.event.target?.name ?? row.event.evidence?.targetPath?.at(-1) ?? 'Canvas context'
}

function updateText(eventId: string, event: Event) {
  const target = event.currentTarget as HTMLTextAreaElement
  editNarratedTraceEventText(eventId, target.value)
}

function updateNote(eventId: string, event: Event) {
  const target = event.currentTarget as HTMLInputElement
  noteNarratedTraceEvent(eventId, target.value)
}

function isExpanded(eventId: string) {
  return expandedEventIds.value.has(eventId)
}

function toggleExpanded(eventId: string) {
  const next = new Set(expandedEventIds.value)
  if (next.has(eventId)) next.delete(eventId)
  else next.add(eventId)
  expandedEventIds.value = next
}

function handleSetupAction() {
  if (narratedTraceSpeechAvailability.value === 'unavailable') {
    startNarratedTraceActionRecording()
    return
  }
  startNarratedTraceRecording()
}

function togglePause() {
  if (narratedTraceStatus.value === 'recording') pauseNarratedTraceRecording()
  else resumeNarratedTraceRecording()
}

function copyContext() {
  void copy(narratedTraceContextMarkdown.value)
}

function openRecord(sessionId: string) {
  void openNarratedTraceRecord(sessionId)
}

function resumeRecord(sessionId: string) {
  void continueNarratedTraceRecording(sessionId)
}

const saveRecordTitle = useDebounceFn((sessionId: string, title: string) => {
  void renameNarratedTraceTitle(sessionId, title)
}, 300)

function updateRecordTitle(sessionId: string, event: Event) {
  const input = event.currentTarget as HTMLInputElement
  saveRecordTitle(sessionId, input.value)
}

function requestDeleteRecord(sessionId: string) {
  if (pendingDeleteRecordId.value !== sessionId) {
    pendingDeleteRecordId.value = sessionId
    return
  }
  pendingDeleteRecordId.value = null
  void removeNarratedTraceRecord(sessionId)
}

function cancelDeleteRecord(sessionId: string) {
  if (pendingDeleteRecordId.value === sessionId) pendingDeleteRecordId.value = null
}

function evidenceAnnotationPath(row: NarratedTraceRow) {
  const evidence = row.event.evidence
  if (!evidence || !Array.isArray(evidence.annotation?.points)) return ''
  return narratedTracePointsPath(evidence.annotation.points, {
    x: evidence.cropBounds.x,
    y: evidence.cropBounds.y
  })
}

async function copyEvidenceImage(row: NarratedTraceRow) {
  const evidence = row.event.evidence
  if (!evidence || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return
  const dataUrl = evidenceImages.value[evidence.evidenceId]
  if (!dataUrl) return
  const blob = await fetch(dataUrl).then((response) => response.blob())
  await navigator.clipboard.write([new ClipboardItem({ [evidence.mimeType]: blob })])
  copiedEvidenceId.value = evidence.evidenceId
}

onMounted(() => {
  checkNarratedTraceSpeechAvailability()
})
</script>

<template>
  <div data-test-id="narrated-trace-panel" class="flex min-h-0 flex-1 flex-col">
    <div class="flex min-h-14 shrink-0 items-center border-b border-white/[0.055] px-3 py-2.5">
      <NarratedTraceHeader @new-trace="handleSetupAction" />
    </div>

    <div
      v-if="isActive"
      class="mx-2.5 mt-1 flex h-10 shrink-0 items-center gap-1 border-b border-white/[0.055] px-1"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2 text-[9px] text-muted">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="narratedTraceStatus === 'recording' ? 'bg-red-400' : 'bg-amber-300'"
        />
        <span class="truncate font-medium text-surface">
          {{ narratedTraceStatus === 'recording' ? 'Recording canvas' : 'Capture paused' }}
        </span>
      </div>
      <button
        data-test-id="narrated-trace-panel-pause"
        class="flex size-7 items-center justify-center rounded-[7px] text-muted transition-all hover:bg-white/[0.055] hover:text-surface"
        :aria-label="narratedTraceStatus === 'recording' ? 'Pause trace' : 'Resume trace'"
        @click="togglePause"
      >
        <icon-lucide-pause v-if="narratedTraceStatus === 'recording'" class="size-3.5" />
        <icon-lucide-play v-else class="size-3.5" />
      </button>
      <button
        data-test-id="narrated-trace-panel-stop"
        class="rounded-[7px] bg-white/[0.095] px-2 py-1 text-[9px] font-medium text-surface shadow-[0_1px_2px_rgba(0,0,0,0.28),inset_0_1px_0_rgba(255,255,255,0.055)] transition-all hover:bg-white/[0.13]"
        @click="stopNarratedTraceRecording"
      >
        Finish
      </button>
    </div>

    <div
      v-if="traceNotice && narratedTraceViewMode !== 'history'"
      data-test-id="narrated-trace-error"
      class="mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] border border-white/[0.055] bg-black/20 px-2.5 py-2 text-[9.5px] leading-3.5 text-muted"
    >
      <icon-lucide-circle-alert class="size-3 shrink-0" />
      {{ traceNotice }}
    </div>

    <div
      v-if="narratedTraceInterimText && narratedTraceViewMode !== 'history'"
      data-test-id="narrated-trace-interim"
      class="mx-2.5 mt-2 flex items-start gap-2 rounded-[9px] border border-white/[0.055] bg-black/20 px-2.5 py-2 text-[10px] italic leading-4 text-muted"
    >
      <icon-lucide-audio-waveform class="mt-0.5 size-3 shrink-0" />
      {{ narratedTraceInterimText }}
    </div>

    <div
      v-if="narratedTraceViewMode === 'history'"
      data-test-id="narrated-trace-history"
      class="min-h-0 flex-1 overflow-auto"
    >
      <div v-if="narratedTraceHistory.length === 0" class="px-2.5 pt-2.5 pb-4">
        <div class="p-1">
          <div class="flex items-start gap-2.5">
            <icon-lucide-notebook-tabs class="mt-0.5 size-4 shrink-0 text-muted/75" />
            <div class="min-w-0 flex-1 pt-0.5">
              <div class="text-[11.5px] leading-4 font-semibold text-surface">No saved traces</div>
              <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/75">
                Finished traces appear here automatically.
              </div>
            </div>
          </div>
          <button
            type="button"
            class="mt-2.5 flex h-8 w-full items-center justify-start gap-1.5 rounded-[7px] bg-white/[0.075] px-2 text-[10px] font-medium text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:bg-white/[0.11]"
            @click="handleSetupAction"
          >
            <icon-lucide-plus class="size-3 text-violet-200" />
            Start trace
          </button>
        </div>
      </div>

      <article
        v-for="record in narratedTraceHistory"
        v-else
        :key="record.id"
        data-test-id="narrated-trace-history-record"
        class="group relative mx-2.5 flex items-center gap-2 rounded-[7px] px-2 py-2.5 transition-all first:mt-2 hover:bg-white/[0.055]"
      >
        <button
          class="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-white/[0.045] text-muted transition-all group-hover:bg-white/[0.075] group-hover:text-surface"
          aria-label="Open narrated session"
          @click="openRecord(record.id)"
        >
          <icon-lucide-audio-lines class="size-3.5" />
        </button>
        <div class="min-w-0 flex-1">
          <input
            :value="record.title"
            class="w-full truncate border-0 bg-transparent p-0 text-[11px] font-medium text-surface outline-none"
            aria-label="Rename narrated session"
            @input="updateRecordTitle(record.id, $event)"
          />
          <div class="relative mt-0.5 h-3.5">
            <div
              data-test-id="narrated-trace-history-meta"
              class="pointer-events-none absolute inset-0 flex items-center gap-2 text-[9.5px] text-muted/75 transition-opacity"
              :class="
                pendingDeleteRecordId === record.id
                  ? 'opacity-0'
                  : 'group-hover:opacity-0 group-focus-within:opacity-0'
              "
            >
              <span>{{ formatNarratedTraceTime(record.durationMs) }}</span>
              <span
                class="flex items-center gap-0.5"
                :aria-label="`${record.eventCount} ${record.eventCount === 1 ? 'moment' : 'moments'}`"
              >
                <icon-lucide-rows-3 class="size-2.5" aria-hidden="true" />
                {{ record.eventCount }}
              </span>
              <span
                v-if="record.evidenceCount"
                class="flex items-center gap-0.5"
                :aria-label="`${record.evidenceCount} ${record.evidenceCount === 1 ? 'capture' : 'captures'}`"
              >
                <icon-lucide-camera class="size-2.5" aria-hidden="true" />
                {{ record.evidenceCount }}
              </span>
            </div>
            <div
              class="pointer-events-none absolute inset-0 flex items-center gap-2.5 transition-opacity"
              :class="
                pendingDeleteRecordId === record.id
                  ? 'pointer-events-auto opacity-100'
                  : 'opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
              "
            >
              <template v-if="pendingDeleteRecordId === record.id">
                <span class="text-[9.5px] font-medium text-red-300">Delete?</span>
                <button
                  data-test-id="narrated-trace-history-delete-cancel"
                  class="text-[9.5px] font-medium text-surface hover:text-white"
                  aria-label="Cancel delete"
                  @click="cancelDeleteRecord(record.id)"
                >
                  Cancel
                </button>
                <span class="h-3 w-px bg-white/[0.12]" aria-hidden="true" />
                <button
                  data-test-id="narrated-trace-history-delete-confirm"
                  class="text-[9.5px] font-semibold text-red-300 hover:text-red-200"
                  aria-label="Confirm delete session"
                  @click="requestDeleteRecord(record.id)"
                >
                  Confirm
                </button>
              </template>
              <template v-else>
                <button
                  data-test-id="narrated-trace-history-resume"
                  class="flex items-center gap-1 text-[9.5px] font-medium text-surface hover:text-violet-200"
                  aria-label="Resume narrated session"
                  @click="resumeRecord(record.id)"
                >
                  <icon-lucide-play class="size-3" />
                  Resume
                </button>
                <span class="h-3 w-px bg-white/[0.12]" aria-hidden="true" />
                <button
                  class="flex items-center gap-1 text-[9.5px] font-medium text-muted hover:text-red-300"
                  aria-label="Delete session"
                  @click="requestDeleteRecord(record.id)"
                >
                  <icon-lucide-trash-2 class="size-3" />
                  Delete
                </button>
              </template>
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto">
      <div v-if="visibleRows.length === 0" class="px-2.5 pt-2.5 pb-4">
        <div class="p-1">
          <div class="flex items-start gap-2.5">
            <icon-lucide-audio-lines
              class="mt-0.5 size-4 shrink-0"
              :class="isActive ? 'text-red-200' : 'text-muted/75'"
            />
            <div class="min-w-0 flex-1 pt-0.5">
              <div class="text-[11.5px] leading-4 font-semibold text-surface">
                {{ isActive ? 'Listening for intent' : 'Start with a trace' }}
              </div>
              <div class="mt-0.5 text-[9.5px] leading-3.5 text-muted/75">
                {{
                  isActive
                    ? 'Talk, select, and edit. Moments appear as you work.'
                    : 'Capture narration and canvas changes in one timeline.'
                }}
              </div>
            </div>
          </div>

          <template v-if="!isActive">
            <button
              data-test-id="narrated-trace-panel-start"
              class="mt-2.5 flex h-8 w-full items-center justify-start gap-1.5 rounded-[7px] bg-white/[0.075] px-2 text-[10px] font-medium text-surface shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all hover:bg-white/[0.11]"
              @click="handleSetupAction"
            >
              <icon-lucide-mic class="size-3.5 text-violet-200" />
              {{ setupLabel }}
            </button>
            <div class="mt-2.5 flex items-start gap-1.5 text-[9px] leading-3.5 text-muted/65">
              <icon-lucide-shield-check class="mt-px size-3 shrink-0" />
              <span>{{ setupHint }}</span>
            </div>
          </template>
        </div>
      </div>

      <div
        v-if="timelineRows.length > 0"
        data-test-id="narrated-trace-timeline"
        class="px-2.5 pb-1"
        :class="isActive ? '' : 'pt-2'"
      >
        <article
          v-for="(row, rowIndex) in timelineRows"
          :key="row.event.id"
          :data-test-id="'narrated-trace-row-' + row.event.kind"
          :title="rowMetadata(row) || undefined"
          class="group relative grid gap-x-1.5 rounded-[7px] px-1.5 py-2.5 transition-all hover:bg-white/[0.055] focus-within:bg-white/[0.045]"
          :class="
            isActive
              ? 'grid-cols-[2.25rem_1.25rem_minmax(0,1fr)]'
              : 'grid-cols-[2.25rem_minmax(0,1fr)]'
          "
        >
          <time class="pt-0.5 text-[9px] leading-4 tabular-nums text-muted/55">
            {{ timelineTimeLabel(row, rowIndex) }}
          </time>
          <div
            v-if="isActive"
            :data-test-id="'narrated-trace-marker-' + row.event.kind"
            class="flex size-5 items-center justify-center text-[10px] font-semibold"
            :class="markerClass(row)"
            :aria-label="eventKindLabel(row)"
          >
            <icon-lucide-mic v-if="row.event.kind === 'transcript'" class="size-3.5" />
            <icon-lucide-mouse-pointer-2
              v-else-if="row.event.kind === 'selection'"
              class="size-3"
            />
            <icon-lucide-braces v-else-if="row.event.kind === 'edit'" class="size-3.5" />
            <icon-lucide-pencil
              v-else-if="row.event.kind === 'shape' || row.event.kind === 'ink'"
              class="size-3.5"
            />
            <icon-lucide-scan-search v-else-if="row.event.kind === 'screenshot'" class="size-3.5" />
            <icon-lucide-move v-else-if="row.event.kind === 'viewport'" class="size-3.5" />
            <icon-lucide-panels-top-left
              v-else-if="row.event.kind === 'navigation'"
              class="size-3.5"
            />
            <icon-lucide-rotate-ccw v-else-if="row.event.kind === 'undo'" class="size-3.5" />
            <icon-lucide-rotate-cw v-else-if="row.event.kind === 'redo'" class="size-3.5" />
            <icon-lucide-message-square v-else-if="row.event.kind === 'note'" class="size-3.5" />
            <icon-lucide-mouse-pointer-2 v-else class="size-3.5" />
          </div>

          <div class="min-w-0">
            <div class="flex min-w-0 items-start gap-1.5">
              <textarea
                v-if="row.event.kind === 'transcript'"
                :value="rowText(row)"
                class="min-h-8 min-w-0 flex-1 resize-none rounded-md border border-transparent bg-transparent px-0 py-0.5 text-[11px] font-medium leading-4 text-surface outline-none hover:border-border/70 focus:border-accent focus:bg-hover/30"
                aria-label="Edit transcript segment"
                @change="updateText(row.event.id, $event)"
              />
              <div
                v-else
                data-test-id="narrated-trace-row-title"
                class="min-w-0 flex-1 pt-0.5 text-[11px] font-medium leading-4 text-surface"
                :class="isActive ? 'truncate' : 'line-clamp-3 break-words'"
              >
                {{ rowObjectTitle(row) }}
              </div>
              <span
                v-if="rowActionLabel(row)"
                data-test-id="narrated-trace-row-action"
                class="shrink-0 pt-0.5 text-[9px] leading-4 text-muted/65"
              >
                {{ rowActionLabel(row) }}
              </span>
              <button
                v-if="row.event.evidence && !isActive"
                type="button"
                data-test-id="narrated-trace-evidence-toggle"
                class="relative size-11 shrink-0 overflow-hidden rounded-[6px] border border-border/70 bg-black/15 transition-colors hover:border-white/20"
                :aria-label="isExpanded(row.event.id) ? 'Collapse evidence' : 'Expand evidence'"
                @click="toggleExpanded(row.event.id)"
              >
                <img
                  v-if="evidenceImages[row.event.evidence.evidenceId]"
                  data-test-id="narrated-trace-evidence-image"
                  :src="evidenceImages[row.event.evidence.evidenceId]"
                  :alt="`Context snapshot for ${evidenceTargetLabel(row)}`"
                  class="size-full object-cover"
                />
                <span
                  v-else
                  class="flex size-full items-center justify-center text-[8px] text-muted"
                >
                  …
                </span>
                <svg
                  class="pointer-events-none absolute inset-0 size-full"
                  :viewBox="`0 0 ${row.event.evidence.cropBounds.width} ${row.event.evidence.cropBounds.height}`"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  <path
                    :d="evidenceAnnotationPath(row)"
                    fill="none"
                    :stroke="row.event.evidence.annotation.color"
                    :stroke-width="row.event.evidence.annotation.strokeWidth"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div
              v-if="visibleRowDetail(row) || (row.event.changes?.length ?? 0) > 1"
              class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9.5px] leading-3.5"
            >
              <span
                v-if="visibleRowDetail(row)"
                data-test-id="narrated-trace-row-meta"
                class="min-w-0 truncate font-mono text-muted/60"
              >
                {{ visibleRowDetail(row) }}
              </span>
              <button
                v-if="(row.event.changes?.length ?? 0) > 1"
                class="flex shrink-0 items-center gap-0.5 text-muted/65 hover:text-surface"
                @click="toggleExpanded(row.event.id)"
              >
                <icon-lucide-chevron-right
                  class="size-2.5 transition-transform"
                  :class="isExpanded(row.event.id) ? 'rotate-90' : ''"
                />
                {{ row.event.changes?.length }} changes
              </button>
            </div>

            <div
              v-if="row.context.note && !isExpanded(row.event.id)"
              class="mt-1 flex items-start gap-1.5 text-[9px] leading-3.5 text-muted/75"
            >
              <icon-lucide-message-square class="mt-px size-2.5 shrink-0 text-violet-300/80" />
              <span>{{ row.context.note }}</span>
            </div>

            <div
              v-if="row.event.evidence && (isActive || isExpanded(row.event.id))"
              class="relative mt-2 h-44 overflow-hidden rounded-md border border-border/70 bg-black/15"
            >
              <img
                v-if="evidenceImages[row.event.evidence.evidenceId]"
                :data-test-id="isActive ? 'narrated-trace-evidence-image' : undefined"
                :src="evidenceImages[row.event.evidence.evidenceId]"
                :alt="`Context snapshot for ${evidenceTargetLabel(row)}`"
                class="size-full object-contain"
              />
              <div v-else class="flex size-full items-center justify-center text-[9px] text-muted">
                Loading crop…
              </div>
              <svg
                class="pointer-events-none absolute inset-0 size-full"
                :viewBox="`0 0 ${row.event.evidence.cropBounds.width} ${row.event.evidence.cropBounds.height}`"
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
              >
                <path
                  :d="evidenceAnnotationPath(row)"
                  fill="none"
                  :stroke="row.event.evidence.annotation.color"
                  :stroke-width="row.event.evidence.annotation.strokeWidth"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <button
                data-test-id="narrated-trace-copy-evidence"
                type="button"
                class="absolute right-1.5 top-1.5 z-10 flex items-center gap-1 rounded-md border border-border/70 bg-panel/90 px-2 py-1 text-[9px] font-medium text-surface shadow-sm backdrop-blur-sm hover:bg-panel"
                :aria-label="
                  copiedEvidenceId === row.event.evidence.evidenceId
                    ? 'Snapshot copied'
                    : 'Copy snapshot'
                "
                @click="copyEvidenceImage(row)"
              >
                <icon-lucide-check
                  v-if="copiedEvidenceId === row.event.evidence.evidenceId"
                  class="size-3"
                />
                <icon-lucide-copy v-else class="size-3" />
                {{ copiedEvidenceId === row.event.evidence.evidenceId ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <div
              v-if="row.event.evidence?.omissions.length"
              class="mt-1.5 flex items-center gap-1 text-[8px] text-muted"
            >
              <icon-lucide-eye-off class="size-2.5" />
              {{ row.event.evidence.omissions.length }} private
              {{ row.event.evidence.omissions.length === 1 ? 'area' : 'areas' }} omitted
            </div>

            <div v-if="isExpanded(row.event.id)" class="mt-2 rounded-md bg-hover/60 p-2">
              <div
                v-if="rowMetadata(row)"
                class="mb-2 truncate text-[8.5px] leading-3.5 text-muted/65"
              >
                {{ rowMetadata(row) }}
              </div>
              <div v-if="(row.event.changes?.length ?? 0) > 1" class="mb-2 space-y-1">
                <div
                  v-for="change in row.event.changes"
                  :key="change.property"
                  class="break-words font-mono text-[9px] leading-3.5 text-muted"
                >
                  <span class="text-surface">{{ change.property }}</span
                  >: {{ change.before ?? 'unknown' }} → {{ change.after ?? 'removed' }}
                </div>
              </div>
              <input
                :value="row.context.note ?? ''"
                class="w-full rounded border border-border bg-panel px-2 py-1 text-[10px] text-surface outline-none placeholder:text-muted/60 focus:border-accent"
                placeholder="Add a clarification for Codex…"
                aria-label="Add clarification"
                @change="updateNote(row.event.id, $event)"
              />
            </div>

            <div
              class="absolute top-1 right-1 flex items-center gap-0.5 rounded-[6px] bg-[#15161a]/95 p-0.5 text-muted/70 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              <button
                class="flex size-6 items-center justify-center rounded-md hover:bg-hover hover:text-surface"
                :class="row.context.note ? 'text-accent' : ''"
                :aria-label="row.context.note ? 'Edit clarification' : 'Add clarification'"
                @click="toggleExpanded(row.event.id)"
              >
                <icon-lucide-message-square-plus class="size-3" />
              </button>
              <button
                data-test-id="narrated-trace-row-remove"
                class="flex size-6 items-center justify-center rounded-md hover:bg-hover hover:text-red-300"
                aria-label="Remove from copied context"
                @click="removeNarratedTraceEventFromContext(row.event.id)"
              >
                <icon-lucide-x class="size-3" />
              </button>
            </div>
          </div>
        </article>
      </div>

      <section v-if="backgroundRows.length > 0">
        <button
          data-test-id="narrated-trace-background-toggle"
          class="flex h-8 w-full items-center justify-between px-2.5 text-[9.5px] text-muted transition-colors hover:bg-hover"
          @click="showBackground = !showBackground"
        >
          <span>
            {{ isActive ? 'Background activity' : 'Selection and canvas activity' }} ·
            {{ backgroundRows.length }}
          </span>
          <icon-lucide-chevron-down
            class="size-3 transition-transform"
            :class="showBackground ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="showBackground" class="bg-hover/20">
          <div
            v-for="row in backgroundRows"
            :key="row.event.id"
            :data-test-id="'narrated-trace-row-' + row.event.kind"
            class="group flex items-start gap-2 px-2.5 py-2 text-[9.5px]"
          >
            <span class="w-8 shrink-0 tabular-nums text-muted">
              {{ formatNarratedTraceTime(row.event.atMs) }}
            </span>
            <span class="min-w-0 flex-1 text-muted">{{ rowObjectTitle(row) }}</span>
            <button
              data-test-id="narrated-trace-row-remove"
              class="flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-red-300"
              aria-label="Remove from copied context"
              @click="removeNarratedTraceEventFromContext(row.event.id)"
            >
              <icon-lucide-x class="size-3" />
            </button>
          </div>
        </div>
      </section>

      <section v-if="removedRows.length > 0">
        <button
          data-test-id="narrated-trace-removed-toggle"
          class="flex h-8 w-full items-center justify-between px-2.5 text-[9.5px] text-muted transition-colors hover:bg-hover"
          @click="showRemoved = !showRemoved"
        >
          <span>{{ removedRows.length }} removed</span>
          <icon-lucide-chevron-down
            class="size-3 transition-transform"
            :class="showRemoved ? 'rotate-180' : ''"
          />
        </button>
        <div v-if="showRemoved" class="bg-hover/20">
          <div
            v-for="row in removedRows"
            :key="row.event.id"
            class="flex items-center gap-2 px-2.5 py-2 text-[9.5px] text-muted"
          >
            <span class="w-9 tabular-nums">{{ formatNarratedTraceTime(row.event.atMs) }}</span>
            <span class="min-w-0 flex-1 truncate">{{ rowText(row) }}</span>
            <AppTextButton
              data-test-id="narrated-trace-row-restore"
              :ui="{ base: 'rounded px-1.5 py-0.5 text-[10px] hover:bg-hover' }"
              @click="restoreNarratedTraceEventToContext(row.event.id)"
            >
              Restore
            </AppTextButton>
          </div>
        </div>
      </section>
    </div>

    <footer
      v-if="narratedTraceViewMode !== 'history' && narratedTraceIncludedCount > 0"
      class="shrink-0 px-2.5 pt-2 pb-2.5"
    >
      <div>
        <AppTextButton
          data-test-id="narrated-trace-copy-context"
          :ui="{
            base: 'flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] border border-violet-300/20 bg-accent px-3 text-[10.5px] font-semibold text-white shadow-[0_4px_12px_rgba(94,64,176,0.22),inset_0_1px_0_rgba(255,255,255,0.14)] transition-all hover:brightness-105'
          }"
          @click="copyContext"
        >
          <icon-lucide-check v-if="copied" class="size-3.5 text-emerald-300" />
          <icon-lucide-copy v-else class="size-3.5 text-violet-300" />
          {{ copied ? 'Copied' : 'Copy context' }}
          <span v-if="!copied && narratedTraceIncludedCount > 0" class="opacity-70">
            · {{ narratedTraceIncludedCount }}
          </span>
        </AppTextButton>
      </div>
      <div v-if="narratedTraceRemovedCount > 0" class="mt-1.5 text-center text-[9px] text-muted">
        {{ narratedTraceRemovedCount }} removed
        {{ narratedTraceRemovedCount === 1 ? 'moment' : 'moments' }} won’t be copied
      </div>
    </footer>
  </div>
</template>
