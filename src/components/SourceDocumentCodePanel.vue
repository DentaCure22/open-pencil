<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import {
  createCodeObject,
  createUserCodeObjectDocument
} from '@/app/code-object/model'
import { useEditorStore } from '@/app/editor/active-store'
import {
  selectedSourceDocument,
  updateSourceDocument
} from '@/app/source-document/workspace'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const store = useEditorStore()
const { copy, copied } = useClipboard({ copiedDuring: 2000 })
const draft = ref('')
const saved = ref('')
const message = ref('')
const messageRevision = ref<number | null>(null)

const document = computed(() => {
  void store.state.sceneVersion
  return selectedSourceDocument(store)
})
const signature = computed(() => {
  const current = document.value
  return current ? `${current.node.id}:${current.source.revision}` : ''
})
const documentId = computed(() => document.value?.node.id ?? '')
const dirty = computed(() => draft.value !== saved.value)
const lineCount = computed(() => draft.value.split('\n').length)
const canMigrateToCodeObject = computed(() => {
  const format = document.value?.source.format
  return (format === 'jsx' || format === 'tsx') && !dirty.value
})

watch(
  signature,
  () => {
    const current = document.value
    if (!current) return
    draft.value = current.source.source
    saved.value = current.source.source
    if (messageRevision.value !== current.source.revision) {
      message.value = ''
      messageRevision.value = null
    }
  },
  { immediate: true }
)

watch(documentId, () => {
  message.value = ''
  messageRevision.value = null
})

function saveSource() {
  const current = document.value
  if (!current || !dirty.value) return
  if (!updateSourceDocument(store, current.node.id, draft.value)) return
  saved.value = draft.value
  message.value = 'Source saved on this document'
  messageRevision.value = current.source.revision + 1
}

function resetSource() {
  draft.value = saved.value
  message.value = ''
  messageRevision.value = null
}

function copySource() {
  copy(draft.value)
}

function createMigratedCodeObject() {
  const current = document.value
  if (!current || !canMigrateToCodeObject.value) return
  const name = current.node.name.replace(/\.(jsx|tsx)$/i, '') || 'Code Object'
  const created = createCodeObject(store, {
    cornerRadius: 12,
    document: createUserCodeObjectDocument({
      definitionId: `legacy.${current.node.id}`,
      name,
      props: {},
      source: current.source.source,
      state: {}
    }),
    height: 520,
    name,
    width: 720,
    x: current.node.x + current.node.width + 120,
    y: current.node.y
  })
  store.select([created.id])
}
</script>

<template>
  <div
    v-if="document"
    data-test-id="source-document-code-panel"
    class="flex min-h-0 flex-1 flex-col"
  >
    <div class="shrink-0 border-b border-white/[0.055] px-3 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[12px] font-semibold text-surface">Legacy source record</span>
            <span
              data-test-id="source-document-format"
              class="rounded bg-violet-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-200 uppercase"
            >
              {{ document.source.format }}
            </span>
          </div>
          <div class="mt-0.5 truncate text-[9.5px] text-muted/70">
            {{ document.source.fileName || document.node.name }} · r{{ document.source.revision }}
          </div>
        </div>
        <AppTextButton
          data-test-id="source-document-copy"
          :ui="{
            base: 'flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] bg-white/[0.055] px-2 text-[10px] font-medium text-muted hover:bg-white/[0.085] hover:text-surface'
          }"
          @click="copySource"
        >
          <icon-lucide-check v-if="copied" class="size-3 text-[var(--color-success)]" />
          <icon-lucide-copy v-else class="size-3" />
          {{ copied ? 'Copied' : 'Copy' }}
        </AppTextButton>
      </div>
      <p class="mt-2 text-[9.5px] leading-4 text-muted/70">
        Preserved for existing boards. New JSX/TSX files open directly as Code Objects.
      </p>
    </div>

    <div class="flex min-h-0 flex-1 flex-col p-2.5">
      <textarea
        v-model="draft"
        data-test-id="source-document-editor"
        :aria-label="`${document.source.format.toUpperCase()} source`"
        class="min-h-0 flex-1 resize-none rounded-[9px] border border-white/[0.07] bg-black/15 px-3 py-3 font-mono text-[11px] leading-5 text-surface outline-none focus:border-violet-300/55"
        spellcheck="false"
      />
      <div class="mt-2 flex items-center justify-between gap-2 text-[9.5px] text-muted/65">
        <span>{{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }}</span>
        <span v-if="dirty" data-test-id="source-document-dirty" class="text-amber-300"
          >Unsaved source</span
        >
        <span v-else>Stored · r{{ document.source.revision }}</span>
      </div>
    </div>

    <div class="shrink-0 border-t border-white/[0.055] px-3 py-3">
      <div class="flex items-center gap-1.5">
        <AppTextButton
          data-test-id="source-document-save"
          :ui="{
            base: [
              'flex h-8 flex-1 items-center justify-center rounded-[7px] px-2 text-[10px] font-semibold',
              dirty
                ? 'bg-violet-300 text-[#17171a] hover:bg-violet-200'
                : 'cursor-not-allowed bg-white/[0.04] text-muted/45'
            ].join(' ')
          }"
          @click="saveSource"
        >
          Save source
        </AppTextButton>
        <AppTextButton
          data-test-id="source-document-reset"
          :ui="{
            base: dirty
              ? 'h-8 rounded-[7px] px-2 text-[10px] text-muted hover:bg-hover hover:text-surface'
              : 'h-8 cursor-not-allowed rounded-[7px] px-2 text-[10px] text-muted/35'
          }"
          @click="resetSource"
        >
          Reset
        </AppTextButton>
      </div>

      <AppTextButton
        v-if="document.source.format === 'jsx' || document.source.format === 'tsx'"
        data-test-id="source-document-migrate-code-object"
        :ui="{
          base: [
            'mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-[7px] px-2 text-[10px] font-medium',
            canMigrateToCodeObject
              ? 'bg-white/[0.055] text-surface hover:bg-white/[0.085]'
              : 'cursor-not-allowed bg-white/[0.025] text-muted/40'
          ].join(' ')
        }"
        @click="createMigratedCodeObject"
      >
        <icon-lucide-box class="size-3" />
        Create Code Object
      </AppTextButton>
      <p
        v-else
        data-test-id="source-document-runtime-boundary"
        class="mt-2 rounded-[7px] bg-white/[0.035] px-2 py-2 text-[9.5px] leading-4 text-muted/70"
      >
        HTML stays attached source only. OpenPencil no longer creates HTML Board runtimes.
      </p>
      <p
        v-if="message"
        data-test-id="source-document-message"
        class="mt-2 text-[9.5px] text-emerald-300"
      >
        {{ message }}
      </p>
    </div>
  </div>
</template>
