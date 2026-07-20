<script setup lang="ts">
import { useMobileHudContext } from '@/components/MobileHud/context'

const hud = useMobileHudContext()
</script>

<template>
  <button
    class="flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-muted transition-colors select-none hover:bg-hover hover:text-surface active:bg-hover"
    @click="hud.share"
  >
    <icon-lucide-share-2 class="size-3.5" />
  </button>
</template>
