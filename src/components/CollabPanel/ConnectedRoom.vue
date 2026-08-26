<script setup lang="ts">
import { selectTarget } from '@open-pencil/vue'
import AppInput from '@/components/ui/AppInput.vue'
import { useCollabPanelContext } from '@/components/CollabPanel/context'

const collab = useCollabPanelContext()
</script>

<template>
  <div v-if="collab.isCloudWorkspace" class="mb-3 rounded-lg border border-border bg-canvas/50 p-3">
    <div class="mb-1 flex items-center gap-2 text-xs font-medium text-surface">
      <span class="size-2 rounded-full bg-[var(--color-success-bg)]" />
      Shared workspace is live
    </div>
    <p class="text-[11px] leading-4 text-muted">
      Boards, folders, and edits are saved automatically.
    </p>
  </div>

  <template v-else>
    <div class="mb-3 text-xs font-medium text-surface">{{ collab.dialogs.roomLink }}</div>
    <div class="mb-3 flex items-center gap-1.5">
      <AppInput
        :model-value="collab.shareUrl"
        readonly
        data-test-id="collab-room-link"
        :ui="{ base: 'min-w-0 flex-1' }"
        @focus="selectTarget($event)"
      />
      <button
        data-test-id="collab-copy-link"
        class="flex h-7 cursor-pointer items-center gap-1 rounded border-none bg-accent px-2 text-xs text-white hover:bg-accent/90"
        @click="collab.copyLink"
      >
        <icon-lucide-check v-if="collab.copied" class="size-3" />
        <icon-lucide-copy v-else class="size-3" />
        {{ collab.copied ? 'Copied' : 'Copy' }}
      </button>
    </div>
  </template>

  <div class="mb-2 text-xs font-medium text-surface">
    {{ collab.peers.length + 1 }} {{ collab.peers.length === 0 ? 'person' : 'people' }} in this room
  </div>

  <button
    v-if="collab.canInviteCofounder"
    data-test-id="collab-copy-cofounder-invite"
    class="mb-2 flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded border-none bg-accent text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
    :disabled="collab.creatingInvite"
    @click="collab.copyCofounderInvite"
  >
    <IconlyIcon name="add-user" class="size-3.5" />
    {{ collab.creatingInvite ? 'Creating invite…' : 'Copy cofounder invite' }}
  </button>

  <button
    data-test-id="collab-disconnect"
    class="flex h-7 w-full cursor-pointer items-center justify-center rounded border border-border bg-transparent text-xs text-muted hover:bg-hover hover:text-surface"
    @click="collab.isCloudWorkspace ? collab.signOutCloud() : collab.disconnect()"
  >
    {{ collab.isCloudWorkspace ? 'Sign out' : 'Disconnect' }}
  </button>
</template>
