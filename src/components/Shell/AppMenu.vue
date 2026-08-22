<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarItemIndicator,
  MenubarMenu,
  MenubarPortal,
  MenubarRoot,
  MenubarSeparator,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger
} from 'reka-ui'

import IconChevronRight from '~icons/lucide/chevron-right'
import IconFile from '~icons/lucide/file'
import IconMonitor from '~icons/lucide/monitor'
import IconMoon from '~icons/lucide/moon'
import IconSettings from '~icons/lucide/settings'
import IconSlidersHorizontal from '~icons/lucide/sliders-horizontal'
import IconSun from '~icons/lucide/sun'

import { vTestId } from '@open-pencil/vue'
import AppShortcutText from '@/components/ui/AppShortcutText.vue'
import { useMenuUI } from '@/components/ui/menu'
import { usePopoverUI } from '@/components/ui/popover'
import ToolButton from '@/components/Toolbar/ToolButton.vue'
import { useAppMenu } from '@/app/shell/menu/app-menu'
import {
  hasMenuSubItems,
  isMenuCheckbox,
  isMenuSeparator,
  menuChecked,
  menuDisabled,
  menuLabel,
  menuShortcut,
  menuSubItems,
  runMenuAction,
  updateMenuChecked
} from '@/app/shell/menu/entry'
import { useEditorStore } from '@/app/editor/active-store'
import { useAppTheme, type AppTheme } from '@/app/shell/theme'

import type { MenuEntry } from '@open-pencil/vue'
import type { Component } from 'vue'

const store = useEditorStore()
const open = ref(false)

const { topMenus } = useAppMenu()
const { theme, setTheme } = useAppTheme()
const menuCls = useMenuUI()
const mainMenuCls = useMenuUI({ content: 'min-w-52' })
const subMenuCls = useMenuUI({ content: 'min-w-44' })
const popover = usePopoverUI({
  content:
    'z-[100] w-[280px] overflow-visible rounded-[16px] border-chrome-border bg-chrome-raised p-2 text-surface shadow-chrome-panel backdrop-blur-2xl'
})

const themeOptions = [
  { icon: IconSun, label: 'Light', value: 'light' },
  { icon: IconMoon, label: 'Dark', value: 'dark' },
  { icon: IconMonitor, label: 'System', value: 'auto' }
] satisfies { icon: Component; label: string; value: AppTheme }[]

