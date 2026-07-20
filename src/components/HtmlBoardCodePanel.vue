<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { htmlBoardRegisteredComponentsForSlot } from '@/app/html-board/components'
import {
  HTML_BOARD_SCHEMA_VERSION,
  addHtmlBoardComment,
  approveHtmlBoardChangeSet,
  clearHtmlBoardSourceBindingsForCurrentRevision,
  createHtmlBoardChangeSet,
  createHtmlBoardBranch,
  createHtmlBoardFlowState,
  focusHtmlBoardWorkflow,
  htmlBoardComments,
  htmlBoardContent,
  htmlBoardCssTokens,
  htmlBoardDocument,
  htmlBoardElementSelection,
  htmlBoardHandoff,
  htmlBoardImplementationRequest,
  htmlBoardSourceBindingsForCurrentRevision,
  htmlBoardViewportInsets,
  htmlBoardViewportStyleScope,
  htmlBoardWorkflow,
  htmlBoardWorkflowStatusLabel,
  insertHtmlBoardRegisteredComponent,
  isHtmlBoardFrame,
  markHtmlBoardChangeSetWorkspaceChecked,
  markHtmlBoardPreferred,
  requestHtmlBoardReview,
  updateHtmlBoardFrame,
  updateHtmlBoardComponentProp,
  updateHtmlBoardStyleOverride,
  updateHtmlBoardTokenOverride,
  updateHtmlBoardViewport,
  upsertHtmlBoardSourceBinding
} from '@/app/html-board/workspace'
import type { HtmlBoardSourceBindingKind } from '@/app/html-board/workspace'
import AppTextButton from '@/components/ui/AppTextButton.vue'
import Tip from '@/components/ui/Tip.vue'

const store = useEditorStore()
const { copy: copyWorkflowHandoff } = useClipboard({ copiedDuring: 2000 })
const sourceTab = ref<'css' | 'html' | 'js'>('html')
const html = ref('')
const css = ref('')
const js = ref('')
const savedHtml = ref('')
const savedCss = ref('')
const savedJs = ref('')
const showAdvancedStyles = ref(false)
const showTokens = ref(false)
const showWorkflowActions = ref(false)
const showSource = ref(false)
const showSourceMapping = ref(false)
const handoffMessage = ref('')
const commentDraft = ref('')
const acceptanceDraft = ref(
  'Visual matches the Preferred revision; Responsive states remain usable; Interaction behavior passes focused tests'
)
const sourceKindDraft = ref<HtmlBoardSourceBindingKind>('component')
const sourceRepositoryDraft = ref('Smylr-Elite')
const sourceFileDraft = ref('')
const sourceSymbolDraft = ref('')
const tokenDrafts = ref<Record<string, string>>({})
const componentPropDrafts = ref<Record<string, string>>({})
const displayValue = ref('block')
const gapValue = ref('normal')
const paddingValue = ref('0px')
const fontSizeValue = ref('16px')
const colorValue = ref('rgb(0, 0, 0)')
const backgroundColorValue = ref('rgba(0, 0, 0, 0)')
const borderRadiusValue = ref('0px')
const styleBaseline = ref('')
const slotComponentChoiceId = ref('')

const viewportPresets = [
  { height: 900, label: 'Desktop', width: 1440 },
  { height: 1024, label: 'Tablet', width: 768 },
  { height: 844, label: 'Phone', width: 390 }
] as const

const board = computed(() => {
  void store.state.sceneVersion
  const ids = [...store.state.selectedIds]
  if (ids.length !== 1) return null
  const node = store.graph.getNode(ids[0])
  return isHtmlBoardFrame(node) ? node : null
})

const signature = computed(() => {
  const node = board.value
  return node ? `${node.id}:${store.state.sceneVersion}` : ''
})

const dirty = computed(() => {
  return (
    html.value !== savedHtml.value || css.value !== savedCss.value || js.value !== savedJs.value
  )
})

const boardRevision = computed(() => {
  void store.state.sceneVersion
  return board.value ? htmlBoardDocument(board.value).revision : 0
})

const workflow = computed(() => {
  void store.state.sceneVersion
  return board.value ? htmlBoardWorkflow(board.value) : null
})

const workflowStatus = computed(() => {
  const status = workflow.value?.status
  if (!status) return ''
  return status === 'production' ? 'Production protected' : htmlBoardWorkflowStatusLabel(status)
})

const workflowStatusClass = computed(() => {
  const status = workflow.value?.status
  if (status === 'production' || status === 'verified') return 'bg-emerald-500/10 text-emerald-300'
  if (status === 'in-review' || status === 'approved') return 'bg-amber-500/10 text-amber-300'
  if (status === 'preferred' || status === 'change-set') return 'bg-blue-500/10 text-blue-300'
  return 'bg-violet-500/10 text-violet-300'
})

const workflowOrigin = computed(() => {
  const origin = workflow.value?.origin
  return origin ? `from ${origin.boardId} · r${origin.revision}` : 'canonical board'
})

