import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { CodeObjectTheme } from '@open-pencil/core/code-object'

import type {
  OfficeDocumentState,
  OfficeSpreadsheetState,
  CodeObjectState
} from '@/app/code-object/model'

import { createOfficeRuntime, type OfficeRuntime, type OfficeRuntimeKind } from './runtime'

type UniverSurfaceProps = {
  fileName: string
  interactionEnabled: boolean
  kind: OfficeRuntimeKind
  onStateChange: (state: CodeObjectState) => void
  preview: ReactNode
  state: OfficeDocumentState | OfficeSpreadsheetState
  theme: CodeObjectTheme
}

type RuntimeStatus = 'error' | 'loading' | 'ready'

function disposeRuntime(runtime: OfficeRuntime, host: HTMLElement) {
  window.setTimeout(() => {
    runtime.dispose()
    host.remove()
  }, 0)
}

function fitRuntimeHostToCanvasScale(container: HTMLElement, host: HTMLElement) {
  const bounds = container.getBoundingClientRect()
  const scaleX = bounds.width / Math.max(1, container.clientWidth)
  const scaleY = bounds.height / Math.max(1, container.clientHeight)
  host.style.width = `${bounds.width}px`
  host.style.height = `${bounds.height}px`
  host.style.transform = `scale(${1 / Math.max(scaleX, 0.01)}, ${1 / Math.max(scaleY, 0.01)})`
  host.style.transformOrigin = 'top left'
}

export function UniverSurface({
  fileName,
  interactionEnabled,
  kind,
  onStateChange,
  preview,
  state,
  theme
}: UniverSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<OfficeRuntime | null>(null)
  const interactionRef = useRef(interactionEnabled)
  const stateRef = useRef(state)
  const [runtimeActive, setRuntimeActive] = useState(interactionEnabled)
  const [status, setStatus] = useState<RuntimeStatus>('loading')

  stateRef.current = state

  useLayoutEffect(() => {
    const wasInteracting = interactionRef.current
    interactionRef.current = interactionEnabled
    if (!wasInteracting && interactionEnabled) {
      setRuntimeActive(true)
      return
    }
    if (!wasInteracting || interactionEnabled) return
    const runtime = runtimeRef.current
    const current = stateRef.current
    if (runtime) {
      onStateChange({
        ...current,
        revision: current.revision + 1,
        snapshot: runtime.save()
      })
    }
    setRuntimeActive(false)
  }, [interactionEnabled, onStateChange])

  useEffect(() => {
    if (!runtimeActive) return undefined
    const container = containerRef.current
    if (!container) return undefined
    const host = document.createElement('div')
    host.className = 'absolute top-0 left-0'
    host.dataset.officeRuntimeHost = kind
    fitRuntimeHostToCanvasScale(container, host)
    container.append(host)
    let disposed = false
    let ownedRuntime: OfficeRuntime | null = null
    setStatus('loading')
    void createOfficeRuntime({
      container: host,
      fileName,
      kind,
      state: stateRef.current,
      theme
    }).then(
      (runtime) => {
        if (disposed) {
          disposeRuntime(runtime, host)
          return null
        }
        ownedRuntime = runtime
        runtimeRef.current = runtime
        setStatus('ready')
        return null
      },
      (error: unknown) => {
        console.error('[OpenPencil Office] Runtime startup failed', error)
        if (!disposed) setStatus('error')
        return null
      }
    )
    return () => {
      disposed = true
      if (ownedRuntime) {
        if (runtimeRef.current === ownedRuntime) runtimeRef.current = null
        disposeRuntime(ownedRuntime, host)
      } else {
        host.remove()
      }
    }
  }, [fileName, kind, runtimeActive, state.revision, theme])

  return (
    <main
      className="relative size-full overflow-hidden bg-[var(--code-background)] font-sans"
      data-office-kind={kind}
      data-office-mode={interactionEnabled ? 'interact' : 'design'}
      data-test-id={`office-${kind}`}
    >
      {runtimeActive ? (
        <div
          ref={containerRef}
          className="absolute inset-0"
          data-test-id={`office-${kind}-runtime`}
        />
      ) : null}

      {!interactionEnabled ? (
        <div className="absolute inset-0" data-test-id={`office-${kind}-preview`}>
          {preview}
        </div>
      ) : null}

      {interactionEnabled && status === 'loading' ? (
        <div
          className="pointer-events-none absolute inset-0 grid place-items-center bg-[var(--code-background)] text-[12px] font-medium text-[var(--code-text-muted)]"
          data-test-id={`office-${kind}-loading`}
        >
          Opening {kind === 'document' ? 'document' : 'spreadsheet'}…
        </div>
      ) : null}

      {interactionEnabled && status === 'error' ? (
        <div
          className="absolute inset-0 grid place-items-center bg-[var(--code-background)] p-10 text-center text-[12px] leading-5 text-[var(--code-text-muted)]"
          data-test-id={`office-${kind}-error`}
        >
          The Office surface could not start. The board object and its source remain preserved.
        </div>
      ) : null}
    </main>
  )
}
