import type { Editor } from '@open-pencil/core/editor'
import type { SceneNode } from '@open-pencil/scene-graph'

export type MoveMembershipPolicy = {
  shouldDetach?: (child: SceneNode, parent: SceneNode) => boolean
}

function isFrameContainer(node: SceneNode | undefined): node is SceneNode {
  return node?.type === 'FRAME' || node?.type === 'SECTION'
}

export function findFrameContainingSelection(editor: Editor): string | null {
  const selectedIds = [...editor.state.selectedIds]
  if (selectedIds.length === 0) return null
  const page = editor.graph.getNode(editor.state.currentPageId)
  if (!page) return null

  const centers = []
  for (const id of selectedIds) {
    const node = editor.graph.getNode(id)
    if (!node) return null
    const position = editor.graph.getAbsolutePosition(id)
    centers.push({ x: position.x + node.width / 2, y: position.y + node.height / 2 })
  }

  for (const childId of [...page.childIds].toReversed()) {
    if (selectedIds.includes(childId)) continue
    const frame = editor.graph.getNode(childId)
    if (!isFrameContainer(frame)) continue
    const origin = editor.graph.getAbsolutePosition(childId)
    const contained = centers.every(
      (center) =>
        center.x >= origin.x &&
        center.x <= origin.x + frame.width &&
        center.y >= origin.y &&
        center.y <= origin.y + frame.height
    )
    if (contained) return childId
  }
  return null
}

export function findMoveDropTarget(cx: number, cy: number, editor: Editor): SceneNode | null {
  let dropTarget = editor.graph.hitTestFrame(
    cx,
    cy,
    editor.state.selectedIds,
    editor.state.currentPageId
  )
  const movingSection = [...editor.state.selectedIds].some(
    (id) => editor.graph.getNode(id)?.type === 'SECTION'
  )
  if (
    movingSection &&
    dropTarget &&
    dropTarget.type !== 'SECTION' &&
    dropTarget.type !== 'CANVAS'
  ) {
    dropTarget = null
  }
  return dropTarget
}

export function reparentOutsideNodes(editor: Editor, policy?: MoveMembershipPolicy) {
  editor.detachOutsideFrameMembership(editor.state.selectedIds)
  if (!policy?.shouldDetach) return
  for (const id of editor.state.selectedIds) {
    const child = editor.graph.getNode(id)
    const parent = child?.parentId ? editor.graph.getNode(child.parentId) : undefined
    if (!child || !isFrameContainer(parent) || !policy.shouldDetach(child, parent)) continue
    editor.reparentNodes([child.id], parent.parentId ?? editor.state.currentPageId)
  }
}

function absorbOverlappingSiblings(editor: Editor, frameId: string) {
  const frame = editor.graph.getNode(frameId)
  if (!isFrameContainer(frame) || frame.parentId !== editor.state.currentPageId) return
  const origin = editor.graph.getAbsolutePosition(frameId)
  const page = editor.graph.getNode(editor.state.currentPageId)
  if (!page) return

  for (const siblingId of page.childIds.slice()) {
    if (siblingId === frameId) continue
    const sibling = editor.graph.getNode(siblingId)
    if (!sibling) continue
    const position = editor.graph.getAbsolutePosition(siblingId)
    const centerX = position.x + sibling.width / 2
    const centerY = position.y + sibling.height / 2
    if (
      centerX < origin.x ||
      centerX > origin.x + frame.width ||
      centerY < origin.y ||
      centerY > origin.y + frame.height
    ) {
      continue
    }
    editor.graph.reparentNode(siblingId, frameId)
  }
}

export function applyMoveReparent(editor: Editor, policy?: MoveMembershipPolicy) {
  const selectedIds = [...editor.state.selectedIds]
  const dropId = editor.state.dropTargetId
  const droppingOnCurrentParent =
    dropId != null &&
    selectedIds.length > 0 &&
    selectedIds.every((id) => editor.graph.getNode(id)?.parentId === dropId)

  if (dropId && !droppingOnCurrentParent) {
    editor.reparentNodes(selectedIds, dropId)
  } else {
    const joinId = findFrameContainingSelection(editor)
    if (joinId && selectedIds.every((id) => editor.graph.getNode(id)?.parentId !== joinId)) {
      editor.reparentNodes(selectedIds, joinId)
    } else {
      reparentOutsideNodes(editor, policy)
    }
  }

  for (const id of selectedIds) absorbOverlappingSiblings(editor, id)
}
