<script setup lang="ts">
import { useEditorStore } from '@/app/editor/active-store'
import { nodeIcon } from '@/app/editor/icons'
import { codeComponentPresetsForQuery } from '@/app/code-object/model'
import { openExternalLink, toast } from '@/app/shell/ui'
import {
  SMYLR_COMPONENT_INVENTORY,
  SMYLR_COMPUTED_ASSETS,
  type SmylrComponentInventoryLayer
} from '@/app/smylr-component-library/computed-catalog'
import {
  ensureSmylrLiveComponentCanvas,
  placeSmylrLiveComponentVariant
} from '@/app/smylr-component-library/live-component-canvas'
import {
  setLiveInspectorActiveFrame,
  setLiveInspectorInteractionMode
} from '@/app/smylr-live-inspector/session'
import { fitSmylrPageToViewport } from '@/app/smylr-production/workspace'
import { downloadBlob } from '@/app/document/io/browser'
import {
  buildOpenPencilLibrary,
  parseOpenPencilLibrary,
  reviewOpenPencilLibrary,
  type DesignLibraryReview,
  type OpenPencilLibrary
} from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { useI18n } from '@open-pencil/vue'
import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useFileDialog } from '@vueuse/core'
import AppInput from '@/components/ui/AppInput.vue'
import Tip from '@/components/ui/Tip.vue'
import AssetVariantDropdown from '@/components/assets/AssetVariantDropdown.vue'
import CodeObjectAssets from '@/components/assets/CodeObjectAssets.vue'
import type {
  AssetVariant,
  ComputedAsset,
  InteractiveAsset,
  InventoryAsset,
  LocalAsset,
  SceneAsset,
  SceneAssetVariant
} from '@/components/assets/types'
import { useButtonUI } from '@/components/ui/button'
import { useDialogUI } from '@/components/ui/dialog'

const emit = defineEmits<{ assetInserted: [nodeId: string] }>()
const editor = useEditorStore()
const { panels } = useI18n()
const query = ref('')
const detailsOpen = ref(false)
const selectedAssetId = ref<string | null>(null)
const previewUrl = ref<string | null>(null)
const previewLoading = ref(false)
let previewRequestId = 0
const insertButton = useButtonUI({ tone: 'ghost', size: 'iconSm' })
const primaryButton = useButtonUI({ tone: 'accent', size: 'md' })
const dialog = useDialogUI({
  content: 'flex w-[720px] max-w-[92vw] flex-col overflow-hidden'
})
const openingAssetId = ref<string | null>(null)
const assetOpenError = ref<string | null>(null)
const variantOpenState = ref<Record<string, boolean>>({})
watch(query, () => {
  variantOpenState.value = {}
})
type AssetGroupId = 'features' | 'layout' | 'local' | 'primitives' | 'shared'
type AssetGroup = {
  assets: LocalAsset[]
  id: AssetGroupId
  label: string
}
const expandedGroups = ref<Record<AssetGroupId, boolean>>({
  features: false,
  layout: false,
  local: true,
  primitives: true,
  shared: false
})
const libraryReviewOpen = ref(false)
const libraryDialog = useDialogUI({
  content: 'flex w-[560px] max-w-[92vw] flex-col overflow-hidden'
})
const pendingLibrary = ref<{
  library: OpenPencilLibrary
  review: DesignLibraryReview
  fileName: string
} | null>(null)
const libraryFileDialog = useFileDialog({
  accept: '.json,application/json',
  multiple: false,
  reset: true
})

libraryFileDialog.onChange((files) => {
  const file = files?.[0]
  if (file) void reviewLibraryFile(file)
})

function librarySlug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'openpencil-library'
  )
}

function publishLibrary() {
  const name = editor.state.documentName.trim() || 'Untitled'
  const key = librarySlug(name)
  const library = buildOpenPencilLibrary(editor.graph, {
    key,
    name,
    version: new Date().toISOString()
  })
  const bytes = new TextEncoder().encode(JSON.stringify(library, null, 2) + '\n')
  downloadBlob(bytes, key + '.openpencil-library.json', 'application/json')
  toast.info(
    'Published ' +
      library.components.length +
      ' components and ' +
      editor.graph.variables.size +
      ' tokens'
  )
}

function importLibrary() {
  libraryFileDialog.open()
}

async function reviewLibraryFile(file: File) {
  try {
    const library = parseOpenPencilLibrary(await file.text())
    pendingLibrary.value = {
      library,
      review: reviewOpenPencilLibrary(editor.graph, library),
      fileName: file.name
    }
    libraryReviewOpen.value = true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not read library package')
  }
}

function applyLibrary() {
  const pending = pendingLibrary.value
  if (!pending) return
  editor.applyDesignLibraryPackage(pending.library, pending.review)
  libraryReviewOpen.value = false
  pendingLibrary.value = null
  toast.info('Library changes applied')
}

