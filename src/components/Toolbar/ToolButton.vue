<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core'
import { AnimatePresence, motion } from 'motion-v'
import { ToolbarButton } from 'reka-ui'

import type { Component } from 'vue'

interface ToolButtonProps {
  icon: Component
  label: string
  active?: boolean
  mobile?: boolean
  pressed?: boolean
  variant?: 'tool' | 'utility'
}

const {
  icon,
  label,
  active = false,
  mobile = false,
  pressed,
  variant = 'tool'
} = defineProps<ToolButtonProps>()
const reducedMotion = usePreferredReducedMotion()

const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <ToolbarButton as-child>
    <button
      :aria-label="label"
      :aria-pressed="pressed"
      type="button"
      class="relative z-10 flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden border-none outline-none transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-chrome"
      :class="[
        mobile ? 'rounded-[6px] select-none' : 'rounded-full',
        active
          ? mobile
            ? 'bg-accent text-white'
            : variant === 'utility'
              ? 'bg-chrome-control-active text-surface shadow-sm ring-1 ring-inset ring-chrome-control-border'
              : 'bg-transparent text-white'
          : mobile
            ? 'bg-transparent text-muted active:bg-hover'
            : 'bg-transparent text-muted hover:bg-hover hover:text-surface'
      ]"
      @click="emit('click')"
    >
      <AnimatePresence mode="popLayout" :initial="false">
        <motion.span
          :key="label"
          class="absolute inset-0 flex items-center justify-center"
          :initial="reducedMotion === 'reduce' ? false : { opacity: 0, scale: 0.72, y: 4 }"
          :animate="{ opacity: 1, scale: 1, y: 0 }"
          :exit="reducedMotion === 'reduce' ? { opacity: 0 } : { opacity: 0, scale: 0.72, y: -4 }"
          :transition="{
            duration: reducedMotion === 'reduce' ? 0 : 0.16,
            ease: [0.2, 0.8, 0.2, 1]
          }"
        >
          <component :is="icon" class="size-4" />
        </motion.span>
      </AnimatePresence>
    </button>
  </ToolbarButton>
</template>
