<script setup lang="ts">
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'

import type { AgentConversationThread } from '@/app/agent-chat/client'
import { agentConversationMessages, getAgentConversation } from '@/app/agent-chat/client'
import {
  agentConversationCopyText,
  agentConversationDisplayTitle,
  agentConversationLastResponseText,
  isAgentConversationArchived,
  isAgentConversationPinned,
  isAgentConversationUnread,
  setAgentConversationArchived,
  setAgentConversationPinned,
  setAgentConversationTitle,
  setAgentConversationUnread
} from '@/app/agent-chat/thread-preferences'
import { toast } from '@/app/shell/ui'
import { writeTauriClipboardText } from '@/app/tauri/clipboard'
import { useButtonUI } from '@/components/ui/button'
import { useDialogUI } from '@/components/ui/dialog'
import { useInputUI } from '@/components/ui/input'
import { useMenuUI } from '@/components/ui/menu'

const { thread } = defineProps<{ thread: AgentConversationThread | null }>()

const renameOpen = ref(false)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const title = computed(() => (thread ? agentConversationDisplayTitle(thread) : 'Task'))
const pinned = computed(() => Boolean(thread && isAgentConversationPinned(thread)))
const unread = computed(() => Boolean(thread && isAgentConversationUnread(thread)))
const archived = computed(() => Boolean(thread && isAgentConversationArchived(thread)))

const menu = useMenuUI({
  content:
    'w-[196px] rounded-[10px] border-border/75 bg-panel/98 p-1 shadow-[0_12px_32px_rgb(0_0_0/0.18)] backdrop-blur-xl',
  icon: 'size-3.5 shrink-0 stroke-[1.7] text-muted',
  item: 'h-7 rounded-[6px] px-2 py-0 text-[12px] font-normal data-[highlighted]:bg-hover/80',
  separator: 'mx-1 my-1',
  subTrigger: 'h-7 rounded-[6px] px-2 py-0 text-[12px] font-normal data-[highlighted]:bg-hover/80'
})
const dialog = useDialogUI({ content: 'w-[360px] max-w-[calc(100vw-32px)] p-4' })
const input = useInputUI({ ui: { base: 'h-9 rounded-[7px] px-2.5 text-[13px]' } })
const cancelButton = useButtonUI({ bordered: true, size: 'md', tone: 'ghost' })
const submitButton = useButtonUI({ size: 'md', tone: 'accent' })

watch(renameOpen, async (open) => {
  if (!open || !thread) return
  renameValue.value = title.value
  await nextTick()
  renameInput.value?.select()
})

function beginRename() {
  requestAnimationFrame(() => {
    renameOpen.value = true
  })
}

function commitRename() {
  if (!thread) return
  const nextTitle = renameValue.value.trim()
  if (!nextTitle) return
  setAgentConversationTitle(thread, nextTitle)
  renameOpen.value = false
  toast.info('Task renamed')
}

function togglePinned() {
  if (!thread) return
  setAgentConversationPinned(thread, !pinned.value)
  toast.info(pinned.value ? 'Task pinned' : 'Task unpinned')
}

function toggleUnread() {
  if (!thread) return
  setAgentConversationUnread(thread, !unread.value)
  toast.info(unread.value ? 'Marked as unread' : 'Marked as read')
}

function toggleArchived() {
  if (!thread) return
  setAgentConversationArchived(thread, !archived.value)
  toast.info(archived.value ? 'Task archived' : 'Task restored')
}

async function fullThread(): Promise<AgentConversationThread> {
  if (!thread) throw new Error('Task unavailable')
  const remote = await getAgentConversation(thread.nativeThreadId)
  return {
    ...thread,
    createdAt: remote.createdAt,
    effort: remote.effort,
    messages: agentConversationMessages(remote),
    model: remote.model,
    recentUpdate: remote.recentUpdate,
    state: remote.state,
    task: remote.task,
    updatedAt: remote.updatedAt
  }
}

async function writeClipboard(text: string) {
  if (await writeTauriClipboardText(text)) return
  await navigator.clipboard.writeText(text)
}

async function copyConversation(kind: 'conversation' | 'id' | 'last-response') {
  if (!thread || busy.value) return
  busy.value = true
  try {
    let text = thread.nativeThreadId
    let message = 'Task ID copied'
    if (kind !== 'id') {
      const hydrated = await fullThread()
      text =
        kind === 'conversation'
          ? agentConversationCopyText(hydrated)
          : agentConversationLastResponseText(hydrated)
      message = kind === 'conversation' ? 'Conversation copied' : 'Last response copied'
    }
    if (!text) throw new Error('There is no response to copy yet')
    await writeClipboard(text)
    toast.info(message)
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause))
  } finally {
    busy.value = false
  }
}

