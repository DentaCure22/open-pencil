<script setup lang="ts">
import { codeObjectInspectorSelection } from '@/app/code-object/inspector'
import PanelSection from '@/components/ui/PanelSection.vue'
</script>

<template>
  <div
    v-if="codeObjectInspectorSelection"
    data-test-id="code-object-dom-inspector"
    class="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-4"
  >
    <div class="flex min-h-16 items-center gap-2.5 border-b border-white/[0.055] px-3 py-2.5">
      <icon-lucide-layers-3 class="size-4 shrink-0 text-violet-300" />
      <div class="min-w-0 flex-1">
        <div
          class="truncate text-[9px] leading-3.5 font-medium tracking-[0.04em] text-muted uppercase"
        >
          {{ codeObjectInspectorSelection.tagName }}
          <template v-if="codeObjectInspectorSelection.role">
            · {{ codeObjectInspectorSelection.role }}
          </template>
        </div>
        <div class="truncate text-[12px] leading-4 font-semibold text-surface">
          {{ codeObjectInspectorSelection.name }}
        </div>
      </div>
    </div>

    <PanelSection label="Selector">
      <code
        data-test-id="code-object-dom-selector"
        class="block break-words rounded bg-input/40 px-2 py-1.5 font-mono text-[9.5px] leading-4 text-violet-200"
      >
        {{ codeObjectInspectorSelection.selector }}
      </code>
    </PanelSection>

    <PanelSection label="Classes">
      <div v-if="codeObjectInspectorSelection.classes.length > 0" class="flex flex-wrap gap-1">
        <code
          v-for="className in codeObjectInspectorSelection.classes"
          :key="className"
          class="max-w-full truncate rounded border border-border bg-hover/60 px-1.5 py-0.5 text-[9.5px] text-surface"
        >
          .{{ className }}
        </code>
      </div>
      <span v-else class="text-[10px] text-muted">No classes on this layer.</span>
    </PanelSection>

    <PanelSection v-if="codeObjectInspectorSelection.attributes.length > 0" label="Attributes">
      <dl class="grid grid-cols-[minmax(72px,auto)_1fr] gap-x-2 gap-y-1 text-[9.5px]">
        <template
          v-for="attribute in codeObjectInspectorSelection.attributes"
          :key="attribute.name"
        >
          <dt class="truncate font-mono text-muted">{{ attribute.name }}</dt>
          <dd class="break-all font-mono text-surface">{{ attribute.value }}</dd>
        </template>
      </dl>
    </PanelSection>

    <PanelSection label="Computed">
      <dl class="grid grid-cols-[minmax(88px,auto)_1fr] gap-x-2 gap-y-1 text-[9.5px]">
        <template v-for="entry in codeObjectInspectorSelection.computedStyles" :key="entry.name">
          <dt class="font-mono text-muted">{{ entry.name }}</dt>
          <dd class="break-all font-mono text-surface">{{ entry.value }}</dd>
        </template>
      </dl>
    </PanelSection>

    <p class="px-3 pt-2 text-[9.5px] leading-4 text-muted">
      Edit this layer durably in the Code Object TSX; the selector stays scoped to this object.
    </p>
  </div>
</template>
