<script setup lang="ts">
import WorkMapBotIcon from '@/components/agent-chat/WorkMapBotIcon.vue'
import type { BotPresencePhase } from './bot-presence'

const {
  botId,
  botName,
  phase,
  variant = 0
} = defineProps<{
  botId?: string
  botName: string
  phase: BotPresencePhase
  variant?: number
}>()
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    data-test-id="ai-bot-presence"
    :data-phase="phase"
    class="flex min-h-7 items-center gap-2 pl-1 text-[12px] leading-5 text-muted"
  >
    <WorkMapBotIcon v-if="botId" active :bot-id="botId" :variant="variant" class="size-7" />
    <span>
      <span class="font-medium text-agent-ink">{{ botName }}</span>
      is {{ phase }}<span aria-hidden="true" class="inline-block min-w-3 animate-pulse">…</span>
    </span>
  </div>
</template>
