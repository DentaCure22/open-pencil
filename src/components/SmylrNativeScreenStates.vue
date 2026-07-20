<script setup lang="ts">
import { watch } from 'vue'

import { useEditorStore } from '@/app/editor/active-store'
import { liveInspectorDocument } from '@/app/smylr-live-inspector/session'
import { ensureDentalChartNativeScreenStates } from '@/app/smylr-live-inspector/screen-states'

const store = useEditorStore()

watch(
  liveInspectorDocument,
  (document) => {
    if (document) ensureDentalChartNativeScreenStates(store, document)
  },
  { immediate: true }
)
</script>

<template></template>
