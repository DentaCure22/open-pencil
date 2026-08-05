<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import { useEditorStore } from '@/app/editor/active-store'
import {
  cancelNarratedTraceMicConsent,
  clearNarratedTraceMicTurnsOutsideScope,
  disposeNarratedTraceMic,
  narratedTraceMicDisclosure,
  narratedTraceMicError,
  narratedTraceMicInterimText,
  narratedTraceMicPhase,
  narratedTraceScopeForStore,
  prepareNarratedTraceMic,
  startNarratedTraceMic,
  stopNarratedTraceMic
} from '@/app/narrated-trace'
import { activeTab } from '@/app/tabs'
import Tip from '@/components/ui/Tip.vue'
import { useButtonUI } from '@/components/ui/button'
import { usePopoverUI } from '@/components/ui/popover'

const store = useEditorStore()
const popoverOpen = ref(false)

const popover = usePopoverUI({ content: 'w-72 p-3' })
const startButton = useButtonUI({ size: 'sm', tone: 'accent' })
const secondaryButton = useButtonUI({ bordered: true, size: 'sm', tone: 'ghost' })

const micButtonLabel = computed(() => {
  if (narratedTraceMicPhase.value === 'checking') return 'Checking microphone'
  if (narratedTraceMicPhase.value === 'consent') return 'Microphone consent required'
  if (narratedTraceMicPhase.value === 'listening') return 'Stop microphone'
  return 'Start Trace microphone'
})

const hasMicFailure = computed(() =>
  ['denied', 'error', 'no-speech', 'unsupported'].includes(narratedTraceMicPhase.value)
)

async function toggleMic() {
  if (narratedTraceMicPhase.value === 'listening') {
    stopNarratedTraceMic()
    popoverOpen.value = false
    return
  }
  if (narratedTraceMicPhase.value === 'checking' || narratedTraceMicPhase.value === 'consent') {
    popoverOpen.value = true
    return
  }
  popoverOpen.value = true
  await prepareNarratedTraceMic(store)
}

function startMic() {
  startNarratedTraceMic(store)
}

function cancelConsent() {
  cancelNarratedTraceMicConsent()
  popoverOpen.value = false
}

function updatePopoverOpen(open: boolean) {
  popoverOpen.value = open
  if (!open && narratedTraceMicPhase.value === 'consent') cancelNarratedTraceMicConsent()
}

watch(narratedTraceMicPhase, (phase, previousPhase) => {
  if (phase === 'consent' && !popoverOpen.value) {
    cancelNarratedTraceMicConsent()
    return
  }
  if (phase === 'idle' && previousPhase === 'listening') popoverOpen.value = false
  if (['denied', 'error', 'no-speech', 'unsupported'].includes(phase)) {
    popoverOpen.value = true
  }
})

watch(
  () => [activeTab.value?.id, store.state.currentPageId] as const,
  () => {
    stopNarratedTraceMic()
    clearNarratedTraceMicTurnsOutsideScope(narratedTraceScopeForStore(store))
  },
  { immediate: true }
)

onBeforeUnmount(stopNarratedTraceMic)
if (IS_BROWSER) useEventListener(window, 'pagehide', disposeNarratedTraceMic)
</script>

<template>
  <PopoverRoot :open="popoverOpen" @update:open="updatePopoverOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        data-test-id="narrated-trace-mic-toggle"
        :data-phase="narratedTraceMicPhase"
        :aria-label="micButtonLabel"
        :aria-pressed="narratedTraceMicPhase === 'listening'"
        class="flex size-8 items-center justify-center rounded-lg transition-colors"
        :class="
          narratedTraceMicPhase === 'listening'
            ? 'bg-violet-500 text-white'
            : 'text-muted hover:bg-hover hover:text-surface'
        "
        @click="toggleMic"
      >
        <Tip :label="micButtonLabel">
          <icon-lucide-square
            v-if="narratedTraceMicPhase === 'listening'"
            class="size-3 fill-current"
          />
          <icon-lucide-loader-circle
            v-else-if="narratedTraceMicPhase === 'checking'"
            class="size-3.5 animate-spin"
          />
          <icon-lucide-mic v-else class="size-3.5" />
        </Tip>
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        data-test-id="narrated-trace-mic-popover"
        :class="popover.content"
        :side-offset="8"
        side="bottom"
        align="end"
        @escape-key-down="cancelConsent"
        @interact-outside="cancelConsent"
      >
        <template v-if="narratedTraceMicPhase === 'checking'">
          <div class="flex items-center gap-2 text-xs text-surface">
            <icon-lucide-loader-circle class="size-4 animate-spin text-violet-200" />
            Checking speech recognition…
          </div>
        </template>

        <template v-else-if="narratedTraceMicPhase === 'consent'">
          <div class="text-xs font-semibold text-surface">
            Keep microphone on until you stop it?
          </div>
          <p
            data-test-id="narrated-trace-mic-consent"
            class="mt-1.5 text-[10px] leading-4 text-muted"
          >
            {{ narratedTraceMicDisclosure }}
          </p>
          <p class="mt-1 text-[10px] leading-4 text-muted">
            Each completed spoken turn appears in normal Trace History with this Board’s exact
            scope.
          </p>
          <div class="mt-3 flex justify-end gap-1.5">
            <button type="button" :class="secondaryButton.base" @click="cancelConsent">
              Cancel
            </button>
            <button
              type="button"
              data-test-id="narrated-trace-mic-consent-start"
              :class="startButton.base"
              @click="startMic"
            >
              Start microphone
            </button>
          </div>
        </template>

        <template v-else-if="narratedTraceMicPhase === 'listening'">
          <div class="flex items-start gap-2">
            <span class="mt-1 size-2 shrink-0 animate-pulse rounded-full bg-violet-300" />
            <div class="min-w-0 flex-1">
              <div class="text-xs font-semibold text-surface">Microphone on</div>
              <p class="mt-1 min-h-4 text-[10px] leading-4 text-muted">
                {{
                  narratedTraceMicInterimText ||
                  narratedTraceMicError ||
                  'Listening until you stop…'
                }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex justify-end">
            <button type="button" :class="secondaryButton.base" @click="toggleMic">
              Stop microphone
            </button>
          </div>
        </template>

        <template v-else-if="hasMicFailure">
          <div class="text-xs font-semibold text-surface">Microphone unavailable</div>
          <p
            data-test-id="narrated-trace-mic-error"
            class="mt-1.5 text-[10px] leading-4 text-[var(--color-warning-text)]"
          >
            {{ narratedTraceMicError }}
          </p>
          <div class="mt-3 flex justify-end">
            <button type="button" :class="secondaryButton.base" @click="popoverOpen = false">
              Dismiss
            </button>
          </div>
        </template>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
