import type { Tool } from '@open-pencil/core/editor'

export const SURFACE_ACTIVATION_DELAY_MS = 260
export const SURFACE_CLICK_DRAG_THRESHOLD_PX = 4

export function canvasSurfaceCanReceivePointer(activeTool: Tool): boolean {
  return activeTool === 'SELECT'
}
