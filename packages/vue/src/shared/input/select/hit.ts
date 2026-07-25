import { isMermaidDiagramContainer } from '@open-pencil/core/diagram'
import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

import { isSmylrLiveAppFrame } from '#vue/shared/input/geometry'
import type { HitTestFns } from '#vue/shared/input/select'

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

function liveFrameHit(
  cx: number,
  cy: number,
  parentId: string,
  editor: Editor,
  fns: HitTestFns
): SceneNode | null {
  const children = editor.graph.getChildren(parentId)
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (!child.visible) continue
    const nested = liveFrameHit(cx, cy, child.id, editor, fns)
    if (nested) return nested
    if (isSmylrLiveAppFrame(child) && fns.isInsideContainerBounds(cx, cy, child.id)) {
      return child
    }
  }
  return null
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

  const liveHit = liveFrameHit(
    cx,
    cy,
    editor.state.enteredContainerId ?? editor.state.currentPageId,
    editor,
    fns
  )
  if (liveHit) return liveHit

  const hit = fns.hitTestInScope(cx, cy, false)
  if (hit) return mermaidOwner(hit, editor)

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
