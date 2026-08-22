<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { templateRef } from '@vueuse/core'
import 'vue-stream-markdown/index.css'

import { codeObjectCanvasStyle } from '@/app/code-object/transform'
import { useEditorStore } from '@/app/editor/active-store'
import { focusCanvasSurface } from '@/app/editor/canvas/surface/focus'
import { canvasSurfaceCanReceivePointer } from '@/app/editor/canvas/surface/interaction'
import { useEditorNodeOverlayStyle } from '@/app/editor/presentation'
import {
  markdownDocument,
  updateMarkdownDocumentSource,
  type MarkdownDocument
} from '@/app/markdown-document'

const MarkdownRenderer = defineAsyncComponent(async () => {
  const { Markdown } = await import('vue-stream-markdown')
  return Markdown
})

const store = useEditorStore()
const canvasStyle = useEditorNodeOverlayStyle(store, (node) => codeObjectCanvasStyle(store, node))
const editingId = ref<string | null>(null)
const draft = ref('')
const editorRef = templateRef('editorRef')

const documents = computed<MarkdownDocument[]>(() => {
  void store.state.sceneVersion
  void store.state.currentPageId
  return Array.from(store.graph.getDescendants(store.state.currentPageId)).flatMap((node) => {
    const document = markdownDocument(node)
    return document && node.visible ? [document] : []
  })
})

watch(
  () => [...store.state.selectedIds],
  (selectedIds) => {
    if (editingId.value && !selectedIds.includes(editingId.value)) cancelEditing()
  }
)

function isSelected(nodeId: string) {
  return store.state.selectedIds.has(nodeId)
}

function isReading(nodeId: string) {
  return store.state.enteredContainerId === nodeId
}

function isEditing(nodeId: string) {
  return editingId.value === nodeId
}

function surfaceAcceptsPointer(): boolean {
  return canvasSurfaceCanReceivePointer(store.state.activeTool)
}

function focusDocument(nodeId: string) {
  focusCanvasSurface(store, nodeId)
}

async function beginEditing(document: MarkdownDocument) {
  store.select([document.node.id])
  draft.value = document.metadata.source
  editingId.value = document.node.id
  await nextTick()
  const editor = editorRef.value?.[0]
  if (editor instanceof HTMLTextAreaElement) editor.focus()
}

function cancelEditing() {
  editingId.value = null
  draft.value = ''
}

function saveEditing(document: MarkdownDocument) {
  updateMarkdownDocumentSource(store, document.node.id, draft.value)
  cancelEditing()
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[4] overflow-hidden">
    <article
      v-for="document in documents"
      :key="document.node.id"
      :data-markdown-document-id="document.node.id"
      :data-markdown-document-mode="isReading(document.node.id) ? 'read' : 'design'"
      :style="canvasStyle(document.node)"
      class="absolute top-0 left-0 flex flex-col overflow-hidden bg-white text-[#242521] shadow-sm"
      data-test-id="markdown-document"
    >
      <header class="flex h-11 shrink-0 items-center gap-2 border-b border-[#d9d6ce] bg-white px-4">
        <span class="min-w-0 flex-1 truncate text-xs font-semibold">{{ document.node.name }}</span>
        <span class="text-[10px] tracking-wide text-[#6d6b64] uppercase">
          {{ document.sourceMode === 'plain-text' ? 'Text' : document.sourceMode }}
        </span>
        <template v-if="isEditing(document.node.id)">
          <button
            type="button"
            :class="surfaceAcceptsPointer() ? 'pointer-events-auto' : 'pointer-events-none'"
            class="rounded px-2 py-1 text-[11px] text-[#6d6b64] hover:bg-black/5"
            @pointerdown.stop
            @click.stop="cancelEditing"
          >
            Cancel
          </button>
          <button
            type="button"
            :class="surfaceAcceptsPointer() ? 'pointer-events-auto' : 'pointer-events-none'"
            class="rounded bg-[#6954c5] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#5945b5]"
            @pointerdown.stop
            @click.stop="saveEditing(document)"
          >
            Save
          </button>
        </template>
        <button
          v-else-if="isSelected(document.node.id)"
          type="button"
          :class="surfaceAcceptsPointer() ? 'pointer-events-auto' : 'pointer-events-none'"
          class="rounded bg-white px-2 py-1 text-[11px] font-medium shadow-sm ring-1 ring-black/10 hover:bg-[#f8f7f2]"
          data-test-id="markdown-document-edit"
          @pointerdown.stop
          @click.stop="beginEditing(document)"
        >
          Edit
        </button>
      </header>

      <textarea
        v-if="isEditing(document.node.id)"
        ref="editorRef"
        v-model="draft"
        :aria-label="`Edit ${document.node.name}`"
        :class="surfaceAcceptsPointer() ? 'pointer-events-auto' : 'pointer-events-none'"
        class="min-h-0 flex-1 resize-none bg-white p-8 font-mono text-[15px] leading-6 outline-none"
        data-test-id="markdown-document-source-editor"
        spellcheck="true"
        @keydown.stop
        @keydown.escape.stop.prevent="cancelEditing"
        @wheel.stop
      />
      <pre
        v-else-if="document.sourceMode === 'plain-text'"
        :class="
          isReading(document.node.id) && surfaceAcceptsPointer()
            ? 'pointer-events-auto overflow-y-auto'
            : 'pointer-events-none overflow-hidden'
        "
        :tabindex="isReading(document.node.id) ? 0 : -1"
        :aria-label="`${document.node.name} reading surface`"
        class="min-h-0 flex-1 p-10 font-mono text-[15px] leading-6 whitespace-pre-wrap"
        data-test-id="markdown-document-preview"
        @dblclick.stop.prevent="focusDocument(document.node.id)"
        @wheel.stop
        >{{ document.metadata.source }}</pre
      >
      <MarkdownRenderer
        v-else
        :content="document.metadata.source"
        :mermaid="false"
        :class="
          isReading(document.node.id) && surfaceAcceptsPointer()
            ? 'pointer-events-auto overflow-y-auto'
            : 'pointer-events-none overflow-hidden'
        "
        :tabindex="isReading(document.node.id) ? 0 : -1"
        :aria-label="`${document.node.name} reading surface`"
        class="markdown-document-preview min-h-0 flex-1 px-12 py-10"
        data-test-id="markdown-document-preview"
        @dblclick.stop.prevent="focusDocument(document.node.id)"
        @wheel.stop
      />

      <div
        v-if="isSelected(document.node.id)"
        class="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-[#6954c5] ring-inset"
      />
      <template v-if="isSelected(document.node.id) && !isEditing(document.node.id)">
        <span class="absolute top-0 left-0 size-2 -translate-1/2 bg-white ring-2 ring-[#6954c5]" />
        <span
          class="absolute top-0 right-0 size-2 translate-x-1/2 -translate-y-1/2 bg-white ring-2 ring-[#6954c5]"
        />
        <span
          class="absolute bottom-0 right-0 size-2 translate-1/2 bg-white ring-2 ring-[#6954c5]"
        />
        <span
          class="absolute bottom-0 left-0 size-2 -translate-x-1/2 translate-y-1/2 bg-white ring-2 ring-[#6954c5]"
        />
      </template>
    </article>
  </div>
</template>

<style scoped>
.markdown-document-preview {
  --background: #ffffff;
  --border: #d9d6ce;
  --foreground: #242521;
  --muted: #f3f1ea;
  --muted-foreground: #6d6b64;
  --primary: #6954c5;
  --primary-foreground: #ffffff;
  color: #242521;
}

.markdown-document-preview :deep(*) {
  pointer-events: none !important;
}
</style>
