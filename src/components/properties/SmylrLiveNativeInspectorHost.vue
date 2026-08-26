<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import { buildOpenPencilClipboardHTML } from '@open-pencil/core/clipboard'
import type { SceneNode } from '@open-pencil/scene-graph'
import { cloneNodeProps } from '@open-pencil/scene-graph/copy'
import { provideEditor } from '@open-pencil/vue'

import { createEditorStore } from '@/app/editor/session'
import { smylrLiveContainerToSceneGraph } from '@/app/smylr-live-container/to-scene-graph'
import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode
} from '@/app/smylr-live-container/types'
import {
  cloneLiveInspectorValue,
  createLiveInspectorStylePatch,
  draftAdjustedLiveInspectorDocument,
  findContainingPageId,
  findLiveInspectorProxyNode,
  seedLiveInspectorSemanticVariables
} from '@/app/smylr-live-inspector/native-adapter'
import {
  beginLiveInspectorDraftTransaction,
  endLiveInspectorDraftTransaction,
  liveInspectorDraftHistoryEpoch,
  liveInspectorPatchDraftFor,
  previewLiveInspectorDraft,
  resetLiveInspectorPreview,
  setLiveInspectorClipboardHtml
} from '@/app/smylr-live-inspector/session'
import SmylrLiveClassesField from '@/components/SmylrLiveClassesField.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Tip from '@/components/ui/Tip.vue'
import NativeSelectionInspector from './NativeSelectionInspector.vue'

const { document, node } = defineProps<{
  document: SmylrLiveContainerDocument
  node: SmylrLiveContainerNode
}>()

const emit = defineEmits<{
  reset: []
}>()

const graph = smylrLiveContainerToSceneGraph(document)
const proxyNode = findLiveInspectorProxyNode(graph, node.id)
if (!proxyNode) throw new Error(`Live inspector proxy not found for ${node.id}`)
proxyNode.name = node.label
const proxyNodeId = proxyNode.id
let baselineNode = cloneLiveInspectorValue(proxyNode) as SceneNode
let accumulatedDraft = liveInspectorPatchDraftFor(node.id)
const restoredAccumulatedDraft = Boolean(accumulatedDraft)

if (accumulatedDraft?.styles && Object.keys(accumulatedDraft.styles).length > 0) {
  const effectiveGraph = smylrLiveContainerToSceneGraph(
    draftAdjustedLiveInspectorDocument(document, node, accumulatedDraft.styles)
  )
  const effectiveProxy = findLiveInspectorProxyNode(effectiveGraph, node.id)
  if (effectiveProxy) {
    effectiveProxy.name = node.label
    graph.updateNode(proxyNodeId, cloneNodeProps(effectiveProxy, null))
  }
}

const tokenByVariableId = seedLiveInspectorSemanticVariables({
  catalog: document.semanticTokenCatalog ?? [],
  graph,
  node,
  proxy: proxyNode
})
const shadowStore = createEditorStore(graph)
const pageId = findContainingPageId(graph, proxyNode)
if (pageId) shadowStore.state.currentPageId = pageId
shadowStore.select([proxyNodeId])
provideEditor(shadowStore)

let previewReady = false
const hasChanges = ref(Boolean(accumulatedDraft))
const resetLabel = computed(() => (hasChanges.value ? 'Reset live changes' : 'No live changes'))
const styleTransactionKey = `styles:${node.id}`

/** Live semantic catalog (for class suggestions + variable binding seed). Full list: docs/design-system/open-pencil-live-tokens.md */
const tokenCatalog = computed(() => document.semanticTokenCatalog ?? [])

function splitClassList(value: string | undefined) {
  return (value ?? '')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

const baseUtilityClasses = computed(() => {
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const part of [...splitClassList(node.className), ...(node.tokenHints ?? [])]) {
    if (seen.has(part)) continue
    seen.add(part)
    ordered.push(part)
  }
  return ordered
})

const activeUtilityClasses = ref<string[]>([])

function recomputeActiveUtilityClasses() {
  const next = new Set(baseUtilityClasses.value)
  for (const removed of accumulatedDraft?.remove ?? []) next.delete(removed)
  for (const added of accumulatedDraft?.add ?? []) next.add(added)
  activeUtilityClasses.value = [...next]
}

recomputeActiveUtilityClasses()

watch(liveInspectorDraftHistoryEpoch, async () => {
  previewReady = false
  accumulatedDraft = liveInspectorPatchDraftFor(node.id)
  hasChanges.value = Boolean(accumulatedDraft)
  recomputeActiveUtilityClasses()

  let nextNode: SceneNode | null = baselineNode
  if (accumulatedDraft?.styles && Object.keys(accumulatedDraft.styles).length > 0) {
    const effectiveGraph = smylrLiveContainerToSceneGraph(
      draftAdjustedLiveInspectorDocument(document, node, accumulatedDraft.styles)
    )
    nextNode = findLiveInspectorProxyNode(effectiveGraph, node.id)
  }
  if (nextNode) {
    nextNode.name = node.label
    graph.updateNode(proxyNodeId, cloneNodeProps(nextNode, null))
  }
  await nextTick()
  previewReady = true
})