const settingsMenus = computed(() => {
  const [file, preferences, , insert] = topMenus.value
  if (!file || !preferences) return []

  const fileItems: MenuEntry[] = insert
    ? [...file.items, { separator: true }, ...insert.items]
    : file.items

  return [{ ...file, items: fileItems }, preferences]
})
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <ToolButton
        data-test-id="app-menu-toggle"
        :icon="IconSettings"
        label="Settings"
        :active="open"
        variant="utility"
      />
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="app-settings-menu"
        :class="popover.content"
        side="right"
        align="end"
        :align-offset="-9"
        :side-offset="10"
      >
        <div class="px-1 pt-1">
          <div class="mb-1.5 px-1 text-[10px] font-medium text-muted">Appearance</div>
          <div
            role="radiogroup"
            aria-label="Appearance"
            class="grid grid-cols-3 gap-1 rounded-[10px] bg-chrome-control p-0.5 ring-1 ring-inset ring-chrome-control-border"
          >
            <button
              v-for="option in themeOptions"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="theme === option.value"
              :data-test-id="`settings-theme-${option.value}`"
              class="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] text-[10px] transition-[color,background-color,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-accent"
              :class="
                theme === option.value
                  ? 'bg-chrome-control-active text-surface shadow-sm ring-1 ring-inset ring-chrome-control-border'
                  : 'text-muted hover:bg-hover hover:text-surface'
              "
              @click="setTheme(option.value)"
            >
              <component :is="option.icon" class="size-3.5" />
              <span>{{ option.label }}</span>
            </button>
          </div>
        </div>

        <MenubarRoot
          aria-label="Application settings"
          class="border-border/70 mt-2 grid grid-cols-2 gap-1 border-t pt-2"
        >
          <MenubarMenu v-for="(menu, index) in settingsMenus" :key="menu.label">
            <MenubarTrigger
              v-test-id="`menubar-${menu.label.toLowerCase()}`"
              class="flex h-9 w-full cursor-pointer items-center gap-2 rounded-[9px] px-2.5 text-[10.5px] text-muted transition-colors select-none outline-none hover:bg-hover hover:text-surface focus-visible:ring-2 focus-visible:ring-accent data-[state=open]:bg-hover data-[state=open]:text-surface"
            >
              <component
                :is="index === 0 ? IconFile : IconSlidersHorizontal"
                class="size-3.5 opacity-70"
              />
              <span class="flex-1 text-left">{{ menu.label }}</span>
              <IconChevronRight class="size-3 opacity-55" />
            </MenubarTrigger>

            <MenubarPortal disabled>
              <MenubarContent
                side="right"
                :side-offset="6"
                align="start"
                :class="mainMenuCls.content"
              >
                <template v-for="(item, i) in menu.items" :key="i">
                  <MenubarSeparator v-if="isMenuSeparator(item)" :class="menuCls.separator" />
                  <MenubarSub v-else-if="hasMenuSubItems(item)">
                    <MenubarSubTrigger :class="menuCls.item">
                      <span class="flex-1">{{ menuLabel(item) }}</span>
                      <IconChevronRight class="size-3 text-muted" />
                    </MenubarSubTrigger>
                    <MenubarPortal disabled>
                      <MenubarSubContent :side-offset="4" :class="subMenuCls.content">
                        <template v-for="(sub, j) in menuSubItems(item)" :key="j">
                          <MenubarSeparator
                            v-if="isMenuSeparator(sub)"
                            :class="menuCls.separator"
                          />
                          <MenubarCheckboxItem
                            v-else-if="isMenuCheckbox(sub)"
                            :model-value="menuChecked(sub)"
                            :class="menuCls.item"
                            @update:model-value="updateMenuChecked(sub, $event as boolean)"
                          >
                            <span class="flex-1">{{ menuLabel(sub) }}</span>
                            <MenubarItemIndicator class="text-surface">
                              <icon-lucide-check class="size-3.5" />
                            </MenubarItemIndicator>
                          </MenubarCheckboxItem>
                          <MenubarItem
                            v-else
                            :class="menuCls.item"
                            :disabled="menuDisabled(sub)"
                            @select="runMenuAction(sub)"
                          >
                            <span class="flex-1">{{ menuLabel(sub) }}</span>
                            <AppShortcutText v-if="menuShortcut(sub)">{{
                              menuShortcut(sub)
                            }}</AppShortcutText>
                          </MenubarItem>
                        </template>
                      </MenubarSubContent>
                    </MenubarPortal>
                  </MenubarSub>
                  <MenubarCheckboxItem
                    v-else-if="isMenuCheckbox(item)"
                    :model-value="menuChecked(item)"
                    :class="menuCls.item"
                    @update:model-value="updateMenuChecked(item, $event as boolean)"
                  >
                    <span class="flex-1">{{ menuLabel(item) }}</span>
                    <MenubarItemIndicator class="text-surface">
                      <icon-lucide-check class="size-3.5" />
                    </MenubarItemIndicator>
                  </MenubarCheckboxItem>
                  <MenubarItem
                    v-else
                    :class="menuCls.item"
                    :disabled="menuDisabled(item)"
                    @select="runMenuAction(item)"
                  >
                    <span class="flex-1">{{ menuLabel(item) }}</span>
                    <AppShortcutText v-if="menuShortcut(item)">{{
                      menuShortcut(item)
                    }}</AppShortcutText>
                  </MenubarItem>
                </template>
              </MenubarContent>
            </MenubarPortal>
          </MenubarMenu>
        </MenubarRoot>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>

  <span data-test-id="app-document-name" class="sr-only">{{ store.state.documentName }}</span>
</template>