function componentSetVariantInfo(componentSetId: string) {
  return [...editor.collectVariantOptions(componentSetId)].map(([name, values]) => ({
    name,
    values: [...values].sort((a, b) => a.localeCompare(b))
  }))
}

function sceneVariantItems(componentSetId: string): SceneAssetVariant[] {
  return editor.graph
    .getChildren(componentSetId)
    .filter((node) => node.type === 'COMPONENT')
    .map((node) => ({
      componentId: node.id,
      id: node.id,
      kind: 'scene' as const,
      label: node.name
    }))
}

function originalSceneItem(componentId: string): SceneAssetVariant {
  return {
    componentId,
    id: `original:${componentId}`,
    kind: 'scene',
    label: 'Original'
  }
}

function computedVariantAxes(asset: (typeof SMYLR_COMPUTED_ASSETS)[number]) {
  const axes = new Map<string, Set<string>>()
  for (const variant of asset.variants) {
    for (const [name, value] of Object.entries(variant.props)) {
      const values = axes.get(name) ?? new Set<string>()
      values.add(value)
      axes.set(name, values)
    }
  }
  return [...axes].map(([name, values]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    values: [...values]
  }))
}

function sourcePathFor(node: SceneNode) {
  return (
    node.pluginData.find(
      (entry) => entry.pluginId === 'smylr-production' && entry.key === 'sourcePath'
    )?.value ?? null
  )
}

const graphNodes = computed(() => ({
  sceneVersion: editor.state.sceneVersion,
  nodes: [...editor.graph.nodes.values()]
}))

