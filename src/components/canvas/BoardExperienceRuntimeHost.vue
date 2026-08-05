<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  boardExperienceSnapshot,
  disposeBoardExperience,
  subscribeBoardExperience,
  syncBoardExperience,
  tickBoardExperience
} from '@/app/board-experience'
import {
  codeObjectRuntimeActivityIntersects,
  subscribeCodeObjectRuntimeActivity
} from '@/app/code-object/runtime-activity'
import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const revision = ref(0)
const runtimeActive = ref(false)
let animationFrameId: number | null = null
let pendingMutationFrame = false
let previousFrameTime = 0
let unsubscribe: Array<() => void> = []

const snapshot = computed(() => {
  void revision.value
  void store.state.currentPageId
  return boardExperienceSnapshot(store)
})

function canRunExperience() {
  const current = snapshot.value
  return (
    !document.hidden &&
    Boolean(current?.running || pendingMutationFrame) &&
    Boolean(current && codeObjectRuntimeActivityIntersects(store, current.componentIds))
  )
}

function ensureAnimationFrame() {
  if (!canRunExperience()) {
    stopAnimationFrame()
    return
  }
  runtimeActive.value = true
  if (animationFrameId !== null) return
  animationFrameId = requestAnimationFrame(runFrame)
}

function stopAnimationFrame() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  pendingMutationFrame = false
  previousFrameTime = 0
  runtimeActive.value = false
}

function sync() {
  const session = syncBoardExperience(store)
  revision.value += 1
  if (session && canRunExperience()) ensureAnimationFrame()
  else stopAnimationFrame()
  return session
}

function processBoardMutation() {
  pendingMutationFrame = true
  if (sync()) ensureAnimationFrame()
  else pendingMutationFrame = false
}

function runFrame(time: number) {
  animationFrameId = null
  const session = syncBoardExperience(store)
  revision.value += 1
  if (!session || !canRunExperience()) {
    stopAnimationFrame()
    return
  }
  const running = session.runtime.getSnapshot().running
  const elapsed = !running || previousFrameTime === 0 ? 0 : time - previousFrameTime
  previousFrameTime = time
  pendingMutationFrame = false
  tickBoardExperience(store, elapsed)
  revision.value += 1
  if (canRunExperience()) ensureAnimationFrame()
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
