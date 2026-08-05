import { isMermaidDiagramContainer } from '@open-pencil/core/diagram'
import type { Editor } from '@open-pencil/core/editor'
import { getAbsolutePositionFull, type SceneNode } from '@open-pencil/scene-graph'

import type { HitTestFns } from '#vue/shared/input/select'

function multiSelectionBoundsOwner(cx: number, cy: number, editor: Editor): SceneNode | null {
  if (editor.state.selectedIds.size < 2) return null

  let owner: SceneNode | null = null
  let selectedCount = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of editor.state.selectedIds) {
    const node = editor.graph.getNode(id)
    if (!node) continue
    const bounds = getAbsolutePositionFull(node, editor.graph)
    owner ??= node
    selectedCount += 1
    minX = Math.min(minX, bounds.boundX)
    minY = Math.min(minY, bounds.boundY)
    maxX = Math.max(maxX, bounds.boundX + bounds.width)
    maxY = Math.max(maxY, bounds.boundY + bounds.height)
  }

  if (selectedCount < 2) return null
  return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY ? owner : null
}

function mermaidOwner(hit: SceneNode, editor: Editor): SceneNode {
  let current: SceneNode | undefined = hit
  while (current) {
    if (isMermaidDiagramContainer(current)) {
      // Mermaid imports behave like one object until the user explicitly enters the
      // diagram. Once entered, preserve the native descendant hit so its shapes,
      // labels, and vectors can use the editor's normal move/resize/edit behavior.
      return current.id === editor.state.enteredContainerId ? hit : current
    }
    current = current.parentId ? editor.graph.getNode(current.parentId) : undefined
  }
  return hit
}

export function resolveHit(
  cx: number,
  cy: number,
  editor: Editor,
  fns: HitTestFns
): SceneNode | null {
  const titleHit =
    fns.hitTestFrameTitle(cx, cy) ??
    fns.hitTestSectionTitle(cx, cy) ??
    fns.hitTestComponentLabel(cx, cy)
  if (titleHit) return titleHit

  const hit = fns.hitTestInScope(cx, cy, false)
  if (hit) return mermaidOwner(hit, editor)

  // The multi-selection outline is a real transform target even where its
  // interior does not overlap a selected child.
  const selectionOwner = multiSelectionBoundsOwner(cx, cy, editor)
  if (selectionOwner) return selectionOwner

  const scopeId = editor.state.enteredContainerId
  if (!scopeId) return null

  if (fns.isInsideContainerBounds(cx, cy, scopeId)) {
    editor.clearSelection()
    return null
  }

  editor.exitContainer()
  const afterExit = fns.hitTestInScope(cx, cy, false)
  if (afterExit) return mermaidOwner(afterExit, editor)

  if (editor.state.enteredContainerId) {
    editor.exitContainer()
  }
  return null
}
