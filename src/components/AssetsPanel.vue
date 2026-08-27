<script setup lang="ts">
import { useEditorStore } from '@/app/editor/active-store'
import { boardExperienceDefinitionsForQuery } from '@/app/board-experience'
import { codeObjectPresetsForQuery } from '@/app/code-object/model'
import { toast } from '@/app/shell/ui'
import {
  SMYLR_COMPONENT_INVENTORY,
  SMYLR_COMPUTED_ASSETS,
  type SmylrComponentInventoryLayer
} from '@/app/smylr-component-library/computed-catalog'
import {
  ensureSmylrComponentCodeObjectCanvas,
  placeSmylrComponentCodeObject
} from '@/app/smylr-component-library/code-object-canvas'
import { fitSmylrPageToViewport } from '@/app/smylr-production/workspace'
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
import AppInput from '@/components/ui/AppInput.vue'
import AssetVariantDropdown from '@/components/assets/AssetVariantDropdown.vue'
import BoardExperienceAssets from '@/components/assets/BoardExperienceAssets.vue'
import CodeObjectAssets from '@/components/assets/CodeObjectAssets.vue'
import type {
  AssetVariant,
  ComputedAsset,
  InteractiveAsset,
  InventoryAsset,
  LocalAsset
} from '@/components/assets/types'
import { useButtonUI } from '@/components/ui/button'
import { useDialogUI } from '@/components/ui/dialog'

const { scope = 'global', workspace = false } = defineProps<{
  scope?: 'global' | 'project'
  workspace?: boolean
}>()
const emit = defineEmits<{ assetInserted: [nodeId: string] }>()
const query = defineModel<string>('query', { default: '' })
const editor = useEditorStore()
const { panels } = useI18n()
const detailsOpen = ref(false)
const selectedAssetId = ref<string | null>(null)
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
type AssetGroupId = 'features' | 'layout' | 'primitives' | 'shared'
type AssetGroup = {
  assets: LocalAsset[]
  id: AssetGroupId
  label: string
}
const expandedGroups = ref<Record<AssetGroupId, boolean>>({
  features: false,
  layout: false,
  primitives: false,
  shared: false
})

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

