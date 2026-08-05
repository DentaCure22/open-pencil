<script setup lang="ts">
const { newerHeadAvailable } = defineProps<{ newerHeadAvailable: boolean }>()

const emit = defineEmits<{
  reload: []
}>()
</script>

<template>
  <div
    data-test-id="local-workspace-viewer"
    class="bg-canvas/20 fixed inset-0 z-[90] flex items-start justify-center p-5 pt-16 backdrop-blur-[1px]"
  >
    <div
      class="border-border bg-panel shadow-chrome-panel flex w-full max-w-md items-start gap-3 rounded-xl border p-4"
    >
      <div
        class="bg-accent/10 text-accent flex size-9 shrink-0 items-center justify-center rounded-lg"
      >
        <icon-lucide-eye class="size-4" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-surface text-sm font-medium">
          {{ newerHeadAvailable ? 'Newer saved Board available' : 'View-only tab' }}
        </p>
        <p class="text-muted mt-1 text-xs leading-5">
          {{
            newerHeadAvailable
              ? 'Reload to show the latest saved Board. This tab cannot overwrite it.'
              : 'Another tab owns saving. Close that editing tab, then reload here to edit.'
          }}
        </p>
        <button
          type="button"
          data-test-id="local-workspace-reload"
          class="border-border text-surface hover:bg-hover mt-3 h-8 rounded-lg border px-3 text-xs font-medium"
          @click="emit('reload')"
        >
          Reload workspace
        </button>
      </div>
    </div>
  </div>
</template>
