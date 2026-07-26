import type { ViewportInsets } from '@open-pencil/core/editor'

const VIEWPORT_SAFE_GAP = 14

export function visibleElementRect(selector: string): DOMRect | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

/** Describe the canvas area that remains readable around floating editor chrome. */
export function editorViewportInsets(): ViewportInsets {
  const canvas = visibleElementRect('[data-test-id="canvas-area"]')
  if (!canvas) return {}

  const leftPanel =
    visibleElementRect('[data-test-id="layers-shell"]') ??
    visibleElementRect('[data-test-id="layers-panel"]')
  const rightPanel = visibleElementRect('[data-test-id="properties-panel"]')
  const toolbar = visibleElementRect('[data-test-id="toolbar"]')
  const boardDock = visibleElementRect('[data-test-id="board-dock"]')
  const mobileDrawer = visibleElementRect('[data-test-id="mobile-drawer"]')
  const canvasCenterX = canvas.left + canvas.width / 2
  const propertiesOnRight = rightPanel && rightPanel.left >= canvasCenterX ? rightPanel : null
  let bottom = VIEWPORT_SAFE_GAP
  if (mobileDrawer) {
    bottom = Math.max(VIEWPORT_SAFE_GAP, canvas.bottom - mobileDrawer.top + VIEWPORT_SAFE_GAP)
  } else if (boardDock) {
    bottom = Math.max(VIEWPORT_SAFE_GAP, canvas.bottom - boardDock.top + VIEWPORT_SAFE_GAP)
  }

  return {
    bottom,
    left: leftPanel
      ? Math.max(VIEWPORT_SAFE_GAP, leftPanel.right - canvas.left + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP,
    right: propertiesOnRight
      ? Math.max(VIEWPORT_SAFE_GAP, canvas.right - propertiesOnRight.left + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP,
    top: toolbar
      ? Math.max(VIEWPORT_SAFE_GAP, toolbar.bottom - canvas.top + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP
  }
}
