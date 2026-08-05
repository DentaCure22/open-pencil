import { describe, expect, test } from 'bun:test'

import type { Editor, EditorEvents } from '@open-pencil/core/editor'
import {
  cancelEditorPresentationUpdate,
  scheduleEditorPresentationFrame,
  scheduleEditorPresentationUpdate,
  type EditorPresentationFrame
} from '@open-pencil/vue/presentation'

import { createCanvasRenderLoop } from '#vue/canvas/surface/render-loop'

type EditorEventName = keyof EditorEvents

type TestEditor = Pick<Editor, 'state' | 'onEditorEvent'>

function createFrameScheduler() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => {
    callbacks.delete(id)
  }) as typeof cancelAnimationFrame

  return {
    get pendingCount() {
      return callbacks.size
    },
    flush() {
      const pending = [...callbacks]
      callbacks.clear()
      for (const [id, callback] of pending) callback(id)
    },
    restore() {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame
      globalThis.cancelAnimationFrame = originalCancelAnimationFrame
    }
  }
}

function createErrorRecorder() {
  const originalConsoleError = console.error
  const errors: unknown[][] = []
  console.error = (...args: unknown[]) => {
    errors.push(args)
  }

  return {
    errors,
    restore() {
      console.error = originalConsoleError
    }
  }
}

function createEditor() {
  const handlers = new Map<EditorEventName, Set<(...args: never[]) => void>>()
  const editor: TestEditor = {
    state: {
      loading: false,
      panX: 0,
      renderVersion: 0,
      sceneVersion: 0,
      selectedIds: new Set<string>(),
      panY: 0,
      zoom: 1
    } as Editor['state'],
    onEditorEvent(event, handler) {
      const listeners = handlers.get(event) ?? new Set()
      listeners.add(handler as (...args: never[]) => void)
      handlers.set(event, listeners)
      return () => listeners.delete(handler as (...args: never[]) => void)
    }
  }

  return {
    editor: editor as Editor,
    emit(event: EditorEventName) {
      for (const handler of handlers.get(event) ?? []) handler()
    }
  }
}

