<script setup lang="ts">
import { useSectionUI } from '@/components/ui/section'

interface PanelSectionUi {
  label?: string
  wrapper?: string
}

interface PanelSectionProps {
  label: string
  ui?: PanelSectionUi
}

const { label, ui } = defineProps<PanelSectionProps>()

const sectionCls = useSectionUI(ui)
</script>

<template>
  <section :class="sectionCls.wrapper">
    <div v-if="$slots.actions" class="flex items-center justify-between">
      <h3 :class="sectionCls.label">{{ label }}</h3>
      <slot name="actions" />
    </div>
    <h3 v-else :class="sectionCls.label">{{ label }}</h3>
    <slot />
  </section>
</template>
