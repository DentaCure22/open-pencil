<script setup lang="ts">
const { description, heading } = defineProps<{ description?: string; heading?: string }>()
</script>

<template>
  <div
    data-test-id="ai-conversation-empty"
    class="flex min-h-full flex-col items-center justify-start gap-1.5 px-4 pt-10 text-center"
  >
    <span class="text-[13px] font-medium text-surface">{{ heading ?? 'Conversation ready' }}</span>
    <span v-if="description" class="max-w-64 text-[11px] leading-4 text-muted">{{
      description
    }}</span>
  </div>
</template>
