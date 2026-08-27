<script setup lang="ts">
import { ref } from 'vue'

import type { AiBoardObjectChange } from '@/app/agent-chat/types'
import AiBoardChanges from '@/components/ai-elements/AiBoardChanges.vue'

const activeObject = ref<string | null>(null)
const changes: AiBoardObjectChange[] = [
  { id: 'history-panel', name: 'History panel', type: 'FRAME', verb: 'created' },
  { id: 'medical-alerts', name: 'Medical alerts', type: 'FRAME', verb: 'edited' },
  { id: 'perio-shortcut', name: 'Perio shortcut', type: 'TEXT', verb: 'created' }
]
</script>

<template>
  <main
    class="preview-page flex min-h-screen items-center bg-[#17191d] p-5 font-sans text-agent-ink"
  >
    <section
      class="preview-panel flex h-[780px] w-[380px] flex-col overflow-hidden rounded-[22px] border border-white/[0.07] bg-[#0d0d0f] shadow-2xl"
    >
      <header class="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
        <button type="button" aria-label="Back" class="text-muted">
          <icon-lucide-arrow-left class="size-4" />
        </button>
        <h1 class="min-w-0 flex-1 truncate text-[14px] font-medium text-surface">
          Patient-history quick panel
        </h1>
        <icon-lucide-square-pen class="size-4 text-muted" />
      </header>
      <div class="flex min-h-0 flex-1 flex-col px-4 pt-8">
        <div
          class="ml-auto max-w-[86%] rounded-[18px] bg-agent-user-bubble px-3.5 py-2.5 text-[14px] leading-[1.55] text-agent-ink"
        >
          Make the three history options and keep it clean.
        </div>
        <button type="button" class="mt-6 flex h-8 items-center gap-2 text-[12px] text-muted">
          <span>Worked for 18s</span><icon-lucide-chevron-right class="size-3.5" />
        </button>
        <div class="mt-2 flex flex-col gap-2.5">
          <AiBoardChanges
            :changes="changes"
            @hover-object="(id) => (activeObject = id)"
            @open-object="(id) => (activeObject = id)"
          />
          <div class="text-[14px] font-normal leading-[1.58] text-agent-ink">
            Created the
            <button
              type="button"
              class="inline rounded-[3px] font-[inherit] leading-[inherit] text-accent underline decoration-accent/30 underline-offset-2"
            >
              History panel</button
            >, tightened
            <button
              type="button"
              class="inline rounded-[3px] font-[inherit] leading-[inherit] text-accent underline decoration-accent/30 underline-offset-2"
            >
              Medical alerts</button
            >, and added the
            <button
              type="button"
              class="inline rounded-[3px] font-[inherit] leading-[inherit] text-accent underline decoration-accent/30 underline-offset-2"
            >
              Perio shortcut</button
            >. Click any highlighted name to show it on the Board.
          </div>
        </div>
        <div class="mt-auto pb-4">
          <div
            class="rounded-[18px] border border-white/[0.08] bg-white/[0.045] px-4 py-3 text-[13px] text-muted"
          >
            Follow up…
            <div class="mt-7 flex items-center justify-between">
              <icon-lucide-plus class="size-4" /><icon-lucide-audio-lines class="size-4" />
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.preview-page {
  box-sizing: border-box;
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: flex-start;
  padding: 20px;
  background: #17191d;
}

.preview-panel {
  width: 380px;
  height: min(780px, calc(100vh - 40px));
  border: 1px solid rgb(255 255 255 / 7%);
  border-radius: 22px;
  background: #0d0d0f;
  box-shadow: 0 24px 70px rgb(0 0 0 / 35%);
}
</style>