describe('canvas render loop', () => {
  test('waits for editor events before scheduling renders', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(editor, () => {
        renders++
      })

      expect(scheduler.pendingCount).toBe(0)
      emit('repaint:requested')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('coalesces multiple editor events into one animation frame', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(editor, () => {
        renders++
      })

      emit('render:requested')
      emit('repaint:requested')
      emit('selection:changed')
      emit('viewport:changed')

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('scene layers render on repaint but ignore selection events', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(
        editor,
        () => {
          renders++
        },
        { layer: 'scene' }
      )

      emit('selection:changed')
      expect(scheduler.pendingCount).toBe(0)

      emit('repaint:requested')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('overlay layers render on repaint and selection events', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      createCanvasRenderLoop(
        editor,
        () => {
          renders++
        },
        { layer: 'overlays' }
      )

      emit('repaint:requested')
      emit('selection:changed')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(renders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('overlay-only events render full and overlay layers, coalescing without scene renders', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let fullRenders = 0
      let sceneRenders = 0
      let overlayRenders = 0
      createCanvasRenderLoop(editor, () => {
        fullRenders++
      })
      createCanvasRenderLoop(
        editor,
        () => {
          sceneRenders++
        },
        { layer: 'scene' }
      )
      createCanvasRenderLoop(
        editor,
        () => {
          overlayRenders++
        },
        { layer: 'overlays' }
      )

      emit('overlay:requested')
      emit('overlay:requested')
      emit('overlay:requested')

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(fullRenders).toBe(1)
      expect(overlayRenders).toBe(1)
      expect(sceneRenders).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('coalesces multiple canvas surfaces into one animation frame', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let sceneRenders = 0
      let overlayRenders = 0
      createCanvasRenderLoop(
        editor,
        () => {
          sceneRenders++
        },
        { layer: 'scene' }
      )
      createCanvasRenderLoop(
        editor,
        () => {
          overlayRenders++
        },
        { layer: 'overlays' }
      )

      emit('viewport:changed')
      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(sceneRenders).toBe(1)
      expect(overlayRenders).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('shares one immutable presentation frame with Board overlays', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      editor.state.panX = 120
      editor.state.panY = 80
      editor.state.zoom = 1.25
      editor.state.renderVersion = 7
      editor.state.sceneVersion = 3
      let canvasRenders = 0
      let presentation: EditorPresentationFrame | null = null

      createCanvasRenderLoop(editor, () => {
        canvasRenders++
      })
      scheduleEditorPresentationFrame(editor, (frame) => {
        presentation = frame
      })
      emit('repaint:requested')

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(canvasRenders).toBe(1)
      expect(presentation).toEqual({
        renderVersion: 7,
        revision: 1,
        sceneVersion: 3,
        timestamp: 1,
        viewport: { x: 120, y: 80, zoom: 1.25 }
      })
      expect(Object.isFrozen(presentation)).toBe(true)
      expect(Object.isFrozen(presentation?.viewport)).toBe(true)
    } finally {
      scheduler.restore()
    }
  })

  test('runs transient updates before same-frame canvas and overlay consumers', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      const observations: string[] = []
      let transientPosition = 0

      createCanvasRenderLoop(editor, () => {
        observations.push(`canvas:${transientPosition}`)
      })
      scheduleEditorPresentationUpdate(editor, (timestamp) => {
        transientPosition = 120
        editor.state.renderVersion = 1
        observations.push(`update:${timestamp}`)
        emit('repaint:requested')
        scheduleEditorPresentationFrame(editor, (frame) => {
          observations.push(
            `overlay:${transientPosition}:${frame.renderVersion}:${frame.timestamp}`
          )
        })
      })

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()

      expect(observations).toEqual(['update:1', 'canvas:120', 'overlay:120:1:1'])
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('defers recursively scheduled transient updates to the next frame', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      const renderedPositions: number[] = []
      let transientPosition = 0

      createCanvasRenderLoop(editor, () => {
        renderedPositions.push(transientPosition)
      })
      const update = () => {
        transientPosition++
        emit('repaint:requested')
        if (transientPosition < 2) scheduleEditorPresentationUpdate(editor, update)
      }
      scheduleEditorPresentationUpdate(editor, update)

      scheduler.flush()
      expect(renderedPositions).toEqual([1])
      expect(scheduler.pendingCount).toBe(1)

      scheduler.flush()
      expect(renderedPositions).toEqual([1, 2])
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      scheduler.restore()
    }
  })

  test('cancels a pending transient update without cancelling presentation consumers', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor } = createEditor()
      let updates = 0
      let presentations = 0
      const update = () => {
        updates++
      }
      scheduleEditorPresentationUpdate(editor, update)
      scheduleEditorPresentationFrame(editor, () => {
        presentations++
      })
      cancelEditorPresentationUpdate(editor, update)

      expect(scheduler.pendingCount).toBe(1)
      scheduler.flush()
      expect(updates).toBe(0)
      expect(presentations).toBe(1)
    } finally {
      scheduler.restore()
    }
  })

  test('isolates a throwing update while preserving later updates and presentation ordering', () => {
    const scheduler = createFrameScheduler()
    const errorRecorder = createErrorRecorder()
    try {
      const { editor } = createEditor()
      const failure = new Error('update failed')
      const observations: string[] = []

      scheduleEditorPresentationUpdate(editor, () => {
        observations.push('update:first')
        throw failure
      })
      scheduleEditorPresentationUpdate(editor, () => {
        observations.push('update:second')
      })
      scheduleEditorPresentationFrame(editor, () => {
        observations.push('presentation')
      })

      scheduler.flush()

      expect(observations).toEqual(['update:first', 'update:second', 'presentation'])
      expect(errorRecorder.errors).toEqual([
        ['[canvas] Editor transient update callback failed', failure]
      ])
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      errorRecorder.restore()
      scheduler.restore()
    }
  })

  test('isolates a throwing presentation while later consumers still run', () => {
    const scheduler = createFrameScheduler()
    const errorRecorder = createErrorRecorder()
    try {
      const { editor } = createEditor()
      const failure = new Error('presentation failed')
      const observations: string[] = []

      scheduleEditorPresentationUpdate(editor, () => {
        observations.push('update')
      })
      scheduleEditorPresentationFrame(editor, () => {
        observations.push('presentation:first')
        throw failure
      })
      scheduleEditorPresentationFrame(editor, () => {
        observations.push('presentation:second')
      })

      scheduler.flush()

      expect(observations).toEqual(['update', 'presentation:first', 'presentation:second'])
      expect(errorRecorder.errors).toEqual([
        ['[canvas] Editor presentation callback failed', failure]
      ])
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      errorRecorder.restore()
      scheduler.restore()
    }
  })

  test('cancels pending renders when paused', () => {
    const scheduler = createFrameScheduler()
    try {
      const { editor, emit } = createEditor()
      let renders = 0
      const loop = createCanvasRenderLoop(editor, () => {
        renders++
      })

      emit('render:requested')
      expect(scheduler.pendingCount).toBe(1)
      loop.pause()
      expect(scheduler.pendingCount).toBe(0)

      emit('render:requested')
      scheduler.flush()
      expect(renders).toBe(0)
    } finally {
      scheduler.restore()
    }
  })
})
