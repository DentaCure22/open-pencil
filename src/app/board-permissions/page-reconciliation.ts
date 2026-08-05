import type { Editor } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { randomHex } from '@open-pencil/core/random'
import type { SceneNode } from '@open-pencil/scene-graph'

import type {
  BoardMutationReceipt,
  BoardPermissionDenialReason,
  BoardPermissionDescriptor
} from './contracts'
import { runBoardMutation } from './run'

type BoardPageSnapshot = ReturnType<Editor['snapshotPage']>

export type BoardPageReconciliationProvenance = {
  operation: 'react-design.patch' | 'react-design.reimport'
  sourceId?: string
}

export type BoardPageReconciliationAction<TResult> = {
  apply: () => TResult
  label: string
  provenance: BoardPageReconciliationProvenance
  type: 'board.page.reconcile'
}

export type BoardPageReconciliationReceipt<TResult> = BoardMutationReceipt<
  BoardPageReconciliationAction<TResult>['type'],
  BoardPermissionDenialReason | 'page-mismatch'
> & {
  pageId: string
  pageName: string
  provenance: BoardPageReconciliationProvenance
  result?: TResult
}

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
  descriptor: BoardPermissionDescriptor,
  action: BoardPageReconciliationAction<TResult>,
  pageName: string,
  reason: BoardPermissionDenialReason | 'page-mismatch'
): BoardPageReconciliationReceipt<TResult> {
  return {
    actionId: id,
    actorId: descriptor.actorId,
    changed: false,
    pageId: descriptor.pageId,
    pageName,
    provenance: structuredClone(action.provenance),
    reason,
    status: 'denied',
    targetNodeId: descriptor.pageId,
    type: action.type
  }
}

function snapshotChanged(before: BoardPageSnapshot, after: BoardPageSnapshot): boolean {
  return JSON.stringify([...before]) !== JSON.stringify([...after])
}

export function reconcileBoardPage<TResult>(
  editor: Editor,
  descriptor: BoardPermissionDescriptor,
  action: BoardPageReconciliationAction<TResult>,
  id = actionId()
): BoardPageReconciliationReceipt<TResult> {
  const page = editor.graph.getNode(descriptor.pageId)
  const pageName = page?.name ?? 'Missing Board'
  const permission = runBoardMutation(editor, descriptor, ['page.reconcile'], () => undefined)
  if (permission.status === 'denied') {
    return denied(id, descriptor, action, pageName, permission.reason)
  }
  if (page?.type !== 'CANVAS' || editor.state.currentPageId !== descriptor.pageId) {
    return denied(id, descriptor, action, pageName, 'page-mismatch')
  }

  const before = editor.snapshotPage()
  let result: TResult
  try {
    result = action.apply()
    if (editor.state.currentPageId !== descriptor.pageId) {
      throw new Error('Board reconciliation changed its page scope')
    }
  } catch (error) {
    restorePage(editor, descriptor.pageId, before)
    throw error
  }

  const after = editor.snapshotPage()
  const changed = snapshotChanged(before, after)
  if (changed) {
    editor.pushUndoEntry({
      label: `${action.label} · ${pageName} [${descriptor.pageId}]`,
      forward: () => restorePage(editor, descriptor.pageId, after),
      inverse: () => restorePage(editor, descriptor.pageId, before)
    })
  }
  editor.requestRender()
  return {
    actionId: id,
    actorId: descriptor.actorId,
    changed,
    pageId: descriptor.pageId,
    pageName,
    provenance: structuredClone(action.provenance),
    result,
    status: changed ? 'applied' : 'noop',
    targetNodeId: descriptor.pageId,
    type: action.type
  }
}
