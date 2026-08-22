<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  codeObjectDocument,
  codeObjectPluginData,
  materializeCodeObjectDocument,
  setCodeObjectBoardShapeAccess,
  type CodeObjectDocument,
  type CodeObjectState
} from '@/app/code-object/model'
import { compileCodeObjectSource } from '@/app/code-object/compiler'
import { useEditorStore } from '@/app/editor/active-store'
import AppTextButton from '@/components/ui/AppTextButton.vue'

const store = useEditorStore()
const source = ref('')
const propsJson = ref('{}')
const stateJson = ref('{}')
const name = ref('')
const error = ref('')

const selectedNodeId = computed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  return ids.length === 1 ? ids[0] : null
})

const selectedDocument = computed(() => {
  void store.state.sceneVersion
  const nodeId = selectedNodeId.value
  return nodeId ? codeObjectDocument(store.graph.getNode(nodeId)) : null
})

const boardShapeAccessEnabled = computed(
  () => selectedDocument.value?.boardPermissions.includes('shape.create') ?? false
)

watch(
  [selectedNodeId, selectedDocument],
  ([nodeId, document]) => {
    if (!nodeId || !document) return
    materializeCodeObjectDocument(store, nodeId)
    source.value = document.source
    propsJson.value = JSON.stringify(document.props, null, 2)
    stateJson.value = JSON.stringify(document.state, null, 2)
    name.value = document.name
    error.value = ''
  },
  { immediate: true }
)

function isCodeObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseRecord(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!isCodeObjectRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed
}

function applyCodeObject() {
  const current = selectedDocument.value
  const nodeId = selectedNodeId.value
  const node = nodeId ? store.graph.getNode(nodeId) : undefined
  if (!current || !node) return
  const compiled = compileCodeObjectSource(source.value)
  if (compiled.error) {
    error.value = compiled.error
    return
  }
  try {
    const next = {
      ...current,
      name: name.value.trim() || current.name,
      props: parseRecord(propsJson.value, 'Properties'),
      source: source.value,
      state: parseRecord(stateJson.value, 'State') as CodeObjectState
    } as CodeObjectDocument
    store.updateNodeWithUndo(
      node.id,
      {
        name: next.name,
        pluginData: codeObjectPluginData(node, next)
      },
      'Update Code Object source'
    )
    error.value = ''
  } catch (nextError) {
    error.value = nextError instanceof Error ? nextError.message : String(nextError)
  }
}

function toggleBoardShapeAccess() {
  const actorFrameId = selectedNodeId.value
  if (!actorFrameId) return
  setCodeObjectBoardShapeAccess(store, actorFrameId, !boardShapeAccessEnabled.value)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test-id="code-object-code-panel">
    <div
      class="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.055] px-3 py-2.5"
    >
      <div class="min-w-0">
        <div class="text-[12px] leading-4 font-semibold text-surface">Code Object</div>
        <div class="truncate text-[9.5px] leading-3.5 text-muted/70">
          Trusted TypeScript/TSX · ReactDOM
        </div>
      </div>
      <AppTextButton
        data-test-id="code-object-apply"
        :ui="{
          base: 'h-7 rounded-[7px] bg-violet-300 px-2 text-[10px] font-semibold text-[#17171a] hover:bg-violet-200'
        }"
        @click="applyCodeObject"
      >
        Apply
      </AppTextButton>
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      <label class="block text-[10px] font-medium text-muted">
        Name
        <input
          v-model="name"
          data-test-id="code-object-name"
          class="mt-1 h-8 w-full rounded border border-border bg-panel px-2 text-[11px] text-surface outline-none focus:border-accent"
        />
      </label>
      <label class="block text-[10px] font-medium text-muted">
        TypeScript/TSX
        <textarea
          v-model="source"
          data-test-id="code-object-source"
          class="mt-1 h-72 w-full resize-y rounded border border-border bg-panel px-2 py-1.5 font-mono text-[10px] leading-4 text-surface outline-none focus:border-accent"
          spellcheck="false"
        />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="block text-[10px] font-medium text-muted">
          Properties
          <textarea
            v-model="propsJson"
            data-test-id="code-object-props"
            class="mt-1 h-28 w-full resize-y rounded border border-border bg-panel px-2 py-1.5 font-mono text-[10px] leading-4 text-surface outline-none focus:border-accent"
            spellcheck="false"
          />
        </label>
        <label class="block text-[10px] font-medium text-muted">
          State
          <textarea
            v-model="stateJson"
            data-test-id="code-object-state"
            class="mt-1 h-28 w-full resize-y rounded border border-border bg-panel px-2 py-1.5 font-mono text-[10px] leading-4 text-surface outline-none focus:border-accent"
            spellcheck="false"
          />
        </label>
      </div>
      <section
        class="rounded border border-border bg-input/20 p-2"
        data-test-id="code-object-board-access"
      >
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-[10px] font-medium text-surface">Board access</div>
            <div class="text-[9px] leading-3.5 text-muted/70">
              Create and control only the native shapes owned by this object.
            </div>
          </div>
          <AppTextButton
            data-test-id="code-object-board-access-toggle"
            size="xs"
            @click="toggleBoardShapeAccess"
          >
            {{ boardShapeAccessEnabled ? 'Revoke' : 'Allow' }}
          </AppTextButton>
        </div>
      </section>
      <div
        v-if="error"
        class="rounded border border-red-500/35 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200"
        data-test-id="code-object-error"
      >
        {{ error }}
      </div>
      <p class="text-[9.5px] leading-4 text-muted/70">
        Default-export one React component. Nested components live inside this object; use
        <code>setState</code> for its own persistent state and <code>dispatchBoardAction</code> for
        approved Board shape operations.
      </p>
    </div>
  </div>
</template>
