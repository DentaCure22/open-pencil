<script setup lang="ts">
import { computed } from 'vue'

import type { LiveAppRuntimeStatus, ReviewStatus } from '@/app/workspace'
import AppBadge from '@/components/ui/AppBadge.vue'

type WorkspaceStatus = LiveAppRuntimeStatus | ReviewStatus | 'active' | 'archived'

const { status } = defineProps<{ status: WorkspaceStatus }>()

const label = computed(() =>
  status
    .split('-')
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
)

const tone = computed(() => {
  if (status === 'live' || status === 'approved' || status === 'verified' || status === 'applied') {
    return 'bg-green-500/15 text-green-400'
  }
  if (status === 'preview' || status === 'preferred') return 'bg-violet-500/15 text-violet-300'
  if (status === 'loading' || status === 'stale' || status === 'open') {
    return 'bg-amber-500/15 text-amber-300'
  }
  if (status === 'auth-required' || status === 'unavailable' || status === 'rejected') {
    return 'bg-red-500/15 text-red-300'
  }
  return 'bg-hover text-muted'
})
</script>

<template>
  <AppBadge data-test-id="workspace-status-badge" :ui="{ base: tone }">{{ label }}</AppBadge>
</template>
