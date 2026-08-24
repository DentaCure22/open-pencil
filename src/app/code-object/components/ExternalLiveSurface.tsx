import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent
} from 'react'

import {
  postBrowserLiveSurfaceInput,
  type BrowserLiveSurfaceInput,
  type ExternalLiveSurfaceSource
} from '@/app/external-live-surface/contracts'
import { startExternalLiveSurfaceCapture } from '@/app/external-live-surface/native'

import type { ExternalLiveSurfaceDocument } from '../model'

type ExternalLiveSurfaceProps = {
  document: ExternalLiveSurfaceDocument
  frameId: string
  interactionEnabled: boolean
}

function ratios(element: HTMLElement, clientX: number, clientY: number) {
  const bounds = element.getBoundingClientRect()
  return {
    xRatio: Math.min(1, Math.max(0, (clientX - bounds.left) / Math.max(1, bounds.width))),
    yRatio: Math.min(1, Math.max(0, (clientY - bounds.top) / Math.max(1, bounds.height)))
  }
}

function pointerInput(
  event: PointerEvent<HTMLDivElement>,
  phase: 'down' | 'move' | 'up'
): Extract<BrowserLiveSurfaceInput, { kind: 'pointer' }> {
  return {
    button: event.button,
    buttons: event.buttons,
    kind: 'pointer',
    phase,
    ...ratios(event.currentTarget, event.clientX, event.clientY)
  }
}

function forwardPointer(
  source: ExternalLiveSurfaceSource,
  event: PointerEvent<HTMLDivElement>,
  phase: 'down' | 'move' | 'up'
) {
  postBrowserLiveSurfaceInput(source, pointerInput(event, phase))
}

function forwardKey(
  source: ExternalLiveSurfaceSource,
  event: KeyboardEvent<HTMLDivElement>,
  phase: 'down' | 'up'
) {
  postBrowserLiveSurfaceInput(source, {
    altKey: event.altKey,
    code: event.code,
    ctrlKey: event.ctrlKey,
    key: event.key,
    kind: 'key',
    metaKey: event.metaKey,
    phase,
    shiftKey: event.shiftKey
  })
}

export function ExternalLiveSurface({
  document,
  frameId,
  interactionEnabled
}: ExternalLiveSurfaceProps) {
  const [frame, setFrame] = useState(document.preview.dataUrl)
  const [captureStatus, setCaptureStatus] = useState<'ended' | 'live' | 'preview'>('preview')
  const pendingMove = useRef<Extract<BrowserLiveSurfaceInput, { kind: 'pointer' }> | null>(null)
  const moveFrame = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    let stop: (() => Promise<void>) | null = null
    void startExternalLiveSurfaceCapture(frameId, document.captureSource, (status) => {
      if (!active) return
      if (status.kind === 'frame') {
        setFrame(status.dataUrl)
        setCaptureStatus('live')
      } else {
        setCaptureStatus((current) => (current === 'live' ? 'ended' : current))
      }
    })
      .then((cleanup) => {
        if (!active) return cleanup?.()
        stop = cleanup
        return undefined
      })
      .catch(() => setCaptureStatus('preview'))
    return () => {
      active = false
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current)
      void stop?.()
    }
  }, [document.captureSource, frameId])

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!interactionEnabled) return
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    forwardPointer(document.captureSource, event, 'down')
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!interactionEnabled) return
    pendingMove.current = pointerInput(event, 'move')
    if (moveFrame.current !== null) return
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null
      const latest = pendingMove.current
      pendingMove.current = null
      if (latest) postBrowserLiveSurfaceInput(document.captureSource, latest)
    })
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!interactionEnabled) return
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current)
      moveFrame.current = null
    }
    const latestMove = pendingMove.current
    pendingMove.current = null
    if (latestMove) postBrowserLiveSurfaceInput(document.captureSource, latestMove)
    forwardPointer(document.captureSource, event, 'up')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function wheel(event: WheelEvent<HTMLDivElement>) {
    if (!interactionEnabled) return
    postBrowserLiveSurfaceInput(document.captureSource, {
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      kind: 'wheel',
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      ...ratios(event.currentTarget, event.clientX, event.clientY)
    })
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!interactionEnabled) return
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      postBrowserLiveSurfaceInput(document.captureSource, { kind: 'text', text: event.key })
      event.preventDefault()
      return
    }
    forwardKey(document.captureSource, event, 'down')
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    if (!interactionEnabled) return
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    postBrowserLiveSurfaceInput(document.captureSource, { kind: 'text', text })
    event.preventDefault()
  }

  return (
    <div
      aria-label={`${document.name} live surface`}
      className="size-full overflow-hidden outline-none"
      data-external-live-surface-status={captureStatus}
      data-test-id="external-live-surface"
      onKeyDown={keyDown}
      onKeyUp={(event) => interactionEnabled && forwardKey(document.captureSource, event, 'up')}
      onPaste={paste}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onWheel={wheel}
      role="application"
      tabIndex={interactionEnabled ? 0 : -1}
    >
      <img
        alt=""
        className="pointer-events-none size-full select-none"
        draggable={false}
        src={frame}
      />
    </div>
  )
}
