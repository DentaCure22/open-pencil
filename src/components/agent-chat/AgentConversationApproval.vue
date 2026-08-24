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
    class="group/message-approval grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-start gap-x-2.5 py-1 text-[12px] text-surface"
    data-test-id="agent-ui-approval"
    :data-state="state"
  >
    <img :src="messagesAppIconUrl" alt="" class="size-8 shrink-0 object-contain" />
    <div class="min-w-0 flex-1" data-test-id="agent-message-approval-content">
      <div class="flex h-5 min-w-0 items-start gap-2">
        <h3
          class="min-w-0 flex-1 truncate pt-px text-[12.5px] font-semibold leading-[18px] tracking-[-0.012em]"
          data-test-id="agent-message-recipient"
        >
          {{ message.recipient }}
        </h3>
      </div>
      <div class="mt-0.5 flex min-w-0 flex-col items-end gap-1">
        <p
          v-for="(text, index) in message.texts"
          :key="`${String(index)}:${text}`"
          class="max-w-full rounded-[16px] rounded-br-[5px] bg-agent-approval-action px-3 py-1.5 text-[12.5px] leading-[17px] break-words whitespace-pre-wrap text-agent-approval-action-foreground"
          data-test-id="agent-message-approval-text"
        >
          {{ text }}
        </p>
        <div
          v-if="state !== 'pending'"
          class="flex h-4 shrink-0 items-center gap-1 pr-0.5 text-[10.5px] font-medium"
          :class="{
            'text-agent-approval-action': state === 'sending' || state === 'sent',
            'text-muted': state === 'cancelled' || state === 'failed'
          }"
          data-test-id="agent-message-approval-status"
          role="status"
        >
          <icon-lucide-loader-circle v-if="state === 'sending'" class="size-3" aria-hidden="true" />
          <icon-lucide-check
            v-else-if="state === 'sent'"
            class="size-3 stroke-[2.2]"
            aria-hidden="true"
          />
          <icon-lucide-x-circle
            v-else-if="state === 'cancelled'"
            class="size-3"
            aria-hidden="true"
          />
          <icon-lucide-circle-alert v-else class="size-3" aria-hidden="true" />
          <span>{{ statusLabel }}</span>
        </div>
        <div
          v-if="state === 'pending'"
          class="flex h-5 items-center gap-4 text-[11.5px] font-medium leading-5"
          data-test-id="agent-message-approval-actions"
        >
          <button
            type="button"
            class="rounded-sm text-muted transition-colors duration-150 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-approval-action/30 disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none"
            :disabled="busy"
            @click="deny"
          >
            Cancel
          </button>
          <button
            type="button"
            :aria-label="busy ? 'Sending messages…' : 'Send'"
            class="rounded-sm text-agent-approval-action transition-colors duration-150 hover:text-agent-approval-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-approval-action/35 disabled:cursor-default disabled:opacity-55 motion-reduce:transition-none"
            :disabled="busy || !approval"
            @click="approve"
          >
            {{ busy ? 'Sending…' : 'Send' }}
          </button>
        </div>
      </div>
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
