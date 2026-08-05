/**
 * Public, component-free presentation scheduler entry point.
 *
 * App services and non-Vue render surfaces use this subpath so importing the
 * shared frame clock never evaluates the SDK's single-file-component barrel.
 */
export {
  cancelEditorPresentationFrame,
  cancelEditorPresentationUpdate,
  scheduleEditorPresentationFrame,
  scheduleEditorPresentationUpdate
} from '#vue/canvas/surface/frame-scheduler'
export type {
  EditorPresentationFrame,
  EditorPresentationFrameCallback,
  EditorPresentationUpdateCallback
} from '#vue/canvas/surface/frame-scheduler'
