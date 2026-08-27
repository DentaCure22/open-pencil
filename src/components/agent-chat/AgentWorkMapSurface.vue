<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  ScrollAreaRoot,
  ScrollAreaViewport
} from 'reka-ui'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import {
  agentChatsPanelRevealProjectEpoch,
  agentChatsPanelRevealProjectId
} from '@/app/agent-chat/panel'
import {
  WORK_MAP_CREATE_BOT_EVENT,
  type WorkMapCreateBotRequest
} from '@/app/agent-chat/work-map-create-drag'
import { useAgentWorkMapSurfaceController } from '@/app/agent-chat/work-map-surface-controller'
import type { T3ThreadStatus } from '@/components/ai-elements/t3-chat-chrome.logic'
import AgentConversationArchiveDialog from '@/components/agent-chat/AgentConversationArchiveDialog.vue'
import AgentConversationContextMenu from '@/components/agent-chat/AgentConversationContextMenu.vue'
import AgentThreadStatusIndicator from '@/components/agent-chat/AgentThreadStatusIndicator.vue'
import WorkMapBotRow from '@/components/agent-chat/WorkMapBotRow.vue'
import WorkMapProjectTree from '@/components/agent-chat/WorkMapProjectTree.vue'
import AppScrollAreaScrollbar from '@/components/ui/AppScrollAreaScrollbar.vue'
import Tip from '@/components/ui/Tip.vue'

const { modelScope, openThreadChapter, selectThread, startConversation, threadStatus } =
  defineProps<{
    modelScope: string
    openThreadChapter?: (thread: AgentConversationThread, chapterId: string) => Promise<void>
    selectThread: (thread: AgentConversationThread) => Promise<void>
    startConversation: (projectId?: string | null, botProjectId?: string | null) => Promise<void>
    threadStatus: (thread: AgentConversationThread) => T3ThreadStatus | undefined
  }>()

const attachments = defineModel<File[]>('attachments', { required: true })
const controller = useAgentWorkMapSurfaceController({
  attachments,
  modelScope: computed(() => modelScope),
  openThreadChapter,
  selectThread,
  startConversation,
  threadStatus
})
const {
  WORK_MAP_MISC_PAGE_SIZE,
  addWorkMapProject,
  archiveInboxItem,
  agentConversationDisplayTitle,
  archiveConfirmationThread,
  archiveConfirmationTitle,
  armThreadPointerDrag,
  beginWorkMapCreationDrag,
  beginThreadDrag,
  browserCaptureDragEnter,
  browserCaptureDragLeave,
  captureDropTargetId,
  closeArchiveConfirmation,
  closeWorkMapCreateDialog,
  closeWorkMapSearch,
  draggedWorkMapThreadId,
  dropBrowserCaptureOnThread,
  dropOnList,
  dropWorkMapThread,
  endWorkMapDrag,
  formatWorkMapRoutineTime,
  isAgentConversationPinned,
  isWorkMapInboxOpen,
  isWorkMapMiscOpen,
  listDragDepth,
  listDragEnter,
  listDragLeave,
  openInboxItem,
  openInboxBriefing,
  pressedWorkMapThreadId,
  requestArchiveConversation,
  search,
  selectedId,
  setSurface: setControllerSurface,
  setWorkMapCreateInput,
  setWorkMapSearchField,
  setWorkMapSearchInput,
  setWorkMapSearchToggle,
  showMoreMiscChats,
  showWorkMapProjectDrop,
  startNewConversation,
  submitWorkMapCreate,
  confirmArchiveConversation,
  toggleWorkMapInbox,
  toggleWorkMapMisc,
  toggleWorkMapSearch,
  view,
  workMapCreateDialog,
  workMapCreateDraft,
  workMapCreateTitle,
  workMapDropProjectId,
  workMapMiscActivityStatus,
  workMapSearchOpen,
  workMapView
} = controller

const surface = ref<HTMLElement | null>(null)

function setSurface(element: unknown) {
  setControllerSurface(element)
  surface.value = element instanceof HTMLElement ? element : null
}

function handleArchiveDialogOpenChange(open: boolean) {
  if (open) return
  const closingThread = archiveConfirmationThread.value
  // AlertDialog closes before its confirm event reaches this surface.
  window.requestAnimationFrame(() => {
    if (archiveConfirmationThread.value === closingThread) closeArchiveConfirmation()
  })
}

