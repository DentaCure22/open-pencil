<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { templateRef } from '@vueuse/core'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  RadioGroupItem,
  RadioGroupRoot
} from 'reka-ui'

import { BOARD_ICON_OPTIONS, type BoardIconKey } from '@/app/sidebar-workspace/icons'
import BoardIcon from '@/components/pages-panel/BoardIcon.vue'
import { useButtonUI } from '@/components/ui/button'
import { useDialogUI } from '@/components/ui/dialog'
import { useInputUI } from '@/components/ui/input'

type BoardIdentityDialogMode = 'create' | 'icon'

const {
  boardLabel = '',
  initialIcon = 'canvas',
  mode
} = defineProps<{
  boardLabel?: string
  initialIcon?: BoardIconKey
  mode: BoardIdentityDialogMode
}>()
const emit = defineEmits<{ submit: [name: string, icon: BoardIconKey] }>()
const open = defineModel<boolean>('open', { default: false })
const nameInput = templateRef<HTMLInputElement>('nameInput')
const name = ref('Untitled board')
const selectedIcon = ref<BoardIconKey>('canvas')
const dialog = useDialogUI({
  overlay: 'z-[90]',
  content:
    'z-[91] w-[360px] max-w-[calc(100vw-32px)] border-white/[0.085] bg-[#17181d]/98 p-4 shadow-[0_22px_70px_rgba(0,0,0,0.52)] backdrop-blur-2xl'
})
const input = useInputUI({ ui: { base: 'h-9 rounded-[7px] px-2.5 text-[13px]' } })
const cancelButton = useButtonUI({ bordered: true, size: 'md', tone: 'ghost' })
const submitButton = useButtonUI({ size: 'md', tone: 'accent' })

watch(open, (isOpen) => {
  if (!isOpen) return
  selectedIcon.value = initialIcon
  name.value = mode === 'create' ? 'Untitled board' : boardLabel
  if (mode === 'create') {
    void nextTick(() => nameInput.value?.select())
  }
})

function submit() {
  const cleanName = name.value.trim() || 'Untitled board'
  emit('submit', cleanName, selectedIcon.value)
  open.value = false
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay :class="dialog.overlay" />
      <DialogContent data-test-id="board-identity-dialog" :class="dialog.content">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <DialogTitle :class="dialog.title">
              {{ mode === 'create' ? 'New board' : 'Choose board icon' }}
            </DialogTitle>
            <DialogDescription :class="`${dialog.description} mt-1`">
              {{
                mode === 'create'
                  ? 'Give this board a recognizable dock identity.'
                  : `Choose the symbol used for “${boardLabel}”.`
              }}
            </DialogDescription>
          </div>
          <DialogClose
            type="button"
            aria-label="Close board dialog"
            class="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-hover hover:text-surface"
          >
            <icon-lucide-x class="size-3.5" />
          </DialogClose>
        </div>

        <form class="mt-4" @submit.prevent="submit">
          <label v-if="mode === 'create'" class="block">
            <span class="mb-1.5 block text-[11px] font-medium text-muted">Board name</span>
            <input
              ref="nameInput"
              v-model="name"
              data-test-id="board-name-input"
              :class="input.base"
              aria-label="Board name"
            />
          </label>

          <fieldset :class="mode === 'create' ? 'mt-4' : ''">
            <legend class="mb-2 text-[11px] font-medium text-muted">Board icon</legend>
            <RadioGroupRoot
              v-model="selectedIcon"
              class="grid grid-cols-4 gap-2"
              aria-label="Board icon"
            >
              <RadioGroupItem
                v-for="option in BOARD_ICON_OPTIONS"
                :key="option.key"
                :value="option.key"
                :aria-label="option.label"
                :data-test-id="`board-icon-option-${option.key}`"
                class="group/icon relative flex h-[58px] flex-col items-center justify-center gap-1.5 rounded-[8px] border border-white/[0.07] bg-white/[0.025] text-muted outline-none transition-colors hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/55 data-[state=checked]:border-accent/45 data-[state=checked]:bg-accent/12 data-[state=checked]:text-violet-100"
              >
                <BoardIcon :icon="option.key" class="size-[17px] stroke-[1.55]" />
                <span class="text-[9.5px] leading-none">{{ option.label }}</span>
                <span
                  v-if="selectedIcon === option.key"
                  class="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-violet-300"
                  aria-hidden="true"
                />
              </RadioGroupItem>
            </RadioGroupRoot>
          </fieldset>

          <div class="mt-4 flex justify-end gap-2">
            <DialogClose as-child>
              <button type="button" :class="cancelButton.base">Cancel</button>
            </DialogClose>
            <button data-test-id="board-identity-submit" type="submit" :class="submitButton.base">
              {{ mode === 'create' ? 'Create board' : 'Use icon' }}
            </button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
