<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { onMounted, onUnmounted, ref, shallowRef } from 'vue'

import {
  disposeBoardExperience,
  subscribeBoardExperience,
  syncBoardExperience,
  type BoardExperienceSession,
  type BoardExperienceSnapshot
} from '@/app/board-experience'
import {
  codeObjectRuntimeActivityIntersects,
  subscribeCodeObjectRuntimeActivity
} from '@/app/code-object/runtime-activity'
import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const snapshot = shallowRef<BoardExperienceSnapshot | null>(null)
const runtimeActive = ref(false)
const EXPERIENCE_TICK_INTERVAL_MS = 1000 / 30
const MAX_EXPERIENCE_ELAPSED_MS = 100
let animationFrameId: number | null = null
let pendingMutationFrame = false
let session: BoardExperienceSession | null = null
let accumulatedElapsedMs = 0
let previousFrameTime = 0
let unsubscribe: Array<() => void> = []

function canRunExperience(current: BoardExperienceSnapshot | null) {
  return (
    !document.hidden &&
    Boolean(current?.running || pendingMutationFrame) &&
    Boolean(current && codeObjectRuntimeActivityIntersects(store, current.componentIds))
  )
}

function ensureAnimationFrame() {
  runtimeActive.value = true
  if (animationFrameId !== null) return
  animationFrameId = requestAnimationFrame(runFrame)
}

function stopAnimationFrame() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  pendingMutationFrame = false
  accumulatedElapsedMs = 0
  previousFrameTime = 0
  runtimeActive.value = false
}

function sync() {
  session = syncBoardExperience(store)
  snapshot.value = session?.runtime.getSnapshot() ?? null
  if (canRunExperience(snapshot.value)) ensureAnimationFrame()
  else stopAnimationFrame()
}

function processBoardMutation() {
  pendingMutationFrame = true
  sync()
}

function runFrame(time: number) {
  animationFrameId = null
  const currentSession = session
  const currentSnapshot = snapshot.value
  if (!currentSession || !currentSnapshot || !canRunExperience(currentSnapshot)) {
    stopAnimationFrame()
    return
  }
  const running = currentSnapshot.running
  const elapsed =
    !running || previousFrameTime === 0
      ? 0
      : Math.min(MAX_EXPERIENCE_ELAPSED_MS, time - previousFrameTime)
  previousFrameTime = time
  accumulatedElapsedMs += elapsed
  const processMutation = pendingMutationFrame
  pendingMutationFrame = false
  if (!processMutation && running && accumulatedElapsedMs < EXPERIENCE_TICK_INTERVAL_MS) {
    ensureAnimationFrame()
    return
  }

  currentSession.runtime.tick(accumulatedElapsedMs)
  accumulatedElapsedMs = 0
  snapshot.value = currentSession.runtime.getSnapshot()
  if (canRunExperience(snapshot.value)) ensureAnimationFrame()
  else stopAnimationFrame()
}

useEventListener(document, 'visibilitychange', sync)

onMounted(() => {
  unsubscribe = [
    subscribeBoardExperience(store, sync),
    subscribeCodeObjectRuntimeActivity(store, sync),
    store.onEditorEvent('graph:replaced', sync),
    store.onEditorEvent('page:changed', sync),
    store.onEditorEvent('node:created', sync),
    store.onEditorEvent('node:deleted', sync),
    store.onEditorEvent('node:updated', processBoardMutation)
  ]
  sync()
})

onUnmounted(() => {
  stopAnimationFrame()
  for (const stop of unsubscribe) stop()
  unsubscribe = []
  disposeBoardExperience(store)
})
</script>

<template>
  <div
    v-if="snapshot"
    class="hidden"
    data-test-id="board-experience-runtime"
    :data-board-experience-id="snapshot.definitionId"
    :data-board-experience-runtime-active="runtimeActive"
  />
</template>
