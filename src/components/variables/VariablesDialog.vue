<script setup lang="ts">
import { ref, watch, type Component } from 'vue'
import { templateRef, useFileDialog } from '@vueuse/core'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger
} from 'reka-ui'
import { FlexRender } from '@tanstack/vue-table'

import {
  exportVariablesToDtcg,
  parseDtcgTokens,
  reviewTokenSnapshot,
  type TokenReview,
  type TokenSnapshot
} from '@open-pencil/core/io'
import { variablesAddTestId, vTestId, useI18n, useVariablesEditor } from '@open-pencil/vue'

import IconHash from '~icons/lucide/hash'
import IconPalette from '~icons/lucide/palette'
import IconToggleLeft from '~icons/lucide/toggle-left'
import IconType from '~icons/lucide/type'
import IconX from '~icons/lucide/x'
import ColorInput from '@/components/ColorPicker/ColorInput.vue'
import Tip from '@/components/ui/Tip.vue'
import { downloadBlob } from '@/app/document/io/browser'
import { toast } from '@/app/shell/ui'
import { useDialogUI } from '@/components/ui/dialog'
import { useMenuUI } from '@/components/ui/menu'

import type { VariableType } from '@open-pencil/scene-graph'

const open = defineModel<boolean>('open', { default: false })
const cls = useDialogUI({ content: 'flex h-[75vh] w-[800px] max-w-[90vw] flex-col' })
const reviewCls = useDialogUI({ content: 'flex w-[520px] max-w-[90vw] flex-col' })
const menuCls = useMenuUI({ content: 'w-40' })

const variableTypeIcons: Record<VariableType, Component> = {
  COLOR: IconPalette,
  FLOAT: IconHash,
  STRING: IconType,
  BOOLEAN: IconToggleLeft
}

const { dialogs, panels, variableTypes: variableTypeText } = useI18n()

const variableTypes: Array<{
  type: VariableType
  label: () => string
  description: () => string
}> = [
  {
    type: 'COLOR',
    label: () => variableTypeText.value.color,
    description: () => variableTypeText.value.colorHint
  },
  {
    type: 'FLOAT',
    label: () => variableTypeText.value.number,
    description: () => variableTypeText.value.numberHint
  },
  {
    type: 'STRING',
    label: () => variableTypeText.value.text,
    description: () => variableTypeText.value.textHint
  },
  {
    type: 'BOOLEAN',
    label: () => variableTypeText.value.boolean,
    description: () => variableTypeText.value.booleanHint
  }
]

const ctx = useVariablesEditor({
  colorInput: ColorInput,
  icons: variableTypeIcons,
  fallbackIcon: IconToggleLeft,
  deleteIcon: IconX
})
const collectionInput = templateRef<HTMLInputElement>('collectionInput')
const modeInput = templateRef<HTMLInputElement>('modeInput')
const tokenReviewOpen = ref(false)
const pendingTokenImport = ref<{
  fileName: string
  snapshot: TokenSnapshot
  review: TokenReview
  warnings: string[]
} | null>(null)
const tokenFileDialog = useFileDialog({
  accept: '.json,application/json',
  multiple: false,
  reset: true
})

tokenFileDialog.onChange((files) => {
  const file = files?.[0]
  if (file) void reviewTokenFile(file)
})

watch(collectionInput, (input) => {
  void ctx.collectionRename.focusInput(input)
})
watch(modeInput, (input) => {
  void ctx.modeRename.focusInput(input)
})

function getModeId(columnId: string): string | undefined {
  return columnId.startsWith('mode-') ? columnId.slice(5) : undefined
}

function modeId(columnId: string): string {
  return columnId.slice(5)
}

function exportTokens() {
  const document = exportVariablesToDtcg(ctx.editor.graph)
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2) + '\n')
  downloadBlob(bytes, 'openpencil.tokens.json', 'application/json')
  toast.info('Exported DTCG design tokens')
}