const canRequestReview = computed(() => workflow.value?.status === 'draft')
const canEditDesign = computed(() =>
  ['draft', 'in-review', 'preferred'].includes(workflow.value?.status ?? '')
)
const comments = computed(() => {
  void store.state.sceneVersion
  return board.value ? htmlBoardComments(board.value) : []
})
const commentSummary = computed(() =>
  comments.value.length === 1 ? '1 comment' : `${comments.value.length} comments`
)
const canMarkPreferred = computed(() => workflow.value?.status === 'in-review')
const canCreateChangeSet = computed(() => workflow.value?.status === 'preferred')
const currentSourceBindings = computed(() => {
  void store.state.sceneVersion
  return board.value ? htmlBoardSourceBindingsForCurrentRevision(board.value) : []
})
const sourceTargetSummary = computed(() => {
  const first = currentSourceBindings.value[0]
  if (!first) return 'Unmapped'
  const suffix =
    currentSourceBindings.value.length > 1 ? ` +${currentSourceBindings.value.length - 1}` : ''
  return `${first.repository}/${first.filePath}${suffix}`
})
const hasRepositoryVerifiedSource = computed(() =>
  currentSourceBindings.value.some((binding) => binding.verification === 'repository-verified')
)
const canApproveChangeSet = computed(
  () => workflow.value?.status === 'change-set' && workflow.value.changeSet?.status === 'proposed'
)
const canCheckChangeSet = computed(
  () => workflow.value?.status === 'approved' && workflow.value.changeSet?.status === 'approved'
)
const canCopyImplementationRequest = computed(
  () => workflow.value?.changeSet?.status === 'workspace-checked'
)

const elementSelection = computed(() => {
  if (!board.value || htmlBoardElementSelection.value?.boardId !== board.value.id) return null
  return htmlBoardElementSelection.value
})

const componentPropEntries = computed(() => {
  const selection = elementSelection.value
  if (!selection) return []
  return Object.entries(selection.componentProps)
    .flatMap(([name, value]) => {
      const control = selection.componentControls[name]
      return control && control.binding !== 'metadata' ? [{ control, name, value }] : []
    })
    .slice(0, 4)
})

const slotComponents = computed(() => {
  const selection = elementSelection.value
  return selection?.slotName ? htmlBoardRegisteredComponentsForSlot(selection.slotAccepts) : []
})
const slotComponentChoice = computed(() =>
  slotComponents.value.find((component) => component.id === slotComponentChoiceId.value)
)

watch(
  slotComponents,
  (components) => {
    if (!components.some((component) => component.id === slotComponentChoiceId.value)) {
      slotComponentChoiceId.value = components[0]?.id ?? ''
    }
  },
  { immediate: true }
)

const designTokens = computed(() => htmlBoardCssTokens(savedCss.value))
const visibleTokens = computed(() => designTokens.value.slice(0, 8))

const selectedStyleRows = computed(() => {
  const selection = elementSelection.value
  if (!selection) return []
  const styles = selection.styles
  return [
    {
      label: 'Layout',
      value: [styles.display, styles.position].filter(Boolean).join(' · ')
    },
    {
      label: 'Size',
      value: `${Math.round(selection.rect.width)} × ${Math.round(selection.rect.height)}`
    },
    {
      label: 'Spacing',
      value: [styles.gap && `gap ${styles.gap}`, styles.padding && `pad ${styles.padding}`]
        .filter(Boolean)
        .join(' · ')
    },
    {
      label: 'Type',
      value: [styles['font-size'], styles['font-weight'], styles['line-height']]
        .filter(Boolean)
        .join(' / ')
    }
  ].filter((row) => row.value)
})

const styleScope = computed(() => {
  void store.state.sceneVersion
  return board.value ? htmlBoardViewportStyleScope(board.value) : 'base'
})

const styleScopeName = computed(() => {
  if (styleScope.value === 'phone') return 'Phone only'
  if (styleScope.value === 'tablet') return 'Tablet only'
  return 'Desktop base'
})

const styleDraftSignature = computed(() => {
  return [
    displayValue.value,
    gapValue.value,
    paddingValue.value,
    fontSizeValue.value,
    colorValue.value,
    backgroundColorValue.value,
    borderRadiusValue.value
  ].join('|')
})

const styleDirty = computed(() => {
  return Boolean(elementSelection.value && styleDraftSignature.value !== styleBaseline.value)
})

