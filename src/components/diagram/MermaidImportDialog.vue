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

import { closeMermaidDialog, mermaidDialogOpen } from '@/app/diagram/mermaid/dialog'
import { parseMermaidInBrowser } from '@/app/diagram/mermaid/parse'
import { useAIChat } from '@/app/ai/chat/use'
import { useEditorStore } from '@/app/editor/active-store'
import { ensureGraphFonts } from '@/app/editor/fonts'
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
const source = useLocalStorage('op-mermaid-diagram-source', MERMAID_EXAMPLE)
const preview = shallowRef<MermaidSceneSpec | null>(null)
const previewSource = ref('')
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

const previewSummary = computed(() => `${preview.value?.nodes.length ?? 0} editable layers`)
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
  if (mermaidDialogOpen.value) queuePreview()
})

watch(mermaidDialogOpen, (open) => {
  if (open) void renderPreview()
  else parseRequest++
})

async function insertDiagram(): Promise<void> {
  const diagram =
    preview.value && previewSource.value === source.value ? preview.value : await renderPreview()
  if (!diagram) return

  try {
    const nodeIds = store.insertMermaidDiagram(diagram, insertionPosition(diagram))
    activeTab.value = 'design'
    closeMermaidDialog()
    if (await ensureGraphFonts(store.graph, nodeIds)) store.requestRender()
    requestAnimationFrame(() => {
      store.zoomToSelection()
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
            <DialogTitle :class="dialog.title">Insert Mermaid diagram</DialogTitle>
            <DialogDescription :class="[dialog.description, 'mt-1']">
              Every Mermaid type becomes editable shapes, labels, and lines.
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
              <span
                v-if="previewReady"
                data-test-id="mermaid-layer-count"
                class="text-[10px] text-muted"
              >
                {{ previewSummary }}
              </span>
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
                class="size-full overflow-hidden rounded-lg border border-border bg-canvas p-5 shadow-sm"
              >
                <MermaidDiagramPreview :diagram="preview" />
              </div>
            </div>
          </section>
        </div>

        <footer class="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <p class="text-[10.5px] text-muted">
            Source and converter revision stay attached to the inserted board layers.
          </p>
          <div class="flex items-center gap-2">
            <DialogClose :class="cancelButton.base">Cancel</DialogClose>
            <button
              type="button"
              data-test-id="mermaid-insert"
              :class="insertButton.base"
              :disabled="!previewReady"
              @click="insertDiagram"
            >
              Insert diagram
            </button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
