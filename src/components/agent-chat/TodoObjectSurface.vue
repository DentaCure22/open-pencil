<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
  uploadAgentAttachments,
  type AgentPromptAttachment
} from '@/app/agent-chat/attachment-transfer'
import { carriesAttachmentDrag, readAttachmentDrag } from '@/app/agent-chat/attachments'
import type { AgentTodoDraft } from '@/app/agent-chat/conversations'
import {
  appendAgentTodoBrief,
  updateAgentTodoDraft,
  type AgentTodoBrief,
  type AgentWorkMapTodo,
  type AgentWorkMapTodoStatus
} from '@/app/agent-chat/work-map'
import {
  syncTodoCodeObjectTitle,
  TODO_CODE_OBJECT_PRESET_ID
} from '@/app/agent-chat/todo-code-object'
import { installTodoDocumentEditor } from '@/app/agent-chat/todo-document-editor'
import { resolveBrowserCaptureAttachments } from '@/app/browser-inspector/attachment'
import { toast } from '@/app/shell/ui'

const { draft, threadId, todo } = defineProps<{
  draft: AgentTodoDraft | null
  threadId: string
  todo: AgentWorkMapTodo | null
}>()

const emit = defineEmits<{
  'open-related-chat': []
  saved: []
}>()

const statusLabels: Record<AgentWorkMapTodoStatus, string> = {
  in_motion: 'In motion',
  todo: 'Todo'
}

const documentFrame = ref<HTMLIFrameElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const documentSrcdoc = ref('')
const dirty = ref(false)
const dropping = ref(false)
const saving = ref(false)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let writePromise: Promise<boolean> | null = null
let lastPersistedHtml = ''
let removeDocumentListeners: (() => void) | undefined

const status = computed<AgentWorkMapTodoStatus>(() => todo?.status ?? 'todo')
const statusLabel = computed(() => statusLabels[status.value])
const canonicalTitle = computed(
  () => draft?.brief.title?.trim() || todo?.title.trim() || draft?.brief.goal.trim() || 'Todo'
)

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function legacyDocument(brief: AgentTodoBrief, title: string): string {
  return `<!doctype html>
<html lang="en" data-openpencil-code-object="${TODO_CODE_OBJECT_PRESET_ID}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; container-type: inline-size; }
    * { box-sizing: border-box; }
    html, body { width: 100%; min-width: 0; min-height: 100%; overflow-x: hidden; }
    body { margin: 0; padding: clamp(16px, 5cqw, 28px) clamp(14px, 5cqw, 24px) 80px; background: transparent; color: #202127; font-size: clamp(13px, 3.6cqw, 14px); line-height: 1.62; }
    main { width: 100%; max-width: 720px; min-width: 0; margin: 0 auto; }
    h1 { margin: 0 0 clamp(18px, 5cqw, 24px); overflow-wrap: anywhere; font-size: clamp(24px, 8cqw, 38px); line-height: 1.08; letter-spacing: -.035em; }
    h2 { margin: 0 0 8px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #727782; }
    section { padding: 18px 0; border-top: 1px solid #7f7f7f38; }
    p { margin: 0 0 10px; }
    img, picture, video, canvas, svg, iframe { display: block; max-width: 100%; height: auto; }
    pre, table { display: block; max-width: 100%; overflow-x: auto; }
    @media (prefers-color-scheme: dark) { body { color: #f2f3f5; } h2 { color: #979ca8; } }
  </style>
</head>
<body>
  <main data-todo-document>
    <h1 data-todo-title>${escapeHtml(title)}</h1>
    ${brief.context ? `<section><h2>Notes</h2><p>${escapeHtml(brief.context).replaceAll('\n', '<br>')}</p></section>` : '<p>Start shaping this Todo here.</p>'}
  </main>
</body>
</html>`
}