const classSuggestions = computed(() => {
  const ordered: string[] = []
  const seen = new Set<string>()
  const push = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    ordered.push(trimmed)
  }

  for (const token of tokenCatalog.value) {
    for (const utility of token.utilities ?? []) push(utility)
  }
  for (const part of baseUtilityClasses.value) push(part)

  for (const common of [
    'flex',
    'inline-flex',
    'grid',
    'hidden',
    'items-center',
    'justify-between',
    'justify-center',
    'gap-1',
    'gap-2',
    'gap-3',
    'gap-4',
    'p-2',
    'p-3',
    'p-4',
    'px-3',
    'py-2',
    'mt-1',
    'mt-2',
    'mb-2',
    'rounded-md',
    'rounded-lg',
    'rounded-xl',
    'text-xs',
    'text-sm',
    'text-base',
    'text-lg',
    'font-medium',
    'font-semibold',
    'tracking-tight',
    'text-center',
    'text-left',
    'truncate',
    'shadow-sm',
    'border',
    'bg-card',
    'bg-background',
    'text-foreground',
    'text-muted-foreground'
  ]) {
    push(common)
  }

  return ordered
})

function commitClassDraft(nextAdd: string[], nextRemove: string[]) {
  const nextDraft = {
    add: nextAdd,
    nodeId: node.id,
    note: node.label,
    remove: nextRemove,
    source: node.source,
    styles: accumulatedDraft?.styles
  }
  const hasClassEdits = nextAdd.length > 0 || nextRemove.length > 0
  const hasStyleEdits = Boolean(nextDraft.styles && Object.keys(nextDraft.styles).length > 0)
  if (!hasClassEdits && !hasStyleEdits) {
    accumulatedDraft = null
    hasChanges.value = false
    recomputeActiveUtilityClasses()
    resetLiveInspectorPreview(node.id)
    return
  }
  accumulatedDraft = nextDraft
  hasChanges.value = true
  recomputeActiveUtilityClasses()
  const current = shadowStore.graph.getNode(proxyNodeId)
  if (current) {
    setLiveInspectorClipboardHtml(
      node.id,
      buildOpenPencilClipboardHTML([current], shadowStore.graph)
    )
  }
  previewLiveInspectorDraft(nextDraft, { label: `Edit classes on ${node.label}` })
}

function addUtilityClass(className: string) {
  const value = className.trim()
  if (!value) return
  const nextRemove = (accumulatedDraft?.remove ?? []).filter((item) => item !== value)
  const nextAdd = new Set(accumulatedDraft?.add)
  if (!baseUtilityClasses.value.includes(value)) nextAdd.add(value)
  commitClassDraft([...nextAdd], nextRemove)
}

function removeUtilityClass(className: string) {
  const value = className.trim()
  if (!value) return
  const nextAdd = (accumulatedDraft?.add ?? []).filter((item) => item !== value)
  const nextRemove = new Set(accumulatedDraft?.remove)
  if (baseUtilityClasses.value.includes(value)) nextRemove.add(value)
  commitClassDraft(nextAdd, [...nextRemove])
}

function syncLivePreview() {
  const current = shadowStore.graph.getNode(proxyNodeId)
  if (!current) return
  const styles = createLiveInspectorStylePatch({
    baseline: baselineNode,
    current,
    sourceStyles: node.computedStyle,
    tokenByVariableId
  })
  const mergedStyles = { ...accumulatedDraft?.styles, ...styles }
  const nextDraft = {
    add: accumulatedDraft?.add ?? [],
    nodeId: node.id,
    note: node.label,
    remove: accumulatedDraft?.remove ?? [],
    source: node.source,
    styles: mergedStyles
  }
  hasChanges.value = Object.keys(mergedStyles).length > 0
  if (!hasChanges.value) {
    accumulatedDraft = null
    resetLiveInspectorPreview(node.id)
    return
  }
  accumulatedDraft = nextDraft
  setLiveInspectorClipboardHtml(node.id, buildOpenPencilClipboardHTML([current], shadowStore.graph))
  previewLiveInspectorDraft(nextDraft, {
    coalesceKey: styleTransactionKey,
    label: `Edit ${node.label}`
  })
}

watch(
  () => shadowStore.state.sceneVersion,
  () => {
    if (previewReady) syncLivePreview()
  }
)

onMounted(async () => {
  await nextTick()
  const mountedNode = shadowStore.graph.getNode(proxyNodeId)
  if (mountedNode && !restoredAccumulatedDraft) {
    baselineNode = cloneLiveInspectorValue(mountedNode) as SceneNode
  }
  if (mountedNode) {
    setLiveInspectorClipboardHtml(
      node.id,
      buildOpenPencilClipboardHTML([mountedNode], shadowStore.graph)
    )
  }
  previewReady = true
})

function requestReset() {
  accumulatedDraft = null
  hasChanges.value = false
  recomputeActiveUtilityClasses()
  resetLiveInspectorPreview(node.id)
  emit('reset')
}
</script>

<template>
  <NativeSelectionInspector
    compact-header
    :computed-style="node.computedStyle"
    :editor-store="shadowStore"
    :name-label="node.label"
    data-live-adapter="true"
    @pointerdown.capture="beginLiveInspectorDraftTransaction(styleTransactionKey)"
    @pointerup.capture="endLiveInspectorDraftTransaction(styleTransactionKey)"
    @pointercancel.capture="endLiveInspectorDraftTransaction(styleTransactionKey)"
  >
    <template #header-actions>
      <Tip v-if="hasChanges" label="This layer has live overrides">
        <span data-test-id="smylr-live-change-indicator" class="size-1.5 rounded-full bg-accent" />
      </Tip>
      <IconButton
        :label="resetLabel"
        :disabled="!hasChanges"
        data-test-id="smylr-live-reset"
        @click="requestReset"
      >
        <icon-lucide-rotate-ccw class="size-3.5" />
      </IconButton>
    </template>

    <template #sections-footer>
      <SmylrLiveClassesField
        :active-classes="activeUtilityClasses"
        :suggestions="classSuggestions"
        @add="addUtilityClass"
        @remove="removeUtilityClass"
      />
    </template>
  </NativeSelectionInspector>
</template>
