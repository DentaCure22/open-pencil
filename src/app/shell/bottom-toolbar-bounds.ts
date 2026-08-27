import { useEventListener } from '@vueuse/core'
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  toValue,
  type CSSProperties,
  type MaybeRefOrGetter
} from 'vue'

const EDGE_GAP = 12

function visibleToolbarBoundary(selector: string) {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) return null
  const style = getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return null
  return element
}

export function useBottomToolbarBounds(embedded: MaybeRefOrGetter<boolean>) {
  const horizontalInsets = ref({ left: EDGE_GAP, right: EDGE_GAP })
  const horizontalStyle = computed<CSSProperties | undefined>(() =>
    toValue(embedded)
      ? undefined
      : {
          left: `${horizontalInsets.value.left}px`,
          right: `${horizontalInsets.value.right}px`
        }
  )

  let frame = 0
  let mutationObserver: MutationObserver | null = null
  let resizeObserver: ResizeObserver | null = null
  const observedBounds = new WeakSet<Element>()

  function refresh() {
    if (toValue(embedded)) return

    const viewportWidth = document.documentElement.clientWidth
    let left = EDGE_GAP
    let rightEdge = viewportWidth - EDGE_GAP

    const leftSidebar = visibleToolbarBoundary(
      '[data-test-id="layers-shell-motion"][data-sidebar-open="true"]'
    )
    if (leftSidebar) {
      left = Math.max(left, leftSidebar.getBoundingClientRect().right + EDGE_GAP)
    }

    const rightPanel = visibleToolbarBoundary('[data-test-id="t3-right-panel"][data-state="open"]')
    if (rightPanel) {
      const panelStyle = getComputedStyle(rightPanel)
      const panelRight = Number.parseFloat(panelStyle.right) || 0
      const panelLeft = viewportWidth - panelRight - rightPanel.getBoundingClientRect().width
      rightEdge = Math.min(rightEdge, panelLeft - EDGE_GAP)
    }

    const propertiesPanel = visibleToolbarBoundary('[data-test-id="properties-panel"]')
    if (propertiesPanel) {
      const propertiesBounds = propertiesPanel.getBoundingClientRect()
      if (propertiesBounds.left >= viewportWidth / 2) {
        rightEdge = Math.min(rightEdge, propertiesBounds.left - EDGE_GAP)
      }
    }

    rightEdge = Math.max(left, rightEdge)
    horizontalInsets.value = {
      left: Math.round(left * 2) / 2,
      right: Math.round(Math.max(EDGE_GAP, viewportWidth - rightEdge) * 2) / 2
    }
  }

  function queueRefresh() {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      refresh()
    })
  }

  function observeBoundary(element: Element | null) {
    if (!element || observedBounds.has(element)) return
    observedBounds.add(element)
    resizeObserver?.observe(element)
  }

  function syncObservers() {
    observeBoundary(document.querySelector('[data-test-id="layers-shell-motion"]'))
    observeBoundary(document.querySelector('[data-test-id="t3-right-panel"]'))
    observeBoundary(document.querySelector('[data-test-id="properties-panel"]'))
    queueRefresh()
  }

  onMounted(() => {
    if (toValue(embedded)) return
    resizeObserver = new ResizeObserver(queueRefresh)
    mutationObserver = new MutationObserver(syncObservers)
    mutationObserver.observe(document.body, {
      attributeFilter: ['data-sidebar-open', 'data-state'],
      attributes: true,
      childList: true,
      subtree: true
    })
    syncObservers()
  })

  useEventListener(window, 'resize', queueRefresh, { passive: true })

  onUnmounted(() => {
    if (frame) window.cancelAnimationFrame(frame)
    mutationObserver?.disconnect()
    resizeObserver?.disconnect()
  })

  return { horizontalInsets, horizontalStyle, queueRefresh }
}
