<script setup lang="ts">
const { expanded, visible } = defineProps<{
  expanded: boolean
  visible: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()
</script>

<template>
  <button
    v-if="visible"
    type="button"
    data-test-id="layers-item-disclosure"
    class="flex w-4 shrink-0 cursor-pointer items-center justify-center text-muted transition-transform hover:text-surface"
    :class="expanded ? 'rotate-90' : 'rotate-0'"
    @click.stop="emit('toggle')"
  >
    <IconlyIcon name="arrow-right" class="size-3" />
  </button>
  <span v-else class="w-4 shrink-0" />
</template>
