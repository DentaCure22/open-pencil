<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed } from 'vue'

import { colorToCSS } from '@open-pencil/core/color'

import ConnectedRoom from '@/components/CollabPanel/ConnectedRoom.vue'
import JoinRoomPrompt from '@/components/CollabPanel/JoinRoomPrompt.vue'
import ShareOrJoinRoom from '@/components/CollabPanel/ShareOrJoinRoom.vue'
import { useCollabPanelContext } from '@/components/CollabPanel/context'
import { initials } from '@/app/shell/ui'
import { usePopoverUI } from '@/components/ui/popover'
import Tip from '@/components/ui/Tip.vue'

const collab = useCollabPanelContext()
const cls = usePopoverUI({ content: 'z-50 w-72 p-3' })
const buttonLabel = computed(() =>
  collab.state.connected
    ? collab.dialogs.connected
    : collab.isJoining
      ? collab.dialogs.joinRoom
      : collab.dialogs.share
)
</script>

<template>
  <PopoverRoot v-model:open="collab.popoverOpen">
    <PopoverTrigger as-child>
      <button
        data-test-id="collab-share-button"
        :aria-label="buttonLabel"
        class="relative flex size-7 cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 transition-transform hover:scale-105"
      >
        <Tip :label="buttonLabel">
          <span
            data-test-id="collab-local-avatar"
            class="flex size-6 items-center justify-center rounded-full border-2 border-panel text-[10px] font-semibold text-white"
            :style="{ background: colorToCSS(collab.state.localColor) }"
          >
            {{ initials(collab.state.localName || collab.dialogs.you) }}
          </span>
          <span
            class="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full border border-panel text-white"
            :class="
              collab.state.connected
                ? 'bg-[var(--color-success-bg)]'
                : collab.isJoining
                  ? 'animate-pulse bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]'
                  : 'bg-accent'
            "
            aria-hidden="true"
          >
            <icon-lucide-share-2 class="size-2" />
          </span>
        </Tip>
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="collab-popover"
        :class="cls.content"
        :side-offset="8"
        side="top"
        align="end"
      >
        <ConnectedRoom v-if="collab.state.connected" />
        <JoinRoomPrompt v-else-if="collab.isJoining" />
        <ShareOrJoinRoom v-else />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
