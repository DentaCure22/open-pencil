type UnknownRecord = { [key: string]: unknown }

export type EmbeddedSurfaceWheelMessage = {
  action: 'canvas-wheel'
  clientX?: number
  clientY?: number
  ctrlKey?: boolean
  deltaMode?: number
  deltaX?: number
  deltaY?: number
  kind: string
  metaKey?: boolean
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function editorCanvasWheelTarget(source: Element) {
  const canvasArea = source.closest<HTMLElement>('.canvas-area')
  return canvasArea?.querySelector<HTMLElement>('[data-test-id="canvas-element"]') ?? canvasArea
}

function dispatchEditorCanvasWheel(wheelTarget: HTMLElement, init: WheelEventInit) {
  wheelTarget.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ...init
    })
  )
}

export function isEmbeddedSurfaceWheelMessage(
  value: unknown,
  expectedKind: string
): value is EmbeddedSurfaceWheelMessage {
  return (
    isRecord(value) &&
    value.kind === expectedKind &&
    value.action === 'canvas-wheel' &&
    (value.clientX === undefined || Number.isFinite(value.clientX)) &&
    (value.clientY === undefined || Number.isFinite(value.clientY)) &&
    (value.deltaMode === undefined || Number.isFinite(value.deltaMode)) &&
    (value.deltaX === undefined || Number.isFinite(value.deltaX)) &&
    (value.deltaY === undefined || Number.isFinite(value.deltaY))
  )
}

/**
 * Re-dispatch an iframe wheel packet through the editor's canonical canvas
 * handler so embedded surfaces use exactly the same pan/zoom behavior.
 */
export function forwardEmbeddedSurfaceWheel(
  iframe: HTMLIFrameElement,
  message: EmbeddedSurfaceWheelMessage
) {
  const wheelTarget = editorCanvasWheelTarget(iframe)
  if (!wheelTarget) return false

  const iframeRect = iframe.getBoundingClientRect()
  const scaleX = iframeRect.width / Math.max(iframe.clientWidth, 1)
  const scaleY = iframeRect.height / Math.max(iframe.clientHeight, 1)
  const clientX = iframeRect.left + finiteNumber(message.clientX) * scaleX
  const clientY = iframeRect.top + finiteNumber(message.clientY) * scaleY
  const deltaMode = finiteNumber(message.deltaMode)

  dispatchEditorCanvasWheel(wheelTarget, {
    clientX,
    clientY,
    ctrlKey: message.ctrlKey === true,
    deltaMode: deltaMode === 1 || deltaMode === 2 ? deltaMode : 0,
    deltaX: finiteNumber(message.deltaX),
    deltaY: finiteNumber(message.deltaY),
    metaKey: message.metaKey === true
  })
  return true
}

/** Forward wheel gestures caught by parent-owned frame overlays. */
export function forwardFrameSurfaceWheel(source: HTMLElement, event: WheelEvent) {
  const wheelTarget = editorCanvasWheelTarget(source)
  if (!wheelTarget) return false

  dispatchEditorCanvasWheel(wheelTarget, {
    altKey: event.altKey,
    clientX: event.clientX,
    clientY: event.clientY,
    ctrlKey: event.ctrlKey,
    deltaMode: event.deltaMode,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey
  })
  return true
}
