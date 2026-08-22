import type { SmylrLiveContainerNode } from '@/app/smylr-live-container/types'

function createElementForLiveNode(node: SmylrLiveContainerNode): HTMLElement {
  const element = document.createElement(node.tagName || 'div')
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    element.setAttribute(name, value)
  }
  if (node.className && !element.hasAttribute('class')) element.className = node.className

  if (node.children?.length) {
    for (const child of node.children) element.append(createElementForLiveNode(child))
  } else if (node.text) {
    element.textContent = node.text
  }
  return element
}

export function liveInspectorNodeOuterHtml(node: SmylrLiveContainerNode | null) {
  if (!node || typeof document === 'undefined') return null
  return createElementForLiveNode(node).outerHTML
}
