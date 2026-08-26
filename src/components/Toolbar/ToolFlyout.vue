<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger
} from 'reka-ui'
import { ref } from 'vue'

import { IconlyArrowDown as IconChevronDown } from '@/components/icons/iconly'

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
  suppressActive = false,
  side = 'right'
} = defineProps<{
  tool: EditorToolDef
  activeTool: Tool
  toolIcons: ToolIconMap
  toolLabels: ToolLabels
  toolShortcuts: Record<Tool, string>
  ui?: ToolbarUi
  mobile?: boolean
  side?: 'right' | 'top'
  suppressActive?: boolean
}>()

const emit = defineEmits<{
  select: [tool: Tool]
}>()

const hoverOpen = ref(false)

function isActiveTool(key: Tool) {
  if (suppressActive) return false
  return (
    tool.key === activeTool || (tool.flyout?.includes(activeTool) ?? false) || key === activeTool
  )
}

function activeKeyForTool() {
  return tool.flyout?.includes(activeTool) ? activeTool : tool.key
}

function selectTool(key: Tool) {
  hoverOpen.value = false
  emit('select', key)
}
</script>

<template>
  <div v-if="mobile" class="flex items-center">
    <ToolButton
      :data-test-id="toolbarToolTestId(activeKeyForTool(), true)"
      :icon="toolIcons[activeKeyForTool()]"
      :label="toolLabels[activeKeyForTool()]"
      :active="isActiveTool(activeKeyForTool())"
      :pressed="isActiveTool(activeKeyForTool())"
      mobile
      @click="emit('select', activeKeyForTool())"
    />

    <DropdownMenuRoot>
      <DropdownMenuTrigger as-child>
        <button
          v-test-id="toolbarFlyoutTestId(tool.key, true)"
          :aria-label="`${toolLabels[activeKeyForTool()]} tool options`"
          class="flex h-8 w-3 cursor-pointer items-center justify-center rounded-[6px] border-none transition-colors select-none"
          :class="
            isActiveTool(activeKeyForTool())
              ? 'bg-accent text-white'
              : 'bg-transparent text-muted active:bg-hover'
          "
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
              v-test-id="toolbarFlyoutItemTestId(sub, true)"
              :class="
                menu().item({
                  class: !suppressActive && subActive ? 'bg-accent text-white' : undefined
                })
              "
              @select="emit('select', sub)"
            >
              <component :is="toolIcons[sub]" class="size-3.5" />
              <span class="flex-1">{{ toolLabels[sub] }}</span>
            </DropdownMenuItem>
          </ToolbarItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenuRoot>
  </div>

  <HoverCardRoot
    v-else
    v-model:open="hoverOpen"
    :open-delay="80"
    :close-delay="160"
    :enable-touch="true"
  >
    <div v-test-id="toolbarFlyoutTestId(tool.key)" class="flex size-8 items-center justify-center">
      <HoverCardTrigger as-child>
        <ToolButton
          :data-test-id="toolbarToolTestId(activeKeyForTool())"
          :icon="toolIcons[activeKeyForTool()]"
          :label="toolLabels[activeKeyForTool()]"
          :active="isActiveTool(activeKeyForTool())"
          :pressed="isActiveTool(activeKeyForTool())"
          @click="selectTool(activeKeyForTool())"
        />
      </HoverCardTrigger>
    </div>

    <HoverCardPortal>
      <HoverCardContent
        :side="side"
        :side-offset="8"
        align="center"
        :class="
          menu().content({
            class: [
              'origin-left data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-left-1 data-[state=open]:zoom-in-95 motion-reduce:animate-none',
              ui?.flyoutContent
            ]
          })
        "
      >
        <button
          v-for="sub in tool.flyout"
          :key="sub"
          v-test-id="toolbarFlyoutItemTestId(sub)"
          type="button"
          :class="
            menu().item({
              class: !suppressActive && sub === activeTool ? 'bg-accent text-white' : undefined
            })
          "
          @click="selectTool(sub)"
        >
          <component :is="toolIcons[sub]" class="size-3.5" />
          <span class="flex-1 text-left">{{ toolLabels[sub] }}</span>
          <AppShortcutText v-if="toolShortcuts[sub]">
            {{ toolShortcuts[sub] }}
          </AppShortcutText>
        </button>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
</template>
