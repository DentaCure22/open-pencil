<script setup lang="ts">
import { useEditorCommands, useI18n, useSelectionState } from '@open-pencil/vue'

import type { EditorStore } from '@/app/editor/active-store'
import AppearanceSection from './AppearanceSection.vue'
import EffectsSection from './EffectsSection.vue'
import ExportSection from './ExportSection.vue'
import FillSection from './FillSection.vue'
import LayoutSection from './LayoutSection/LayoutSection.vue'
import PositionSection from './PositionSection.vue'
import StrokeSection from './StrokeSection.vue'
import TypographySection from './TypographySection.vue'
import VariantSection from './VariantSection.vue'

import type { DesignStyleDeclaration } from '@open-pencil/dom-css'

const {
  compactHeader = false,
  editorStore,
  nameLabel
} = defineProps<{
  compactHeader?: boolean
  computedStyle?: DesignStyleDeclaration
  editorStore?: EditorStore
  nameLabel?: string
}>()

const { selectedNode: node } = useSelectionState()
const { getCommand } = useEditorCommands()
const goToMainComponent = getCommand('selection.goToMainComponent')
const detachInstance = getCommand('selection.detachInstance')
const { panels } = useI18n()
</script>

<template>
  <div
    v-if="node"
    data-test-id="design-panel-single"
    class="scrollbar-thin flex-1 overflow-x-hidden overflow-y-auto pb-4"
  >
    <div
      v-if="compactHeader"
      data-test-id="design-node-header"
      class="flex h-11 items-center gap-2.5 border-b border-white/[0.055] px-3"
    >
      <div
        data-test-id="design-node-name"
        class="min-w-0 flex-1 truncate text-[11.5px] font-medium text-surface"
      >
        {{ nameLabel ?? node.name }}
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
