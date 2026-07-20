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

const { boardLabel, boardPageId } = defineProps<{
  boardLabel: string
  boardPageId: string
}>()
const emit = defineEmits<{
  confirm: [boardPageId: string]
}>()
const open = defineModel<boolean>('open', { default: false })
const cls = useDialogUI({
  overlay: 'z-50',
  content: 'w-[360px] max-w-[calc(100vw-32px)] p-4'
})
</script>

<template>
  <AlertDialogRoot v-model:open="open">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="cls.overlay" />
      <AlertDialogContent data-test-id="board-delete-dialog" :class="cls.content">
        <div class="flex items-start gap-3">
          <div
            class="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-400/10 text-red-300"
          >
            <icon-lucide-trash-2 class="size-4" />
          </div>
          <div class="min-w-0 pt-0.5">
            <AlertDialogTitle :class="cls.title"> Delete “{{ boardLabel }}”? </AlertDialogTitle>
            <AlertDialogDescription :class="`${cls.description} mt-1.5 leading-5`">
              This will permanently delete the board and everything on it. This action cannot be
              undone.
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
            data-test-id="board-delete-confirm"
            type="button"
            class="h-8 rounded-md bg-red-500 px-3 text-xs font-medium text-white transition-colors hover:bg-red-500/90"
            @click="emit('confirm', boardPageId)"
          >
            Delete board
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
