import type { Editor } from '@open-pencil/core/editor'

export type EditorPresentationFrame = Readonly<{
  renderVersion: number
  revision: number
  sceneVersion: number
  timestamp: number
  viewport: Readonly<{
    x: number
    y: number
    zoom: number
  }>
}>

export type EditorPresentationFrameCallback = (frame: EditorPresentationFrame) => void

export type EditorPresentationUpdateCallback = (timestamp: number) => void

type EditorPresentationCallbackPhase = 'presentation' | 'transient update'

type EditorRenderScheduler = {
  cancelPresentation: (callback: EditorPresentationFrameCallback) => void
  cancelUpdate: (callback: EditorPresentationUpdateCallback) => void
  schedulePresentation: (callback: EditorPresentationFrameCallback) => void
  scheduleUpdate: (callback: EditorPresentationUpdateCallback) => void
}

const renderSchedulers = new WeakMap<Editor, EditorRenderScheduler>()

function runPresentationCallbacks<T>(
  callbacks: readonly ((value: T) => void)[],
  value: T,
  phase: EditorPresentationCallbackPhase
): void {
  for (const callback of callbacks) {
    try {
      callback(value)
    } catch (error) {
      console.error(`[canvas] Editor ${phase} callback failed`, error)
    }
  }
}

function getRenderScheduler(editor: Editor): EditorRenderScheduler {
  const existing = renderSchedulers.get(editor)
  if (existing) return existing

  let frameId: number | null = null
  let flushing = false
  let revision = 0
  const presentationCallbacks = new Set<EditorPresentationFrameCallback>()
  const updateCallbacks = new Set<EditorPresentationUpdateCallback>()

  function requestFrame() {
    if (frameId !== null || flushing) return
    frameId = requestAnimationFrame(flush)
  }

  function cancelFrameIfIdle() {
    if (frameId === null || presentationCallbacks.size > 0 || updateCallbacks.size > 0) {
      return
    }
    cancelAnimationFrame(frameId)
    frameId = null
  }

  function flush(timestamp: number) {
    frameId = null
    flushing = true
    try {
      const pendingUpdates = [...updateCallbacks]
      updateCallbacks.clear()
      runPresentationCallbacks(pendingUpdates, timestamp, 'transient update')

      const frame: EditorPresentationFrame = Object.freeze({
        renderVersion: editor.state.renderVersion,
        revision: ++revision,
        sceneVersion: editor.state.sceneVersion,
        timestamp,
        viewport: Object.freeze({
          x: editor.state.panX,
          y: editor.state.panY,
          zoom: editor.state.zoom
        })
      })
      const pendingPresentations = [...presentationCallbacks]
      presentationCallbacks.clear()
      runPresentationCallbacks(pendingPresentations, frame, 'presentation')
    } finally {
      flushing = false
      if (presentationCallbacks.size > 0 || updateCallbacks.size > 0) requestFrame()
    }
  }

  const scheduler: EditorRenderScheduler = {
    cancelPresentation(callback) {
      presentationCallbacks.delete(callback)
      cancelFrameIfIdle()
    },
    cancelUpdate(callback) {
      updateCallbacks.delete(callback)
      cancelFrameIfIdle()
    },
    schedulePresentation(callback) {
      presentationCallbacks.add(callback)
      requestFrame()
    },
    scheduleUpdate(callback) {
      updateCallbacks.add(callback)
      requestFrame()
    }
  }

  renderSchedulers.set(editor, scheduler)
  return scheduler
}

export function scheduleEditorPresentationFrame(
  editor: Editor,
  callback: EditorPresentationFrameCallback
): void {
  getRenderScheduler(editor).schedulePresentation(callback)
}

export function cancelEditorPresentationFrame(
  editor: Editor,
  callback: EditorPresentationFrameCallback
): void {
  getRenderScheduler(editor).cancelPresentation(callback)
}

export function scheduleEditorPresentationUpdate(
  editor: Editor,
  callback: EditorPresentationUpdateCallback
): void {
  getRenderScheduler(editor).scheduleUpdate(callback)
}

export function cancelEditorPresentationUpdate(
  editor: Editor,
  callback: EditorPresentationUpdateCallback
): void {
  getRenderScheduler(editor).cancelUpdate(callback)
}
