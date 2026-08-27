<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot } from 'reka-ui'
import { ref } from 'vue'

import type { AgentWorkMapSurfaceController } from '@/app/agent-chat/work-map-surface-controller'
import type { AgentWorkMapBot } from '@/app/agent-chat/work-map'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'
import AgentThreadStatusIndicator from '@/components/agent-chat/AgentThreadStatusIndicator.vue'
import WorkMapBotIcon from '@/components/agent-chat/WorkMapBotIcon.vue'
import WorkMapScheduledSection from '@/components/agent-chat/WorkMapScheduledSection.vue'
import Tip from '@/components/ui/Tip.vue'

const { bot, controller } = defineProps<{
  bot: AgentWorkMapBot
  controller: AgentWorkMapSurfaceController
}>()

const {
  botThread,
  botTitle,
  handleConversationArchivedChange,
  handleConversationBotChange,
  openBot,
  threadStatus
} = controller
const open = ref(false)
</script>

<template>
  <CollapsibleRoot v-model:open="open" :data-test-id="`work-map-bot-directory-${bot.id}`">
    <AgentConversationContextMenu
      :bot="true"
      :thread="botThread(bot) ?? null"
      @archived-change="handleConversationArchivedChange"
      @bot-change="handleConversationBotChange"
    >
      <div
        role="button"
        tabindex="0"
        data-work-map-directory="bot"
        :data-test-id="`work-map-bot-${bot.id}`"
        :aria-label="`${open ? 'Collapse' : 'Expand'} ${botTitle(bot)}`"
        :aria-expanded="open"
        class="group/bot relative z-10 flex h-11 w-full cursor-pointer items-center rounded-[8px] px-1 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
        @click="open = !open"
        @keydown.enter.self.prevent="open = !open"
      >
        <span class="flex h-10 w-7 shrink-0 items-center justify-center">
          <WorkMapBotIcon :bot-id="bot.id" :variant="bot.avatarVariant" class="h-10 w-11" />
        </span>
        <span
          :data-test-id="`work-map-bot-summary-${bot.id}`"
          class="ml-3 min-w-0 flex-1 truncate text-[15px] font-medium text-surface"
        >
          {{ botTitle(bot) }}
        </span>
        <AgentThreadStatusIndicator
          v-if="botThread(bot) && threadStatus(botThread(bot)!)"
          :status="threadStatus(botThread(bot)!)"
        />
      </div>
    </AgentConversationContextMenu>

    <CollapsibleContent :data-test-id="`work-map-bot-directory-content-${bot.id}`">
      <div class="ml-2 min-h-0 overflow-hidden pt-0.5 pb-1">
        <section class="relative mb-0.5">
          <div
            class="flex h-8 items-center gap-2 rounded-[6px] px-2 text-[13px] font-medium text-surface"
          >
            <span class="relative z-10 flex h-8 w-6 shrink-0 items-center justify-center">
              <IconlyIcon name="activity" class="size-[16px] text-[#6e2ffc]" />
            </span>
            <span>In motion</span>
          </div>
          <button
            v-if="botThread(bot)"
            type="button"
            :data-test-id="`work-map-bot-in-motion-${bot.id}`"
            class="group/chat relative z-10 ml-8 flex min-h-8 w-[calc(100%-2rem)] cursor-pointer items-center gap-2 rounded-[7px] pr-2 pl-2 text-left text-[12.5px] text-surface before:pointer-events-none before:absolute before:top-2.5 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2.5 after:border-l after:border-work-map-tree after:content-[''] hover:bg-hover"
            @click.stop="openBot(bot)"
          >
            <span class="min-w-0 flex-1 truncate">{{ botTitle(bot) }}</span>
            <Tip label="Open working chat">
              <icon-lucide-arrow-right class="size-3.5 shrink-0 stroke-[1.7] text-muted" />
            </Tip>
          </button>
          <div
            v-else
            class="relative z-10 ml-8 flex h-7 items-center pr-2 pl-2 text-[12px] text-muted/55 before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-['']"
          >
            No working chats
          </div>
        </section>

        <section class="relative mb-0.5">
          <div
            class="flex h-8 items-center gap-2 rounded-[6px] px-2 text-[13px] font-medium text-surface"
          >
            <span class="relative z-10 flex h-8 w-6 shrink-0 items-center justify-center">
              <IconlyIcon name="time-circle" class="size-[16px] text-[#f59e0b]" />
            </span>
            <span>Todo</span>
          </div>
          <div
            class="relative z-10 ml-8 flex h-7 items-center pr-2 pl-2 text-[12px] text-muted/55 before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-['']"
          >
            No todos
          </div>
        </section>

        <WorkMapScheduledSection
          :bots="[bot]"
          :controller="controller"
          :directory-id="bot.id"
          :schedule-bot="bot"
        />
      </div>
    </CollapsibleContent>
  </CollapsibleRoot>
</template>
