<script setup lang="ts">
import type { AgentWorkMapSurfaceController } from '@/app/agent-chat/work-map-surface-controller'
import type { WorkMapViewEntry } from '@/app/agent-chat/work-map-view'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'
import AgentThreadStatusIndicator from '@/components/agent-chat/AgentThreadStatusIndicator.vue'
import Tip from '@/components/ui/Tip.vue'

const { controller, entry } = defineProps<{
  controller: AgentWorkMapSurfaceController
  entry: WorkMapViewEntry
}>()

const {
  agentConversationDisplayTitle,
  armThreadPointerDrag,
  beginThreadDrag,
  browserCaptureDragEnter,
  browserCaptureDragLeave,
  captureDropTargetId,
  draggedWorkMapThreadId,
  dropBrowserCaptureOnThread,
  endWorkMapDrag,
  handleConversationArchivedChange,
  handleConversationBotChange,
  isAgentConversationPinned,
  pressedWorkMapThreadId,
  requestArchiveConversation,
  selectThread,
  threadStatus
} = controller
</script>

<template>
  <div :data-test-id="`work-map-project-in-motion-chats-${entry.project.id}`">
    <AgentConversationContextMenu
      v-for="(thread, threadIndex) in entry.threads.items"
      :key="thread.id"
      :thread="thread"
      @archived-change="handleConversationArchivedChange"
      @bot-change="handleConversationBotChange"
    >
      <div
        role="button"
        tabindex="0"
        draggable="true"
        :data-agent-thread-id="thread.id"
        :data-test-id="`work-map-project-chat-${thread.id}`"
        class="group/chat relative z-10 ml-8 flex min-h-8 cursor-pointer items-center gap-2 rounded-[7px] pr-2 pl-2 text-left before:pointer-events-none before:absolute before:top-2.5 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:border-l after:border-work-map-tree after:content-[''] hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
        :class="[
          threadIndex === entry.threads.items.length - 1 &&
          !entry.todos.in_motion.items.length &&
          !entry.inMotion.remaining
            ? 'after:h-2.5'
            : 'after:h-full',
          captureDropTargetId === thread.id ? 'bg-accent/10' : '',
          pressedWorkMapThreadId === thread.id || draggedWorkMapThreadId === thread.nativeThreadId
            ? '!cursor-grabbing'
            : ''
        ]"
        @dragenter="browserCaptureDragEnter($event, thread)"
        @dragleave="browserCaptureDragLeave($event, thread)"
        @dragover="browserCaptureDragEnter($event, thread)"
        @pointerdown="armThreadPointerDrag($event, thread)"
        @dragstart="beginThreadDrag($event, thread)"
        @dragend="endWorkMapDrag"
        @drop="dropBrowserCaptureOnThread($event, thread)"
        @click="selectThread(thread)"
        @keydown.enter.prevent="selectThread(thread)"
      >
        <icon-lucide-pin
          v-if="isAgentConversationPinned(thread)"
          class="size-3.5 shrink-0 stroke-[1.6] text-muted"
          aria-label="Pinned"
        />
        <span class="min-w-0 flex-1 truncate text-[12.5px] text-surface">{{
          agentConversationDisplayTitle(thread)
        }}</span>
        <Tip label="Archive chat">
          <button
            type="button"
            :data-test-id="`work-map-archive-chat-${thread.id}`"
            aria-label="Archive chat"
            class="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 focus-visible:outline-none focus-visible:text-surface group-hover/chat:pointer-events-auto group-hover/chat:opacity-100 group-focus-within/chat:pointer-events-auto group-focus-within/chat:opacity-100"
            @pointerdown.stop
            @click.stop="requestArchiveConversation(thread)"
          >
            <icon-lucide-archive class="size-4 stroke-[1.6]" />
          </button>
        </Tip>
        <AgentThreadStatusIndicator v-if="threadStatus(thread)" :status="threadStatus(thread)" />
      </div>
    </AgentConversationContextMenu>
  </div>
</template>
