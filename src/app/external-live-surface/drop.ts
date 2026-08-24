import { ref, type Ref } from 'vue'

import type { Vector } from '@open-pencil/scene-graph/primitives'

import { readBrowserCaptureDrag, hasBrowserCaptureDrag } from '@/app/browser-inspector/drag'
import { getBrowserCaptureSession } from '@/app/browser-inspector/state'
import { createCodeObject, createExternalLiveSurfaceDocument } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'

import { externalLiveSurfaceSourceFromSelection } from './contracts'

function selectionName(accessibleName: string, tag: string) {
  const label = accessibleName.replaceAll(/\s+/g, ' ').trim()
  return label ? `${label} · ${tag}` : `Chrome ${tag}`
}

export function placeBrowserSelectionAsLiveSurface(
  store: EditorStore,
  sessionId: string,
  selectionId: string | undefined,
  center: Vector
) {
  const session = getBrowserCaptureSession(sessionId)
  const selection = selectionId
    ? session?.selections.find((candidate) => candidate.id === selectionId)
    : session?.selections.at(-1)
  if (!selection) return null
  const width = selection.element.bounds.width
  const height = selection.element.bounds.height
  const name = selectionName(selection.element.accessibleName, selection.element.tag)
  return createCodeObject(store, {
    document: createExternalLiveSurfaceDocument({
      name,
      preview: { ...(selection.surfacePreview ?? selection.snapshot) },
      source: externalLiveSurfaceSourceFromSelection(selection)
    }),
    height,
    name,
    width,
    x: Math.round(center.x - width / 2),
    y: Math.round(center.y - height / 2)
  })
}

export function useExternalLiveSurfaceDrop(
  canvasAreaRef: Ref<HTMLElement | null>,
  store: EditorStore
) {
  const isDraggingExternalLiveSurface = ref(false)

  function onDragEnter(event: DragEvent) {
    if (!hasBrowserCaptureDrag(event.dataTransfer)) return
    event.preventDefault()
    isDraggingExternalLiveSurface.value = true
  }

  function onDragOver(event: DragEvent) {
    if (!hasBrowserCaptureDrag(event.dataTransfer)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    isDraggingExternalLiveSurface.value = true
  }

  function onDragLeave(event: DragEvent) {
    const area = canvasAreaRef.value
    const related = event.relatedTarget
    if (area && related instanceof Node && area.contains(related)) return
    isDraggingExternalLiveSurface.value = false
  }

  function onDrop(event: DragEvent) {
    const area = canvasAreaRef.value
    const payload = readBrowserCaptureDrag(event.dataTransfer)
    isDraggingExternalLiveSurface.value = false
    if (!area || !payload || payload.recordingId) return
    event.preventDefault()
    const bounds = area.getBoundingClientRect()
    const point = store.screenToCanvas(event.clientX - bounds.left, event.clientY - bounds.top)
    placeBrowserSelectionAsLiveSurface(store, payload.sessionId, payload.selectionId, point)
  }

  return { isDraggingExternalLiveSurface, onDragEnter, onDragLeave, onDragOver, onDrop }
}
