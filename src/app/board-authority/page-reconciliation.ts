import type { Editor } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import type {
  BoardAuthorityDenialReason,
  BoardAuthorityGrant,
  BoardPageReconciliationAction,
  BoardPageReconciliationReceipt
} from './contracts'
import { isBoardAuthorityGrantActive } from './grants'

type BoardPageSnapshot = ReturnType<Editor['snapshotPage']>

function actionId(): string {
  return `board-action:${randomHex(8)}`
}

function pageUpdateProps(page: SceneNode): Partial<SceneNode> {
  const { id: _id, type: _type, parentId: _parentId, childIds: _childIds, ...props } = page
  return props
}

function restoreChildren(
  editor: Editor,
  snapshot: BoardPageSnapshot,
  parentId: string,
  childIds: string[]
): void {
  for (const childId of childIds) {
    const node = snapshot.get(childId)
    if (!node) continue
    const { parentId: _parentId, childIds: children, ...props } = node
    editor.graph.createNode(node.type, parentId, { ...props, childIds: [] })
    editor.graph.reorderChild(node.id, parentId, childIds.indexOf(childId))
    restoreChildren(editor, snapshot, node.id, children)
  }
}

function restorePage(editor: Editor, pageId: string, snapshot: BoardPageSnapshot): void {
  const current = editor.graph.getNode(pageId)
  const page = snapshot.get(pageId)
  if (current?.type !== 'CANVAS' || page?.type !== 'CANVAS') return
  for (const childId of current.childIds.slice()) editor.graph.deleteNode(childId)
  restoreChildren(editor, snapshot, pageId, page.childIds)
  editor.graph.preserveSourceMetadataDuring(() => {
    editor.graph.updateNode(pageId, pageUpdateProps(page))
  })
  editor.graph.clearAbsPosCache()
  computeAllLayouts(editor.graph, pageId)
  if (editor.state.currentPageId === pageId) {
    editor.clearSelection()
    editor.state.hoveredNodeId = null
  }
  editor.requestRender()
}

function denied<TResult>(
  id: string,
  grant: BoardAuthorityGrant,
  action: BoardPageReconciliationAction<TResult>,
  pageName: string,
  reason: BoardAuthorityDenialReason
): BoardPageReconciliationReceipt<TResult> {
  return {
    actionId: id,
    actorId: grant.actorId,
    apiVersion: grant.apiVersion,
    changed: false,
    grantId: grant.grantId,
    pageId: grant.pageId,
    pageName,
    provenance: structuredClone(action.provenance),
    reason,
    status: 'denied',
    targetNodeId: grant.pageId,
    type: action.type
  }
}

function snapshotChanged(before: BoardPageSnapshot, after: BoardPageSnapshot): boolean {
  return JSON.stringify([...before]) !== JSON.stringify([...after])
}

export function dispatchBoardPageReconciliation<TResult>(
  editor: Editor,
  grant: BoardAuthorityGrant,
  action: BoardPageReconciliationAction<TResult>,
  id = actionId()
): BoardPageReconciliationReceipt<TResult> {
  const page = editor.graph.getNode(grant.pageId)
  const pageName = page?.name ?? 'Missing Board'
  if (!isBoardAuthorityGrantActive(editor, grant)) {
    return denied(id, grant, action, pageName, 'grant-invalid')
  }
  if (
    !grant.permissions.includes('page.reconcile') ||
    page?.type !== 'CANVAS' ||
    editor.state.currentPageId !== grant.pageId
  ) {
    return denied(id, grant, action, pageName, 'page-mismatch')
  }

  const before = editor.snapshotPage()
  let result: TResult
  try {
    result = action.apply()
    if (editor.state.currentPageId !== grant.pageId) {
      throw new Error('Board reconciliation changed its page scope')
    }
  } catch (error) {
    restorePage(editor, grant.pageId, before)
    throw error
  }

  const after = editor.snapshotPage()
  const changed = snapshotChanged(before, after)
  if (changed) {
    editor.pushUndoEntry({
      label: `${action.label} · ${pageName} [${grant.pageId}]`,
      forward: () => restorePage(editor, grant.pageId, after),
      inverse: () => restorePage(editor, grant.pageId, before)
    })
  }
  editor.requestRender()
  return {
    actionId: id,
    actorId: grant.actorId,
    apiVersion: grant.apiVersion,
    changed,
    grantId: grant.grantId,
    pageId: grant.pageId,
    pageName,
    provenance: structuredClone(action.provenance),
    result,
    status: changed ? 'applied' : 'noop',
    targetNodeId: grant.pageId,
    type: action.type
  }
}