const sourceDocument = computed(() => {
  const brief = draft?.brief
  if (!brief) return ''
  const source = brief.documentHtml || legacyDocument(brief, canonicalTitle.value)
  return syncTodoCodeObjectTitle(source, canonicalTitle.value)
})

watch(
  () => [threadId, sourceDocument.value] as const,
  ([threadId, html], previous) => {
    const changedThread = threadId !== previous?.[0]
    if (!changedThread && (dirty.value || html === lastPersistedHtml)) return
    lastPersistedHtml = html
    documentSrcdoc.value = html
  },
  { immediate: true }
)

function frameDocument(): Document | null {
  return documentFrame.value?.contentDocument ?? null
}

function serializedDocument(): string {
  const document = frameDocument()
  if (!document?.documentElement) return documentSrcdoc.value
  const clone = document.documentElement.cloneNode(true) as HTMLElement
  clone.querySelector('[data-openpencil-todo-editor-style]')?.remove()
  const body = clone.querySelector('body')
  body?.removeAttribute('contenteditable')
  body?.removeAttribute('spellcheck')
  return `<!doctype html>\n${clone.outerHTML}`
}

function documentTitle(): string {
  const heading = frameDocument()?.querySelector<HTMLElement>('[data-todo-title], h1')
  return (heading?.textContent?.trim() || canonicalTitle.value).slice(0, 240)
}

async function writeBrief(
  brief: AgentTodoBrief,
  attachments: AgentPromptAttachment[] = []
): Promise<boolean> {
  if (!threadId) return false
  const pendingWrite = writePromise
  if (pendingWrite) await pendingWrite
  saving.value = true
  const write = updateAgentTodoDraft({ attachments, brief, threadId })
    .then(() => {
      lastPersistedHtml = brief.documentHtml ?? lastPersistedHtml
      emit('saved')
      return true
    })
    .catch((cause: unknown) => {
      toast.error(cause instanceof Error ? cause.message : 'Todo update failed')
      return false
    })
  writePromise = write
  const result = await write
  if (writePromise === write) writePromise = null
  saving.value = false
  return result
}

async function persistDocument() {
  const brief = draft?.brief
  if (!brief) return
  const html = serializedDocument()
  if (!dirty.value && html === lastPersistedHtml) return
  const saved = await writeBrief({ ...brief, documentHtml: html, title: documentTitle() })
  if (!saved) return
  dirty.value = serializedDocument() !== html
  if (dirty.value) scheduleDocumentSave()
}

function scheduleDocumentSave() {
  dirty.value = true
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void persistDocument(), 650)
}

function installDocumentEditor() {
  const document = frameDocument()
  if (!document) return
  removeDocumentListeners?.()
  removeDocumentListeners = installTodoDocumentEditor(document, {
    acceptsDrop: carriesTodoContent,
    onDrop: (dataTransfer) => void appendDataTransfer(dataTransfer),
    onDropActive: (active) => {
      dropping.value = active
    },
    onInput: scheduleDocumentSave,
    onLeave: () => {
      if (dirty.value) void persistDocument()
    }
  })
}

function carriesTodoContent(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  if ([...dataTransfer.types].includes('application/x-openpencil-work-map-todo')) return false
  return carriesAttachmentDrag(dataTransfer) || [...dataTransfer.types].includes('text/plain')
}

