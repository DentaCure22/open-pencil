<script setup lang="ts">
import { computed } from 'vue'

import {
  approveExtensionUiRequest,
  denyExtensionUiRequest,
  messageApprovalPreview,
  type MessageApprovalPreview,
  type MessageApprovalState
} from '@/app/agent-chat/approval'
import type { AgentExtensionUiRequest, AgentExtensionUiResponse } from '@/app/agent-chat/client'
import messagesAppIconUrl from '@/assets/messages-app-icon.png'

const {
  busy = false,
  preview,
  request,
  state = 'pending'
} = defineProps<{
  busy?: boolean
  preview?: MessageApprovalPreview
  request?: AgentExtensionUiRequest
  state?: MessageApprovalState
}>()

const emit = defineEmits<{
  respond: [requestId: string, response: AgentExtensionUiResponse]
}>()

const message = computed(() => preview ?? (request ? messageApprovalPreview(request) : null))
const approval = computed(() => (request ? approveExtensionUiRequest(request) : null))
const statusLabel = computed(() => {
  if (state === 'sending') return 'Sending'
  if (state === 'sent') return 'Sent'
  if (state === 'cancelled') return 'Cancelled'
  if (state === 'failed') return 'Not sent'
  return ''
})

function approve() {
  if (request && approval.value) emit('respond', request.id, approval.value)
}

function deny() {
  if (request) {
    emit('respond', request.id, denyExtensionUiRequest(request))
  }
}
</script>

<template>
  <section
    v-if="message"
    class="flex min-h-[50px] items-center gap-2.5 rounded-[12px] border border-agent-approval-border bg-agent-approval-surface px-2 py-1.5 text-[12px] text-surface"
    data-test-id="agent-ui-approval"
    :data-state="state"
  >
    <img :src="messagesAppIconUrl" alt="" class="size-8 shrink-0 object-contain" />
    <div class="min-w-0 flex-1">
      <h3
        class="truncate text-[12.5px] font-semibold tracking-[-0.015em]"
        data-test-id="agent-message-recipient"
      >
        Message {{ message.recipient }}
      </h3>
      <p
        class="line-clamp-2 text-[11px] leading-[15px] text-muted"
        data-test-id="agent-message-approval-text"
      >
        {{ message.text }}
      </p>
    </div>
    <div v-if="state === 'pending'" class="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        class="h-7 rounded-full px-1 font-semibold text-muted transition-colors duration-150 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-approval-action/30 disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none"
        :disabled="busy"
        @click="deny"
      >
        Cancel
      </button>
      <button
        type="button"
        :aria-label="busy ? 'Sending message…' : 'Send'"
        class="flex size-8 items-center justify-center rounded-full bg-agent-approval-action text-agent-approval-action-foreground transition-[background-color,opacity,transform] duration-150 hover:bg-agent-approval-action-hover active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-approval-action/35 disabled:cursor-default disabled:opacity-55 disabled:active:scale-100 motion-reduce:transition-none"
        :disabled="busy || !approval"
        @click="approve"
      >
        <icon-lucide-loader-circle v-if="busy" class="size-3.5 animate-spin" aria-hidden="true" />
        <icon-lucide-arrow-up v-else class="size-4 stroke-[2]" aria-hidden="true" />
      </button>
    </div>
    <div
      v-else
      class="flex min-w-[76px] shrink-0 items-center justify-center gap-1.5 font-semibold"
      :class="{
        'text-agent-approval-action': state === 'sending',
        'text-muted': state === 'cancelled',
        'text-[var(--color-success)]': state === 'sent',
        'text-[var(--color-warning-action)]': state === 'failed'
      }"
      data-test-id="agent-message-approval-status"
      role="status"
    >
      <icon-lucide-loader-circle
        v-if="state === 'sending'"
        class="size-3.5 animate-spin"
        aria-hidden="true"
      />
      <icon-lucide-check-circle-2
        v-else-if="state === 'sent'"
        class="size-3.5"
        aria-hidden="true"
      />
      <icon-lucide-x-circle v-else-if="state === 'cancelled'" class="size-3.5" aria-hidden="true" />
      <icon-lucide-circle-alert v-else class="size-3.5" aria-hidden="true" />
      <span>{{ statusLabel }}</span>
    </div>
  </section>

  <section
    v-else-if="request"
    class="overflow-hidden rounded-[14px] border border-agent-approval-border bg-agent-approval-surface text-[12px] text-surface"
    data-test-id="agent-ui-approval"
  >
    <div class="p-3">
      <div class="flex items-center gap-2.5">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-agent-approval-action/12 text-agent-approval-action ring-1 ring-agent-approval-action/15"
          aria-hidden="true"
        >
          <icon-lucide-shield-check class="size-4 stroke-[1.7]" />
        </span>
        <div class="min-w-0 flex-1">
          <h3 class="text-[13px] font-semibold tracking-[-0.01em]">Allow this action?</h3>
          <p class="mt-0.5 text-[10.5px] leading-4 text-muted">Review before continuing.</p>
        </div>
      </div>
      <p
        class="mt-3 max-h-36 overflow-auto rounded-[11px] bg-hover/65 px-3 py-2.5 leading-5 whitespace-pre-wrap text-muted ring-1 ring-border/50 overscroll-contain"
      >
        {{ request.message || request.title }}
      </p>
    </div>
    <div class="flex justify-end gap-2 px-3 pb-3">
      <button
        type="button"
        class="h-8 rounded-full px-3 font-medium text-muted hover:bg-hover hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-approval-action/30 disabled:opacity-45"
        :disabled="busy"
        @click="deny"
      >
        Cancel
      </button>
      <button
        type="button"
        class="h-8 rounded-full bg-agent-approval-action px-4 font-semibold text-agent-approval-action-foreground hover:bg-agent-approval-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-approval-action/35 disabled:opacity-55"
        :disabled="busy || !approval"
        @click="approve"
      >
        {{ busy ? 'Allowing…' : 'Allow' }}
      </button>
    </div>
  </section>
</template>