watch(
  () => {
    const selection = elementSelection.value
    if (!selection) return ''
    return [
      selection.boardId,
      selection.selector,
      selection.styles.display,
      selection.styles.gap,
      selection.styles.padding,
      selection.styles['font-size'],
      selection.styles.color,
      selection.styles['background-color'],
      selection.styles['border-radius']
    ].join('|')
  },
  () => {
    const selection = elementSelection.value
    if (!selection) return
    showAdvancedStyles.value = false
    displayValue.value = selection.styles.display || 'block'
    gapValue.value = selection.styles.gap || 'normal'
    paddingValue.value = selection.styles.padding || '0px'
    fontSizeValue.value = selection.styles['font-size'] || '16px'
    colorValue.value = selection.styles.color || 'rgb(0, 0, 0)'
    backgroundColorValue.value = selection.styles['background-color'] || 'rgba(0, 0, 0, 0)'
    borderRadiusValue.value = selection.styles['border-radius'] || '0px'
    styleBaseline.value = styleDraftSignature.value
  },
  { immediate: true }
)

watch(
  signature,
  () => {
    if (!board.value) return
    const content = htmlBoardContent(board.value)
    html.value = content.html
    css.value = content.css
    js.value = content.js
    savedHtml.value = content.html
    savedCss.value = content.css
    savedJs.value = content.js
  },
  { immediate: true }
)

watch(
  () => JSON.stringify(elementSelection.value?.componentProps ?? {}),
  () => {
    componentPropDrafts.value = { ...elementSelection.value?.componentProps }
  },
  { immediate: true }
)

watch(
  () => `${board.value?.id ?? ''}:${workflow.value?.status ?? ''}`,
  () => {
    showSource.value = false
    showSourceMapping.value = false
  },
  { immediate: true }
)

function updateBoard() {
  if (!board.value || !dirty.value) return
  if (!updateHtmlBoardFrame(store, board.value.id, html.value, css.value, js.value)) return
  savedHtml.value = html.value
  savedCss.value = css.value
  savedJs.value = js.value
}

function createBranch() {
  if (!board.value) return
  createHtmlBoardBranch(store, board.value.id)
  showWorkflowActions.value = false
}

function createFlowState() {
  if (!board.value) return
  createHtmlBoardFlowState(store, board.value.id)
  showWorkflowActions.value = false
}

function fitWorkflow() {
  if (!board.value || dirty.value) return
  focusHtmlBoardWorkflow(store, board.value.id)
  showWorkflowActions.value = false
}

function sendToReview() {
  if (!board.value || !requestHtmlBoardReview(store, board.value.id)) return
  handoffMessage.value = 'Review attached to this revision'
}

function addComment() {
  if (!board.value || !commentDraft.value.trim()) return
  if (!addHtmlBoardComment(store, board.value.id, commentDraft.value)) return
  commentDraft.value = ''
  handoffMessage.value = ''
}

function markPreferred() {
  if (!board.value || !markHtmlBoardPreferred(store, board.value.id)) return
  handoffMessage.value = 'Preferred decision recorded on the exact revision'
}

function mapSourceTarget() {
  if (!board.value) return
  if (
    !upsertHtmlBoardSourceBinding(store, board.value.id, {
      filePath: sourceFileDraft.value,
      kind: sourceKindDraft.value,
      repository: sourceRepositoryDraft.value,
      route: '',
      selector: '',
      symbol: sourceSymbolDraft.value
    })
  ) {
    return
  }
  handoffMessage.value = 'Source target declared · repository check still required'
  showSourceMapping.value = false
}

function clearSourceTargets() {
  if (!board.value || !clearHtmlBoardSourceBindingsForCurrentRevision(store, board.value.id)) return
  handoffMessage.value = 'Source target cleared'
}

function makeChangeSet() {
  if (!board.value) return
  const criteria = acceptanceDraft.value.split(';').map((value) => value.trim())
  if (!createHtmlBoardChangeSet(store, board.value.id, criteria)) return
  handoffMessage.value = 'Proposal created · source unchanged'
}

function approveChangeSet() {
  if (!board.value || !approveHtmlBoardChangeSet(store, board.value.id)) return
  handoffMessage.value = 'Approved for implementation planning · source unchanged'
}

function checkChangeSet() {
  if (!board.value || !markHtmlBoardChangeSetWorkspaceChecked(store, board.value.id)) return
  handoffMessage.value = 'Workspace checked · source application and tests still required'
}

async function copyImplementationRequest() {
  if (!board.value) return
  const result = htmlBoardImplementationRequest(board.value)
  if (!result.ok || !result.request) {
    handoffMessage.value = result.reasons[0] ?? 'Implementation request is not ready'
    return
  }
  await copyWorkflowHandoff(JSON.stringify(result.request, null, 2))
  handoffMessage.value = 'Implementation request copied · visible diff and authorization required'
}

async function copyHandoff() {
  if (!board.value) return
  const text = JSON.stringify(htmlBoardHandoff(board.value), null, 2)
  await copyWorkflowHandoff(text)
  handoffMessage.value = 'Handoff copied · source unchanged'
}

watch(
  designTokens,
  (tokens) => {
    tokenDrafts.value = Object.fromEntries(tokens.map((token) => [token.name, token.value]))
  },
  { immediate: true }
)