function dragEnter(event: DragEvent) {
  if (!carriesTodoContent(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  dropping.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function dragLeave(event: DragEvent) {
  const current = event.currentTarget
  const related = event.relatedTarget
  if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
  dropping.value = false
}

async function appendContent(files: File[], text = '') {
  const brief = draft?.brief
  if (!brief || (!files.length && !text.trim())) return
  if (saveTimer) clearTimeout(saveTimer)
  await persistDocument()
  try {
    const resolved = await resolveBrowserCaptureAttachments(files)
    const attachments = await uploadAgentAttachments(resolved.attachments)
    const addedText = [text.trim(), resolved.contextPrompt?.trim()].filter(Boolean).join('\n\n')
    const current: AgentTodoBrief = {
      ...brief,
      documentHtml: serializedDocument(),
      title: documentTitle()
    }
    const next = appendAgentTodoBrief(current, { attachments, text: addedText })
    if (!(await writeBrief(next, attachments))) return
    dirty.value = false
    documentSrcdoc.value = next.documentHtml ?? documentSrcdoc.value
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : 'Reference could not be added')
  }
}

async function appendDataTransfer(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return
  await appendContent(readAttachmentDrag(dataTransfer), dataTransfer.getData('text/plain').trim())
}

function dropContent(event: DragEvent) {
  if (!carriesTodoContent(event.dataTransfer)) return
  event.preventDefault()
  event.stopPropagation()
  dropping.value = false
  void appendDataTransfer(event.dataTransfer)
}

function chooseReferences() {
  fileInput.value?.click()
}

function addSelectedReferences(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (files.length) void appendContent(files)
}

onBeforeUnmount(() => {
  removeDocumentListeners?.()
  if (saveTimer) clearTimeout(saveTimer)
  if (dirty.value) void persistDocument()
})
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-surface"
    data-test-id="workspace-object-surface"
    @dragenter="dragEnter"
    @dragover="dragEnter"
    @dragleave="dragLeave"
    @drop="dropContent"
  >
    <template v-if="draft">
      <header class="flex h-11 shrink-0 items-center gap-2 border-b border-chrome-border/70 px-3.5">
        <div
          class="flex min-w-0 flex-1 items-center gap-2 text-[10px] font-medium tracking-[0.09em] text-muted uppercase"
        >
          <icon-lucide-clock-3 class="size-3.5 shrink-0 stroke-[1.6]" />
          {{ statusLabel }}
          <span v-if="saving" class="normal-case tracking-normal text-muted/70">Saving…</span>
        </div>
        <button
          type="button"
          data-test-id="todo-object-add-reference"
          :disabled="saving"
          aria-label="Add reference"
          title="Add reference"
          class="flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2 text-[10.5px] text-muted transition-colors outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-45"
          @click="chooseReferences"
        >
          <icon-lucide-paperclip class="size-3.5 stroke-[1.7]" />
          Reference
        </button>
        <button
          type="button"
          data-test-id="todo-object-related-chat"
          aria-label="Open related chat"
          title="Related chat"
          class="flex size-7 shrink-0 items-center justify-center rounded-[7px] text-accent transition-colors outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/25"
          @click="emit('open-related-chat')"
        >
          <icon-lucide-message-circle class="size-3.5 stroke-[1.7]" />
        </button>
        <input
          ref="fileInput"
          data-test-id="todo-object-reference-input"
          class="hidden"
          multiple
          type="file"
          @change="addSelectedReferences"
        />
      </header>

      <div class="min-h-0 flex-1">
        <iframe
          ref="documentFrame"
          data-test-id="todo-object-document"
          title="Editable Todo Code Object"
          class="h-full w-full min-w-0 border-0 bg-transparent"
          referrerpolicy="no-referrer"
          sandbox="allow-same-origin"
          :srcdoc="documentSrcdoc"
          @load="installDocumentEditor"
        />
      </div>

      <div
        v-if="dropping"
        class="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[10px] border border-accent/60 bg-agent-surface/90 text-[12px] font-medium text-accent"
      >
        Add to this Todo
      </div>
    </template>

    <div v-else class="flex min-h-0 flex-1 items-center justify-center px-6 text-center">
      <div>
        <icon-lucide-panel-right class="mx-auto size-5 text-muted/70" />
        <p class="mt-3 text-[12px] font-medium text-surface">No Todo selected</p>
        <p class="mt-1 text-[11px] leading-4.5 text-muted">
          Open a Todo from the Work Map or its related chat.
        </p>
      </div>
    </div>
  </section>
</template>
