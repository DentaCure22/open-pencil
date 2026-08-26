export const CANVAS_ZOOM_MIN = 0.02
export const CANVAS_ZOOM_MAX = 256
export const CANVAS_ZOOM_STEP = 1.25

export function clampCanvasZoom(level: number): number {
  return Math.max(CANVAS_ZOOM_MIN, Math.min(CANVAS_ZOOM_MAX, level))
}

export function steppedCanvasZoom(current: number, direction: 1 | -1): number {
  const next = direction === 1 ? current * CANVAS_ZOOM_STEP : current / CANVAS_ZOOM_STEP
  return clampCanvasZoom(next)
}

export function formatCanvasZoomPercent(zoom: number): string {
  return `${Math.round(clampCanvasZoom(zoom) * 100)}%`
}
