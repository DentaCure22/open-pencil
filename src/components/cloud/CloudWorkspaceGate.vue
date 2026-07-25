<script setup lang="ts">
import { useUrlSearchParams } from '@vueuse/core'
import { computed, ref } from 'vue'

import {
  createOpenPencilCloudAccount,
  openPencilCloud,
  retryOpenPencilCloud,
  signInToOpenPencilCloud
} from '@/app/cloud/workspace'
import AppInput from '@/components/ui/AppInput.vue'

const { enabled = true } = defineProps<{ enabled?: boolean }>()
const email = ref('')
const password = ref('')
const creatingAccount = ref(false)
const submitting = ref(false)
const params = useUrlSearchParams('history')
const state = computed(() => openPencilCloud.state.value)
const visible = computed(
  () =>
    enabled && !('test' in params) && openPencilCloud.configured && state.value.status !== 'ready'
)

async function submit() {
  if (!email.value.trim() || password.value.length < 8 || submitting.value) return
  submitting.value = true
  try {
    if (creatingAccount.value) {
      await createOpenPencilCloudAccount(email.value.trim(), password.value)
    } else {
      await signInToOpenPencilCloud(email.value.trim(), password.value)
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div
    v-if="visible"
    data-test-id="openpencil-cloud-gate"
    class="bg-canvas/95 fixed inset-0 z-[100] flex items-center justify-center p-5 backdrop-blur-xl"
  >
    <div class="border-border bg-panel w-full max-w-sm rounded-2xl border p-6 shadow-2xl">
      <div
        class="bg-accent/10 text-accent mb-4 flex size-10 items-center justify-center rounded-xl"
      >
        <icon-lucide-cloud class="size-5" />
      </div>
      <h1 class="text-surface mb-1 text-lg font-semibold">OpenPencil Cloud</h1>
      <p class="text-muted mb-5 text-sm leading-5">
        One shared workspace for you and your cofounder. Boards, folders, and live edits stay in
        sync.
      </p>

      <div v-if="state.status === 'loading'" class="text-muted flex items-center gap-2 text-sm">
        <icon-lucide-loader-circle class="size-4 animate-spin" />
        Connecting your workspace…
      </div>

      <div v-else-if="state.status === 'error'" class="space-y-3">
        <p class="text-sm text-[var(--color-danger-text)]">{{ state.message }}</p>
        <button
          type="button"
          class="bg-accent h-9 w-full cursor-pointer rounded-lg text-sm font-medium text-white hover:bg-accent/90"
          @click="retryOpenPencilCloud"
        >
          Try again
        </button>
      </div>

      <form v-else class="space-y-3" @submit.prevent="submit">
        <AppInput
          v-model="email"
          type="email"
          autocomplete="email"
          aria-label="Email"
          placeholder="Email"
          data-test-id="openpencil-cloud-email"
        />
        <AppInput
          v-model="password"
          type="password"
          :autocomplete="creatingAccount ? 'new-password' : 'current-password'"
          aria-label="Password"
          placeholder="Password (8+ characters)"
          data-test-id="openpencil-cloud-password"
          @enter="submit"
        />
        <p v-if="state.message" class="text-xs text-[var(--color-warning-text)]">
          {{ state.message }}
        </p>
        <button
          type="submit"
          data-test-id="openpencil-cloud-submit"
          class="bg-accent h-9 w-full cursor-pointer rounded-lg text-sm font-medium text-white hover:bg-accent/90 disabled:cursor-default disabled:opacity-50"
          :disabled="!email.trim() || password.length < 8 || submitting"
        >
          {{ submitting ? 'Working…' : creatingAccount ? 'Create account' : 'Sign in' }}
        </button>
        <button
          type="button"
          class="text-muted hover:text-surface w-full cursor-pointer text-xs"
          @click="creatingAccount = !creatingAccount"
        >
          {{ creatingAccount ? 'Already have an account? Sign in' : 'New here? Create an account' }}
        </button>
      </form>
    </div>
  </div>
</template>
