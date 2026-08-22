<script setup lang="ts">
import { ToolbarButton } from 'reka-ui'
import { computed } from 'vue'

import { browserInspectorState, requestBrowserElementPicker } from '@/app/browser-inspector/state'
import { toast } from '@/app/shell/ui'
import Tip from '@/components/ui/Tip.vue'

const pickerBusy = computed(() => browserInspectorState.pickerStatus === 'requesting')
const pickerActive = computed(() => browserInspectorState.pickerStatus === 'active')

async function inspectChrome() {
  const started = await requestBrowserElementPicker()
  if (!started && browserInspectorState.error) toast.error(browserInspectorState.error)
  else if (started) {
    toast.info('Chrome capture armed. Switch tabs and keep selecting until Done.')
  }
}
</script>

<template>
  <Tip
    :label="
      pickerBusy
        ? 'Opening Chrome selector…'
        : pickerActive
          ? 'Chrome session active'
          : 'Inspect Chrome'
    "
    side="right"
  >
    <ToolbarButton as-child>
      <button
        type="button"
        data-test-id="browser-inspector-select"
        aria-label="Inspect Chrome"
        :aria-busy="pickerBusy"
        :aria-pressed="pickerActive"
        :disabled="pickerBusy"
        class="relative z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-muted outline-none transition-[color,background-color,box-shadow] hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-chrome aria-pressed:bg-accent/12 aria-pressed:text-accent disabled:cursor-default disabled:text-muted/45 disabled:hover:bg-transparent"
        @click="inspectChrome"
      >
        <icon-lucide-loader-circle v-if="pickerBusy" class="size-4 animate-spin" />
        <icon-lucide-scan-search v-else class="size-4" />
        <span
          v-if="pickerActive"
          class="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-accent ring-2 ring-chrome"
        />
      </button>
    </ToolbarButton>
  </Tip>
</template>
