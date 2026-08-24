/**
 * Options for {@link useCanvas}.
 */
export type CanvasRenderLayer = 'full' | 'scene' | 'overlays'

export interface UseCanvasOptions {
  /**
   * Returns true when a node has a product-owned overlay that replaces native
   * selection and hover chrome.
   */
  ownsSelectionChrome?: (nodeId: string) => boolean
  /**
   * Selects which render layer this canvas owns.
   */
  layer?: CanvasRenderLayer
  /**
   * Caps backing-store resolution below the device pixel ratio.
   */
  maxDevicePixelRatio?: number
  /**
   * Forces ruler visibility on or off for this canvas.
   *
   * When omitted, the composable falls back to viewport and URL-param logic.
   */
  showRulers?: boolean
  /**
   * Keeps the drawing buffer after presenting frames.
   *
   * Useful for screenshot or pixel-readback workflows, but may increase memory
   * usage depending on the browser and GPU backend.
   */
  preserveDrawingBuffer?: boolean
  /**
   * Called when the rendering surface cannot be initialized.
   */
  onError?: (error: unknown) => void
  /**
   * Called once the rendering surface is ready.
   */
  onReady?: () => void
}
