<script setup lang="ts">
import CollabSharePopover from '@/components/CollabPanel/CollabSharePopover.vue'
import { provideCollabPanel } from '@/components/CollabPanel/context'

provideCollabPanel()
</script>

<template>
  <div data-test-id="toolbar-collaboration" class="flex items-center justify-end">
    <CollabSharePopover />
  </div>
</template>