async function reviewTokenFile(file: File) {
  try {
    const result = parseDtcgTokens(await file.text())
    pendingTokenImport.value = {
      fileName: file.name,
      snapshot: result.snapshot,
      review: reviewTokenSnapshot(ctx.editor.graph, result.snapshot),
      warnings: result.warnings
    }
    tokenReviewOpen.value = true
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'Could not read design tokens')
  }
}

function importTokens() {
  tokenFileDialog.open()
}

function applyTokenImport() {
  const pending = pendingTokenImport.value
  if (!pending) return
  ctx.editor.replaceVariablesFromSnapshot(pending.snapshot)
  tokenReviewOpen.value = false
  pendingTokenImport.value = null
  toast.info('Design token changes applied')
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="cls.overlay" />
      <DialogContent
        data-test-id="variables-dialog"
        :aria-describedby="undefined"
        :class="cls.content"
      >
        <DialogTitle class="sr-only">{{ dialogs.localVariables }}</DialogTitle>
        <div v-if="!ctx.hasCollections.value" class="flex flex-1 flex-col">
          <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h2 class="text-sm font-semibold text-surface">{{ dialogs.localVariables }}</h2>
            <DialogClose
              data-test-id="variables-dialog-close"
              aria-label="Close variables"
              class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
            >
              <icon-lucide-x class="size-4" />
            </DialogClose>
          </div>
          <div class="flex flex-1 items-center justify-center">
            <div class="text-center">
              <p class="text-sm text-muted">{{ dialogs.noVariableCollections }}</p>
              <button
                data-test-id="variables-create-collection"
                class="mt-2 cursor-pointer rounded bg-hover px-3 py-1.5 text-xs text-surface hover:bg-border"
                @click="ctx.addCollection"
              >
                {{ dialogs.createCollection }}
              </button>
              <button
                data-test-id="variables-import-dtcg-empty"
                class="ml-2 cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
                @click="importTokens"
              >
                Import DTCG
              </button>
            </div>
          </div>
        </div>

        <template v-else>
          <TabsRoot
            v-model="ctx.activeCollectionId.value"
            class="flex flex-1 flex-col overflow-hidden"
          >
            <div class="flex shrink-0 items-center border-b border-border">
              <TabsList class="flex flex-1 gap-0.5 overflow-x-auto px-3 py-1">
                <template v-for="col in ctx.collections.value" :key="col.id">
                  <input
                    v-if="ctx.collectionRename.editingId.value === col.id"
                    ref="collectionInput"
                    class="w-24 rounded border border-accent bg-input px-2 py-0.5 text-xs text-surface outline-none"
                    :value="col.name"
                    @blur="ctx.collectionRename.commit(col.id, $event)"
                    @keydown="ctx.collectionRename.onKeydown"
                  />
                  <TabsTrigger
                    v-else
                    :value="col.id"
                    data-test-id="variables-collection-tab"
                    class="cursor-pointer rounded border-none px-2.5 py-1 text-xs whitespace-nowrap text-muted data-[state=active]:bg-hover data-[state=active]:text-surface"
                    @dblclick="ctx.startRenameCollection(col.id)"
                  >
                    {{ col.name }}
                  </TabsTrigger>
                </template>
              </TabsList>

              <div class="flex items-center gap-1.5 px-3">
                <Tip label="Import DTCG tokens">
                  <button
                    data-test-id="variables-import-dtcg"
                    aria-label="Import DTCG tokens"
                    class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
                    @click="importTokens"
                  >
                    <icon-lucide-upload class="size-3.5" />
                  </button>
                </Tip>
                <Tip label="Export DTCG tokens">
                  <button
                    data-test-id="variables-export-dtcg"
                    aria-label="Export DTCG tokens"
                    class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
                    @click="exportTokens"
                  >
                    <icon-lucide-download class="size-3.5" />
                  </button>
                </Tip>
                <DropdownMenuRoot>
                  <DropdownMenuTrigger as-child>
                    <button
                      data-test-id="variables-collection-menu"
                      class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
                    >
                      <icon-lucide-ellipsis class="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent
                      side="bottom"
                      :side-offset="4"
                      align="start"
                      :class="menuCls.content"
                    >
                      <DropdownMenuItem
                        :class="menuCls.item"
                        @select="ctx.startRenameCollection(ctx.activeCollectionId.value)"
                      >
                        <icon-lucide-pencil :class="menuCls.icon" />
                        {{ dialogs.renameCollection }}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator class="mx-1.5 my-1 h-px bg-border" />
                      <DropdownMenuItem
                        :class="menuCls.item"
                        class="text-red-500"
                        data-test-id="variables-delete-collection"
                        @select="ctx.removeCollection(ctx.activeCollectionId.value)"
                      >
                        <icon-lucide-trash-2 :class="menuCls.icon" />
                        {{ dialogs.deleteCollection }}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
                <div class="flex items-center gap-1 rounded border border-border px-2 py-0.5">
                  <icon-lucide-search class="size-3 text-muted" />
                  <input
                    v-model="ctx.searchTerm.value"
                    data-test-id="variables-search-input"
                    class="w-24 border-none bg-transparent text-xs text-surface outline-none placeholder:text-muted"
                    :placeholder="dialogs.search"
                  />
                </div>
                <Tip :label="dialogs.createCollection">
                  <button
                    data-test-id="variables-add-collection"
                    class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
                    @click="ctx.addCollection"
                  >
                    <icon-lucide-folder-plus class="size-3.5" />
                  </button>
                </Tip>
                <DialogClose
                  data-test-id="variables-dialog-close"
                  aria-label="Close variables"
                  class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
                >
                  <icon-lucide-x class="size-4" />
                </DialogClose>
              </div>
            </div>

            <TabsContent
              v-for="col in ctx.collections.value"
              :key="col.id"
              :value="col.id"
              class="flex flex-1 flex-col overflow-hidden outline-none"
            >
              <div class="flex-1 overflow-auto">
                <table
                  class="w-full border-collapse"
                  :style="{ width: `${ctx.table.getCenterTotalSize()}px` }"
                >
                  <thead class="sticky top-0 z-10 bg-panel">
                    <tr
                      v-for="headerGroup in ctx.table.getHeaderGroups()"
                      :key="headerGroup.id"
                      class="border-b border-border"
                    >
                      <th
                        v-for="header in headerGroup.headers"
                        :key="header.id"
                        class="relative px-4 py-2 text-left text-[11px] font-medium text-muted"
                        :style="{ width: `${header.getSize()}px` }"
                      >
                        <template v-if="getModeId(header.column.id)">
                          <input
                            v-if="ctx.modeRename.editingId.value === getModeId(header.column.id)"
                            ref="modeInput"
                            class="-mx-1 w-full rounded border border-accent bg-input px-1 py-0 text-[11px] font-medium text-surface outline-none"
                            :value="header.column.columnDef.header"
                            @blur="ctx.modeRename.commit(modeId(header.column.id), $event)"
                            @keydown="ctx.modeRename.onKeydown"
                          />
                          <ContextMenuRoot v-else>
                            <ContextMenuTrigger as-child>
                              <span
                                class="cursor-default"
                                :class="
                                  getModeId(header.column.id) === col.defaultModeId
                                    ? 'text-surface'
                                    : ''
                                "
                                @dblclick="ctx.startRenameMode(modeId(header.column.id))"
                              >
                                {{ header.column.columnDef.header }}
                              </span>
                            </ContextMenuTrigger>
                            <ContextMenuPortal>
                              <ContextMenuContent :class="menuCls.content">
                                <ContextMenuItem
                                  :class="menuCls.item"
                                  @select="ctx.startRenameMode(modeId(header.column.id))"
                                >
                                  <icon-lucide-pencil :class="menuCls.icon" />
                                  {{ dialogs.renameMode }}
                                </ContextMenuItem>
                                <ContextMenuItem
                                  :class="menuCls.item"
                                  @select="ctx.duplicateMode(modeId(header.column.id))"
                                >
                                  <icon-lucide-copy :class="menuCls.icon" />
                                  {{ dialogs.duplicateMode }}
                                </ContextMenuItem>
                                <ContextMenuItem
                                  v-if="getModeId(header.column.id) !== col.defaultModeId"
                                  :class="menuCls.item"
                                  @select="ctx.setDefaultMode(modeId(header.column.id))"
                                >
                                  <icon-lucide-pin :class="menuCls.icon" />
                                  {{ dialogs.setDefaultMode }}
                                </ContextMenuItem>
                                <ContextMenuSeparator :class="menuCls.separator" />
                                <ContextMenuItem
                                  :class="[menuCls.item, 'text-red-500']"
                                  :disabled="col.modes.length <= 1"
                                  @select="ctx.removeMode(modeId(header.column.id))"
                                >
                                  <icon-lucide-trash-2 :class="menuCls.icon" />
                                  {{ dialogs.deleteMode }}
                                </ContextMenuItem>
                              </ContextMenuContent>
                            </ContextMenuPortal>
                          </ContextMenuRoot>
                        </template>
                        <FlexRender
                          v-else-if="!header.isPlaceholder"
                          :render="header.column.columnDef.header"
                          :props="header.getContext()"
                        />
                        <div
                          v-if="header.column.getCanResize()"
                          class="absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none"
                          :class="
                            header.column.getIsResizing()
                              ? 'bg-accent'
                              : 'bg-transparent hover:bg-border'
                          "
                          @mousedown="header.getResizeHandler()?.($event)"
                          @touchstart="header.getResizeHandler()?.($event)"
                          @dblclick="header.column.resetSize()"
                        />
                      </th>
                      <th class="w-8 px-1 py-2">
                        <Tip :label="dialogs.addMode">
                          <button
                            data-test-id="variables-add-mode"
                            class="flex size-5 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
                            @click="ctx.addMode"
                          >
                            <icon-lucide-plus class="size-3" />
                          </button>
                        </Tip>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in ctx.table.getRowModel().rows"
                      :key="row.id"
                      data-test-id="variable-row"
                      class="group border-b border-border/30 hover:bg-hover/50"
                    >
                      <td
                        v-for="cell in row.getVisibleCells()"
                        :key="cell.id"
                        class="px-4 py-1.5"
                        :style="{ width: `${cell.column.getSize()}px` }"
                      >
                        <FlexRender
                          :render="cell.column.columnDef.cell"
                          :props="cell.getContext()"
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div
                class="flex w-full shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-2"
              >
                <span class="text-xs text-muted">{{ panels.createVariable }}</span>
                <DropdownMenuRoot>
                  <DropdownMenuTrigger as-child>
                    <button
                      data-test-id="variables-add-variable"
                      class="flex cursor-pointer items-center gap-1.5 rounded bg-hover px-2.5 py-1.5 text-xs text-surface hover:bg-border"
                    >
                      <icon-lucide-plus class="size-3.5" />
                      {{ panels.add }}
                      <icon-lucide-chevron-down class="size-3" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent
                      side="top"
                      :side-offset="8"
                      align="end"
                      :class="menuCls.content"
                    >
                      <DropdownMenuItem
                        v-for="item in variableTypes"
                        :key="item.type"
                        :class="menuCls.item"
                        v-test-id="variablesAddTestId(item.type)"
                        @select="ctx.addVariable(item.type)"
                      >
                        <component :is="variableTypeIcons[item.type]" :class="menuCls.icon" />
                        <span class="flex min-w-0 flex-1 flex-col">
                          <span>{{ item.label() }}</span>
                          <span class="truncate text-[10px] text-muted">{{
                            item.description()
                          }}</span>
                        </span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
              </div>
            </TabsContent>
          </TabsRoot>
        </template>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <DialogRoot v-model:open="tokenReviewOpen">
    <DialogPortal>
      <DialogOverlay :class="reviewCls.overlay" />
      <DialogContent
        data-test-id="variables-token-review"
        :aria-describedby="undefined"
        :class="reviewCls.content"
      >
        <div class="flex items-start justify-between border-b border-border px-5 py-4">
          <div class="min-w-0">
            <DialogTitle class="text-sm font-semibold text-surface"
              >Review token changes</DialogTitle
            >
            <p class="mt-1 truncate text-[11px] text-muted">
              {{ pendingTokenImport?.fileName }} · nothing changes until you apply
            </p>
          </div>
          <DialogClose
            class="flex size-6 cursor-pointer items-center justify-center rounded border-none bg-transparent text-muted hover:bg-hover hover:text-surface"
          >
            <icon-lucide-x class="size-4" />
          </DialogClose>
        </div>

        <div v-if="pendingTokenImport" class="grid grid-cols-2 gap-3 px-5 py-4">
          <section class="rounded-lg border border-border bg-input/30 p-3">
            <span class="text-[10px] font-medium text-muted uppercase">Collections</span>
            <dl class="mt-2 grid grid-cols-4 gap-2 text-center">
              <div>
                <dt class="text-[9px] text-muted">Add</dt>
                <dd class="text-sm text-surface">
                  {{ pendingTokenImport.review.collections.added }}
                </dd>
              </div>
              <div>
                <dt class="text-[9px] text-muted">Update</dt>
                <dd class="text-sm text-surface">
                  {{ pendingTokenImport.review.collections.updated }}
                </dd>
              </div>
              <div>
                <dt class="text-[9px] text-muted">Same</dt>
                <dd class="text-sm text-surface">
                  {{ pendingTokenImport.review.collections.unchanged }}
                </dd>
              </div>
              <div>
                <dt class="text-[9px] text-muted">Remove</dt>
                <dd class="text-sm text-[var(--color-warning-text)]">
                  {{ pendingTokenImport.review.collections.removed }}
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
                  {{ pendingTokenImport.review.variables.added }}
                </dd>
              </div>
              <div>
                <dt class="text-[9px] text-muted">Update</dt>
                <dd class="text-sm text-surface">
                  {{ pendingTokenImport.review.variables.updated }}
                </dd>
              </div>
              <div>
                <dt class="text-[9px] text-muted">Same</dt>
                <dd class="text-sm text-surface">
                  {{ pendingTokenImport.review.variables.unchanged }}
                </dd>
              </div>
              <div>
                <dt class="text-[9px] text-muted">Remove</dt>
                <dd class="text-sm text-[var(--color-warning-text)]">
                  {{ pendingTokenImport.review.variables.removed }}
                </dd>
              </div>
            </dl>
          </section>
          <div
            v-if="pendingTokenImport.warnings.length > 0"
            class="col-span-2 rounded-lg border border-[var(--color-warning-text)]/30 bg-[var(--color-warning-text)]/5 px-3 py-2"
          >
            <p class="text-[10px] font-medium text-[var(--color-warning-text)]">
              {{ pendingTokenImport.warnings.length }} compatibility warnings
            </p>
            <p class="mt-1 line-clamp-2 text-[10px] leading-4 text-muted">
              {{ pendingTokenImport.warnings.slice(0, 3).join(' · ') }}
            </p>
          </div>
        </div>

        <div class="flex justify-end gap-2 border-t border-border px-5 py-3">
          <DialogClose
            class="cursor-pointer rounded border border-border bg-transparent px-3 py-1.5 text-xs text-muted hover:bg-hover hover:text-surface"
          >
            Cancel
          </DialogClose>
          <button
            data-test-id="variables-token-apply"
            class="cursor-pointer rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
            @click="applyTokenImport"
          >
            Apply changes
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
