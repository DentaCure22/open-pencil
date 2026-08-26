<script setup lang="ts">
import { ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
</script>

<template>
  <ScrollAreaScrollbar orientation="vertical" class="flex w-1.5 touch-none p-px select-none">
    <ScrollAreaThumb class="relative flex-1 rounded-full bg-muted/30" />
  </ScrollAreaScrollbar>
</template>
