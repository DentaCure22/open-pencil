import type { SceneNode } from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'

const PAGE_RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const PAGE_RECEIPT_PLUGIN_KEY = 'page-create-request-receipt'

export type AuthorityPageCreationMarker = {
  appliedRevision: number
  baseRevision: number
  name: string
  requestId: string
  route: 'tool:create_page'
  sourcePageId: string
  version: 1
}

export function authorityPageCreationMarker(node: SceneNode): AuthorityPageCreationMarker | null {
  const entry = node.pluginData.find(
    (candidate) =>
      candidate.pluginId === PAGE_RECEIPT_PLUGIN_ID && candidate.key === PAGE_RECEIPT_PLUGIN_KEY
  )
  if (!entry) return null
  try {
    const value = JSON.parse(entry.value) as Partial<AuthorityPageCreationMarker>
    return value.version === 1 &&
      value.route === 'tool:create_page' &&
      typeof value.appliedRevision === 'number' &&
      typeof value.baseRevision === 'number' &&
      typeof value.name === 'string' &&
      typeof value.requestId === 'string' &&
      typeof value.sourcePageId === 'string'
      ? (value as AuthorityPageCreationMarker)
      : null
  } catch {
    throw new Error(`Page creation receipt on "${node.id}" is unreadable.`)
  }
}

export function authorityPageCreationRequestMatches(
  document: AuthorityBoardDocument,
  requestId: string
): SceneNode[] {
  return document.graph
    .getPages(true)
    .filter((candidate) => authorityPageCreationMarker(candidate)?.requestId === requestId)
}

export function authorityPageCreationPluginData(marker: AuthorityPageCreationMarker) {
  return {
    key: PAGE_RECEIPT_PLUGIN_KEY,
    pluginId: PAGE_RECEIPT_PLUGIN_ID,
    value: JSON.stringify(marker)
  }
}
