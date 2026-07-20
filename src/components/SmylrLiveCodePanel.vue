<script setup lang="ts">
import { computed } from 'vue'

import {
  liveInspectorPatchDraft,
  selectedLiveInspectorNode
} from '@/app/smylr-live-inspector/session'
import PanelSection from '@/components/ui/PanelSection.vue'

const node = computed(() => selectedLiveInspectorNode.value)
const source = computed(() => node.value?.source)
const sourceLabel = computed(() => {
  if (!source.value?.filePath && !source.value?.componentName) return 'Source not captured'
  const file = source.value.filePath?.split('/').slice(-4).join('/')
  const line = source.value.lineNumber ? `:${source.value.lineNumber}` : ''
  return [source.value.componentName, file ? `${file}${line}` : undefined]
    .filter(Boolean)
    .join(' · ')
})
const tokenBindings = computed(() => node.value?.tokenProvenance ?? [])
const liveStyles = computed(() => Object.entries(liveInspectorPatchDraft.value?.styles ?? {}))
</script>

<template>
  <div data-test-id="smylr-live-code-panel" class="scrollbar-thin min-h-0 flex-1 overflow-auto">
    <div class="px-3 py-2.5">
      <div class="text-xs font-semibold">{{ node?.label || 'Selected container' }}</div>
      <div class="truncate text-[10px] text-muted">{{ sourceLabel }}</div>
    </div>

    <div v-if="!node" data-test-id="smylr-live-code-empty" class="px-3 py-4 text-[11px] text-muted">
      Select a container to inspect its source bindings.
    </div>

    <template v-else>
      <PanelSection label="Source" data-test-id="smylr-live-code-source">
        <code class="block break-words font-mono text-[10px] leading-4 text-surface">
          {{ sourceLabel }}
        </code>
      </PanelSection>

      <PanelSection label="Token bindings" data-test-id="smylr-live-code-tokens">
        <div v-if="tokenBindings.length" class="grid gap-1.5">
          <div
            v-for="binding in tokenBindings"
            :key="`${binding.cssProperty}-${binding.cssVariable}`"
          >
            <div class="font-mono text-[10px] text-surface">
              {{ binding.cssProperty }}: {{ binding.styleValue || `var(${binding.cssVariable})` }}
            </div>
            <div class="truncate text-[9px] text-muted">
              {{ binding.utility || binding.evidence }}
            </div>
          </div>
        </div>
        <span v-else class="text-[10px] text-muted">No exact source token binding.</span>
      </PanelSection>

      <PanelSection
        v-if="liveStyles.length"
        label="Live changes"
        data-test-id="smylr-live-code-changes"
      >
        <code class="grid gap-1 font-mono text-[10px] leading-4 text-surface">
          <span v-for="[property, value] in liveStyles" :key="property">
            {{ property }}: {{ value }};
          </span>
        </code>
      </PanelSection>
    </template>
  </div>
</template>
