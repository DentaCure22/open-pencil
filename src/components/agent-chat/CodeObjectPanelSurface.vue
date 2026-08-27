<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch
} from 'vue'

import { readContentSource } from '@open-pencil/core/io'
import { assetHashFromReference } from '@open-pencil/scene-graph/images'

import { useEditorStore } from '@/app/editor/active-store'
import {
  createCodeObjectBoardClient,
  dispatchCodeObjectBoardAction,
  updateCodeObjectState,
  type AgentConversationTerminalDocument,
  type CodeObjectDocument,
  type CodeObjectState
} from '@/app/code-object/model'
import { cachedCodeObjectDocument } from '@/app/code-object/overlays'
import { loadCodeObjectRuntime, loadedCodeObjectRuntime } from '@/app/code-object/runtime'
import { placeExtractedPdfPage } from '@/app/media-evidence/extraction'
import type { PdfPageImage } from '@/app/media-evidence/pdf'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { useAppTheme } from '@/app/shell/theme'
import SmylrTrustedWebApp from '@/components/code-object/SmylrTrustedWebApp.vue'

const AgentConversationBoardSurface = defineAsyncComponent(
  () => import('@/components/agent-terminal/AgentConversationBoardSurface.vue')
)

const { objectId } = defineProps<{ objectId: string }>()

const store = useEditorStore()
const { resolvedTheme } = useAppTheme()
const host = useTemplateRef<HTMLDivElement>('host')
const error = ref('')
const activeDocument = shallowRef<CodeObjectDocument | null>(null)
const objectName = ref('')
let renderEpoch = 0
let runtimeId: string | null = null
let unsubscribe: Array<() => void> = []

const agentDocument = computed(() => {
  const document = activeDocument.value
  return document?.component === 'agent-conversation-terminal' ? document : null
})
const smylrDocument = computed(() => {
  const document = activeDocument.value
  return document?.component === 'smylr-production-app' ? document : null
})

function agentWorkerConversationId(document: AgentConversationTerminalDocument) {
  return document.workerConversationId
}

function disposeRuntime() {
  if (runtimeId) loadedCodeObjectRuntime()?.disposeCodeObject(runtimeId)
  runtimeId = null
}

function extractPdfPage(pageNumber: number, image: PdfPageImage) {
  const node = store.graph.getNode(objectId)
  const source = node ? mediaEvidenceSource(node) : null
  if (!node || source?.kind !== 'pdf') return
  placeExtractedPdfPage(store, node, source, pageNumber, image)
}

async function renderCodeObject() {
  const epoch = ++renderEpoch
  await nextTick()
  const element = host.value
  const node = store.graph.getNode(objectId)
  const document = node ? cachedCodeObjectDocument(node) : null
  if (!element || !node || !document) {
    activeDocument.value = null
    objectName.value = ''
    error.value = 'This Code Object is not available in the current workspace.'
    disposeRuntime()
    return
  }

  activeDocument.value = document
  objectName.value = node.name
  if (
    document.component === 'agent-conversation-terminal' ||
    document.component === 'smylr-production-app'
  ) {
    error.value = ''
    disposeRuntime()
    return
  }

  const nextRuntimeId = `object-panel:${objectId}`
  const runtime = await loadCodeObjectRuntime()
  if (epoch !== renderEpoch) return
  if (runtimeId && runtimeId !== nextRuntimeId) runtime.disposeCodeObject(runtimeId)
  runtimeId = nextRuntimeId
  error.value = ''
  const contentSource = readContentSource(node)
  const assetHash = contentSource ? assetHashFromReference(contentSource.source) : null

  const dispatchBoardAction = async (action: Parameters<typeof dispatchCodeObjectBoardAction>[2]) =>
    dispatchCodeObjectBoardAction(store, objectId, action, {
      interactionEnabled: true
    })

  runtime.attachCodeObject(nextRuntimeId, element)
  runtime.renderCodeObject(
    nextRuntimeId,
    document,
    (state: CodeObjectState) => updateCodeObjectState(store, objectId, state),
    {
      board: createCodeObjectBoardClient(store, objectId, dispatchBoardAction),
      bytes: assetHash ? store.graph.images.get(assetHash) : undefined,
      dispatchBoardAction,
      fileName: contentSource?.fileName ?? undefined,
      interactionEnabled: true,
      onExtractPdfPage: extractPdfPage,
      theme: resolvedTheme.value
    }
  )
}

watch([() => objectId, resolvedTheme], () => void renderCodeObject(), { flush: 'post' })

onMounted(() => {
  unsubscribe = [
    store.onEditorEvent('graph:replaced', () => void renderCodeObject()),
    store.onEditorEvent('node:deleted', (id) => {
      if (id === objectId) void renderCodeObject()
    }),
    store.onEditorEvent('node:updated', (id, changes) => {
      if (id === objectId && 'pluginData' in changes) void renderCodeObject()
    })
  ]
  void renderCodeObject()
})

onUnmounted(() => {
  renderEpoch += 1
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  disposeRuntime()
})
</script>

<template>
  <section
    class="relative flex min-h-0 flex-1 overflow-hidden bg-agent-surface"
    data-test-id="code-object-panel-surface"
  >
    <AgentConversationBoardSurface
      v-if="agentDocument"
      :frame-id="objectId"
      :interaction-enabled="true"
      :thread-name="objectName"
      :worker-conversation-id="agentWorkerConversationId(agentDocument)"
    />
    <SmylrTrustedWebApp
      v-else-if="smylrDocument"
      active
      component-surface
      :frame-id="`object-panel:${objectId}`"
      interaction-enabled
      :route="smylrDocument.route"
      :runtime-key="`object-panel:${objectId}`"
    />
    <div
      v-show="!agentDocument && !smylrDocument"
      ref="host"
      class="size-full min-h-0"
      data-test-id="code-object-panel-host"
    />
    <div
      v-if="error"
      class="absolute inset-0 flex items-center justify-center px-8 text-center text-[12px] leading-5 text-muted"
      data-test-id="code-object-panel-error"
    >
      {{ error }}
    </div>
  </section>
</template>
