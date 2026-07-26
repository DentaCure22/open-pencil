import type { Editor } from '@open-pencil/core/editor'

import type { CanvasRenderLayer } from './types'

type RenderLoopOptions = {
  layer?: CanvasRenderLayer
}

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

type EditorRenderScheduler = {
  schedule: (callback: EditorPresentationFrameCallback) => void
  cancel: (callback: EditorPresentationFrameCallback) => void
}

const renderSchedulers = new WeakMap<Editor, EditorRenderScheduler>()

function getRenderScheduler(editor: Editor): EditorRenderScheduler {
  const existing = renderSchedulers.get(editor)
  if (existing) return existing

  let frameId: number | null = null
  let revision = 0
  const callbacks = new Set<EditorPresentationFrameCallback>()

  function flush(timestamp: number) {
    frameId = null
    const pending = [...callbacks]
    callbacks.clear()
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
    for (const callback of pending) callback(frame)
  }

  const scheduler: EditorRenderScheduler = {
    schedule(callback) {
      callbacks.add(callback)
      if (frameId !== null) return
      frameId = requestAnimationFrame(flush)
    },
    cancel(callback) {
      callbacks.delete(callback)
      if (callbacks.size === 0 && frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      }
    }
  }

  renderSchedulers.set(editor, scheduler)
  return scheduler
}

export function scheduleEditorPresentationFrame(
  editor: Editor,
  callback: EditorPresentationFrameCallback
): void {
  getRenderScheduler(editor).schedule(callback)
}

export function cancelEditorPresentationFrame(
  editor: Editor,
  callback: EditorPresentationFrameCallback
): void {
  getRenderScheduler(editor).cancel(callback)
}

function shouldScheduleForSelection(layer: CanvasRenderLayer | undefined) {
  return layer !== 'scene'
}

export function createCanvasRenderLoop(
  editor: Editor,
  renderNow: () => void,
  options: RenderLoopOptions = {}
) {
  const scheduler = getRenderScheduler(editor)
  let dirty = true
  let frameScheduled = false
  let lastRenderVersion = -1
  let lastSelectedIds: Set<string> | null = null

  function renderFrame(_presentation: EditorPresentationFrame) {
    frameScheduled = false
    if (editor.state.loading) {
      scheduleRender()
      return
    }

    const versionChanged = editor.state.renderVersion !== lastRenderVersion
    const selectionChanged = editor.state.selectedIds !== lastSelectedIds
    if (dirty || versionChanged || selectionChanged) {
      dirty = false
      renderNow()
    }
  }

  const scheduleRender = () => {
    dirty = true
    if (frameScheduled) return
    frameScheduled = true
    scheduler.schedule(renderFrame)
  }

  const unsubscribe = [
    editor.onEditorEvent('render:requested', scheduleRender),
    editor.onEditorEvent('viewport:changed', scheduleRender)
  ]

  unsubscribe.push(editor.onEditorEvent('repaint:requested', scheduleRender))

  if (shouldScheduleForSelection(options.layer)) {
    unsubscribe.push(editor.onEditorEvent('overlay:requested', scheduleRender))
    unsubscribe.push(editor.onEditorEvent('selection:changed', scheduleRender))
  }

  function markRendered() {
    lastRenderVersion = editor.state.renderVersion
    lastSelectedIds = editor.state.selectedIds
  }

  function pause() {
    for (const off of unsubscribe) off()
    if (frameScheduled) {
      scheduler.cancel(renderFrame)
      frameScheduled = false
    }
  }

  return {
    pause,
    markRendered,
    markDirty: scheduleRender
  }
}
