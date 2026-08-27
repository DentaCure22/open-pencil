import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'

import {
  readAgentRightPanelWidth,
  writeAgentRightPanelWidth
} from '@/app/agent-chat/right-panel-storage'
import { lockHorizontalResizeCursor } from '@/app/shell/horizontal-resize-lock'
import { IS_BROWSER } from '@/constants'

import {
  getT3RightPanelDefaultWidth,
  getT3RightPanelMaxWidth,
  T3_RIGHT_PANEL_BREAKPOINT,
  T3_RIGHT_PANEL_MIN_WIDTH
} from './t3-right-panel.logic'

function clampPanelWidth(width: number): number {
  if (!IS_BROWSER) return T3_RIGHT_PANEL_MIN_WIDTH
  return Math.min(
    Math.max(width, T3_RIGHT_PANEL_MIN_WIDTH),
    getT3RightPanelMaxWidth(window.innerWidth)
  )
}

function initialPanelWidth(): number {
  const fallback = IS_BROWSER
    ? getT3RightPanelDefaultWidth(window.innerWidth)
    : T3_RIGHT_PANEL_MIN_WIDTH
  return clampPanelWidth(readAgentRightPanelWidth(fallback))
}

export function useT3PanelWidth() {
  const [width, setWidth] = useState(initialPanelWidth)
  const [resizing, setResizing] = useState(false)
  const [narrow, setNarrow] = useState(
    () => IS_BROWSER && window.innerWidth <= T3_RIGHT_PANEL_BREAKPOINT
  )
  const dragState = useRef<{
    frame: number | null
    originWidth: number
    originX: number
    pendingWidth: number
    pointerId: number
    releaseCursorLock: () => void
    target: HTMLElement
  } | null>(null)

  const releaseResize = useCallback((pointerId: number) => {
    const state = dragState.current
    if (!state || state.pointerId !== pointerId) return null
    dragState.current = null
    if (state.frame !== null) window.cancelAnimationFrame(state.frame)
    try {
      if (state.target.hasPointerCapture(pointerId)) state.target.releasePointerCapture(pointerId)
    } catch (error) {
      console.warn('[T3 right panel] Pointer capture was already released.', error)
    }
    state.releaseCursorLock()
    setResizing(false)
    return state
  }, [])

  useEffect(() => {
    const resize = () => {
      setNarrow(window.innerWidth <= T3_RIGHT_PANEL_BREAKPOINT)
      setWidth((current) => clampPanelWidth(current))
    }
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(
    () => () => {
      const state = dragState.current
      if (state) releaseResize(state.pointerId)
    },
    [releaseResize]
  )

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (narrow || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const target = event.currentTarget
    try {
      target.setPointerCapture(event.pointerId)
    } catch {
      return
    }
    dragState.current = {
      frame: null,
      originWidth: width,
      originX: event.clientX,
      pendingWidth: width,
      pointerId: event.pointerId,
      releaseCursorLock: lockHorizontalResizeCursor(),
      target
    }
    setResizing(true)
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    event.preventDefault()
    state.pendingWidth = clampPanelWidth(state.originWidth + state.originX - event.clientX)
    if (state.frame !== null) return
    state.frame = window.requestAnimationFrame(() => {
      const active = dragState.current
      if (!active) return
      active.frame = null
      setWidth(active.pendingWidth)
    })
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    const finalWidth = clampPanelWidth(state.originWidth + state.originX - event.clientX)
    state.pendingWidth = finalWidth
    releaseResize(event.pointerId)
    setWidth(finalWidth)
    writeAgentRightPanelWidth(finalWidth)
  }

  function cancelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragState.current
    if (!state || state.pointerId !== event.pointerId) return
    const originWidth = state.originWidth
    releaseResize(event.pointerId)
    setWidth(originWidth)
  }

  return {
    narrow,
    resizeHandlers: {
      onLostPointerCapture: cancelResize,
      onPointerCancel: cancelResize,
      onPointerDown: beginResize,
      onPointerMove: moveResize,
      onPointerUp: endResize
    },
    resizing,
    width
  }
}
