<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import workMapBotOriginalStill from '@/assets/work-map-bots/comparison-original-neutral/frames/original-01.png'
import workMapBotOriginalMotion from '@/assets/work-map-bots/comparison-original-neutral/original.webp'
import workMapBotCoralStill from '@/assets/work-map-bots/approved-family/frames/coral-hover-puck-01-rest.png'
import workMapBotGraphiteStill from '@/assets/work-map-bots/approved-family/frames/graphite-utility-01-rest.png'
import workMapBotIvoryStill from '@/assets/work-map-bots/approved-family/frames/ivory-twin-thruster-01-rest.png'
import workMapBotMintStill from '@/assets/work-map-bots/approved-family/frames/mint-round-01-rest.png'
import workMapBotOrangeStill from '@/assets/work-map-bots/approved-family/frames/orange-glider-01-rest.png'
import workMapBotCoralMotion from '@/assets/work-map-bots/approved-family/motion/coral-hover-puck.webp'
import workMapBotGraphiteMotion from '@/assets/work-map-bots/approved-family/motion/graphite-utility.webp'
import workMapBotIvoryMotion from '@/assets/work-map-bots/approved-family/motion/ivory-twin-thruster.webp'
import workMapBotMintMotion from '@/assets/work-map-bots/approved-family/motion/mint-round.webp'
import workMapBotOrangeMotion from '@/assets/work-map-bots/approved-family/motion/orange-glider.webp'

const {
  active = false,
  botId,
  variant = 0
} = defineProps<{
  active?: boolean
  botId: string
  variant?: number
}>()

const IDLE_MOTION_MIN_DELAY_MS = 20_000
const IDLE_MOTION_MAX_DELAY_MS = 60_000
const botVariants = [
  { duration: 2_970, motion: workMapBotOriginalMotion, still: workMapBotOriginalStill },
  { duration: 1_800, motion: workMapBotMintMotion, still: workMapBotMintStill },
  { duration: 1_800, motion: workMapBotIvoryMotion, still: workMapBotIvoryStill },
  { duration: 1_800, motion: workMapBotCoralMotion, still: workMapBotCoralStill },
  { duration: 1_800, motion: workMapBotGraphiteMotion, still: workMapBotGraphiteStill },
  { duration: 1_800, motion: workMapBotOrangeMotion, still: workMapBotOrangeStill }
] as const
const normalizedVariant = computed(() => Math.abs(Math.trunc(variant)) % botVariants.length)
const asset = computed(() => botVariants[normalizedVariant.value] ?? botVariants[0])
const isAnimating = ref(false)
const motionKey = ref(0)
let idleTimer: ReturnType<typeof setTimeout> | undefined
let resetTimer: ReturnType<typeof setTimeout> | undefined
const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const mounted = ref(false)

function clearTimers() {
  if (idleTimer) clearTimeout(idleTimer)
  if (resetTimer) clearTimeout(resetTimer)
  idleTimer = undefined
  resetTimer = undefined
}

function motionAllowed() {
  return !prefersReducedMotion.value && document.visibilityState === 'visible'
}

function idleMotionDelay() {
  const sample = new Uint32Array(1)
  crypto.getRandomValues(sample)
  const fraction = (sample[0] ?? 0) / 2 ** 32
  return Math.round(
    IDLE_MOTION_MIN_DELAY_MS + fraction * (IDLE_MOTION_MAX_DELAY_MS - IDLE_MOTION_MIN_DELAY_MS)
  )
}

function scheduleMotion() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
  if (!motionAllowed()) return
  idleTimer = setTimeout(playMotion, active ? 80 : idleMotionDelay())
}

function playMotion() {
  idleTimer = undefined
  if (!motionAllowed()) {
    scheduleMotion()
    return
  }
  motionKey.value += 1
  isAnimating.value = true
  resetTimer = setTimeout(() => {
    isAnimating.value = false
    resetTimer = undefined
    scheduleMotion()
  }, asset.value.duration)
}

function refreshMotionSchedule() {
  clearTimers()
  isAnimating.value = false
  if (!mounted.value) return
  scheduleMotion()
}

onMounted(() => {
  mounted.value = true
  refreshMotionSchedule()
})

watch(prefersReducedMotion, refreshMotionSchedule)
watch(() => active, refreshMotionSchedule)
useEventListener(document, 'visibilitychange', refreshMotionSchedule)

onBeforeUnmount(() => {
  mounted.value = false
  clearTimers()
})
</script>

<template>
  <picture
    aria-hidden="true"
    :data-test-id="`work-map-bot-avatar-${botId}`"
    :data-active="active ? 'true' : 'false'"
    :data-variant="normalizedVariant"
    class="inline-flex shrink-0 items-center justify-center"
  >
    <source media="(prefers-reduced-motion: reduce)" :srcset="asset.still" />
    <img
      :key="isAnimating ? `motion-${motionKey}` : 'still'"
      :src="isAnimating ? asset.motion : asset.still"
      alt=""
      draggable="false"
      class="block h-full w-full scale-[1.08] select-none object-contain"
    />
  </picture>
</template>
