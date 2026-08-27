<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { editorViewportInsets } from '@/app/editor/viewport-insets'

import type { SceneNode } from '@open-pencil/scene-graph'

const query = defineModel<string>('query', { default: '' })
const editor = useEditorStore()
const previews = shallowRef<Record<string, string>>({})
const expandedGroups = ref<Record<string, boolean>>({})
let previewRequestId = 0

function belongsToCurrentPage(node: SceneNode): boolean {
  let current: SceneNode | undefined = node
  while (current?.parentId) {
    if (current.parentId === editor.state.currentPageId) return true
    current = editor.graph.getNode(current.parentId)
  }
  return current?.id === editor.state.currentPageId
}

const graphSnapshot = computed(() => ({
  nodes: [...editor.graph.nodes.values()],
  sceneVersion: editor.state.sceneVersion
}))

const mediaNodes = computed(() => {
  const { nodes } = graphSnapshot.value
  const normalized = query.value.trim().toLowerCase()
  return nodes
    .filter(
      (node) =>
        node.id !== editor.state.currentPageId &&
        node.fills.some((fill) => fill.type === 'IMAGE') &&
        belongsToCurrentPage(node) &&
        (!normalized || node.name.toLowerCase().includes(normalized))
    )
    .sort((left, right) => left.name.localeCompare(right.name))
})

const mediaGroups = computed(() => {
  const groups = new Map<string, { id: string; label: string; nodes: SceneNode[] }>()
  for (const node of mediaNodes.value) {
    const parent = node.parentId ? editor.graph.getNode(node.parentId) : undefined
    const id = parent?.id ?? 'board-media'
    const group = groups.get(id) ?? {
      id,
      label: parent?.name || 'Board media',
      nodes: []
    }
    group.nodes.push(node)
    groups.set(id, group)
  }
  return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
})

function groupIsOpen(groupId: string) {
  return expandedGroups.value[groupId] !== false
}

function toggleGroup(groupId: string) {
  expandedGroups.value = {
    ...expandedGroups.value,
    [groupId]: !groupIsOpen(groupId)
  }
}

function revokePreviews(urls = previews.value) {
  for (const url of Object.values(urls)) URL.revokeObjectURL(url)
}

async function loadPreviews(nodes: SceneNode[]) {
  const requestId = ++previewRequestId
  const next: Record<string, string> = {}
  for (const node of nodes.slice(0, 24)) {
    const scale = Math.min(72 / Math.max(node.width, node.height, 1), 1)
    const data = await editor.renderExportImage([node.id], scale, 'PNG', editor.state.currentPageId)
    if (requestId !== previewRequestId) {
      revokePreviews(next)
      return
    }
    if (data) next[node.id] = URL.createObjectURL(new Blob([data], { type: 'image/png' }))
  }
  revokePreviews()
  previews.value = next
}

function revealNode(node: SceneNode) {
  editor.select([node.id])
  editor.zoomToNode(node.id, editorViewportInsets())
}

watch(
  () => mediaNodes.value.map((node) => node.id).join(':'),
  () => void loadPreviews(mediaNodes.value),
  { immediate: true }
)

onBeforeUnmount(() => {
  previewRequestId += 1
  revokePreviews()
})
</script>

<template>
  <section
    data-test-id="workspace-project-assets"
    class="flex min-h-0 flex-1 flex-col overflow-hidden"
  >
    <div class="scrollbar-thin min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 pb-3">
      <div
        v-if="mediaGroups.length === 0"
        data-test-id="project-assets-empty"
        class="px-3 py-8 text-center text-[11px] leading-5 text-muted"
      >
        <div class="font-medium text-surface/80">No project images yet</div>
        <div>Images placed on this board will appear here.</div>
      </div>

      <section v-for="group in mediaGroups" :key="group.id" class="mb-1">
        <button
          type="button"
          :data-test-id="`project-asset-group-${group.id}`"
          :aria-expanded="groupIsOpen(group.id)"
          class="flex h-8 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-[11px] font-medium text-muted outline-none hover:bg-hover/60 hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/20"
          @click="toggleGroup(group.id)"
        >
          <icon-lucide-chevron-right
            class="size-3 shrink-0 transition-transform"
            :class="groupIsOpen(group.id) ? 'rotate-90' : ''"
          />
          <icon-lucide-folder-open v-if="groupIsOpen(group.id)" class="size-3.5 text-component" />
          <icon-lucide-folder v-else class="size-3.5 text-component" />
          <span class="min-w-0 flex-1 truncate">{{ group.label }}</span>
          <span class="text-[10px] font-normal text-muted/65">{{ group.nodes.length }}</span>
        </button>

        <div v-if="groupIsOpen(group.id)" class="ml-3 border-l border-border/65 pl-2">
          <button
            v-for="node in group.nodes"
            :key="node.id"
            type="button"
            :data-test-id="`project-asset-${node.id}`"
            :aria-label="`Reveal ${node.name} on the board`"
            class="group/asset flex min-h-12 w-full items-center gap-2 rounded-[7px] px-1.5 py-1 text-left outline-none hover:bg-hover/60 focus-visible:ring-2 focus-visible:ring-accent/20"
            @click="revealNode(node)"
          >
            <span
              class="border-border/70 bg-chrome-detail flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[7px] border"
            >
              <img
                v-if="previews[node.id]"
                :src="previews[node.id]"
                alt=""
                aria-hidden="true"
                class="size-full object-contain"
              />
              <icon-lucide-image v-else class="size-4 text-muted/55" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[11px] font-medium text-surface">{{
                node.name
              }}</span>
              <span class="mt-0.5 block text-[9.5px] text-muted">Board image</span>
            </span>
            <icon-lucide-locate-fixed
              class="size-3.5 shrink-0 text-muted/0 transition-colors group-hover/asset:text-muted"
            />
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
