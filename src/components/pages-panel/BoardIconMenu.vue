<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'

import {
  BOARD_ICON_OPTIONS,
  isBoardIconKey,
  type BoardIconKey
} from '@/app/sidebar-workspace/icons'
import BoardIcon from '@/components/pages-panel/BoardIcon.vue'

const { boardLabel, modelValue } = defineProps<{
  boardLabel: string
  modelValue: BoardIconKey
}>()
const emit = defineEmits<{
  closed: []
  'update:modelValue': [value: BoardIconKey]
}>()
const open = defineModel<boolean>('open', { default: false })

function updateIcon(value: unknown) {
  if (isBoardIconKey(value)) emit('update:modelValue', value)
}

function closeAndRestoreRename(event: Event) {
  event.preventDefault()
  emit('closed')
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-test-id="board-rename-icon-trigger"
        :data-board-icon="modelValue"
        :aria-label="`Change icon for ${boardLabel}`"
        class="group/icon-menu relative mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-[5px] border border-white/[0.09] bg-white/[0.035] text-muted outline-none transition-colors hover:border-white/[0.14] hover:bg-white/[0.07] hover:text-surface focus-visible:ring-2 focus-visible:ring-accent/45 data-[state=open]:border-accent/40 data-[state=open]:bg-accent/12 data-[state=open]:text-violet-100"
        @click.stop
      >
        <BoardIcon :icon="modelValue" class="size-[14px] stroke-[1.5]" />
        <icon-lucide-chevron-down
          class="absolute right-0.5 bottom-0.5 size-[7px] stroke-[2] text-current/65"
        />
      </button>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        data-test-id="board-rename-icon-menu"
        :side-offset="5"
        align="start"
        class="z-[130] w-[184px] rounded-[9px] border border-white/[0.09] bg-[#202126]/[.98] p-1.5 text-[#f1f1f3] shadow-[0_14px_38px_rgba(0,0,0,0.46)] backdrop-blur-xl outline-none"
        @close-auto-focus="closeAndRestoreRename"
      >
        <DropdownMenuRadioGroup
          :model-value="modelValue"
          class="grid grid-cols-4 gap-1"
          @update:model-value="updateIcon"
        >
          <DropdownMenuRadioItem
            v-for="option in BOARD_ICON_OPTIONS"
            :key="option.key"
            :value="option.key"
            :text-value="option.label"
            :aria-label="option.label"
            :data-test-id="`board-rename-icon-option-${option.key}`"
            class="relative flex h-11 cursor-default flex-col items-center justify-center gap-1 rounded-[6px] text-muted outline-none transition-colors data-[highlighted]:bg-white/[0.07] data-[highlighted]:text-surface data-[state=checked]:bg-accent/14 data-[state=checked]:text-violet-100"
          >
            <BoardIcon :icon="option.key" class="size-[15px] stroke-[1.5]" />
            <span class="text-[8.5px] leading-none">{{ option.label }}</span>
            <DropdownMenuItemIndicator
              class="absolute top-1 right-1 size-1.5 rounded-full bg-violet-300"
            />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
