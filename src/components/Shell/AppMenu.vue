<script setup lang="ts">
import { ref } from 'vue'
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
  MenubarTrigger
} from 'reka-ui'

import IconChevronRight from '~icons/lucide/chevron-right'

import { vTestId } from '@open-pencil/vue'
import AppShortcutText from '@/components/ui/AppShortcutText.vue'
import Tip from '@/components/ui/Tip.vue'
import { useMenuUI } from '@/components/ui/menu'
import { IS_TAURI } from '@/constants'
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

const store = useEditorStore()
const { closable = false } = defineProps<{ closable?: boolean }>()
const emit = defineEmits<{ closePanel: [] }>()
const showWorkspaceCommands = ref(false)

const { topMenus } = useAppMenu()
const menuCls = useMenuUI()
const mainMenuCls = useMenuUI({ content: 'min-w-52' })
const subMenuCls = useMenuUI({ content: 'min-w-44' })

function toggleWorkspaceCommands() {
  if (IS_TAURI) return
  showWorkspaceCommands.value = !showWorkspaceCommands.value
}
</script>

<template>
  <header class="border-border/70 shrink-0 border-b">
    <div class="group/app-menu flex h-12 items-center gap-2 px-3">
      <component
        :is="IS_TAURI ? 'div' : 'button'"
        :type="IS_TAURI ? undefined : 'button'"
        data-test-id="app-menu-toggle"
        :role="IS_TAURI ? 'img' : undefined"
        :aria-label="IS_TAURI ? 'OpenPencil workspace' : 'Open application menu'"
        :aria-expanded="IS_TAURI ? undefined : showWorkspaceCommands"
        class="flex size-7 shrink-0 items-center justify-center rounded-[7px]"
        :class="
          !IS_TAURI
            ? 'outline-none transition-[background-color,box-shadow] hover:bg-accent/15 hover:shadow-[inset_0_0_0_1px_rgba(167,139,250,0.4),0_0_0_3px_rgba(124,58,237,0.12)] focus-visible:bg-accent/15 focus-visible:ring-2 focus-visible:ring-accent/45'
            : ''
        "
        @click="toggleWorkspaceCommands"
      >
        <img src="/favicon-32.png" alt="" class="size-[22px] object-contain" />
      </component>
      <span
        data-test-id="workspace-title"
        class="min-w-0 px-1.5 py-1 text-[13.5px] font-semibold tracking-[-0.01em] text-surface"
      >
        OpenPencil
      </span>
      <span data-test-id="app-document-name" class="sr-only">{{ store.state.documentName }}</span>
      <Tip v-if="closable" label="Close sidebar">
        <button
          type="button"
          data-test-id="close-layers-panel"
          aria-label="Close sidebar"
          class="ml-auto flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted transition-colors hover:bg-hover hover:text-surface"
          @click="emit('closePanel')"
        >
          <icon-lucide-panel-left-close class="size-[17px] stroke-[1.6]" />
        </button>
      </Tip>
    </div>

    <div
      v-if="!IS_TAURI && showWorkspaceCommands"
      class="border-border/70 app-menu__menubar flex items-center border-t px-1 py-1"
    >
      <MenubarRoot class="scrollbar-none flex items-center gap-0.5 overflow-x-auto">
        <MenubarMenu v-for="menu in topMenus" :key="menu.label">
          <MenubarTrigger
            v-test-id="`menubar-${menu.label.toLowerCase()}`"
            class="flex cursor-pointer items-center rounded-[4px] px-2 py-1 text-[11px] text-muted transition-colors select-none hover:bg-hover hover:text-surface data-[state=open]:bg-hover data-[state=open]:text-surface"
          >
            {{ menu.label }}
          </MenubarTrigger>

          <MenubarPortal>
            <MenubarContent :side-offset="4" align="start" :class="mainMenuCls.content">
              <template v-for="(item, i) in menu.items" :key="i">
                <MenubarSeparator v-if="isMenuSeparator(item)" :class="menuCls.separator" />
                <MenubarSub v-else-if="hasMenuSubItems(item)">
                  <MenubarSubTrigger :class="menuCls.item">
                    <span class="flex-1">{{ menuLabel(item) }}</span>
                    <IconChevronRight class="size-3 text-muted" />
                  </MenubarSubTrigger>
                  <MenubarPortal>
                    <MenubarSubContent :side-offset="4" :class="subMenuCls.content">
                      <template v-for="(sub, j) in menuSubItems(item)" :key="j">
                        <MenubarSeparator v-if="isMenuSeparator(sub)" :class="menuCls.separator" />
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
    </div>
  </header>
</template>
