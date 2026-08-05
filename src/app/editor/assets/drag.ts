import { useEventListener } from '@vueuse/core'
import { ref, type Ref } from 'vue'

import type { EditorStore } from '@/app/editor/session'
import { placeSmylrComponentCodeObject } from '@/app/smylr-component-library/code-object-canvas'
import { SMYLR_COMPUTED_ASSETS } from '@/app/smylr-component-library/computed-catalog'

export const ASSET_VARIANT_DRAG_TYPE = 'application/x-openpencil-component-variant'
const ASSET_VARIANT_DRAG_START_EVENT = 'openpencil:asset-variant-drag-start'

export type AssetVariantDragPayload =
  | {
      componentId: string
      kind: 'scene'
      label: string
    }
  | {
      fixtureId: string
      kind: 'computed'
      label: string
      variantId: string | null
    }

function hasAssetVariant(dataTransfer: DataTransfer | null) {
  return Boolean(dataTransfer && [...dataTransfer.types].includes(ASSET_VARIANT_DRAG_TYPE))
}

function isComputedVariantId(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

export function writeAssetVariantDrag(event: DragEvent, payload: AssetVariantDragPayload) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData(ASSET_VARIANT_DRAG_TYPE, JSON.stringify(payload))
  event.dataTransfer.effectAllowed = 'copy'
  window.dispatchEvent(new CustomEvent(ASSET_VARIANT_DRAG_START_EVENT))
}

function readAssetVariantDrag(dataTransfer: DataTransfer | null): AssetVariantDragPayload | null {
  if (!hasAssetVariant(dataTransfer)) return null
  try {
    const value = JSON.parse(dataTransfer?.getData(ASSET_VARIANT_DRAG_TYPE) ?? '') as unknown
    if (!value || typeof value !== 'object' || !('kind' in value)) return null
    if (
      value.kind === 'scene' &&
      'componentId' in value &&
      typeof value.componentId === 'string' &&
      'label' in value &&
      typeof value.label === 'string'
    ) {
      return { kind: 'scene', componentId: value.componentId, label: value.label }
    }
    if (
      value.kind === 'computed' &&
      'fixtureId' in value &&
      typeof value.fixtureId === 'string' &&
      'variantId' in value &&
      isComputedVariantId(value.variantId) &&
      'label' in value &&
      typeof value.label === 'string'
    ) {
      return {
        kind: 'computed',
        fixtureId: value.fixtureId,
        variantId: value.variantId,
        label: value.label
      }
    }
    return null
  } catch {
    return null
  }
}

function placeSceneVariant(
  editor: EditorStore,
  payload: Extract<AssetVariantDragPayload, { kind: 'scene' }>,
  centerX: number,
  centerY: number
) {
  const component = editor.graph.getNode(payload.componentId)
  if (component?.type !== 'COMPONENT') return
  const parentId = editor.state.enteredContainerId ?? editor.state.currentPageId
  const parentOffset =
    parentId === editor.state.currentPageId
      ? { x: 0, y: 0 }
      : editor.graph.getAbsolutePosition(parentId)
  editor.createInstanceFromComponent(
    component.id,
    centerX - parentOffset.x - component.width / 2,
    centerY - parentOffset.y - component.height / 2,
    parentId
  )
  editor.requestRender()
}

export function useAssetVariantDrop(canvasAreaRef: Ref<HTMLElement | null>, editor: EditorStore) {
  const isDraggingAssetVariant = ref(false)

  function onDragEnter(event: DragEvent) {
    if (!hasAssetVariant(event.dataTransfer)) return
    event.preventDefault()
    isDraggingAssetVariant.value = true
  }

  function onDragOver(event: DragEvent) {
    if (!hasAssetVariant(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    isDraggingAssetVariant.value = true
  }

  function onDragLeave(event: DragEvent) {
    const area = canvasAreaRef.value
    const related = event.relatedTarget
    if (area && related instanceof Node && area.contains(related)) return
    isDraggingAssetVariant.value = false
  }

  function onDrop(event: DragEvent) {
    const area = canvasAreaRef.value
    const payload = readAssetVariantDrag(event.dataTransfer)
    isDraggingAssetVariant.value = false
    if (!area || !payload) return
    event.preventDefault()
    const bounds = area.getBoundingClientRect()
    const point = editor.screenToCanvas(event.clientX - bounds.left, event.clientY - bounds.top)
    if (payload.kind === 'scene') {
      placeSceneVariant(editor, payload, point.x, point.y)
      return
    }
    const asset = SMYLR_COMPUTED_ASSETS.find(
      (candidate) => candidate.fixtureId === payload.fixtureId
    )
    if (!asset) return
    placeSmylrComponentCodeObject(editor, asset, payload.variantId ?? undefined, point.x, point.y)
  }

  useEventListener(window, ASSET_VARIANT_DRAG_START_EVENT, () => {
    isDraggingAssetVariant.value = true
  })
  useEventListener(window, 'dragend', () => {
    isDraggingAssetVariant.value = false
  })

  return { isDraggingAssetVariant, onDragEnter, onDragLeave, onDragOver, onDrop }
}
