<script setup lang="ts">
import { computed } from 'vue'

import type { AiConversationStatus } from './types'

const { message, status } = defineProps<{
  message?: string
  status: AiConversationStatus
}>()

const label = computed(() => {
  if (message) return message
  if (status === 'submitted') return 'Sending…'
  if (status === 'streaming') return 'Agent is responding…'
  if (status === 'needs_attention') return 'Needs attention'
  if (status === 'stopped') return 'Stopped'
  if (status === 'error') return 'Something went wrong'
  return ''
})

const busy = computed(() => ['streaming', 'submitted'].includes(status))
</script>

<template>
  <div
    v-if="status !== 'ready'"
    :data-status="status"
    data-test-id="ai-conversation-status"
    class="flex min-w-0 items-start gap-1.5 px-1 py-1 text-[11px] leading-4"
    :class="status === 'error' || status === 'needs_attention' ? 'text-red-300' : 'text-muted'"
    role="status"
  >
    <span v-if="busy" class="mt-1 size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    <IconlyIcon
      name="danger"
      v-else-if="status === 'error' || status === 'needs_attention'"
      class="size-3"
    />
    <icon-lucide-circle-stop v-else class="size-3" />
    <span class="min-w-0 break-words">{{ label }}</span>
  </div>
</template>
