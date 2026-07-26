<script setup lang="ts">
import { useTimeoutFn, useUrlSearchParams } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import { CLOUD_REQUEST_TIMEOUT_MS } from '@/app/cloud/request'
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
const localFallback = ref(false)
const { start: startCloudDeadline, stop: stopCloudDeadline } = useTimeoutFn(
  () => {
    if (state.value.status === 'loading') localFallback.value = true
  },
  CLOUD_REQUEST_TIMEOUT_MS,
  { immediate: false }
)

watch(
  () => state.value.status,
  (status) => {
    stopCloudDeadline()
    localFallback.value = status === 'error'
    if (status === 'loading') startCloudDeadline()
  },
  { immediate: true }
)

const visible = computed(
  () =>
    enabled && !('test' in params) && openPencilCloud.configured && state.value.status !== 'ready'
)
const usingLocalFallback = computed(
  () => state.value.status === 'error' || (state.value.status === 'loading' && localFallback.value)
)
const blocking = computed(() => !usingLocalFallback.value)

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

async function retryCloud() {
  localFallback.value = false
  startCloudDeadline()
  await retryOpenPencilCloud()
}
</script>

<template>
  <div
    v-if="visible"
    data-test-id="openpencil-cloud-gate"
    :data-cloud-mode="blocking ? 'gate' : 'local-fallback'"
    class="fixed z-[100] flex p-5"
    :class="
      blocking
        ? 'bg-canvas/95 inset-0 items-center justify-center backdrop-blur-xl'
        : 'pointer-events-none right-0 bottom-0'
    "
  >
    <div
      class="border-border bg-panel w-full rounded-2xl border shadow-2xl"
      :class="blocking ? 'max-w-sm p-6' : 'pointer-events-auto max-w-xs p-4'"
    >
      <template v-if="blocking">
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
      </template>

      <div v-if="state.status === 'loading'" class="text-muted flex items-center gap-2 text-sm">
        <icon-lucide-loader-circle class="size-4 animate-spin" />
        Connecting your workspace…
      </div>

      <div v-else-if="usingLocalFallback" class="space-y-3">
        <div class="flex items-start gap-3">
          <div
            class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
          >
            <icon-lucide-cloud-off class="size-4" />
          </div>
          <div class="min-w-0">
            <p class="text-surface text-sm font-medium">Working locally</p>
            <p class="text-muted mt-0.5 text-xs leading-4">
              Cloud sync is unavailable. Your workspace remains open on this device.
            </p>
          </div>
        </div>
        <button
          type="button"
          class="border-border text-surface hover:bg-hover h-8 w-full cursor-pointer rounded-lg border text-xs font-medium"
          @click="retryCloud"
        >
          Try cloud again
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