function applyToken(name: string, currentValue: string) {
  const value = tokenDrafts.value[name]?.trim() ?? ''
  if (!board.value || dirty.value || !value || value === currentValue) return
  if (!updateHtmlBoardTokenOverride(store, board.value.id, name, value)) {
    tokenDrafts.value[name] = currentValue
  }
}

function applyComponentProp(name: string, currentValue: string) {
  const selection = elementSelection.value
  const value = componentPropDrafts.value[name] ?? ''
  if (!board.value || !selection?.componentName || !canEditDesign.value || value === currentValue) {
    return
  }
  if (
    !updateHtmlBoardComponentProp(
      store,
      board.value.id,
      selection.componentName,
      name,
      value,
      selection.componentId
    )
  ) {
    componentPropDrafts.value[name] = currentValue
    return
  }
  htmlBoardElementSelection.value = {
    ...selection,
    componentProps: { ...selection.componentProps, [name]: value }
  }
}

function addComponentToSlot(registeredComponentId: string, label: string) {
  const selection = elementSelection.value
  if (
    !board.value ||
    !selection?.slotName ||
    !canEditDesign.value ||
    dirty.value ||
    !insertHtmlBoardRegisteredComponent(
      store,
      board.value.id,
      selection.slotName,
      registeredComponentId
    )
  ) {
    return
  }
  htmlBoardElementSelection.value = {
    ...selection,
    slotChildCount: selection.slotChildCount + 1
  }
  handoffMessage.value = `${label} added to ${selection.slotLabel || selection.slotName}`
}

function addChosenSlotComponent() {
  const component = slotComponentChoice.value
  if (component) addComponentToSlot(component.id, component.label)
}

function componentControlOptions(entry: (typeof componentPropEntries.value)[number]) {
  const declared = entry.control.type === 'boolean' ? ['true', 'false'] : entry.control.options
  return [...new Set([entry.value, ...declared])]
}

