<script setup lang="ts">
import { computed, type Component } from 'vue'
import IconCalendar from '~icons/lucide/calendar-days'
import IconCanvas from '~icons/lucide/layout-grid'
import IconChart from '~icons/lucide/chart-no-axes-column-increasing'
import IconCode from '~icons/lucide/code-2'
import IconDocument from '~icons/lucide/file-text'
import IconFlow from '~icons/lucide/git-branch'
import IconImage from '~icons/lucide/image'
import IconReview from '~icons/lucide/message-square-check'

import type { BoardIconKey } from '@/app/sidebar-workspace/icons'

defineOptions({ inheritAttrs: false })

const { icon = 'canvas' } = defineProps<{ icon?: BoardIconKey }>()

const icons: Record<BoardIconKey, Component> = {
  calendar: IconCalendar,
  canvas: IconCanvas,
  chart: IconChart,
  code: IconCode,
  document: IconDocument,
  flow: IconFlow,
  image: IconImage,
  review: IconReview
}

const iconComponent = computed(() => icons[icon])
</script>

<template>
  <component :is="iconComponent" v-bind="$attrs" />
</template>