async function shareConversation() {
  if (!thread || busy.value) return
  busy.value = true
  try {
    const hydrated = await fullThread()
    const text = agentConversationCopyText(hydrated)
    if (typeof navigator.share === 'function') {
      await navigator.share({ text, title: title.value })
      return
    }
    await writeClipboard(text)
    toast.info('Conversation copied for sharing')
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return
    toast.error(cause instanceof Error ? cause.message : String(cause))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <template v-if="thread">
    <ContextMenuRoot :modal="false">
      <ContextMenuTrigger as-child>
        <slot />
      </ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent
          data-test-id="agent-conversation-context-menu"
          :class="menu.content"
          :side-offset="3"
          align="start"
        >
          <ContextMenuItem
            data-test-id="agent-conversation-pin"
            :class="menu.item"
            @select="togglePinned"
          >
            <icon-lucide-pin-off v-if="pinned" :class="menu.icon" />
            <icon-lucide-pin v-else :class="menu.icon" />
            <span>{{ pinned ? 'Unpin' : 'Pin' }}</span>
          </ContextMenuItem>
          <ContextMenuItem
            data-test-id="agent-conversation-rename"
            :class="menu.item"
            @select="beginRename"
          >
            <icon-lucide-pencil :class="menu.icon" />
            <span>Rename</span>
          </ContextMenuItem>
          <ContextMenuItem
            data-test-id="agent-conversation-unread"
            :class="menu.item"
            @select="toggleUnread"
          >
            <icon-lucide-eye :class="menu.icon" />
            <span>{{ unread ? 'Mark as read' : 'Mark as unread' }}</span>
          </ContextMenuItem>
          <ContextMenuItem
            data-test-id="agent-conversation-archive"
            :class="menu.item"
            @select="toggleArchived"
          >
            <icon-lucide-archive-restore v-if="archived" :class="menu.icon" />
            <icon-lucide-archive v-else :class="menu.icon" />
            <span>{{ archived ? 'Unarchive' : 'Archive' }}</span>
          </ContextMenuItem>

          <ContextMenuSeparator :class="menu.separator" />

          <ContextMenuItem
            data-test-id="agent-conversation-share"
            :class="menu.item"
            @select="shareConversation"
          >
            <icon-lucide-share :class="menu.icon" />
            <span>Share</span>
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger data-test-id="agent-conversation-copy" :class="menu.subTrigger">
              <icon-lucide-copy :class="menu.icon" />
              <span class="min-w-0 flex-1">Copy</span>
              <icon-lucide-chevron-right class="size-3.5 shrink-0 stroke-[1.8] text-muted" />
            </ContextMenuSubTrigger>
            <ContextMenuPortal>
              <ContextMenuSubContent :class="menu.content" :side-offset="4">
                <ContextMenuItem
                  data-test-id="agent-conversation-copy-chat"
                  :class="menu.item"
                  @select="copyConversation('conversation')"
                >
                  <icon-lucide-messages-square :class="menu.icon" />
                  <span>Copy conversation</span>
                </ContextMenuItem>
                <ContextMenuItem
                  data-test-id="agent-conversation-copy-response"
                  :class="menu.item"
                  @select="copyConversation('last-response')"
                >
                  <icon-lucide-message-square-reply :class="menu.icon" />
                  <span>Copy last response</span>
                </ContextMenuItem>
                <ContextMenuItem
                  data-test-id="agent-conversation-copy-id"
                  :class="menu.item"
                  @select="copyConversation('id')"
                >
                  <icon-lucide-hash :class="menu.icon" />
                  <span>Copy task ID</span>
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuPortal>
          </ContextMenuSub>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenuRoot>

    <DialogRoot v-model:open="renameOpen">
      <DialogPortal>
        <DialogOverlay :class="dialog.overlay" />
        <DialogContent data-test-id="agent-conversation-rename-dialog" :class="dialog.content">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <DialogTitle :class="dialog.title">Rename task</DialogTitle>
              <DialogDescription :class="`${dialog.description} mt-1`">
                Give this conversation a shorter name in OpenPencil.
              </DialogDescription>
            </div>
            <DialogClose
              type="button"
              aria-label="Close rename dialog"
              class="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-hover hover:text-surface"
            >
              <icon-lucide-x class="size-3.5" />
            </DialogClose>
          </div>
          <form class="mt-4" @submit.prevent="commitRename">
            <label class="block">
              <span class="mb-1.5 block text-[11px] font-medium text-muted">Task name</span>
              <input
                ref="renameInput"
                v-model="renameValue"
                data-test-id="agent-conversation-rename-input"
                :class="input.base"
                aria-label="Task name"
              />
            </label>
            <div class="mt-4 flex justify-end gap-2">
              <DialogClose type="button" :class="cancelButton.base">Cancel</DialogClose>
              <button type="submit" :class="submitButton.base" :disabled="!renameValue.trim()">
                Rename
              </button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </template>
  <slot v-else />
</template>
