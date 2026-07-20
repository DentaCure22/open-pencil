<script setup lang="ts">
import { computed } from 'vue'

import type { LearningOutcome, LiveAppRuntimeStatus, ReviewStatus } from '@/app/workspace'
import AppBadge from '@/components/ui/AppBadge.vue'

type WorkspaceStatus =
  | LearningOutcome
  | LiveAppRuntimeStatus
  | ReviewStatus
  | 'active'
  | 'applied'
  | 'archived'
  | 'authorized'
  | 'decided'
  | 'in-review'
  | 'proposed'
  | 'required'
  | 'restored'
  | 'revised'
  | 'rollback-failed'
  | 'rolled-back'

const { status } = defineProps<{ status: WorkspaceStatus }>()

const label = computed(() =>
  status
    .split('-')
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(' ')
)

const tone = computed(() => {
  if (
    status === 'live' ||
    status === 'approved' ||
    status === 'verified' ||
    status === 'applied' ||
    status === 'restored' ||
    status === 'rolled-back' ||
    status === 'passed'
  ) {
    return 'bg-green-500/15 text-green-400'
  }
  if (status === 'preview' || status === 'preferred') return 'bg-violet-500/15 text-violet-300'
  if (status === 'loading' || status === 'stale' || status === 'open') {
    return 'bg-amber-500/15 text-amber-300'
  }
  if (
    status === 'auth-required' ||
    status === 'unavailable' ||
    status === 'rejected' ||
    status === 'failed' ||
    status === 'abandoned'
  ) {
    return 'bg-red-500/15 text-red-300'
  }
  return 'bg-hover text-muted'
})
</script>

<template>
  <AppBadge data-test-id="workspace-status-badge" :ui="{ base: tone }">{{ label }}</AppBadge>
</template>