function tokenLooksLikeColor(value: string) {
  return /^(#|rgb|hsl|oklch|color\()/i.test(value.trim())
}

function setViewport(preset: (typeof viewportPresets)[number]) {
  if (!board.value) return
  if (
    !updateHtmlBoardViewport(
      store,
      board.value.id,
      { height: preset.height, width: preset.width },
      `Set HTML board to ${preset.label}`
    )
  ) {
    return
  }
  requestAnimationFrame(() => store.zoomToSelection(htmlBoardViewportInsets()))
}

function applyElementStyle() {
  const selection = elementSelection.value
  if (!board.value || !selection || !styleDirty.value) return
  const draftEntries = [
    ['display', displayValue.value],
    ['font-size', fontSizeValue.value],
    ['gap', gapValue.value],
    ['padding', paddingValue.value],
    ['color', colorValue.value],
    ['background-color', backgroundColorValue.value],
    ['border-radius', borderRadiusValue.value]
  ] as const
  const declarations = Object.fromEntries(
    draftEntries.filter(([property, value]) => selection.styles[property] !== value)
  )
  if (Object.keys(declarations).length === 0) return
  if (
    !updateHtmlBoardStyleOverride(
      store,
      board.value.id,
      selection.selector,
      declarations,
      styleScope.value
    )
  ) {
    return
  }
  htmlBoardElementSelection.value = {
    ...selection,
    styles: { ...selection.styles, ...declarations }
  }
  styleBaseline.value = styleDraftSignature.value
}

function isActiveViewport(preset: (typeof viewportPresets)[number]) {
  return board.value?.width === preset.width && board.value?.height === preset.height
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-test-id="html-board-code-panel">
    <div class="border-b border-border px-3 py-3">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-baseline gap-2">
          <div class="shrink-0 text-xs font-medium text-surface">HTML board</div>
          <div class="truncate text-[10px] text-muted">
            r{{ boardRevision }} · v{{ HTML_BOARD_SCHEMA_VERSION }}
          </div>
        </div>
      </div>
      <div class="mt-2 flex items-center justify-between gap-2">
        <span
          class="min-w-0 truncate rounded-full px-2 py-1 text-[10px] font-medium"
          :class="workflowStatusClass"
        >
          {{ workflowStatus }}
        </span>
        <button
          v-if="designTokens.length"
          type="button"
          class="shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-[10px] text-muted transition hover:bg-white/5 hover:text-surface"
          data-test-id="html-board-token-toggle"
          @click="showTokens = !showTokens"
        >
          {{ designTokens.length }} tokens
        </button>
      </div>
      <div class="mt-3 grid grid-cols-3 gap-1 rounded-lg bg-black/20 p-1">
        <button
          v-for="preset in viewportPresets"
          :key="preset.label"
          type="button"
          class="rounded-md px-1.5 py-1 text-[10px] transition"
          :class="
            isActiveViewport(preset)
              ? 'bg-white/10 text-surface shadow-sm'
              : 'text-muted hover:bg-white/5 hover:text-surface'
          "
          :data-test-id="`html-board-viewport-${preset.label.toLowerCase()}`"
          :disabled="dirty || !canEditDesign"
          @click="setViewport(preset)"
        >
          {{ preset.label }}
        </button>
      </div>
      <div class="mt-2.5 border-t border-border pt-2.5">
        <div class="flex items-center justify-between gap-2">
          <div class="truncate text-[9px] text-muted">{{ workflowOrigin }}</div>
          <button
            type="button"
            class="shrink-0 text-[9px] font-medium text-surface/70 transition hover:text-surface disabled:opacity-35"
            data-test-id="html-board-fit-workflow"
            :disabled="dirty"
            @click="fitWorkflow"
          >
            Fit flow
          </button>
        </div>
        <div class="mt-1.5 grid grid-cols-[1fr_1fr_auto] items-center gap-2 text-[10px]">
          <button
            type="button"
            class="text-left font-medium text-surface/80 transition hover:text-surface disabled:opacity-35"
            data-test-id="html-board-create-branch"
            :disabled="dirty"
            @click="createBranch"
          >
            Edit branch
          </button>
          <button
            type="button"
            class="text-left font-medium text-surface/80 transition hover:text-surface disabled:opacity-35"
            data-test-id="html-board-create-flow-state"
            :disabled="dirty"
            @click="createFlowState"
          >
            Next state
          </button>
          <button
            type="button"
            class="text-muted transition hover:text-surface"
            data-test-id="html-board-workflow-more"
            @click="showWorkflowActions = !showWorkflowActions"
          >
            •••
          </button>
        </div>
      </div>
      <div
        v-if="showWorkflowActions"
        class="mt-2 space-y-2 border-t border-border pt-2 text-[10px]"
        data-test-id="html-board-decision-controls"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-[9px] text-muted">
            {{ handoffMessage || `Exact revision · ${commentSummary}` }}
          </span>
          <div class="flex shrink-0 items-center gap-2">
            <button
              type="button"
              class="text-surface/80 transition hover:text-surface disabled:opacity-35"
              data-test-id="html-board-request-review"
              :disabled="!canRequestReview || dirty"
              @click="sendToReview"
            >
              Review
            </button>
            <button
              type="button"
              class="text-surface/80 transition hover:text-surface disabled:opacity-35"
              data-test-id="html-board-copy-handoff"
              :disabled="dirty"
              @click="copyHandoff"
            >
              Copy handoff
            </button>
          </div>
        </div>
        <div v-if="canMarkPreferred" class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[9px] text-muted">Decision only · source safe</span>
          <button
            type="button"
            class="shrink-0 whitespace-nowrap font-medium text-blue-300 transition hover:text-blue-200"
            data-test-id="html-board-mark-preferred"
            @click="markPreferred"
          >
            Mark Preferred
          </button>
        </div>
        <div v-if="canCreateChangeSet" class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 text-[9px] text-muted">
                <span>Source target</span>
                <span
                  v-if="hasRepositoryVerifiedSource"
                  class="rounded-full bg-emerald-400/10 px-1.5 py-0.5 font-medium text-emerald-300"
                  data-test-id="html-board-source-verified"
                >
                  Verified
                </span>
              </div>
              <Tip :label="sourceTargetSummary">
                <span class="block truncate text-[10px] text-surface/80">
                  {{ sourceTargetSummary }}
                </span>
              </Tip>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="text-blue-300 transition hover:text-blue-200"
                data-test-id="html-board-toggle-source-map"
                @click="showSourceMapping = !showSourceMapping"
              >
                {{ currentSourceBindings.length ? 'Add' : 'Map' }}
              </button>
              <button
                v-if="currentSourceBindings.length"
                type="button"
                class="text-muted transition hover:text-surface"
                data-test-id="html-board-clear-source-map"
                @click="clearSourceTargets"
              >
                Clear
              </button>
            </div>
          </div>
          <div v-if="showSourceMapping" class="space-y-1.5 border-l border-blue-400/30 pl-2">
            <div class="grid grid-cols-[92px_1fr] gap-1.5">
              <select
                v-model="sourceKindDraft"
                class="h-7 rounded border border-border bg-black/15 px-1.5 text-[10px] text-surface outline-none focus:border-accent"
                data-test-id="html-board-source-kind"
              >
                <option value="component">Component</option>
                <option value="page">Page</option>
                <option value="stylesheet">Stylesheet</option>
                <option value="token">Token</option>
              </select>
              <input
                v-model="sourceRepositoryDraft"
                class="h-7 min-w-0 rounded border border-border bg-black/15 px-1.5 text-[10px] text-surface outline-none focus:border-accent"
                data-test-id="html-board-source-repository"
                placeholder="Repository"
              />
            </div>
            <input
              v-model="sourceFileDraft"
              class="h-7 w-full rounded border border-border bg-black/15 px-1.5 font-mono text-[10px] text-surface outline-none focus:border-accent"
              data-test-id="html-board-source-file"
              placeholder="src/components/Example.tsx"
            />
            <div class="flex items-center gap-2">
              <input
                v-model="sourceSymbolDraft"
                class="h-7 min-w-0 flex-1 rounded border border-border bg-black/15 px-1.5 text-[10px] text-surface outline-none focus:border-accent"
                data-test-id="html-board-source-symbol"
                placeholder="Component or symbol"
              />
              <button
                type="button"
                class="shrink-0 font-medium text-blue-300 transition hover:text-blue-200 disabled:opacity-35"
                data-test-id="html-board-map-source"
                :disabled="!sourceRepositoryDraft.trim() || !sourceFileDraft.trim()"
                @click="mapSourceTarget"
              >
                Attach to r{{ boardRevision }}
              </button>
            </div>
            <div class="text-[9px] text-muted">
              Declared only · repository verification happens with the diff.
            </div>
          </div>
          <input
            v-model="acceptanceDraft"
            class="h-7 w-full border-0 border-b border-border bg-transparent px-0 text-[10px] text-surface outline-none focus:border-accent"
            data-test-id="html-board-acceptance-criteria"
            placeholder="Acceptance criteria, separated by semicolons"
          />
          <button
            type="button"
            class="font-medium text-blue-300 transition hover:text-blue-200 disabled:opacity-35"
            data-test-id="html-board-create-change-set"
            :disabled="currentSourceBindings.length === 0"
            @click="makeChangeSet"
          >
            Create proposal-only change set
          </button>
        </div>
        <div v-if="canApproveChangeSet" class="flex items-center justify-between gap-3">
          <span class="text-[9px] text-muted">No application source changes yet</span>
          <button
            type="button"
            class="font-medium text-amber-300 transition hover:text-amber-200"
            data-test-id="html-board-approve-change-set"
            @click="approveChangeSet"
          >
            Approve plan
          </button>
        </div>
        <div v-if="canCheckChangeSet" class="flex items-center justify-between gap-3">
          <span class="text-[9px] text-muted">Checks identity and acceptance criteria only</span>
          <button
            type="button"
            class="font-medium text-emerald-300 transition hover:text-emerald-200"
            data-test-id="html-board-check-change-set"
            @click="checkChangeSet"
          >
            Check readiness
          </button>
        </div>
        <div v-if="canCopyImplementationRequest" class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[9px] text-muted"
            >Ready for a visible source proposal</span
          >
          <button
            type="button"
            class="shrink-0 whitespace-nowrap font-medium text-emerald-300 transition hover:text-emerald-200"
            data-test-id="html-board-copy-implementation-request"
            @click="copyImplementationRequest"
          >
            Copy implementation request
          </button>
        </div>
        <form class="flex items-center gap-2" @submit.prevent="addComment">
          <input
            v-model="commentDraft"
            class="h-7 min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0 text-[10px] text-surface outline-none focus:border-accent"
            data-test-id="html-board-comment-input"
            :placeholder="`Comment on r${boardRevision}`"
          />
          <button
            type="submit"
            class="shrink-0 text-surface/80 transition hover:text-surface disabled:opacity-35"
            data-test-id="html-board-add-comment"
            :disabled="!commentDraft.trim()"
          >
            Add comment
          </button>
        </form>
      </div>
    </div>

    <div
      v-if="showTokens && visibleTokens.length"
      class="border-b border-border px-3 py-2.5"
      data-test-id="html-board-token-controls"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] font-medium text-surface">Design tokens</span>
        <span class="text-[9px] text-muted">{{
          dirty ? 'Save source first' : 'CSS variables'
        }}</span>
      </div>
      <div class="mt-2 space-y-1.5">
        <label v-for="token in visibleTokens" :key="token.name" class="flex items-center gap-2">
          <span
            v-if="tokenLooksLikeColor(tokenDrafts[token.name] ?? token.value)"
            class="size-3 shrink-0 rounded-sm border border-white/15"
            :style="{ background: tokenDrafts[token.name] ?? token.value }"
          />
          <span v-else class="size-3 shrink-0 rounded-sm border border-white/10 bg-white/5" />
          <Tip :label="token.name">
            <span class="block w-24 shrink-0 truncate font-mono text-[9px] text-muted">
              {{ token.name.replace('--op-', '') }}
            </span>
          </Tip>
          <input
            v-model="tokenDrafts[token.name]"
            class="h-6 min-w-0 flex-1 rounded border border-border bg-black/15 px-1.5 font-mono text-[10px] text-surface outline-none focus:border-accent disabled:opacity-40"
            :disabled="dirty || !canEditDesign"
            :data-test-id="`html-board-token-${token.name.slice(2)}`"
            spellcheck="false"
            @change="applyToken(token.name, token.value)"
            @keyup.enter="applyToken(token.name, token.value)"
          />
        </label>
      </div>
    </div>

    <div
      v-if="elementSelection"
      class="border-b border-border px-3 py-2.5"
      data-test-id="html-board-element-selection"
    >
      <div class="flex items-baseline justify-between gap-2">
        <div class="min-w-0 truncate font-mono text-[11px] font-semibold text-accent">
          &lt;{{ elementSelection.tagName }}&gt;
          <span v-if="elementSelection.id" class="font-normal text-muted"
            >#{{ elementSelection.id }}</span
          >
        </div>
        <span class="shrink-0 text-[10px] text-muted">Selected element</span>
      </div>
      <div
        v-if="elementSelection.componentName"
        class="mt-1.5 flex items-center gap-1.5 text-[10px]"
      >
        <span class="font-medium text-surface">{{ elementSelection.componentName }}</span>
        <span v-if="elementSelection.componentVariant" class="text-muted">
          · {{ elementSelection.componentVariant }}
        </span>
      </div>
      <div class="mt-1 min-w-0">
        <Tip :label="elementSelection.selector">
          <span class="block truncate font-mono text-[10px] text-muted">
            {{ elementSelection.selector }}
          </span>
        </Tip>
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div v-for="row in selectedStyleRows" :key="row.label" class="min-w-0">
          <dt class="text-[9px] uppercase tracking-wide text-muted/70">{{ row.label }}</dt>
          <dd class="min-w-0">
            <Tip :label="row.value">
              <span class="block truncate text-[10px] text-surface">{{ row.value }}</span>
            </Tip>
          </dd>
        </div>
      </dl>
      <div
        v-if="elementSelection.slotName"
        class="mt-3 border-t border-border pt-2.5"
        data-test-id="html-board-slot-controls"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-medium text-surface">
            {{ elementSelection.slotLabel || elementSelection.slotName }}
          </span>
          <span class="text-[9px] text-muted"> {{ elementSelection.slotChildCount }} in slot </span>
        </div>
        <div
          v-if="slotComponents.length > 3"
          class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5"
        >
          <select
            v-model="slotComponentChoiceId"
            class="h-7 min-w-0 rounded-md border border-border bg-black/15 px-1.5 text-[10px] text-surface outline-none focus:border-accent disabled:opacity-40"
            data-test-id="html-board-slot-component-select"
            :disabled="!canEditDesign || dirty"
          >
            <option v-for="component in slotComponents" :key="component.id" :value="component.id">
              {{ component.label }}
            </option>
          </select>
          <button
            type="button"
            class="h-7 rounded-md bg-white/8 px-2.5 text-[10px] font-medium text-surface transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
            data-test-id="html-board-slot-add-selected"
            :disabled="!canEditDesign || dirty || !slotComponentChoice"
            @click="addChosenSlotComponent"
          >
            Add
          </button>
        </div>
        <div v-else-if="slotComponents.length" class="mt-2 flex flex-wrap gap-1.5">
          <button
            v-for="component in slotComponents"
            :key="component.id"
            type="button"
            class="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-surface transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            :data-test-id="`html-board-slot-add-${component.id}`"
            :disabled="!canEditDesign || dirty"
            @click="addComponentToSlot(component.id, component.label)"
          >
            + {{ component.label }}
          </button>
        </div>
      </div>
      <div
        v-if="componentPropEntries.length"
        class="mt-3 border-t border-border pt-2.5"
        data-test-id="html-board-component-controls"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-medium text-surface">Component properties</span>
          <span class="text-[9px] text-muted">Canonical HTML</span>
        </div>
        <div class="mt-2 space-y-2">
          <label
            v-for="entry in componentPropEntries"
            :key="entry.name"
            class="block text-[9px] uppercase tracking-wide text-muted"
          >
            {{ entry.name }}
            <select
              v-if="entry.control.type === 'select' || entry.control.type === 'boolean'"
              v-model="componentPropDrafts[entry.name]"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent disabled:opacity-40"
              :data-test-id="`html-board-component-prop-${entry.name}`"
              :disabled="!canEditDesign"
              @change="applyComponentProp(entry.name, entry.value)"
            >
              <option
                v-for="option in componentControlOptions(entry)"
                :key="option"
                :value="option"
              >
                {{ option }}
              </option>
            </select>
            <input
              v-else
              v-model="componentPropDrafts[entry.name]"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent disabled:opacity-40"
              :data-test-id="`html-board-component-prop-${entry.name}`"
              :disabled="!canEditDesign"
              spellcheck="false"
              @change="applyComponentProp(entry.name, entry.value)"
              @keyup.enter="applyComponentProp(entry.name, entry.value)"
            />
          </label>
        </div>
      </div>
      <div class="mt-3 border-t border-border pt-2.5">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] font-medium text-surface">Visual styles</span>
          <div class="flex items-center gap-2">
            <span class="text-[9px] text-muted">{{ styleScopeName }}</span>
            <button
              type="button"
              class="text-[9px] text-muted transition hover:text-surface"
              data-test-id="html-board-style-more"
              @click="showAdvancedStyles = !showAdvancedStyles"
            >
              {{ showAdvancedStyles ? 'Less' : elementSelection.slotName ? 'Styles' : 'More' }}
            </button>
          </div>
        </div>
        <div v-if="showAdvancedStyles" class="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Text color
            <input
              v-model="colorValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-color"
              spellcheck="false"
            />
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Fill
            <input
              v-model="backgroundColorValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-background"
              spellcheck="false"
            />
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Radius
            <input
              v-model="borderRadiusValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-radius"
              spellcheck="false"
            />
          </label>
        </div>
        <div
          v-if="!elementSelection.slotName || showAdvancedStyles"
          class="mt-2 grid grid-cols-2 gap-x-2 gap-y-2"
        >
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Layout
            <select
              v-model="displayValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-display"
            >
              <option value="block">Block</option>
              <option value="flex">Flex</option>
              <option value="grid">Grid</option>
              <option value="inline-flex">Inline flex</option>
            </select>
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Gap
            <input
              v-model="gapValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-gap"
              spellcheck="false"
            />
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Padding
            <input
              v-model="paddingValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-padding"
              spellcheck="false"
            />
          </label>
          <label class="min-w-0 text-[9px] uppercase tracking-wide text-muted">
            Type size
            <input
              v-model="fontSizeValue"
              class="mt-1 h-7 w-full rounded-md border border-border bg-black/15 px-1.5 text-[10px] normal-case tracking-normal text-surface outline-none focus:border-accent"
              data-test-id="html-board-style-font-size"
              spellcheck="false"
            />
          </label>
        </div>
        <div
          v-if="!elementSelection.slotName || showAdvancedStyles"
          class="mt-2.5 flex justify-end"
        >
          <button
            type="button"
            class="rounded-md px-2.5 py-1 text-[10px] font-medium transition"
            :class="
              styleDirty && canEditDesign
                ? 'bg-accent text-black hover:bg-accent/90'
                : 'cursor-not-allowed bg-white/5 text-muted/50'
            "
            data-test-id="html-board-apply-style"
            :disabled="!styleDirty || !canEditDesign"
            @click="applyElementStyle"
          >
            Apply visual style
          </button>
        </div>
      </div>
    </div>

    <button
      type="button"
      class="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted transition hover:text-surface"
      data-test-id="html-board-source-toggle"
      @click="showSource = !showSource"
    >
      <span>HTML / CSS / JS</span>
      <span>{{ showSource ? 'Hide' : 'Show' }}</span>
    </button>

    <div v-if="showSource" class="flex min-h-0 flex-1 flex-col p-3">
      <div class="mb-2 flex items-center gap-1 border-b border-border">
        <button
          v-for="tabName in ['html', 'css', 'js'] as const"
          :key="tabName"
          type="button"
          class="border-b-2 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide"
          :class="
            sourceTab === tabName
              ? 'border-accent text-surface'
              : 'border-transparent text-muted hover:text-surface'
          "
          @click="sourceTab = tabName"
        >
          {{ tabName }}
        </button>
      </div>

      <textarea
        v-if="sourceTab === 'html'"
        id="html-board-html"
        v-model="html"
        class="min-h-0 flex-1 resize-none rounded-lg border border-border bg-black/15 px-2.5 py-2 font-mono text-xs leading-5 text-surface outline-none focus:border-accent"
        data-test-id="html-board-html"
        :disabled="!canEditDesign"
        spellcheck="false"
      />
      <textarea
        v-else-if="sourceTab === 'css'"
        id="html-board-css"
        v-model="css"
        class="min-h-0 flex-1 resize-none rounded-lg border border-border bg-black/15 px-2.5 py-2 font-mono text-xs leading-5 text-surface outline-none focus:border-accent"
        data-test-id="html-board-css"
        :disabled="!canEditDesign"
        spellcheck="false"
      />
      <textarea
        v-else
        id="html-board-js"
        v-model="js"
        class="min-h-0 flex-1 resize-none rounded-lg border border-border bg-black/15 px-2.5 py-2 font-mono text-xs leading-5 text-surface outline-none focus:border-accent"
        data-test-id="html-board-js"
        :disabled="!canEditDesign"
        spellcheck="false"
      />

      <div class="mt-3 flex items-center justify-between gap-2">
        <span class="text-[11px] text-muted">
          {{
            !canEditDesign
              ? 'Protected · branch to edit'
              : dirty
                ? 'Unsaved source changes'
                : 'Preview is current'
          }}
        </span>
        <AppTextButton
          data-test-id="html-board-update"
          :ui="{
            base:
              dirty && canEditDesign
                ? 'rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-medium text-black hover:bg-accent/90'
                : 'cursor-not-allowed rounded-md px-2.5 py-1.5 text-[11px] opacity-40'
          }"
          :disabled="!dirty || !canEditDesign"
          @click="updateBoard"
        >
          Update live preview
        </AppTextButton>
      </div>
    </div>
  </div>
</template>
