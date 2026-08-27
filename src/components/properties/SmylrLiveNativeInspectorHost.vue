<script setup lang="ts">
import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode
} from '@/app/smylr-live-container/types'
import { useSmylrLiveNativeInspectorHost } from '@/app/smylr-live-inspector/native-host'
import SmylrLiveClassesField from '@/components/SmylrLiveClassesField.vue'
import IconButton from '@/components/ui/IconButton.vue'
import Tip from '@/components/ui/Tip.vue'
import NativeSelectionInspector from './NativeSelectionInspector.vue'

const { document, node } = defineProps<{
  document: SmylrLiveContainerDocument
  node: SmylrLiveContainerNode
}>()

const emit = defineEmits<{
  reset: []
}>()

const {
  activeUtilityClasses,
  addUtilityClass,
  beginStyleTransaction,
  classSuggestions,
  endStyleTransaction,
  hasChanges,
  removeUtilityClass,
  requestReset,
  resetLabel,
  shadowStore
} = useSmylrLiveNativeInspectorHost(document, node, () => emit('reset'))
</script>

<template>
  <NativeSelectionInspector
    compact-header
    :computed-style="node.computedStyle"
    :editor-store="shadowStore"
    :name-label="node.label"
    data-live-adapter="true"
    @pointerdown.capture="beginStyleTransaction"
    @pointerup.capture="endStyleTransaction"
    @pointercancel.capture="endStyleTransaction"
  >
    <template #header-actions>
      <Tip v-if="hasChanges" label="This layer has live overrides">
        <span data-test-id="smylr-live-change-indicator" class="size-1.5 rounded-full bg-accent" />
      </Tip>
      <IconButton
        :label="resetLabel"
        :disabled="!hasChanges"
        data-test-id="smylr-live-reset"
        @click="requestReset"
      >
        <icon-lucide-rotate-ccw class="size-3.5" />
      </IconButton>
    </template>

    <template #sections-footer>
      <SmylrLiveClassesField
        :active-classes="activeUtilityClasses"
        :suggestions="classSuggestions"
        @add="addUtilityClass"
        @remove="removeUtilityClass"
      />
    </template>
  </NativeSelectionInspector>
</template>
