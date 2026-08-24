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

  const sidebarShell = visibleElementRect('[data-test-id="layers-shell-motion"]')
  const leftPanel =
    visibleElementRect('[data-test-id="layers-shell"]') ??
    visibleElementRect('[data-test-id="layers-panel"]')
  const rightPanel = visibleElementRect('[data-test-id="properties-panel"]')
  const toolbar = visibleElementRect('[data-test-id="toolbar"]')
  const mobileDrawer = visibleElementRect('[data-test-id="mobile-drawer"]')
  const canvasCenterX = canvas.left + canvas.width / 2
  const propertiesOnRight = rightPanel && rightPanel.left >= canvasCenterX ? rightPanel : null
  const verticalToolbar = toolbar && toolbar.height > toolbar.width ? toolbar : null
  const toolbarOnLeft = !!verticalToolbar && verticalToolbar.left < canvasCenterX
  const toolbarOnRight = !!verticalToolbar && verticalToolbar.left >= canvasCenterX
  let bottom = VIEWPORT_SAFE_GAP
  if (mobileDrawer) {
    bottom = Math.max(VIEWPORT_SAFE_GAP, canvas.bottom - mobileDrawer.top + VIEWPORT_SAFE_GAP)
  }

  let left = sidebarShell
    ? Math.max(VIEWPORT_SAFE_GAP, sidebarShell.right - canvas.left + VIEWPORT_SAFE_GAP)
    : leftPanel
      ? Math.max(VIEWPORT_SAFE_GAP, leftPanel.right - canvas.left + VIEWPORT_SAFE_GAP)
      : VIEWPORT_SAFE_GAP
  let right = propertiesOnRight
    ? Math.max(VIEWPORT_SAFE_GAP, canvas.right - propertiesOnRight.left + VIEWPORT_SAFE_GAP)
    : VIEWPORT_SAFE_GAP
  if (toolbarOnLeft && verticalToolbar) {
    left = Math.max(left, verticalToolbar.right - canvas.left + VIEWPORT_SAFE_GAP)
  } else if (toolbarOnRight && verticalToolbar) {
    right = Math.max(right, canvas.right - verticalToolbar.left + VIEWPORT_SAFE_GAP)
  }

  return {
    bottom,
    left,
    right,
    top:
      toolbar && !verticalToolbar
        ? Math.max(VIEWPORT_SAFE_GAP, toolbar.bottom - canvas.top + VIEWPORT_SAFE_GAP)
        : VIEWPORT_SAFE_GAP
  }
}
