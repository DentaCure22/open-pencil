<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useHead } from '@unhead/vue'
import { TooltipProvider } from 'reka-ui'

import { provideEditor, useI18n } from '@open-pencil/vue'
import { connectAutomation } from '@/app/automation/bridge/server'
import { onActiveEditorStoreChanged, useEditorStore } from '@/app/editor/active-store'
import { bindNarratedTraceEditor } from '@/app/narrated-trace/bindings'
import { toast } from '@/app/shell/ui'
import { useAppTheme } from '@/app/shell/theme'
import { scheduleStartupUpdateCheck } from '@/app/shell/updater'

useHead({ titleTemplate: (title) => (title ? `${title} — OpenPencil` : 'OpenPencil') })

const store = useEditorStore()
const { dialogs } = useI18n()
provideEditor(store)
useAppTheme()
const releaseNarratedTraceEditor = onActiveEditorStoreChanged(bindNarratedTraceEditor)
const automation = connectAutomation(() => store)

onMounted(() => {
  toast.setupGlobalErrorHandler()
  scheduleStartupUpdateCheck(dialogs)
})

onUnmounted(releaseNarratedTraceEditor)
onUnmounted(automation.disconnect)
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <RouterView />
  </TooltipProvider>
</template>