const computedAssets = computed<ComputedAsset[]>(() => {
  return SMYLR_COMPUTED_ASSETS.map((asset) => ({
    ...asset,
    id: `smylr-computed:${asset.fixtureId}`,
    kind: 'computed' as const,
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
    sourceLibraryKey: 'smylr-computed' as const,
    description: `Live from ${asset.sourcePath}`
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
    name: asset.componentNames[0] ?? asset.sourcePath.split('/').at(-1) ?? asset.sourcePath,
    catalogVariantAxes: asset.variantAxes,
    variantAxes: asset.variantAxes.map((name) => ({ name, values: [] })),
    variantCount: 0,
    sourceLibraryKey: 'smylr-inventory' as const,
    description:
      asset.componentNames.length === 1
        ? `Source component from ${asset.sourcePath}`
        : `${asset.componentNames.length} exported components from ${asset.sourcePath}`
  }))
)

const assets = computed<LocalAsset[]>(() =>
  [...computedAssets.value, ...inventoryAssets.value].sort((a, b) =>
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

const scopedAssets = computed(() => (scope === 'project' ? [] : assets.value))

const filteredAssets = computed(() => {
  const normalized = query.value.trim().toLowerCase()
  if (!normalized) return scopedAssets.value
  return scopedAssets.value.filter((asset) =>
    assetSearchValues(asset).some((value) => value?.toLowerCase().includes(normalized))
  )
})

const filteredCodeObjectCount = computed(() =>
  scope === 'global' ? codeObjectPresetsForQuery(query.value).length : 0
)
const filteredBoardExperienceCount = computed(
  () => (scope === 'global' ? boardExperienceDefinitionsForQuery(query.value).length : 0)
)

const assetCountLabel = computed(() => {
  const count =
    filteredAssets.value.length +
    filteredCodeObjectCount.value +
    filteredBoardExperienceCount.value
  if (query.value.trim()) return `${count} ${count === 1 ? 'result' : 'results'}`
  return `${count} total`
})

const assetCoverageLabel = computed(() => {
  const liveCount =
    filteredAssets.value.filter(isInteractiveAsset).length +
    filteredCodeObjectCount.value +
    filteredBoardExperienceCount.value
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
  if (asset.kind === 'computed') {
    return inventoryGroupId(asset.inventoryLayer)
  }
  return inventoryGroupId(asset.layer)
}

const assetGroups = computed<AssetGroup[]>(() => {
  const groups: AssetGroup[] = [
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
  return asset.kind === 'computed'
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

function openDetails(asset: LocalAsset) {
  selectedAssetId.value = asset.id
  detailsOpen.value = true
}

async function openLiveComponentAsset(asset: ComputedAsset, variantId?: string) {
  const openId = variantId ? `${asset.id}:${variantId}` : asset.id
  if (openingAssetId.value) return
  openingAssetId.value = openId
  assetOpenError.value = null
  const variant = asset.variants.find((candidate) => candidate.id === variantId)
  const displayName = variant ? `${asset.name} ${variant.label}` : asset.name
  toast.info(`Opening the ${displayName} Code Object…`)
  try {
    const { page, frame } = ensureSmylrComponentCodeObjectCanvas(editor, asset, variantId)
    await editor.switchPage(page.id)
    editor.state.enteredContainerId = null
    editor.select([frame.id])
    await nextTick()
    await fitSmylrPageToViewport(editor, [frame.id], { settle: false })
    toast.info(`${displayName} Code Object opened`)
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
    const frame = placeSmylrComponentCodeObject(editor, asset, undefined, center.x, center.y)
    emit('assetInserted', frame.id)
  }
}

async function insertSelectedAsset() {
  if (!selectedAsset.value) return
  await insertAsset(selectedAsset.value)
  detailsOpen.value = false
}
</script>

<template>
  <section data-test-id="assets-panel" class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header
      v-if="!workspace"
      class="flex shrink-0 items-center justify-between gap-2 px-3 pt-2 pb-1.5"
    >
      <span class="shrink-0 text-[11.5px] leading-4 font-semibold text-surface"> Assets </span>
      <div class="flex items-center gap-1">
        <span
          data-test-id="computed-assets-count"
          class="ml-1 whitespace-nowrap text-[9px] text-muted/70"
        >
          {{ assetCountLabel }}
        </span>
      </div>
    </header>
    <div v-if="!workspace || assetOpenError" class="shrink-0 px-3 pb-2">
      <AppInput
        v-if="!workspace"
        v-model="query"
        type="search"
        data-test-id="assets-search"
        size="sm"
        placeholder="Search assets"
        class="rounded-[5px] bg-transparent"
      />
      <p
        v-if="!workspace"
        data-test-id="assets-coverage-summary"
        class="px-1 pt-1 text-[9px] text-muted/70"
      >
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
      <template v-if="scope === 'global'">
        <BoardExperienceAssets :query="query" />
        <CodeObjectAssets :query="query" @asset-inserted="emit('assetInserted', $event)" />
      </template>

      <div
        v-if="workspace && scope === 'project' && assetGroups.length === 0"
        data-test-id="assets-project-empty"
        class="px-3 py-8 text-center text-[11px] leading-5 text-muted"
      >
        <div class="font-medium text-surface/80">No project assets yet</div>
        <div>Project Code Object modalities will appear here.</div>
      </div>

      <section v-for="group in assetGroups" :key="group.id" class="mb-1">
        <button
          type="button"
          data-test-id="asset-group-trigger"
          :data-asset-group="group.id"
          :aria-expanded="groupIsOpen(group.id)"
          class="text-muted hover:text-surface flex w-full items-center gap-1.5 px-2 py-1.5 text-left font-medium"
          :class="workspace ? 'h-8 text-[11px]' : 'text-[9.5px] tracking-wide uppercase'"
          @click="toggleGroup(group.id)"
        >
          <IconlyIcon
            name="arrow-right"
            class="size-3 transition-transform"
            :class="groupIsOpen(group.id) ? 'rotate-90' : ''"
          />
          <icon-lucide-folder-open v-if="groupIsOpen(group.id)" class="text-component size-3" />
          <IconlyIcon name="folder" v-else class="text-component size-3" />
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
                    v-else
                    class="text-component size-3.5 shrink-0"
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
                  </span>
                  <span
                    data-test-id="asset-variants-trigger"
                    class="text-muted/70 group-hover/asset-open:text-component flex size-5 shrink-0 items-center justify-center transition-colors"
                    aria-hidden="true"
                  >
                    <IconlyIcon
                      name="arrow-down"
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
                  <IconlyIcon name="plus" class="size-3" />
                  Add Code Object
                </button>
                <button
                  type="button"
                  aria-label="Component details"
                  data-test-id="asset-details"
                  class="text-muted hover:text-surface flex items-center gap-1 transition-colors"
                  @click.stop="openDetails(asset)"
                >
                  <IconlyIcon name="info" class="size-3" />
                  Details
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
        v-if="
          filteredAssets.length === 0 &&
          filteredCodeObjectCount === 0 &&
          filteredBoardExperienceCount === 0
        "
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
              <icon-lucide-box class="text-component size-4 shrink-0" />
              <div class="min-w-0">
                <DialogTitle :class="dialog.title" class="truncate">{{
                  selectedAsset.name
                }}</DialogTitle>
                <p class="text-muted mt-0.5 text-[11px]">
                  {{
                    selectedAsset.kind === 'computed'
                      ? 'Live Code Object'
                      : `Source component · ${sourceOnlyStatus(selectedAsset)}`
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
                <div class="text-center">
                  <icon-lucide-box class="text-component mx-auto size-8" />
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
                    ? 'Insert Code Object'
                    : 'Needs live fixture'
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

  </section>
</template>
