<script setup lang="ts">
import { useDebounceFn, useLocalStorage } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, ref, shallowRef, watch } from 'vue'

import type { MermaidSceneSpec } from '@open-pencil/core/diagram'
import { createMermaidSceneSpec } from '@open-pencil/core/diagram'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import {
  closeMermaidDialog,
  mermaidDialogOpen,
  mermaidDialogTarget
} from '@/app/diagram/mermaid/dialog'
import { parseMermaidInBrowser } from '@/app/diagram/mermaid/parse'
import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { editorViewportInsets } from '@/app/editor/viewport-insets'
import { isHtmlBoardFrame } from '@/app/html-board/workspace'
import { isSmylrLiveAppFrameNode } from '@/app/smylr-production/workspace'
import { useButtonUI } from '@/components/ui/button'
import { useDialogUI } from '@/components/ui/dialog'
import { useInputUI } from '@/components/ui/input'
import MermaidDiagramPreview from '@/components/diagram/MermaidDiagramPreview.vue'

const MERMAID_EXAMPLE = `flowchart TD
  A[Capture intent] --> B{Enough context?}
  B -->|Yes| C[Build native board]
  B -->|No| D[Ask one question]
  D --> A`

const store = useEditorStore()
const { activeTab } = useAIChat()
const savedInsertSource = useLocalStorage('op-mermaid-diagram-source', MERMAID_EXAMPLE)
const source = ref(savedInsertSource.value)
const preview = shallowRef<MermaidSceneSpec | null>(null)
const previewSource = ref('')
const previewMode = ref<'fit' | 'readable'>('readable')
const error = ref('')
const parsing = ref(false)
let parseRequest = 0

const dialog = useDialogUI({
  content: 'flex h-[min(720px,88vh)] w-[min(1040px,94vw)] flex-col overflow-hidden'
})
const input = useInputUI({
  ui: {
    base: 'h-full resize-none rounded-none border-0 bg-transparent p-4 font-mono text-[12px] leading-5 focus:border-0'
  }
})
const cancelButton = useButtonUI({ tone: 'ghost', size: 'md', bordered: true })
const insertButton = useButtonUI({ tone: 'accent', size: 'md' })
const previewButton = useButtonUI({ tone: 'ghost', size: 'sm' })

const previewSummary = computed(() => `${preview.value?.nodes.length ?? 0} editable layers`)
const editingExisting = computed(() => Boolean(mermaidDialogTarget.value?.ownerId))
const upgradingLegacy = computed(() =>
  Boolean(mermaidDialogTarget.value && !mermaidDialogTarget.value.ownerId)
)
const previewReady = computed(
  () => !parsing.value && Boolean(preview.value) && previewSource.value === source.value
)

function overlapsLiveSurface(
  x: number,
  y: number,
  width: number,
  height: number,
  node: Rect
): boolean {
  return (
    x < node.x + node.width && x + width > node.x && y < node.y + node.height && y + height > node.y
  )
}

function insertionPosition(diagram: MermaidSceneSpec): Vector {
  const center = store.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2)
  const desired = {
    x: center.x - diagram.width / 2,
    y: center.y - diagram.height / 2
  }
  const liveSurfaces = store.graph
    .getChildren(store.state.currentPageId)
    .filter((node) => isHtmlBoardFrame(node) || isSmylrLiveAppFrameNode(node))
  const occluding = liveSurfaces.filter((node) =>
    overlapsLiveSurface(desired.x, desired.y, diagram.width, diagram.height, node)
  )
  if (occluding.length === 0) return desired
  return {
    x: Math.max(...occluding.map((node) => node.x + node.width)) + 48,
    y: desired.y
  }
}

function errorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value)
  return message.replaceAll(/\s+/g, ' ').trim().slice(0, 420)
}

async function renderPreview(): Promise<MermaidSceneSpec | null> {
  const request = ++parseRequest
  const definition = source.value
  parsing.value = true
  error.value = ''
  try {
    const next = createMermaidSceneSpec(await parseMermaidInBrowser(definition))
    if (request !== parseRequest) return null
    preview.value = next
    previewSource.value = definition
    return next
  } catch (reason) {
    if (request !== parseRequest) return null
    preview.value = null
    previewSource.value = ''
    error.value = errorMessage(reason)
    return null
  } finally {
    if (request === parseRequest) parsing.value = false
  }
}

const queuePreview = useDebounceFn(() => void renderPreview(), 320, { maxWait: 900 })

watch(source, () => {
  if (!mermaidDialogOpen.value) return
  if (!editingExisting.value && !upgradingLegacy.value) savedInsertSource.value = source.value
  queuePreview()
})

watch(mermaidDialogOpen, (open) => {
  if (open) {
    source.value = mermaidDialogTarget.value?.source ?? savedInsertSource.value
    void renderPreview()
  } else parseRequest++
})

async function submitDiagram(): Promise<void> {
  const diagram =
    preview.value && previewSource.value === source.value ? preview.value : await renderPreview()
  if (!diagram) return

  try {
    const ownerId = mermaidDialogTarget.value?.ownerId
    const nodeIds = ownerId
      ? store.replaceMermaidDiagram(ownerId, diagram)
      : store.insertMermaidDiagram(diagram, insertionPosition(diagram))
    activeTab.value = 'design'
    closeMermaidDialog()
    if (await ensureGraphFonts(store.graph, nodeIds)) store.requestRender()
    requestAnimationFrame(() => {
      store.zoomToReadableSelection(11, editorViewportInsets())
    })
  } catch (reason) {
    error.value = errorMessage(reason)
  }
}
</script>

