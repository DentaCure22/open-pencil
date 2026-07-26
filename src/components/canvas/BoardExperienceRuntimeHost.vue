<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  boardExperienceSnapshot,
  disposeBoardExperience,
  subscribeBoardExperience,
  syncBoardExperience,
  tickBoardExperience
} from '@/app/board-experience'
import { useEditorStore } from '@/app/editor/active-store'

const store = useEditorStore()
const revision = ref(0)
let animationFrameId: number | null = null
let previousFrameTime = 0
let unsubscribe: Array<() => void> = []

const snapshot = computed(() => {
  void revision.value
  void store.state.currentPageId
  return boardExperienceSnapshot(store)
})

function ensureAnimationFrame() {
  if (animationFrameId !== null) return
  animationFrameId = requestAnimationFrame(runFrame)
}

function stopAnimationFrame() {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
  animationFrameId = null
  previousFrameTime = 0
}

function sync() {
  const session = syncBoardExperience(store)
  revision.value += 1
  if (session?.runtime.getSnapshot().running) ensureAnimationFrame()
  else stopAnimationFrame()
  return session
}

function processBoardMutation() {
  if (sync()) ensureAnimationFrame()
}

function runFrame(time: number) {
  animationFrameId = null
  const session = syncBoardExperience(store)
  if (!session) {
    previousFrameTime = 0
    return
  }
  const running = session.runtime.getSnapshot().running
  const elapsed = !running || previousFrameTime === 0 ? 0 : time - previousFrameTime
  previousFrameTime = time
  tickBoardExperience(store, elapsed)
  if (session.runtime.getSnapshot().running) ensureAnimationFrame()
  else previousFrameTime = 0
}

onMounted(() => {
  unsubscribe = [
    subscribeBoardExperience(store, sync),
    store.onEditorEvent('graph:replaced', sync),
    store.onEditorEvent('page:changed', sync),
    store.onEditorEvent('node:created', processBoardMutation),
    store.onEditorEvent('node:deleted', processBoardMutation),
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
  />
</template>
