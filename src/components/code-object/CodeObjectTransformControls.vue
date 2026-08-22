<script setup lang="ts">
import { computed, ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { useEditorStore } from '@/app/editor/active-store'
import { useEditorPresentationViewport } from '@/app/editor/presentation'
import {
  CODE_OBJECT_RESIZE_HANDLE_STYLE,
  CODE_OBJECT_ROTATE_HANDLE_STYLE,
  codeObjectResizeHandles,
  codeObjectRotationHandles,
  codeObjectScreenOverlayStyle,
  createCodeObjectTransformController
} from '@/app/code-object/transform'

const { frame, revision } = defineProps<{ frame: SceneNode; revision: number }>()
const store = useEditorStore()
const presentationViewport = useEditorPresentationViewport(store)
const controlRevision = ref(0)
const frameTransform = createCodeObjectTransformController(store, () => {
  controlRevision.value += 1
})

const overlayStyle = computed(() => {
  void controlRevision.value
  void revision
  return codeObjectScreenOverlayStyle(store, frame, presentationViewport.value)
})
const resizeHandles = computed(() => {
  void controlRevision.value
  void revision
  return codeObjectResizeHandles(frame, presentationViewport.value.zoom)
})
const rotationHandles = computed(() => {
  void controlRevision.value
  void revision
  return codeObjectRotationHandles(frame, presentationViewport.value.zoom)
})
</script>

<template>
  <div
    class="pointer-events-none absolute top-0 left-0 z-[14] ring-1 ring-inset ring-violet-400/35"
    :data-test-id="`code-object-controls-${frame.id}`"
    :style="overlayStyle"
  >
    <span
      v-for="handle in resizeHandles"
      :key="handle.id"
      class="openpencil-control-node openpencil-control-node-transform pointer-events-auto absolute z-20"
      :class="
        handle.id === 'nw' || handle.id === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize'
      "
      :data-test-id="`code-object-resize-${handle.id}`"
      :style="{
        ...CODE_OBJECT_RESIZE_HANDLE_STYLE,
        left: `${handle.x}px`,
        top: `${handle.y}px`,
        transform: `${handle.transform} scale(var(--openpencil-control-node-scale))`
      }"
      @pointercancel.stop="frameTransform.end"
      @pointerdown.stop.prevent="frameTransform.beginResize(frame.id, handle.id, $event)"
      @pointermove.stop.prevent="frameTransform.move"
      @pointerup.stop.prevent="frameTransform.end"
    />
    <span
      v-for="handle in rotationHandles"
      :key="`rotate-${handle.id}`"
      class="pointer-events-auto absolute z-10 cursor-crosshair"
      :data-test-id="`code-object-rotate-${handle.id}`"
      :style="{
        ...CODE_OBJECT_ROTATE_HANDLE_STYLE,
        left: `${handle.x}px`,
        top: `${handle.y}px`,
        transform: handle.transform
      }"
      @pointercancel.stop="frameTransform.end"
      @pointerdown.stop.prevent="frameTransform.beginRotate(frame.id, $event)"
      @pointermove.stop.prevent="frameTransform.move"
      @pointerup.stop.prevent="frameTransform.end"
    />
  </div>
</template>
