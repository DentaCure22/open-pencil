import { useEventListener, useTimeoutFn } from '@vueuse/core'
import { onScopeDispose, type Ref } from 'vue'

import { getAbsolutePositionFull, type SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'
import { markdownDocument } from '@/app/markdown-document'
import { mediaEvidenceSource } from '@/app/media-evidence/source'

import {
  canvasSurfaceCanReceivePointer,
  SURFACE_ACTIVATION_DELAY_MS,
  SURFACE_CLICK_DRAG_THRESHOLD_PX
} from './interaction'

type SurfaceEntryCandidate = {
  startClientX: number
  startClientY: number
}

function supportsDirectSurfaceEntry(node: SceneNode): boolean {
  return mediaEvidenceSource(node)?.kind === 'video' || markdownDocument(node) !== null
}

function eventInsideNode(
  event: MouseEvent,
  node: SceneNode,
  store: EditorStore,
  canvas: HTMLCanvasElement
): boolean {
  const rect = canvas.getBoundingClientRect()
  const zoom = Math.max(store.state.zoom, 0.01)
  const canvasX = (event.clientX - rect.left - store.state.panX) / zoom
  const canvasY = (event.clientY - rect.top - store.state.panY) / zoom
  const bounds = getAbsolutePositionFull(node, store.graph)
  return (
    canvasX >= bounds.boundX &&
    canvasX <= bounds.boundX + bounds.width &&
    canvasY >= bounds.boundY &&
    canvasY <= bounds.boundY + bounds.height
  )
}

export function useCanvasSurfaceEntry(
  canvasRef: Ref<HTMLCanvasElement | null>,
  store: EditorStore
) {
  let candidate: SurfaceEntryCandidate | null = null
  let pendingNodeId: string | null = null

  const { start, stop } = useTimeoutFn(
    () => {
      const nodeId = pendingNodeId
      pendingNodeId = null
      const node = nodeId ? store.graph.getNode(nodeId) : null
      if (
        !nodeId ||
        !node ||
        !canvasSurfaceCanReceivePointer(store.state.activeTool) ||
        store.state.selectedIds.size !== 1 ||
        !store.state.selectedIds.has(nodeId) ||
        !supportsDirectSurfaceEntry(node)
      ) {
        return
      }
      store.enterContainer(nodeId)
    },
    SURFACE_ACTIVATION_DELAY_MS,
    { immediate: false }
  )

  function cancelPendingEntry() {
    stop()
    pendingNodeId = null
  }

  function cancelEntryGesture() {
    cancelPendingEntry()
    candidate = null
  }

  function onMouseDown(event: MouseEvent) {
    cancelEntryGesture()
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !canvasSurfaceCanReceivePointer(store.state.activeTool)
    ) {
      return
    }
    candidate = {
      startClientX: event.clientX,
      startClientY: event.clientY
    }
  }

  function onMouseMove(event: MouseEvent) {
    if (!candidate) return
    if (
      Math.hypot(event.clientX - candidate.startClientX, event.clientY - candidate.startClientY) >=
      SURFACE_CLICK_DRAG_THRESHOLD_PX
    ) {
      cancelEntryGesture()
    }
  }

  function onMouseUp(event: MouseEvent) {
    const next = candidate
    candidate = null
    if (!next || event.button !== 0) return
    const canvas = canvasRef.value
    const [nodeId] = store.state.selectedIds
    const node = store.state.selectedIds.size === 1 && nodeId ? store.graph.getNode(nodeId) : null
    if (
      !canvas ||
      !nodeId ||
      !node ||
      !supportsDirectSurfaceEntry(node) ||
      !eventInsideNode(event, node, store, canvas)
    ) {
      return
    }
    pendingNodeId = nodeId
    start()
  }

  useEventListener(canvasRef, 'mousedown', onMouseDown)
  useEventListener(window, 'mousemove', onMouseMove)
  useEventListener(window, 'mouseup', onMouseUp)
  useEventListener(canvasRef, 'dblclick', cancelEntryGesture)
  useEventListener(window, 'blur', cancelEntryGesture)

  const unsubscribeSelection = store.onEditorEvent('selection:changed', () => {
    if (pendingNodeId && !store.state.selectedIds.has(pendingNodeId)) cancelPendingEntry()
  })
  const unsubscribeTool = store.onEditorEvent('tool:changed', cancelEntryGesture)
  onScopeDispose(() => {
    unsubscribeSelection()
    unsubscribeTool()
  })
}