const sceneAssets = computed<SceneAsset[]>(() => {
  return graphNodes.value.nodes
    .filter((node) => node.type === 'COMPONENT' || node.type === 'COMPONENT_SET')
    .filter((node) => {
      if (node.type === 'COMPONENT_SET') return true
      const parent = node.parentId ? editor.graph.getNode(node.parentId) : null
      return parent?.type !== 'COMPONENT_SET'
    })
    .map((node) => {
      const defaultVariant =
        node.type === 'COMPONENT_SET' ? editor.getDefaultVariantForComponentSet(node.id) : node
      const conflicts =
        node.type === 'COMPONENT_SET' ? editor.getComponentSetVariantConflicts(node.id) : []
      const variantAxes = node.type === 'COMPONENT_SET' ? componentSetVariantInfo(node.id) : []
      const variantItems =
        node.type === 'COMPONENT_SET' ? sceneVariantItems(node.id) : [originalSceneItem(node.id)]
      return {
        id: node.id,
        kind: 'scene' as const,
        name: node.name,
        node,
        componentId: defaultVariant?.id ?? null,
        variantAxes,
        variantCount: node.type === 'COMPONENT_SET' ? variantItems.length : 0,
        variantItems,
        hasConflicts: conflicts.length > 0,
        sourceLibraryKey: node.sourceLibraryKey,
        description: node.symbolDescription,
        docsUrl: node.symbolLinks[0]?.uri ?? null,
        sourcePath: sourcePathFor(node)
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})

const computedAssets = computed<ComputedAsset[]>(() => {
  return SMYLR_COMPUTED_ASSETS.map((asset) => ({
    ...asset,
    id: `smylr-computed:${asset.fixtureId}`,
    kind: 'computed' as const,
    componentId: null,
    variantAxes: computedVariantAxes(asset),
    variantCount: asset.variants.length,
    variantItems:
      asset.variants.length > 0
        ? asset.variants.map((variant) => ({
            ...variant,
            fixtureId: asset.fixtureId,
            kind: 'computed' as const,
            variantId: variant.id
          }))
        : [
            {
              fixtureId: asset.fixtureId,
              id: 'original',
              kind: 'computed' as const,
              label: 'Original',
              props: {},
              variantId: null
            }
          ],
    hasConflicts: false,
    sourceLibraryKey: 'smylr-computed' as const,
    description: `Live from ${asset.sourcePath}`,
    docsUrl: null
  }))
})

const liveSourcePaths = new Set(SMYLR_COMPUTED_ASSETS.map((asset) => asset.sourcePath))

const inventoryAssets = computed<InventoryAsset[]>(() =>
  SMYLR_COMPONENT_INVENTORY.filter(
    (asset) =>
      !liveSourcePaths.has(asset.sourcePath) &&
      asset.openPencilAudit?.assetAction !== 'remove-from-assets'
  ).map((asset) => ({
    ...asset,
    id: `smylr-inventory:${asset.sourcePath}`,
    kind: 'inventory' as const,
    componentId: null,
    name: asset.componentNames[0] ?? asset.sourcePath.split('/').at(-1) ?? asset.sourcePath,
    catalogVariantAxes: asset.variantAxes,
    variantAxes: asset.variantAxes.map((name) => ({ name, values: [] })),
    variantCount: 0,
    hasConflicts: false,
    sourceLibraryKey: 'smylr-inventory' as const,
    description:
      asset.componentNames.length === 1
        ? `Source component from ${asset.sourcePath}`
        : `${asset.componentNames.length} exported components from ${asset.sourcePath}`,
    docsUrl: null
  }))
)

const assets = computed<LocalAsset[]>(() =>
  [...sceneAssets.value, ...computedAssets.value, ...inventoryAssets.value].sort((a, b) =>
    a.name.localeCompare(b.name)
  )
)

function assetSearchValues(asset: LocalAsset) {
  if (asset.kind === 'inventory') {
    return [
      asset.name,
      asset.description,
      asset.sourcePath,
      asset.feature,
      asset.openPencilAudit?.classification,
      asset.openPencilAudit?.reason,
      asset.openPencilAudit?.assetActionReason,
      ...asset.componentNames,
      ...asset.variantAxes.map((axis) => axis.name),
      ...asset.stateTargets
    ]
  }
  return [asset.name, asset.description, asset.sourcePath]
}

const filteredAssets = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return assets.value
  return assets.value.filter((asset) =>
    assetSearchValues(asset).some((value) => value?.toLowerCase().includes(normalized))
  )
})

const filteredCodeComponentCount = computed(() => codeComponentPresetsForQuery(query.value).length)

const assetCountLabel = computed(() => {
  const count = filteredAssets.value.length + filteredCodeComponentCount.value
  if (query.value.trim()) return `${count} ${count === 1 ? 'result' : 'results'}`
  return `${count} total`
})

const assetCoverageLabel = computed(() => {
  const liveCount =
    filteredAssets.value.filter(isInteractiveAsset).length + filteredCodeComponentCount.value
  const sourceOnlyCount =
    filteredAssets.value.length - filteredAssets.value.filter(isInteractiveAsset).length
  return `${liveCount} live · ${sourceOnlyCount} source-only`
})

function inventoryGroupId(layer: SmylrComponentInventoryLayer): AssetGroupId {
  if (layer === 'primitive') return 'primitives'
  if (layer === 'feature') return 'features'
  return layer
}

function assetGroupId(asset: LocalAsset): AssetGroupId {
  if (asset.kind === 'scene') return 'local'
  if (asset.kind === 'computed') {
    return inventoryGroupId(asset.inventoryLayer)
  }
  return inventoryGroupId(asset.layer)
}

const assetGroups = computed<AssetGroup[]>(() => {
  const groups: AssetGroup[] = [
    { id: 'local', label: 'Local', assets: [] },
    { id: 'primitives', label: 'Primitives', assets: [] },
    { id: 'layout', label: 'Layout', assets: [] },
    { id: 'shared', label: 'Shared', assets: [] },
    { id: 'features', label: 'Features', assets: [] }
  ]
  const groupById = new Map(groups.map((group) => [group.id, group]))
  for (const asset of filteredAssets.value) groupById.get(assetGroupId(asset))?.assets.push(asset)
  return groups.filter((group) => group.assets.length > 0)
})

function groupIsOpen(groupId: AssetGroupId) {
  return query.value.trim().length > 0 || expandedGroups.value[groupId]
}

function toggleGroup(groupId: AssetGroupId) {
  expandedGroups.value[groupId] = !expandedGroups.value[groupId]
}

function isInteractiveAsset(asset: LocalAsset): asset is InteractiveAsset {
  return asset.kind !== 'inventory'
}

function sourceOnlyBadge(asset: InventoryAsset) {
  const audit = asset.openPencilAudit
  if (!audit) return 'Source'
  if (audit.assetAction === 'fixture-candidate') return 'Fixture ready'
  if (audit.classification === 'runtime-or-service') return 'Runtime'
  if (audit.classification === 'browser-only') return 'Browser'
  if (audit.classification === 'needs-production-boundary') return 'Boundary'
  return 'Source'
}

function sourceOnlyStatus(asset: InventoryAsset) {
  const audit = asset.openPencilAudit
  if (!audit) return 'live fixture pending'
  if (audit.assetAction === 'fixture-candidate') return 'fixture candidate'
  return 'source-only by design'
}

function sourceOnlyClassification(asset: InventoryAsset) {
  return asset.openPencilAudit?.classification.replaceAll('-', ' ') ?? 'not yet classified'
}

function sourceOnlyCoverage(asset: InventoryAsset) {
  const audit = asset.openPencilAudit
  if (audit) return audit.reason
  if (asset.storyStatus === 'covered') return 'Story coverage found · live fixture not mapped yet'
  if (asset.storyStatus === 'story-ready') return 'Ready for a fixture'
  return 'Needs a fixture and state coverage'
}

const selectedAsset = computed(
  () => assets.value.find((asset) => asset.id === selectedAssetId.value) ?? null
)
const selectedPreviewNodeId = computed(() =>
  selectedAsset.value?.kind === 'scene' ? selectedAsset.value.componentId : null
)

function revokePreview() {
  if (!previewUrl.value) return
  URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = null
}

async function updatePreview() {
  const requestId = ++previewRequestId
  const nodeId = selectedPreviewNodeId.value
  if (!detailsOpen.value || !nodeId) {
    revokePreview()
    return
  }

  const node = editor.getNode(nodeId)
  if (!node) {
    revokePreview()
    return
  }

  previewLoading.value = true
  try {
    const maxSize = Math.max(node.width, node.height, 1)
    const scale = Math.min(176 / maxSize, 2)
    const data = await editor.renderExportImage([nodeId], scale, 'PNG')
    if (requestId !== previewRequestId) return
    revokePreview()
    if (data) previewUrl.value = URL.createObjectURL(new Blob([data], { type: 'image/png' }))
  } finally {
    if (requestId === previewRequestId) previewLoading.value = false
  }
}

watch([detailsOpen, selectedPreviewNodeId, () => editor.state.sceneVersion], updatePreview, {
  flush: 'post'
})

function openDetails(asset: LocalAsset) {
  selectedAssetId.value = asset.id
  detailsOpen.value = true
}

function pageIdForNode(node: SceneNode) {
  const pageIds = new Set(editor.graph.getPages().map((page) => page.id))
  let current: SceneNode | null = node
  while (current) {
    if (pageIds.has(current.id)) return current.id
    current = current.parentId ? (editor.graph.getNode(current.parentId) ?? null) : null
  }
  return null
}

async function openSceneAssetCanvas(asset: SceneAsset, variant?: SceneAssetVariant) {
  detailsOpen.value = false
  const target = variant ? editor.graph.getNode(variant.componentId) : asset.node
  if (!target) return toast.warning('This component variant is not available')
  const pageId = pageIdForNode(target)
  if (!pageId) return toast.warning('This component canvas is not available')
  await editor.switchPage(pageId)
  editor.setTool('SELECT')
  editor.select([target.id])
  await nextTick()
  editor.zoomToSelection()
  toast.info(`${variant?.label ?? asset.name} component canvas opened`)
}

async function openLiveComponentAsset(asset: ComputedAsset, variantId?: string) {
  const openId = variantId ? `${asset.id}:${variantId}` : asset.id
  if (openingAssetId.value) return
  openingAssetId.value = openId
  assetOpenError.value = null
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  const displayName = variant ? `${asset.name} ${variant.label}` : asset.name
  toast.info(`Opening the live ${displayName} component…`)
  try {
    const { page, frame } = ensureSmylrLiveComponentCanvas(editor, asset, variantId)
    await editor.switchPage(page.id)
    editor.state.enteredContainerId = null
    editor.select([frame.id])
    setLiveInspectorActiveFrame(frame.id)
    setLiveInspectorInteractionMode('interact')
    await nextTick()
    await fitSmylrPageToViewport(editor, [frame.id], { settle: false })
    toast.info(`${displayName} live component canvas opened`)
  } catch (error) {
    console.warn('[Smylr computed asset]', error)
    assetOpenError.value = error instanceof Error ? error.message : `Could not open ${asset.name}`
    toast.warning(assetOpenError.value)
  } finally {
    openingAssetId.value = null
  }
}

async function openAssetVariant(asset: LocalAsset, variant: AssetVariant) {
  if (asset.kind === 'computed' && variant.kind === 'computed') {
    await openLiveComponentAsset(asset, variant.variantId ?? undefined)
    return
  }
  if (asset.kind === 'scene' && variant.kind === 'scene') {
    await openSceneAssetCanvas(asset, variant)
  }
}

function insertionPoint(component: SceneNode, parentId: string) {
  const canvasCenter = editor.viewportCanvasCenter()
  const center = editor.screenToCanvas(canvasCenter.x, canvasCenter.y)
  const parentOffset =
    parentId === editor.state.currentPageId
      ? { x: 0, y: 0 }
      : editor.graph.getAbsolutePosition(parentId)
  return {
    x: center.x - parentOffset.x - component.width / 2,
    y: center.y - parentOffset.y - component.height / 2
  }
}

async function insertAsset(asset: LocalAsset) {
  if (asset.kind === 'inventory') {
    toast.info(`${asset.name} needs a live fixture before it can be added to a board`)
    return
  }
  variantOpenState.value[asset.id] = false
  if (asset.kind === 'computed') {
    const canvasCenter = editor.viewportCanvasCenter()
    const center = editor.screenToCanvas(canvasCenter.x, canvasCenter.y)
    const frame = placeSmylrLiveComponentVariant(editor, asset, undefined, center.x, center.y)
    emit('assetInserted', frame.id)
    return
  }
  if (!asset.componentId) return
  const component = editor.graph.getNode(asset.componentId)
  if (!component) return
  const parentId = editor.state.enteredContainerId ?? editor.state.currentPageId
  const point = insertionPoint(component, parentId)
  const instanceId = editor.createInstanceFromComponent(
    asset.componentId,
    point.x,
    point.y,
    parentId
  )
  if (!instanceId) return
  editor.requestRender()
  emit('assetInserted', instanceId)
}

async function insertSelectedAsset() {
  if (!selectedAsset.value) return
  await insertAsset(selectedAsset.value)
  detailsOpen.value = false
}
</script>

<template>
  <section data-test-id="assets-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header class="flex shrink-0 items-center justify-between gap-2 px-3 pt-2 pb-1.5">
      <span class="shrink-0 text-[11.5px] leading-4 font-semibold text-surface"> Assets </span>
      <div class="flex items-center gap-1">
        <Tip label="Import library">
          <button
            type="button"
            data-test-id="assets-import-library"
            aria-label="Import library"
            :class="insertButton.base"
            @click="importLibrary"
          >
            <icon-lucide-upload class="size-3" />
          </button>
        </Tip>
        <Tip label="Publish local library">
          <button
            type="button"
            data-test-id="assets-publish-library"
            aria-label="Publish local library"
            :class="insertButton.base"
            @click="publishLibrary"
          >
            <icon-lucide-package-plus class="size-3" />
          </button>
        </Tip>
        <span
          data-test-id="computed-assets-count"
          class="ml-1 whitespace-nowrap text-[9px] text-muted/70"
        >
          {{ assetCountLabel }}
        </span>
      </div>
    </header>
    <div class="shrink-0 px-3 pb-2">
      <AppInput
        v-model="query"
        type="search"
        data-test-id="assets-search"
        size="sm"
        placeholder="Search assets"
        class="rounded-[5px] bg-transparent"
      />
      <p data-test-id="assets-coverage-summary" class="px-1 pt-1 text-[9px] text-muted/70">
        {{ assetCoverageLabel }}
      </p>
      <p
        v-if="assetOpenError"
        data-test-id="computed-asset-error"
        class="mt-1.5 px-1 text-[10px] leading-4 text-[var(--color-warning-text)]"
      >
        {{ assetOpenError }}
      </p>
    </div>

    <div class="flex-1 scrollbar-thin overflow-x-hidden overflow-y-auto px-2.5 pb-3">
      <CodeObjectAssets :query="query" @asset-inserted="emit('assetInserted', $event)" />

      <section v-for="group in assetGroups" :key="group.id" class="mb-1">
        <button
          type="button"
          data-test-id="asset-group-trigger"
          :data-asset-group="group.id"
          :aria-expanded="groupIsOpen(group.id)"
          class="text-muted hover:text-surface flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[9.5px] font-semibold tracking-wide uppercase"
          @click="toggleGroup(group.id)"
        >
          <icon-lucide-chevron-right
            class="size-3 transition-transform"
            :class="groupIsOpen(group.id) ? 'rotate-90' : ''"
          />
          <icon-lucide-folder-open v-if="groupIsOpen(group.id)" class="text-component size-3" />
          <icon-lucide-folder v-else class="text-component size-3" />
          <span class="flex-1">{{ group.label }}</span>
          <span class="font-normal tracking-normal text-muted/70">{{ group.assets.length }}</span>
        </button>

        <div v-if="groupIsOpen(group.id)" data-test-id="asset-group-content">
          <div
            v-for="asset in group.assets"
            :key="asset.id"
            data-test-id="asset-item"
            :data-asset-id="asset.id"
            :data-asset-kind="asset.kind"
            class="min-h-9 w-full rounded-[5px] px-1.5 py-0.5 text-[11.5px] text-muted transition-colors hover:bg-hover/60"
          >
            <AssetVariantDropdown
              v-if="isInteractiveAsset(asset)"
              v-model:open="variantOpenState[asset.id]"
              :asset="asset"
              @open-variant="openAssetVariant(asset, $event)"
            >
              <template #default="{ open: variantsOpen }">
                <button
                  type="button"
                  data-test-id="asset-open"
                  :aria-label="`Show ${asset.name} options`"
                  class="group/asset-open flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left"
                  :class="variantsOpen ? 'bg-hover/60' : ''"
                >
                  <icon-lucide-loader-2
                    v-if="openingAssetId === asset.id"
                    class="text-component size-3.5 shrink-0 animate-spin"
                  />
                  <icon-lucide-box
                    v-else-if="asset.kind === 'computed'"
                    class="text-component size-3.5 shrink-0"
                  />
                  <component
                    v-else
                    :is="nodeIcon(asset.node)"
                    class="text-component size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span class="min-w-0 flex-1">
                    <span data-test-id="asset-name" class="text-surface block truncate font-medium">
                      {{ asset.name }}
                    </span>
                    <span
                      v-if="asset.sourcePath || asset.variantCount > 0"
                      data-test-id="asset-source-path"
                      class="text-muted mt-0.5 flex min-w-0 items-center gap-1 text-[10px]"
                    >
                      <span v-if="asset.sourcePath" class="min-w-0 flex-1 truncate">
                        {{ asset.sourcePath }}
                      </span>
                      <span
                        v-if="asset.variantCount > 0"
                        data-test-id="asset-variant-summary"
                        class="shrink-0"
                      >
                        <span v-if="asset.sourcePath">·</span> {{ asset.variantCount }} variants
                      </span>
                    </span>
                    <span
                      v-if="asset.hasConflicts"
                      data-test-id="asset-variant-conflict"
                      class="mt-0.5 block truncate text-[10px] text-[var(--color-warning-text)]"
                    >
                      {{ panels.duplicateVariantValues }}
                    </span>
                  </span>
                  <span
                    data-test-id="asset-variants-trigger"
                    class="text-muted/70 group-hover/asset-open:text-component flex size-5 shrink-0 items-center justify-center transition-colors"
                    aria-hidden="true"
                  >
                    <icon-lucide-chevron-down
                      class="size-3 transition-transform"
                      :class="variantsOpen ? 'rotate-180' : ''"
                    />
                  </span>
                </button>
              </template>
              <template #actions>
                <button
                  type="button"
                  aria-label="Add to board"
                  data-test-id="asset-insert"
                  class="text-component hover:text-component/80 flex items-center gap-1 transition-colors"
                  @click.stop="insertAsset(asset)"
                >
                  <icon-lucide-plus class="size-3" />
                  Add to board
                </button>
                <button
                  type="button"
                  aria-label="Component details"
                  data-test-id="asset-details"
                  class="text-muted hover:text-surface flex items-center gap-1 transition-colors"
                  @click.stop="openDetails(asset)"
                >
                  <icon-lucide-info class="size-3" />
                  Details
                </button>
                <button
                  v-if="asset.docsUrl"
                  type="button"
                  :aria-label="panels.openDocumentation"
                  data-test-id="asset-docs"
                  class="text-muted hover:text-surface flex items-center gap-1 transition-colors"
                  @click.stop="openExternalLink(asset.docsUrl)"
                >
                  <icon-lucide-book-open class="size-3" />
                  Docs
                </button>
              </template>
            </AssetVariantDropdown>

            <button
              v-else
              type="button"
              data-test-id="asset-open"
              :aria-label="`View ${asset.name} source component details`"
              class="group/source flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left"
              @click="openDetails(asset)"
            >
              <icon-lucide-file-code-2 class="size-3.5 shrink-0 text-component/70" />
              <span class="min-w-0 flex-1">
                <span data-test-id="asset-name" class="text-surface block truncate font-medium">
                  {{ asset.name }}
                </span>
                <span
                  data-test-id="asset-source-path"
                  class="text-muted mt-0.5 block truncate text-[10px]"
                >
                  {{ asset.sourcePath }}
                </span>
              </span>
              <span
                data-test-id="asset-source-status"
                class="rounded bg-input/70 px-1.5 py-0.5 text-[8px] font-medium tracking-wide text-muted/80 uppercase"
              >
                {{ sourceOnlyBadge(asset) }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <div
        v-if="filteredAssets.length === 0 && filteredCodeComponentCount === 0"
        data-test-id="assets-empty"
        class="text-muted px-3 py-6 text-center text-xs"
      >
        {{ panels.noLocalComponents }}
      </div>
    </div>

    <DialogRoot v-model:open="detailsOpen">
      <DialogPortal>
        <DialogOverlay :class="dialog.overlay" />
        <DialogContent
          v-if="selectedAsset"
          data-test-id="asset-details-dialog"
          :aria-describedby="undefined"
          :class="dialog.content"
        >
          <div class="border-border flex items-center justify-between border-b px-4 py-3">
            <div class="flex min-w-0 items-center gap-2">
              <component
                v-if="selectedAsset.kind === 'scene'"
                :is="nodeIcon(selectedAsset.node)"
                class="text-component size-4 shrink-0"
              />
              <icon-lucide-box v-else class="text-component size-4 shrink-0" />
              <div class="min-w-0">
                <DialogTitle :class="dialog.title" class="truncate">{{
                  selectedAsset.name
                }}</DialogTitle>
                <p class="text-muted mt-0.5 text-[11px]">
                  {{
                    selectedAsset.kind === 'computed'
                      ? 'Live source component'
                      : selectedAsset.kind === 'inventory'
                        ? `Source component · ${sourceOnlyStatus(selectedAsset)}`
                        : selectedAsset.node.type === 'COMPONENT_SET'
                          ? panels.componentSet
                          : panels.component
                  }}
                  <span v-if="selectedAsset.variantCount > 0">
                    · {{ selectedAsset.variantCount }} variants</span
                  >
                </p>
              </div>
            </div>
            <DialogClose
              data-test-id="asset-details-close"
              class="text-muted hover:bg-hover hover:text-surface flex size-7 cursor-pointer items-center justify-center rounded border-none bg-transparent"
            >
              <icon-lucide-x class="size-4" />
            </DialogClose>
          </div>

          <div class="grid min-h-0 grid-cols-[260px_1fr] gap-0">
            <div class="border-border border-r p-4">
              <div
                data-test-id="asset-details-preview"
                class="border-border bg-canvas/60 flex h-36 items-center justify-center overflow-hidden rounded-lg border"
              >
                <img
                  v-if="previewUrl"
                  data-test-id="asset-details-preview-image"
                  :src="previewUrl"
                  :alt="`${selectedAsset.name} preview`"
                  class="max-h-[120px] max-w-[210px] object-contain"
                />
                <div v-else class="text-center">
                  <icon-lucide-loader-2
                    v-if="previewLoading"
                    class="text-muted mx-auto size-5 animate-spin"
                  />
                  <component
                    v-else-if="selectedAsset.kind === 'scene'"
                    :is="nodeIcon(selectedAsset.node)"
                    class="text-component mx-auto size-8"
                  />
                  <icon-lucide-box v-else class="text-component mx-auto size-8" />
                  <p class="text-surface mt-2 max-w-44 truncate text-xs font-medium">
                    {{ selectedAsset.name }}
                  </p>
                </div>
              </div>
              <button
                data-test-id="asset-details-insert"
                :class="primaryButton.base"
                class="mt-3 w-full disabled:cursor-not-allowed disabled:opacity-45"
                :disabled="selectedAsset.kind === 'inventory'"
                @click="insertSelectedAsset"
              >
                {{
                  selectedAsset.kind === 'computed'
                    ? 'Insert live component'
                    : selectedAsset.kind === 'inventory'
                      ? 'Needs live fixture'
                      : panels.insertInstance
                }}
              </button>
            </div>

            <div class="min-w-0 p-4">
              <section v-if="selectedAsset.description" class="mb-4">
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">
                  {{ panels.description }}
                </h3>
                <p
                  data-test-id="asset-details-description"
                  class="text-surface mt-1 text-xs leading-5"
                >
                  {{ selectedAsset.description }}
                </p>
              </section>

              <section v-if="selectedAsset.sourceLibraryKey" class="mb-4">
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">
                  {{ panels.assetLibraryBadge }}
                </h3>
                <p data-test-id="asset-details-library" class="text-muted mt-1 text-xs break-all">
                  {{ selectedAsset.sourcePath ?? selectedAsset.sourceLibraryKey }}
                </p>
              </section>

              <section v-if="selectedAsset.docsUrl" class="mb-4">
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">
                  {{ panels.documentation }}
                </h3>
                <button
                  data-test-id="asset-details-docs"
                  class="text-component hover:bg-component/10 mt-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs"
                  @click="
                    selectedAsset.docsUrl ? openExternalLink(selectedAsset.docsUrl) : undefined
                  "
                >
                  <icon-lucide-book-open class="size-3" />
                  {{ panels.openDocs }}
                </button>
              </section>

              <section v-if="selectedAsset.variantAxes.length > 0">
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">
                  {{ panels.properties }}
                </h3>
                <div class="mt-2 flex flex-col gap-2">
                  <div
                    v-for="variant in selectedAsset.variantAxes"
                    :key="variant.name"
                    data-test-id="asset-details-property"
                    class="border-border bg-input/40 rounded border px-2 py-1.5"
                  >
                    <div class="text-surface text-xs font-medium">
                      {{ variant.name }}
                    </div>
                    <div class="text-muted mt-1 text-[11px]">
                      {{
                        variant.values.length > 0 ? variant.values.join(', ') : 'Declared in source'
                      }}
                    </div>
                  </div>
                </div>
              </section>

              <section v-if="selectedAsset.kind === 'inventory'" class="mt-4">
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">Exports</h3>
                <p data-test-id="asset-details-exports" class="text-surface mt-1 text-xs leading-5">
                  {{ selectedAsset.componentNames.join(', ') }}
                </p>
              </section>

              <section
                v-if="selectedAsset.kind === 'inventory' && selectedAsset.stateTargets.length > 0"
                class="mt-4"
              >
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">States</h3>
                <p data-test-id="asset-details-states" class="text-surface mt-1 text-xs leading-5">
                  {{ selectedAsset.stateTargets.join(', ') }}
                </p>
              </section>

              <section v-if="selectedAsset.kind === 'inventory'" class="mt-4">
                <h3 class="text-muted text-[11px] font-medium tracking-wider uppercase">
                  Coverage
                </h3>
                <div
                  v-if="selectedAsset.openPencilAudit"
                  data-test-id="asset-details-audit-meta"
                  class="mt-1 flex flex-wrap gap-1.5"
                >
                  <span class="rounded bg-input/70 px-1.5 py-0.5 text-[9px] capitalize text-muted">
                    {{ sourceOnlyClassification(selectedAsset) }}
                  </span>
                  <span class="rounded bg-input/70 px-1.5 py-0.5 text-[9px] capitalize text-muted">
                    {{ selectedAsset.openPencilAudit.priority }} priority
                  </span>
                </div>
                <p data-test-id="asset-details-coverage" class="text-muted mt-2 text-xs leading-5">
                  {{ sourceOnlyCoverage(selectedAsset) }}
                </p>
                <p
                  v-if="selectedAsset.openPencilAudit"
                  data-test-id="asset-details-audit-action"
                  class="text-muted/80 mt-1 text-[11px] leading-4"
                >
                  {{ selectedAsset.openPencilAudit.assetActionReason }}
                </p>
              </section>
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <DialogRoot v-model:open="libraryReviewOpen">
      <DialogPortal>
        <DialogOverlay :class="libraryDialog.overlay" />
        <DialogContent
          data-test-id="assets-library-review"
          :aria-describedby="undefined"
          :class="libraryDialog.content"
        >
          <div class="flex items-start justify-between border-b border-border px-5 py-4">
            <div class="min-w-0">
              <DialogTitle class="text-sm font-semibold text-surface">
                Review library update
              </DialogTitle>
              <p class="mt-1 truncate text-[11px] text-muted">
                {{ pendingLibrary?.library.library.name }} · {{ pendingLibrary?.fileName }}
              </p>
            </div>
            <DialogClose
              class="flex size-7 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
            >
              <icon-lucide-x class="size-4" />
            </DialogClose>
          </div>

          <div v-if="pendingLibrary" class="px-5 py-4">
            <p class="mb-3 text-[11px] leading-4 text-muted">
              Components stay editable. Matching masters update in place, removed masters detach
              their existing instances, and tokens keep matching local IDs.
            </p>
            <div class="grid grid-cols-2 gap-3">
              <section class="rounded-lg border border-border bg-input/30 p-3">
                <span class="text-[10px] font-medium text-muted uppercase">Components</span>
                <dl class="mt-2 grid grid-cols-4 gap-2 text-center">
                  <div>
                    <dt class="text-[9px] text-muted">Add</dt>
                    <dd class="text-sm text-surface">
                      {{ pendingLibrary.review.components.added }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[9px] text-muted">Update</dt>
                    <dd class="text-sm text-surface">
                      {{ pendingLibrary.review.components.updated }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[9px] text-muted">Same</dt>
                    <dd class="text-sm text-surface">
                      {{ pendingLibrary.review.components.unchanged }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[9px] text-muted">Remove</dt>
                    <dd class="text-sm text-[var(--color-warning-text)]">
                      {{ pendingLibrary.review.components.removed }}
                    </dd>
                  </div>
                </dl>
              </section>
              <section class="rounded-lg border border-border bg-input/30 p-3">
                <span class="text-[10px] font-medium text-muted uppercase">Tokens</span>
                <dl class="mt-2 grid grid-cols-4 gap-2 text-center">
                  <div>
                    <dt class="text-[9px] text-muted">Add</dt>
                    <dd class="text-sm text-surface">
                      {{ pendingLibrary.review.tokens.variables.added }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[9px] text-muted">Update</dt>
                    <dd class="text-sm text-surface">
                      {{ pendingLibrary.review.tokens.variables.updated }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[9px] text-muted">Same</dt>
                    <dd class="text-sm text-surface">
                      {{ pendingLibrary.review.tokens.variables.unchanged }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-[9px] text-muted">Remove</dt>
                    <dd class="text-sm text-[var(--color-warning-text)]">
                      {{ pendingLibrary.review.tokens.variables.removed }}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
            <div
              v-if="pendingLibrary.review.components.removed > 0"
              class="mt-3 rounded-lg border border-[var(--color-warning-text)]/30 bg-[var(--color-warning-text)]/5 px-3 py-2 text-[10px] leading-4 text-[var(--color-warning-text)]"
            >
              Removed component masters will detach existing instances so their visible content is
              preserved.
            </div>
          </div>

          <div class="flex justify-end gap-2 border-t border-border px-5 py-3">
            <DialogClose
              class="cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
            >
              Cancel
            </DialogClose>
            <button
              data-test-id="assets-library-apply"
              class="cursor-pointer rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              @click="applyLibrary"
            >
              Apply library
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </section>
</template>
