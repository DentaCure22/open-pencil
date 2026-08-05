<script setup lang="ts">
import { COMPONENT_TYPES, nodeIcon } from '@/app/editor/icons'
import LayerTreeActions from './LayerTreeActions.vue'
import LayerTreeDisclosure from './LayerTreeDisclosure.vue'
import LayerTreeDropIndicator from './LayerTreeDropIndicator.vue'

import type { LayerNode } from '@open-pencil/vue'
import type { LayerTreeChrome, LayerTreeItemActions } from './types'

const { node, level, hasChildren, selected, padLeft, expanded, actions, chrome } = defineProps<{
  node: LayerNode
  level: number
  hasChildren: boolean
  selected: boolean
  padLeft: string
  expanded: boolean
  actions: LayerTreeItemActions
  chrome: LayerTreeChrome
}>()

const emit = defineEmits<{
  hoverEnd: [id: string]
  hoverStart: [id: string]
  renameStart: [id: string, name: string]
}>()
</script>

<template>
  <div
    data-test-id="layers-item"
    :data-layer-level="level"
    class="group/row relative flex min-h-8 w-full cursor-pointer items-center gap-1.5 rounded-[5px] border-none pr-1.5 text-left text-[12.5px] tracking-[-0.005em] transition-[padding,background-color] duration-150 ease-out"
    :class="[
      selected
        ? 'bg-white/[0.095] text-surface'
        : 'bg-transparent text-muted hover:bg-hover hover:text-surface',
      level === 1 ? 'font-medium' : '',
      chrome.draggingId === node.id ? 'opacity-30' : '',
      chrome.instructionTargetId === node.id && chrome.instruction?.type === 'make-child'
        ? 'bg-accent/15 text-surface outline-2 outline-accent outline-offset-[-2px]'
        : '',
      !node.visible ? 'opacity-50' : ''
    ]"
    :style="{ paddingLeft: padLeft }"
    @dblclick="emit('renameStart', node.id, node.name)"
    @pointerenter="emit('hoverStart', node.id)"
    @pointerleave="emit('hoverEnd', node.id)"
  >
    <LayerTreeDisclosure
      :expanded="expanded"
      :visible="hasChildren"
      @toggle="actions.toggleExpand"
    />

    <component
      :is="nodeIcon(node)"
      class="size-3 shrink-0"
      :class="
        selected
          ? 'text-accent opacity-100'
          : COMPONENT_TYPES.has(node.type)
            ? 'text-component opacity-100'
            : 'opacity-65'
      "
    />
    <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>

    <!-- Virtual rows (internal DOM / design sections) — no lock/visibility chrome. -->
    <LayerTreeActions
      v-if="!node.virtual"
      :node="node"
      :selected="selected"
      @toggle-lock="actions.toggleLock"
      @toggle-visibility="actions.toggleVisibility"
    />
    <span
      v-else-if="node.id.startsWith('live:')"
      class="rounded-full border border-emerald-300/10 bg-emerald-400/10 px-1.5 py-0.5 text-[8px] text-emerald-300/80"
    >
      live
    </span>

    <LayerTreeDropIndicator
      :active="chrome.instructionTargetId === node.id"
      :instruction="chrome.instruction"
      :level="Math.max(1, level - chrome.indentRebaseLevel)"
      :indent="chrome.indent"
    />
  </div>
</template>
