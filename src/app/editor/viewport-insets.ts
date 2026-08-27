import type { ViewportInsets } from '@open-pencil/core/editor'

const VIEWPORT_SAFE_GAP = 14

export function visibleElementRect(selector: string): DOMRect | null {
  if (typeof document === 'undefined') return null
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 ? rect : null
}

function toolbarViewportInsets(toolbar: DOMRect | null, canvas: DOMRect): ViewportInsets {
  if (!toolbar) return {}
  if (toolbar.height > toolbar.width) {
    if (toolbar.left < canvas.left + canvas.width / 2) {
      return { left: toolbar.right - canvas.left + VIEWPORT_SAFE_GAP }
    }
    return { right: canvas.right - toolbar.left + VIEWPORT_SAFE_GAP }
  }
  if (toolbar.top < canvas.top + canvas.height / 2) {
    return { top: toolbar.bottom - canvas.top + VIEWPORT_SAFE_GAP }
  }
  return { bottom: canvas.bottom - toolbar.top + VIEWPORT_SAFE_GAP }
}

/** Describe the canvas area that remains readable around floating editor chrome. */
export function editorViewportInsets(): ViewportInsets {
  const canvas = visibleElementRect('[data-test-id="canvas-area"]')
  if (!canvas) return {}

  const sidebarShell = visibleElementRect('[data-test-id="layers-shell-motion"]')
  const leftPanel =
    visibleElementRect('[data-test-id="layers-shell"]') ??
    visibleElementRect('[data-test-id="layers-panel"]')
  const rightPanel = visibleElementRect('[data-test-id="properties-panel"]')
  const toolbar = visibleElementRect('[data-test-id="toolbar"]')
  const mobileDrawer = visibleElementRect('[data-test-id="mobile-drawer"]')
  const canvasCenterX = canvas.left + canvas.width / 2
  const propertiesOnRight = rightPanel && rightPanel.left >= canvasCenterX ? rightPanel : null
  const toolbarInsets = toolbarViewportInsets(toolbar, canvas)
  let bottom = toolbarInsets.bottom ?? VIEWPORT_SAFE_GAP
  if (mobileDrawer) {
    bottom = Math.max(bottom, canvas.bottom - mobileDrawer.top + VIEWPORT_SAFE_GAP)
  }

  let left = toolbarInsets.left ?? VIEWPORT_SAFE_GAP
  if (leftPanel) {
    left = Math.max(VIEWPORT_SAFE_GAP, leftPanel.right - canvas.left + VIEWPORT_SAFE_GAP)
  }
  if (sidebarShell) {
    left = Math.max(VIEWPORT_SAFE_GAP, sidebarShell.right - canvas.left + VIEWPORT_SAFE_GAP)
  }
  let right = propertiesOnRight
    ? Math.max(VIEWPORT_SAFE_GAP, canvas.right - propertiesOnRight.left + VIEWPORT_SAFE_GAP)
    : VIEWPORT_SAFE_GAP
  right = Math.max(right, toolbarInsets.right ?? VIEWPORT_SAFE_GAP)

  return {
    bottom,
    left,
    right,
    top: toolbarInsets.top ?? VIEWPORT_SAFE_GAP
  }
}
