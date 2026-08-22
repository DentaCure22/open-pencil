import type { Rect } from '@open-pencil/scene-graph/primitives'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerOwner
} from '@/app/smylr-live-container/types'

import type { NarratedTraceTarget } from './types'

export type NarratedTraceLiveInspectorTargetInput = {
  document: SmylrLiveContainerDocument
  frameBounds: Rect
  frameId: string
  framePath: string[]
  selectedId: string
  selectedRect: Rect
}

function liveInspectorNodePath(
  node: SmylrLiveContainerNode,
  selectedId: string,
  path: string[] = [],
  ancestry: SmylrLiveContainerNode[] = []
): {
  ancestry: SmylrLiveContainerNode[]
  node: SmylrLiveContainerNode
  path: string[]
} | null {
  const nextPath = [...path, node.label]
  const nextAncestry = [...ancestry, node]
  if (node.id === selectedId) return { ancestry: nextAncestry, node, path: nextPath }

  for (const child of node.children ?? []) {
    const match = liveInspectorNodePath(child, selectedId, nextPath, nextAncestry)
    if (match) return match
  }
  return null
}

const GENERIC_REACT_OWNER =
  /^(?:Anonymous|Fragment|Provider|SlotClone|(?:Primitive|Slot)(?:\..*)?|[a-z][a-z0-9-]*)$/

function isMeaningfulOwner(owner: SmylrLiveContainerOwner) {
  return Boolean(owner.componentName && !GENERIC_REACT_OWNER.test(owner.componentName))
}

function editableSourceForNode(node: SmylrLiveContainerNode) {
  const source = node.source
  if (!source) return undefined
  const owners = [source, ...(source.ownerPath ?? [])]
  const owner =
    owners.find((candidate) => candidate.filePath && isMeaningfulOwner(candidate)) ??
    owners.find((candidate) => candidate.filePath) ??
    owners.find(isMeaningfulOwner) ??
    source
  return {
    ...(owner.componentName ? { componentName: owner.componentName } : {}),
    ...(owner.filePath ? { filePath: owner.filePath } : {}),
    ...(owner.lineNumber ? { lineNumber: owner.lineNumber } : {})
  }
}

function elementKindForNode(node: SmylrLiveContainerNode) {
  const tagName = node.tagName?.toLowerCase()
  const role = node.role?.toLowerCase()
  if (
    ['button', 'input', 'select', 'textarea', 'a'].includes(tagName ?? '') ||
    ['button', 'checkbox', 'link', 'radio', 'switch', 'textbox'].includes(role ?? '')
  ) {
    return 'control' as const
  }
  return node.children?.length ? ('container' as const) : ('component' as const)
}

function hierarchyForMatch(match: NonNullable<ReturnType<typeof liveInspectorNodePath>>) {
  const parent = match.ancestry.at(-2)
  return {
    children: (match.node.children ?? [])
      .slice(0, 8)
      .map((child) => ({ label: child.label, stableId: child.id })),
    current: { label: match.node.label, stableId: match.node.id },
    ...(parent ? { parent: { label: parent.label, stableId: parent.id } } : {})
  }
}

export function narratedTraceTargetForLiveInspectorSelection(
  input: NarratedTraceLiveInspectorTargetInput
): NarratedTraceTarget | null {
  const match = liveInspectorNodePath(input.document.tree, input.selectedId)
  if (!match) return null
  const source = editableSourceForNode(match.node)

  return {
    bounds: {
      height: input.selectedRect.height,
      width: input.selectedRect.width,
      x: input.frameBounds.x + input.selectedRect.x,
      y: input.frameBounds.y + input.selectedRect.y
    },
    elementKind: elementKindForNode(match.node),
    frameId: input.frameId,
    hierarchy: hierarchyForMatch(match),
    name: match.node.label,
    path: [...input.framePath, ...match.path],
    route: input.document.route,
    ...(source ? { source } : {}),
    stableId: input.selectedId
  }
}
