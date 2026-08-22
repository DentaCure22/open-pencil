<script setup lang="ts">
import { LayoutControlsRoot, useI18n } from '@open-pencil/vue'

import AutoLayoutControls from '@/components/properties/LayoutSection/AutoLayoutControls.vue'
import ClipContentControl from '@/components/properties/LayoutSection/ClipContentControl.vue'
import ComputedBoxModel from '@/components/properties/LayoutSection/ComputedBoxModel.vue'
import FlexControls from '@/components/properties/LayoutSection/FlexControls.vue'
import GridControls from '@/components/properties/LayoutSection/GridControls.vue'
import PaddingControls from '@/components/properties/LayoutSection/PaddingControls.vue'
import SizeControls from '@/components/properties/LayoutSection/SizeControls.vue'
import PanelSection from '@/components/ui/PanelSection.vue'

import type { DesignStyleDeclaration } from '@open-pencil/dom-css'

const { computedStyle } = defineProps<{
  computedStyle?: DesignStyleDeclaration
}>()

const { panels } = useI18n()

const CONTAINER_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE']
</script>

<template>
  <LayoutControlsRoot v-slot="ctx">
    <template v-if="ctx.node">
      <PanelSection :label="panels.layout" data-test-id="layout-section">
        <SizeControls />
        <ComputedBoxModel
          v-if="computedStyle && CONTAINER_TYPES.includes(ctx.node.type)"
          class="mt-3"
          :computed-style="computedStyle"
          :node="ctx.node"
        />
      </PanelSection>

      <template v-if="CONTAINER_TYPES.includes(ctx.node.type)">
        <PanelSection :label="panels.autoLayout">
          <AutoLayoutControls />

          <template v-if="ctx.node.layoutMode !== 'NONE'">
            <FlexControls v-if="ctx.isFlex" />
            <template v-if="ctx.isGrid">
              <GridControls />
              <PaddingControls />
              <ClipContentControl />
            </template>
          </template>
        </PanelSection>
      </template>
    </template>
  </LayoutControlsRoot>
</template>
