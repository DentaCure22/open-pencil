<script setup lang="ts">
import { useClipboard } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import {
  HTML_BOARD_SCHEMA_VERSION,
  addHtmlBoardComment,
  approveHtmlBoardChangeSet,
  createHtmlBoardChangeSet,
  createHtmlBoardBranch,
  createHtmlBoardFlowState,
  htmlBoardComments,
  htmlBoardContent,
  htmlBoardCssTokens,
  htmlBoardDocument,
  htmlBoardElementSelection,
  htmlBoardHandoff,
  htmlBoardViewportStyleScope,
  htmlBoardWorkflow,
  htmlBoardWorkflowStatusLabel,
  isHtmlBoardFrame,
  markHtmlBoardChangeSetWorkspaceChecked,
  markHtmlBoardPreferred,
  requestHtmlBoardReview,
  updateHtmlBoardFrame,
  updateHtmlBoardStyleOverride,
  updateHtmlBoardTokenOverride,
  updateHtmlBoardViewport
} from '@/app/html-board/workspace'
import AppTextButton from '@/components/ui/AppTextButton.vue'

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
const handoffMessage = ref('')
const commentDraft = ref('')
const acceptanceDraft = ref(
  'Visual matches the Preferred revision; Responsive states remain usable; Interaction behavior passes focused tests'
)
const tokenDrafts = ref<Record<string, string>>({})
const displayValue = ref('block')
const gapValue = ref('normal')
const paddingValue = ref('0px')
const fontSizeValue = ref('16px')
const colorValue = ref('rgb(0, 0, 0)')
const backgroundColorValue = ref('rgba(0, 0, 0, 0)')
const borderRadiusValue = ref('0px')
const styleBaseline = ref('')

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
  return html.value !== savedHtml.value || css.value !== savedCss.value || js.value !== savedJs.value
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
const canApproveChangeSet = computed(
  () => workflow.value?.status === 'change-set' && workflow.value.changeSet?.status === 'proposed'
)
const canCheckChangeSet = computed(
  () => workflow.value?.status === 'approved' && workflow.value.changeSet?.status === 'approved'
)

const elementSelection = computed(() => {
  if (!board.value || htmlBoardElementSelection.value?.boardId !== board.value.id) return null
  return htmlBoardElementSelection.value
})

const componentPropEntries = computed(() => {
  return Object.entries(elementSelection.value?.componentProps ?? {}).slice(0, 3)
})

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
  requestAnimationFrame(() => store.zoomToSelection())
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
        <div class="min-w-0">
          <div class="text-xs font-medium text-surface">HTML source</div>
          <div class="mt-0.5 text-[11px] leading-4 text-muted">
            r{{ boardRevision }} · schema v{{ HTML_BOARD_SCHEMA_VERSION }}
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            v-if="designTokens.length"
            type="button"
            class="shrink-0 whitespace-nowrap rounded px-1.5 py-1 text-[10px] text-muted transition hover:bg-white/5 hover:text-surface"
            data-test-id="html-board-token-toggle"
            @click="showTokens = !showTokens"
          >
            {{ designTokens.length }} tokens
          </button>
          <span
            class="shrink-0 rounded-full px-2 py-1 text-[10px] font-medium"
            :class="workflowStatusClass"
          >
            {{ workflowStatus }}
          </span>
        </div>
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
      <div class="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <div class="min-w-0 text-[9px] text-muted">
          <span class="truncate">{{ workflowOrigin }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-2 text-[10px]">
          <button
            type="button"
            class="font-medium text-surface/80 transition hover:text-surface disabled:opacity-35"
            data-test-id="html-board-create-branch"
            :disabled="dirty"
            @click="createBranch"
          >
            Edit branch
          </button>
          <button
            type="button"
            class="font-medium text-surface/80 transition hover:text-surface disabled:opacity-35"
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
        <div v-if="canCreateChangeSet" class="space-y-1.5">
          <input
            v-model="acceptanceDraft"
            class="h-7 w-full border-0 border-b border-border bg-transparent px-0 text-[10px] text-surface outline-none focus:border-accent"
            data-test-id="html-board-acceptance-criteria"
            placeholder="Acceptance criteria, separated by semicolons"
          />
          <button
            type="button"
            class="font-medium text-blue-300 transition hover:text-blue-200"
            data-test-id="html-board-create-change-set"
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
        <span class="text-[9px] text-muted">{{ dirty ? 'Save source first' : 'CSS variables' }}</span>
      </div>
      <div class="mt-2 space-y-1.5">
        <label v-for="token in visibleTokens" :key="token.name" class="flex items-center gap-2">
          <span
            v-if="tokenLooksLikeColor(tokenDrafts[token.name] ?? token.value)"
            class="size-3 shrink-0 rounded-sm border border-white/15"
            :style="{ background: tokenDrafts[token.name] ?? token.value }"
          />
          <span v-else class="size-3 shrink-0 rounded-sm border border-white/10 bg-white/5" />
          <span class="w-24 shrink-0 truncate font-mono text-[9px] text-muted" :title="token.name">
            {{ token.name.replace('--op-', '') }}
          </span>
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
          <span v-if="elementSelection.id" class="font-normal text-muted">#{{ elementSelection.id }}</span>
        </div>
        <span class="shrink-0 text-[10px] text-muted">Selected element</span>
      </div>
      <div v-if="elementSelection.componentName" class="mt-1.5 flex items-center gap-1.5 text-[10px]">
        <span class="font-medium text-surface">{{ elementSelection.componentName }}</span>
        <span v-if="elementSelection.componentVariant" class="text-muted">
          · {{ elementSelection.componentVariant }}
        </span>
        <span
          v-for="([name, value]) in componentPropEntries"
          :key="name"
          class="truncate text-muted"
        >
          · {{ name }}={{ value }}
        </span>
      </div>
      <div class="mt-1 truncate font-mono text-[10px] text-muted" :title="elementSelection.selector">
        {{ elementSelection.selector }}
      </div>
      <dl class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        <div v-for="row in selectedStyleRows" :key="row.label" class="min-w-0">
          <dt class="text-[9px] uppercase tracking-wide text-muted/70">{{ row.label }}</dt>
          <dd class="truncate text-[10px] text-surface" :title="row.value">{{ row.value }}</dd>
        </div>
      </dl>
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
              {{ showAdvancedStyles ? 'Less' : 'More' }}
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
        <div class="mt-2 grid grid-cols-2 gap-x-2 gap-y-2">
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
        <div class="mt-2.5 flex justify-end">
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

    <div class="flex min-h-0 flex-1 flex-col p-3">
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
          {{ !canEditDesign ? 'Protected · branch to edit' : dirty ? 'Unsaved source changes' : 'Preview is current' }}
        </span>
        <AppTextButton
          data-test-id="html-board-update"
          :ui="{
            base: dirty && canEditDesign
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
