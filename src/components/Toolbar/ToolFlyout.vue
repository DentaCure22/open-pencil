<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'

import IconChevronDown from '~icons/lucide/chevron-down'

import AppShortcutText from '@/components/ui/AppShortcutText.vue'
import { menu } from '@/components/ui/menu'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import {
  toolbarFlyoutItemTestId,
  toolbarFlyoutTestId,
  toolbarToolTestId,
  vTestId,
  ToolbarItem
} from '@open-pencil/vue'

import type { Tool } from '@open-pencil/vue'
import type { EditorToolDef } from '@open-pencil/core/editor'
import type { ToolbarUi, ToolIconMap, ToolLabels } from '@/components/Toolbar/types'

const {
  tool,
  activeTool,
  toolIcons,
  toolLabels,
  toolShortcuts,
  ui,
  mobile = false,
  suppressActive = false
} = defineProps<{
  tool: EditorToolDef
  activeTool: Tool
  toolIcons: ToolIconMap
  toolLabels: ToolLabels
  toolShortcuts: Record<Tool, string>
  ui?: ToolbarUi
  mobile?: boolean
  suppressActive?: boolean
}>()

const emit = defineEmits<{
  select: [tool: Tool]
}>()

defineSlots<{
  default(props: { label: string }): unknown
}>()

function isActiveTool(key: Tool) {
  if (suppressActive) return false
  return (
    tool.key === activeTool || (tool.flyout?.includes(activeTool) ?? false) || key === activeTool
  )
}

function activeKeyForTool() {
  return tool.flyout?.includes(activeTool) ? activeTool : tool.key
}
</script>

<template>
  <div class="flex items-center">
    <slot :label="`${toolLabels[activeKeyForTool()]} (${tool.shortcut})`">
      <ToolButton
        :data-test-id="toolbarToolTestId(activeKeyForTool(), mobile)"
        :icon="toolIcons[activeKeyForTool()]"
        :label="toolLabels[activeKeyForTool()]"
        :active="isActiveTool(activeKeyForTool())"
        :mobile="mobile"
        @click="emit('select', activeKeyForTool())"
      />
    </slot>

    <DropdownMenuRoot>
      <DropdownMenuTrigger as-child>
        <button
          v-test-id="toolbarFlyoutTestId(tool.key, mobile)"
          :aria-label="`${toolLabels[activeKeyForTool()]} tool options`"
          class="flex h-8 w-3 cursor-pointer items-center justify-center border-none transition-colors"
          :class="[
            mobile ? 'rounded-[6px] select-none' : 'rounded-lg',
            isActiveTool(activeKeyForTool())
              ? 'bg-accent text-white'
              : mobile
                ? 'bg-transparent text-muted active:bg-hover'
                : 'bg-transparent text-muted hover:bg-hover hover:text-surface'
          ]"
        >
          <IconChevronDown class="size-2.5" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuPortal>
        <DropdownMenuContent side="top" :side-offset="8" align="start" :class="ui?.flyoutContent">
          <ToolbarItem
            v-for="sub in tool.flyout"
            :key="sub"
            v-slot="{ active: subActive }"
            :tool="sub"
          >
            <DropdownMenuItem
              v-test-id="toolbarFlyoutItemTestId(sub, mobile)"
              :class="
                menu().item({
                  class: !suppressActive && subActive ? 'bg-accent text-white' : undefined
                })
              "
              @select="emit('select', sub)"
            >
              <component :is="toolIcons[sub]" class="size-3.5" />
              <span class="flex-1">{{ toolLabels[sub] }}</span>
              <AppShortcutText v-if="!mobile && toolShortcuts[sub]">
                {{ toolShortcuts[sub] }}
              </AppShortcutText>
            </DropdownMenuItem>
          </ToolbarItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </div>
</template>
