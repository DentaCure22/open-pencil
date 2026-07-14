<script setup lang="ts">
import { computed, ref } from "vue";
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from "reka-ui";

import AppMenu from "@/components/Shell/AppMenu.vue";
import {
  liveInspectorDocument,
  liveInspectorFrameSrc,
  liveInspectorInteractionMode,
  liveInspectorRoute,
  liveInspectorStatus,
  reloadLiveInspectorFrame,
  setLiveInspectorInteractionMode,
} from "@/app/smylr-live-inspector/session";
import AssetsPanel from "./AssetsPanel.vue";
import LayerTree from "./LayerTree/LayerTree.vue";
import PagesPanel from "./PagesPanel.vue";
import Tip from "./ui/Tip.vue";
import "./layers-panel.css";

const emit = defineEmits<{ close: [] }>();
const openUtility = ref<"assets" | "layers" | null>(null);
const showLiveTools = ref(false);

interface LayerTreeHandle {
  closeTreeTools: () => void;
}

const layerTreeRef = ref<LayerTreeHandle | null>(null);

const liveStatusLabel = computed(() => {
  if (liveInspectorStatus.value === "connected") return "Live";
  if (liveInspectorStatus.value === "loading") return "Loading";
  if (liveInspectorStatus.value === "unavailable") return "Reconnect";
  return "";
});
const liveStatusDot = computed(() => {
  if (liveInspectorStatus.value === "connected") return "bg-emerald-500";
  if (liveInspectorStatus.value === "loading") return "bg-sky-500";
  if (liveInspectorStatus.value === "unavailable") return "bg-amber-500";
  return "";
});
const showLiveChrome = computed(
  () =>
    liveInspectorStatus.value !== "idle" ||
    Boolean(liveInspectorDocument.value) ||
    Boolean(liveInspectorFrameSrc.value),
);

function setUtility(kind: "assets" | "layers", open: boolean) {
  openUtility.value = open ? kind : null;
  showLiveTools.value = false;
  layerTreeRef.value?.closeTreeTools();
}

function useLiveApp() {
  setLiveInspectorInteractionMode("interact");
}

function useLiveAppFromMenu() {
  useLiveApp();
  showLiveTools.value = false;
}

function reloadLiveLayersFromMenu() {
  reloadLiveInspectorFrame();
  showLiveTools.value = false;
}

function openLiveApp() {
  if (!liveInspectorFrameSrc.value) return;
  window.open(liveInspectorFrameSrc.value, "_blank", "noopener,noreferrer");
}

function openLiveAppFromMenu() {
  openLiveApp();
  showLiveTools.value = false;
}

function toggleLiveTools() {
  const next = !showLiveTools.value;
  showLiveTools.value = next;
  if (next) layerTreeRef.value?.closeTreeTools();
}
</script>

<template>
  <aside
    data-test-id="layers-panel"
    class="layers-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent"
    style="contain: paint layout style"
  >
    <AppMenu closable @close-panel="emit('close')" />
    <PagesPanel />

    <div class="mx-3 mt-1 h-px shrink-0 bg-white/[0.055]" />

    <CollapsibleRoot
      :open="openUtility === 'layers'"
      class="flex min-h-0 flex-col"
      :class="openUtility === 'layers' ? 'flex-1' : 'shrink-0'"
      @update:open="setUtility('layers', $event)"
    >
      <CollapsibleTrigger as-child>
        <button
          data-test-id="left-panel-layers-tab"
          type="button"
          class="group/utility mx-2 flex h-8 shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-surface"
        >
          <icon-lucide-layers-3 class="size-[16px] shrink-0 stroke-[1.55] text-muted/80" />
          <span>Layers</span>
          <icon-lucide-chevron-right
            class="size-3 shrink-0 stroke-[1.6] text-muted/65 transition-transform"
            :class="openUtility === 'layers' ? 'rotate-90' : ''"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          v-if="showLiveChrome"
          class="relative mx-3 flex h-7 shrink-0 items-center gap-1 border-b border-white/[0.055] text-[10px] text-muted/80"
        >
          <span
            v-if="liveStatusDot"
            class="size-1.5 shrink-0 rounded-full"
            :class="liveStatusDot"
          />
          <span class="min-w-0 flex-1 truncate">{{ liveInspectorRoute || liveStatusLabel }}</span>
          <Tip label="Live layer controls">
            <button
              type="button"
              data-test-id="smylr-live-tools-toggle"
              aria-label="Live layer controls"
              class="flex size-6 shrink-0 items-center justify-center rounded-[5px] text-muted hover:bg-hover hover:text-surface"
              :class="showLiveTools ? 'bg-hover text-surface' : ''"
              :aria-expanded="showLiveTools"
              @click="toggleLiveTools"
            >
              <icon-lucide-more-horizontal class="size-3.5" />
            </button>
          </Tip>
          <div
            v-if="showLiveTools"
            class="absolute top-7 right-0 z-30 w-40 rounded-[9px] border border-white/[0.085] bg-[#202126]/[.98] p-1 shadow-[0_12px_34px_rgba(0,0,0,0.42)] backdrop-blur-xl"
          >
            <button
              type="button"
              data-test-id="smylr-live-interact"
              class="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-surface"
              :class="liveInspectorInteractionMode === 'interact' ? 'bg-hover text-surface' : ''"
              @click="useLiveAppFromMenu"
            >
              <icon-lucide-mouse-pointer-click class="size-3.5" />
              <span>Use live app</span>
            </button>
            <button
              type="button"
              data-test-id="smylr-auth-reload-frame"
              class="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-surface"
              @click="reloadLiveLayersFromMenu"
            >
              <icon-lucide-refresh-cw class="size-3.5" />
              <span>Reload layers</span>
            </button>
            <button
              type="button"
              data-test-id="smylr-open-live-app"
              class="flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left text-[12px] text-muted hover:bg-hover hover:text-surface disabled:cursor-default disabled:opacity-40"
              :disabled="!liveInspectorFrameSrc"
              @click="openLiveAppFromMenu"
            >
              <icon-lucide-external-link class="size-3.5" />
              <span>Open Smylr</span>
            </button>
          </div>
        </div>
        <LayerTree
          ref="layerTreeRef"
          data-test-id="layers-tree"
          @tools-opened="showLiveTools = false"
        />
      </CollapsibleContent>
    </CollapsibleRoot>

    <CollapsibleRoot
      :open="openUtility === 'assets'"
      class="flex min-h-0 flex-col"
      :class="openUtility === 'assets' ? 'flex-1' : 'shrink-0'"
      @update:open="setUtility('assets', $event)"
    >
      <CollapsibleTrigger as-child>
        <button
          data-test-id="left-panel-assets-tab"
          type="button"
          class="group/utility mx-2 flex h-8 shrink-0 items-center gap-2 rounded-[6px] px-2 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-surface"
        >
          <icon-lucide-boxes class="size-[16px] shrink-0 stroke-[1.55] text-muted/80" />
          <span>Assets</span>
          <icon-lucide-chevron-right
            class="size-3 shrink-0 stroke-[1.6] text-muted/65 transition-transform"
            :class="openUtility === 'assets' ? 'rotate-90' : ''"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <AssetsPanel />
      </CollapsibleContent>
    </CollapsibleRoot>
  </aside>
</template>
