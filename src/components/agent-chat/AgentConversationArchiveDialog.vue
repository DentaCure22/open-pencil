<script setup lang="ts">
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle
} from 'reka-ui'

import { useDialogUI } from '@/components/ui/dialog'

defineProps<{ title: string }>()
const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>('open', { default: false })
const dialog = useDialogUI({
  overlay: 'z-50',
  content: 'w-[360px] max-w-[calc(100vw-32px)] p-4'
})
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="dialog.overlay" />
      <AlertDialogContent data-test-id="agent-conversation-archive-dialog" :class="dialog.content">
        <div class="flex items-start gap-3">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-400/10 text-red-300"
          >
            <icon-lucide-archive class="size-4 stroke-[1.7]" />
          </div>
          <div class="min-w-0 pt-0.5">
            <AlertDialogTitle :class="dialog.title">Archive “{{ title }}”?</AlertDialogTitle>
            <AlertDialogDescription :class="`${dialog.description} mt-1.5 leading-5`">
              Are you sure? This removes the chat from the active Work Map. Its conversation, plan,
              and evidence are kept and can be restored later.
            </AlertDialogDescription>
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <AlertDialogCancel
            type="button"
            class="h-8 rounded-md border border-border bg-canvas px-3 text-xs text-muted transition-colors hover:bg-hover hover:text-surface"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            data-test-id="agent-conversation-archive-confirm"
            type="button"
            class="h-8 rounded-md bg-red-500 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500/90"
            @click="emit('confirm')"
          >
            Archive
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