<template>
  <DialogRoot v-model:open="mermaidDialogOpen">
    <DialogPortal>
      <DialogOverlay :class="dialog.overlay" />
      <DialogContent data-test-id="mermaid-import-dialog" :class="dialog.content">
        <header class="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div>
            <DialogTitle :class="dialog.title">
              {{
                editingExisting
                  ? 'Edit Mermaid source'
                  : upgradingLegacy
                    ? 'Upgrade Mermaid diagram'
                    : 'Insert Mermaid diagram'
              }}
            </DialogTitle>
            <DialogDescription :class="[dialog.description, 'mt-1']">
              {{
                editingExisting
                  ? 'Update the source and redraw this diagram in place.'
                  : upgradingLegacy
                    ? 'Create a grouped interactive copy from this retained source.'
                    : 'Every Mermaid type becomes editable shapes, labels, and lines.'
              }}
            </DialogDescription>
          </div>
          <DialogClose
            data-test-id="mermaid-dialog-close"
            class="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover hover:text-surface"
            aria-label="Close Mermaid dialog"
          >
            <icon-lucide-x class="size-4" />
          </DialogClose>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
          <section class="flex min-h-0 flex-col border-b border-border md:border-r md:border-b-0">
            <div class="flex h-9 shrink-0 items-center border-b border-border px-4">
              <span class="text-[11px] font-medium text-muted">Mermaid source</span>
            </div>
            <textarea
              v-model="source"
              data-test-id="mermaid-source"
              :class="input.base"
              spellcheck="false"
              aria-label="Mermaid source"
            />
          </section>

          <section class="flex min-h-0 flex-col bg-canvas/30">
            <div class="flex h-9 shrink-0 items-center justify-between border-b border-border px-4">
              <span class="text-[11px] font-medium text-muted">Preview</span>
              <div v-if="previewReady" class="flex items-center gap-2">
                <div
                  class="flex items-center rounded-md border border-border bg-panel/40 p-0.5"
                  role="group"
                  aria-label="Preview size"
                >
                  <button
                    type="button"
                    data-test-id="mermaid-preview-fit"
                    :class="[
                      previewButton.base,
                      'h-5 px-1.5 text-[9.5px]',
                      previewMode === 'fit' && 'bg-hover text-surface'
                    ]"
                    @click="previewMode = 'fit'"
                  >
                    Fit
                  </button>
                  <button
                    type="button"
                    data-test-id="mermaid-preview-readable"
                    :class="[
                      previewButton.base,
                      'h-5 px-1.5 text-[9.5px]',
                      previewMode === 'readable' && 'bg-hover text-surface'
                    ]"
                    @click="previewMode = 'readable'"
                  >
                    Readable
                  </button>
                </div>
                <span data-test-id="mermaid-layer-count" class="text-[10px] text-muted">
                  {{ previewSummary }}
                </span>
              </div>
            </div>
            <div class="relative min-h-0 flex-1 p-5">
              <div
                v-if="parsing"
                data-test-id="mermaid-preview-loading"
                class="flex size-full items-center justify-center text-xs text-muted"
              >
                Rendering diagram…
              </div>
              <div
                v-else-if="error"
                data-test-id="mermaid-preview-error"
                class="flex size-full items-center justify-center"
              >
                <div class="max-w-sm rounded-lg border border-red-500/20 bg-red-500/8 p-4">
                  <p class="text-xs font-medium text-red-300">Couldn’t parse this diagram</p>
                  <p class="mt-1.5 text-[11px] leading-4 text-red-200/75">{{ error }}</p>
                </div>
              </div>
              <div
                v-else-if="preview"
                class="flex size-full overflow-auto rounded-lg border border-border bg-canvas p-5 shadow-sm"
              >
                <div
                  v-if="previewMode === 'readable'"
                  data-test-id="mermaid-preview-scroll-content"
                  class="grid h-max w-max min-h-full min-w-full place-items-center"
                >
                  <MermaidDiagramPreview :diagram="preview" mode="readable" />
                </div>
                <MermaidDiagramPreview v-else :diagram="preview" mode="fit" />
              </div>
            </div>
          </section>
        </div>

        <footer class="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <p class="text-[10.5px] text-muted">
            {{
              editingExisting
                ? 'Updating source replaces native part edits with a fresh Mermaid projection.'
                : upgradingLegacy
                  ? 'The existing flat legacy layers stay unchanged until you remove them.'
                  : 'Source and converter revision stay attached to the inserted board layers.'
            }}
          </p>
          <div class="flex items-center gap-2">
            <DialogClose :class="cancelButton.base">Cancel</DialogClose>
            <button
              type="button"
              data-test-id="mermaid-insert"
              :class="insertButton.base"
              :disabled="!previewReady"
              @click="submitDiagram"
            >
              {{
                editingExisting
                  ? 'Update diagram'
                  : upgradingLegacy
                    ? 'Insert upgraded diagram'
                    : 'Insert diagram'
              }}
            </button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