function beginCreateDrag(event: DragEvent, kind: 'bot' | 'chat') {
  beginWorkMapCreationDrag(event, kind)
}

function endCreateDrag() {
  endWorkMapDrag()
}

function createBot() {
  addWorkMapProject()
}

function createChat() {
  void startNewConversation()
}

watch(agentChatsPanelRevealProjectEpoch, async () => {
  const projectId = agentChatsPanelRevealProjectId.value
  if (!projectId) return
  await nextTick()
  window.requestAnimationFrame(() => {
    surface.value
      ?.querySelector<HTMLElement>(
        `[data-test-id="${CSS.escape(`work-map-project-row-${projectId}`)}"]`
      )
      ?.scrollIntoView({ block: 'nearest' })
  })
})

useEventListener(window, WORK_MAP_CREATE_BOT_EVENT, (event: Event) => {
  const detail = (event as CustomEvent<WorkMapCreateBotRequest>).detail
  addWorkMapProject(detail?.parentId, detail?.boardPlacement)
})

const inboxToggleLabel = computed(() => {
  const action = isWorkMapInboxOpen() ? 'Collapse' : 'Expand'
  const count = workMapView.value.unreadInboxCount
  if (!count) return `${action} Inbox`
  return `${action} Inbox, ${String(count)} unopened scheduled update${count === 1 ? '' : 's'}`
})
</script>

