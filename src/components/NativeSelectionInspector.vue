<script setup lang="ts">
import { computed } from 'vue'

import { useEditorCommands, useI18n, useSelectionState } from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/active-store'
import AppearanceSection from './properties/AppearanceSection.vue'
import EffectsSection from './properties/EffectsSection.vue'
import ExportSection from './properties/ExportSection.vue'
import FillSection from './properties/FillSection.vue'
import LayoutSection from './properties/LayoutSection/LayoutSection.vue'
import PositionSection from './properties/PositionSection.vue'
import StrokeSection from './properties/StrokeSection.vue'
import TypographySection from './properties/TypographySection.vue'
import VariantSection from './properties/VariantSection.vue'

import type { DesignStyleDeclaration } from '@open-pencil/dom-css'

const {
  compactHeader = false,
  editorStore,
  nameLabel,
  typeLabel
} = defineProps<{
  compactHeader?: boolean
  computedStyle?: DesignStyleDeclaration
  editorStore?: EditorStore
  nameLabel?: string
  typeLabel?: string
}>()

const { selectedNode: node } = useSelectionState()
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const isComponentType = computed(() => {
  if (typeLabel === 'CONTAINER') return true
  const type = node.value?.type
  return type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'INSTANCE'
})
const nodeSizeLabel = computed(() => {
  const selection = node.value
  if (!selection) return ''
  return `${Math.round(selection.width)} × ${Math.round(selection.height)}`
})
const { panels } = useI18n()
</script>

<template>
  <div
    v-if="node"
    data-test-id="design-panel-single"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <div
      data-test-id="design-node-header"
      class="flex items-center gap-2.5 border-b border-white/[0.055] px-3"
      :class="compactHeader ? 'h-11' : 'min-h-16 py-2.5'"
    >
      <icon-lucide-square-dashed
        class="size-4 shrink-0"
        :class="isComponentType ? 'text-component' : 'text-muted'"
      />
      <div class="min-w-0 flex-1">
        <div
          v-if="!compactHeader"
          data-test-id="design-node-type"
          class="truncate text-[9px] leading-3.5 font-medium tracking-[0.04em] text-muted uppercase"
        >
          {{ typeLabel ?? node.type }}
        </div>
        <div
          data-test-id="design-node-name"
          class="truncate leading-4 text-surface"
          :class="compactHeader ? 'text-[11.5px] font-medium' : 'text-[12px] font-semibold'"
        >
          {{ nameLabel ?? node.name }}
        </div>
        <div
          v-if="!compactHeader"
          data-test-id="design-node-size"
          class="text-[9.5px] leading-3.5 tabular-nums text-muted/70"
        >
          {{ nodeSizeLabel }}
        </div>
      </div>
      <div v-if="$slots['header-actions']" class="ml-auto flex shrink-0 items-center gap-1">
        <slot name="header-actions" />
      </div>
    </div>

    <!-- Component actions -->
    <div v-if="node.type === 'INSTANCE'" class="flex flex-col gap-1 px-3 py-2.5">
      <button
        data-test-id="design-go-to-component"
        class="rounded bg-component/10 px-2 py-1 text-left text-[11px] text-component hover:bg-component/20"
        @click="goToMainComponent.run()"
      >
        {{ panels.goToMainComponent }}
      </button>
      <button
        data-test-id="design-detach-instance"
        class="rounded px-2 py-1 text-left text-[11px] text-muted hover:bg-hover"
        @click="detachInstance.run()"
      >
        {{ panels.detachInstance }}
      </button>
    </div>

    <VariantSection v-if="node.type === 'INSTANCE'" />

    <PositionSection :editor-store="editorStore" />
    <LayoutSection :computed-style="computedStyle" />
    <AppearanceSection />
    <TypographySection v-if="node.type === 'TEXT'" />
    <FillSection />
    <StrokeSection />
    <EffectsSection />

    <!-- Live Smylr adapter injects token list here -->
    <slot name="sections-footer" />

    <ExportSection :editor-store="editorStore" />
  </div>
</template>