<template>
  <div
    :ref="setSurface"
    v-show="view === 'list'"
    data-test-id="agent-thread-selector"
    :aria-hidden="view !== 'list'"
    class="relative flex min-h-0 flex-1 flex-col overflow-clip"
    :class="listDragDepth > 0 ? 'ring-2 ring-inset ring-accent/60' : ''"
    @dragenter="listDragEnter"
    @dragover="listDragEnter"
    @dragleave="listDragLeave"
    @drop="dropOnList"
  >
    <div class="shrink-0 px-4 pt-2.5 pb-2">
      <div class="flex h-8 items-center gap-1">
        <div class="relative h-8 min-w-0 flex-1 overflow-hidden">
          <h2
            data-test-id="work-map-title"
            class="absolute inset-0 flex items-center truncate text-[17px] font-semibold tracking-[-0.015em] text-surface transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none"
            :class="workMapSearchOpen ? 'pointer-events-none -translate-x-2 opacity-0' : ''"
          >
            Work map
          </h2>
          <label
            :ref="setWorkMapSearchField"
            data-test-id="work-map-search-field"
            :aria-hidden="!workMapSearchOpen"
            class="absolute inset-y-0 right-0 flex h-8 w-full items-center overflow-hidden rounded-[8px] bg-hover/60 px-2 text-surface transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none"
            :class="
              workMapSearchOpen
                ? 'translate-x-0 opacity-100'
                : 'pointer-events-none translate-x-2 opacity-0'
            "
          >
            <input
              :ref="setWorkMapSearchInput"
              v-model="search"
              aria-label="Search work map"
              type="text"
              placeholder="Search work…"
              :tabindex="workMapSearchOpen ? 0 : -1"
              class="w-full min-w-0 border-0 bg-transparent text-[11px] text-surface outline-none placeholder:text-muted/75"
              @keydown.esc.prevent.stop="closeWorkMapSearch()"
            />
          </label>
        </div>
        <Tip :label="workMapSearchOpen ? 'Close search' : 'Search work map'">
          <button
            :ref="setWorkMapSearchToggle"
            type="button"
            data-test-id="work-map-search-toggle"
            :aria-label="workMapSearchOpen ? 'Close search' : 'Search work map'"
            :aria-expanded="workMapSearchOpen"
            class="flex size-7 shrink-0 items-center justify-center text-muted hover:text-surface focus-visible:outline-none focus-visible:text-surface"
            :class="workMapSearchOpen ? 'text-surface' : ''"
            @click="toggleWorkMapSearch"
          >
            <IconlyIcon name="search" class="size-4 shrink-0 stroke-[1.6]" />
          </button>
        </Tip>
        <Tip label="Add chat · drag to the Board, Chats, or a Bot">
          <button
            type="button"
            draggable="true"
            data-test-id="agent-thread-new"
            aria-label="Add chat"
            class="flex size-7 shrink-0 cursor-grab items-center justify-center text-muted hover:text-surface focus-visible:outline-none focus-visible:text-surface active:cursor-grabbing"
            @dragstart="beginCreateDrag($event, 'chat')"
            @dragend="endCreateDrag"
            @click="createChat"
          >
            <icon-lucide-message-square-plus class="size-4 stroke-[1.6]" />
          </button>
        </Tip>
        <Tip label="Add Bot · drag to the Board or under a Bot">
          <button
            type="button"
            draggable="true"
            data-test-id="work-map-new-project"
            aria-label="Add Bot"
            class="flex size-7 shrink-0 cursor-grab items-center justify-center text-muted hover:text-surface focus-visible:outline-none focus-visible:text-surface active:cursor-grabbing"
            @dragstart="beginCreateDrag($event, 'bot')"
            @dragend="endCreateDrag"
            @click="createBot"
          >
            <icon-lucide-bot class="size-4 stroke-[1.6]" />
          </button>
        </Tip>
      </div>
    </div>
    <ScrollAreaRoot class="min-h-0 flex-1">
      <ScrollAreaViewport
        class="h-full touch-pan-y overscroll-y-contain [&>div]:min-h-full"
        data-test-id="agent-thread-list"
      >
        <nav aria-label="Work map" class="min-h-full px-3 pb-3">
          <section class="mb-2" data-test-id="work-map-inbox">
            <button
              type="button"
              data-test-id="work-map-inbox-toggle"
              :aria-label="inboxToggleLabel"
              :aria-expanded="isWorkMapInboxOpen()"
              class="group/inbox-toggle flex h-11 w-full items-center rounded-[8px] px-1 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
              @click="toggleWorkMapInbox"
            >
              <span class="flex h-10 w-7 shrink-0 items-center justify-center">
                <icon-lucide-inbox class="size-[20px] stroke-[1.7] text-muted" />
              </span>
              <span class="ml-3 min-w-0 flex-1 truncate text-[15px] font-medium text-surface">
                Inbox
              </span>
              <span
                v-if="workMapView.unreadInboxCount"
                data-test-id="work-map-inbox-unopened-count"
                class="ml-1 text-[12px] font-medium text-surface"
              >
                {{ workMapView.unreadInboxCount }}
              </span>
            </button>

            <Transition
              enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
              enter-from-class="grid-rows-[0fr] opacity-0"
              enter-to-class="grid-rows-[1fr] opacity-100"
              leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
              leave-from-class="grid-rows-[1fr] opacity-100"
              leave-to-class="grid-rows-[0fr] opacity-0"
            >
              <div v-if="isWorkMapInboxOpen()" data-test-id="work-map-inbox-content">
                <div class="min-h-0 overflow-hidden">
                  <div
                    v-for="(item, itemIndex) in workMapView.inbox.slice(0, 8)"
                    :key="item.id"
                    :data-test-id="`work-map-inbox-${item.id}`"
                    class="group/inbox relative z-10 ml-8 flex min-h-8 w-[calc(100%-2rem)] items-center rounded-[7px] before:pointer-events-none before:absolute before:top-2.5 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:border-l after:border-work-map-tree after:content-[''] hover:bg-hover"
                    :class="
                      itemIndex === Math.min(workMapView.inbox.length, 8) - 1
                        ? 'after:h-2.5'
                        : 'after:h-full'
                    "
                  >
                    <button
                      type="button"
                      class="flex min-h-8 min-w-0 flex-1 items-center rounded-[7px] px-2 text-left focus-visible:bg-hover focus-visible:outline-none"
                      :aria-label="`Open Inbox message: ${item.title}`"
                      @click="openInboxItem(item)"
                    >
                      <span class="min-w-0 flex-1">
                        <span
                          class="block truncate text-[11.5px]"
                          :class="item.readAt ? 'text-muted' : 'font-medium text-surface'"
                        >
                          {{ item.title }}
                        </span>
                        <span class="block truncate text-[10px] text-muted/60">
                          {{ formatWorkMapRoutineTime(item.updatedAt) }}
                        </span>
                      </span>
                    </button>
                    <Tip v-if="item.briefing" label="Open briefing object">
                      <button
                        type="button"
                        :data-test-id="`work-map-open-inbox-briefing-${item.id}`"
                        :aria-label="`Open briefing object: ${item.title}`"
                        class="pointer-events-none flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 group-hover/inbox:pointer-events-auto group-hover/inbox:opacity-100 group-focus-within/inbox:pointer-events-auto group-focus-within/inbox:opacity-100"
                        @click.stop="openInboxBriefing(item)"
                      >
                        <icon-lucide-panel-right-open class="size-4 stroke-[1.6]" />
                      </button>
                    </Tip>
                    <Tip label="Archive Inbox message">
                      <button
                        type="button"
                        :data-test-id="`work-map-archive-inbox-${item.id}`"
                        aria-label="Archive Inbox message"
                        class="pointer-events-none mr-1 flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted opacity-0 transition-opacity hover:bg-chrome-control hover:text-surface focus:pointer-events-auto focus:opacity-100 group-hover/inbox:pointer-events-auto group-hover/inbox:opacity-100 group-focus-within/inbox:pointer-events-auto group-focus-within/inbox:opacity-100"
                        @click.stop="archiveInboxItem(item)"
                      >
                        <icon-lucide-archive class="size-4 stroke-[1.6]" />
                      </button>
                    </Tip>
                  </div>
                  <div
                    v-if="!workMapView.inbox.length"
                    class="relative z-10 ml-8 flex h-7 items-center pr-2 pl-2 text-[11.5px] text-muted/55 before:pointer-events-none before:absolute before:top-2 before:-left-3 before:h-1.5 before:w-3 before:rounded-bl-[6px] before:border-b before:border-l before:border-work-map-tree before:content-[''] after:pointer-events-none after:absolute after:top-0 after:-left-3 after:h-2 after:border-l after:border-work-map-tree after:content-['']"
                  >
                    Scheduled runs appear here
                  </div>
                </div>
              </div>
            </Transition>
          </section>

          <WorkMapProjectTree :controller="controller" />

          <section
            v-if="workMapView.globalBots.length"
            data-test-id="work-map-global-bots"
            class="mb-2"
          >
            <WorkMapBotRow
              v-for="bot in workMapView.globalBots"
              :key="bot.id"
              :bot="bot"
              :controller="controller"
            />
          </section>

          <section v-if="workMapView.misc.total" class="relative mb-0.5">
            <div
              data-test-id="work-map-misc-row"
              class="group/misc relative flex h-11 cursor-pointer items-center rounded-[8px] px-1 transition-colors hover:bg-hover"
              :class="workMapDropProjectId === null ? 'bg-accent/10 text-accent' : ''"
              @dragover.stop="showWorkMapProjectDrop($event, null)"
              @dragleave="workMapDropProjectId = undefined"
              @drop="dropWorkMapThread($event, null)"
              @click="toggleWorkMapMisc"
            >
              <button
                type="button"
                class="flex min-w-0 items-center gap-1.5 text-left text-[15px] font-medium text-surface focus-visible:outline-none"
                :aria-label="`${isWorkMapMiscOpen() ? 'Collapse' : 'Expand'} Chats`"
                :aria-expanded="isWorkMapMiscOpen()"
                @click.stop="toggleWorkMapMisc"
              >
                <span class="truncate">Chats</span>
              </button>
              <span class="min-w-0 flex-1" />
              <AgentThreadStatusIndicator
                v-if="workMapMiscActivityStatus()"
                :status="workMapMiscActivityStatus()"
              />
            </div>

            <Transition
              enter-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
              enter-from-class="grid-rows-[0fr] opacity-0"
              enter-to-class="grid-rows-[1fr] opacity-100"
              leave-active-class="grid overflow-hidden transition-[grid-template-rows,opacity] duration-300 ease-in-out motion-reduce:transition-none"
              leave-from-class="grid-rows-[1fr] opacity-100"
              leave-to-class="grid-rows-[0fr] opacity-0"
            >
              <div v-if="isWorkMapMiscOpen()" data-test-id="work-map-misc-content" class="ml-2">
                <div class="min-h-0 overflow-hidden pt-0.5 pb-1">
                  <AgentConversationContextMenu
                    v-for="thread in workMapView.misc.items"
                    :key="thread.id"
                    :thread="thread"
                  >
                    <div
                      role="button"
                      tabindex="0"
                      draggable="true"
                      :data-agent-thread-id="thread.id"
                      :data-test-id="`agent-chat-thread-${thread.id}`"
                      :aria-current="selectedId === thread.id ? 'true' : undefined"
                      :aria-label="`${agentConversationDisplayTitle(thread)}; drag to organize or place on the Board`"
                      class="group/chat relative flex min-h-8 w-full cursor-pointer items-center gap-2 overflow-hidden rounded-[7px] px-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                      :class="[
                        captureDropTargetId === thread.id ? 'bg-accent/10' : '',
                        pressedWorkMapThreadId === thread.id ||
                        draggedWorkMapThreadId === thread.nativeThreadId
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
                      <span
                        v-if="captureDropTargetId === thread.id"
                        aria-hidden="true"
                        class="bg-chrome-raised/95 absolute inset-0 z-10 flex items-center justify-center gap-1.5 text-[12px] font-medium text-accent backdrop-blur-sm"
                      >
                        <icon-lucide-link class="size-3.5 stroke-[1.8]" />
                        Drop to attach
                      </span>
                      <icon-lucide-pin
                        v-if="isAgentConversationPinned(thread)"
                        class="size-3.5 shrink-0 stroke-[1.6] text-muted"
                        aria-label="Pinned"
                      />
                      <span class="min-w-0 flex-1 truncate text-[12.5px] text-surface">
                        {{ agentConversationDisplayTitle(thread) }}
                      </span>
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
                      <AgentThreadStatusIndicator
                        v-if="threadStatus(thread)"
                        :status="threadStatus(thread)"
                      />
                    </div>
                  </AgentConversationContextMenu>
                  <button
                    v-if="workMapView.misc.remaining"
                    type="button"
                    data-test-id="work-map-show-more-misc"
                    :aria-label="`Show ${Math.min(WORK_MAP_MISC_PAGE_SIZE, workMapView.misc.remaining)} more chats`"
                    class="flex h-7 w-full items-center rounded-[7px] px-2 text-left text-[12px] text-muted/70 transition-colors hover:!text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
                    @click.stop="showMoreMiscChats"
                  >
                    Show more
                  </button>
                </div>
              </div>
            </Transition>
          </section>

          <div
            v-if="workMapView.emptySearch"
            class="px-2 py-8 text-center text-[12px] leading-4 text-muted"
          >
            No matching work
          </div>
        </nav>
      </ScrollAreaViewport>
      <AppScrollAreaScrollbar />
    </ScrollAreaRoot>
  </div>

  <DialogRoot
    :open="Boolean(workMapCreateDraft)"
    @update:open="!$event && closeWorkMapCreateDialog()"
  >
    <DialogPortal>
      <DialogOverlay :class="workMapCreateDialog.overlay" />
      <DialogContent data-test-id="work-map-create-dialog" :class="workMapCreateDialog.content">
        <form class="p-4" @submit.prevent="submitWorkMapCreate">
          <DialogTitle :class="workMapCreateDialog.title"> New Bot </DialogTitle>
          <DialogDescription :class="[workMapCreateDialog.description, 'mt-1']">
            <template v-if="workMapCreateDraft?.parentId && workMapCreateDraft.boardPlacement">
              Name the sub-bot being placed inside {{ workMapCreateDraft.parentName }}.
            </template>
            <template v-else-if="workMapCreateDraft?.parentId">
              Add one sub-bot inside {{ workMapCreateDraft.parentName }}.
            </template>
            <template v-else-if="workMapCreateDraft?.boardPlacement">
              Name the Bot directory being placed on the Board.
            </template>
            <template v-else>Create a top-level Bot directory.</template>
          </DialogDescription>
          <input
            :ref="setWorkMapCreateInput"
            v-model="workMapCreateTitle"
            data-test-id="work-map-create-title"
            aria-label="Bot name"
            placeholder="Bot name"
            class="border-chrome-control-border bg-chrome-control mt-4 h-9 w-full rounded-[9px] border px-3 text-[12px] text-surface outline-none placeholder:text-muted/70 focus:border-accent/55 focus:ring-2 focus:ring-accent/15"
          />
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              class="h-8 rounded-[8px] px-3 text-[11px] text-muted hover:bg-hover hover:text-surface"
              @click="closeWorkMapCreateDialog"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="!workMapCreateTitle.trim() || workMapBusy"
              class="h-8 rounded-[8px] bg-accent px-3 text-[11px] font-medium text-white disabled:cursor-default disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <AgentConversationArchiveDialog
    :open="Boolean(archiveConfirmationThread)"
    :title="archiveConfirmationTitle"
    @update:open="handleArchiveDialogOpenChange"
    @confirm="confirmArchiveConversation"
  />
</template>
