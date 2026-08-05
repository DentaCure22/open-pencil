import { describe, expect, test } from 'bun:test'

import {
  createBoardComponentSession,
  removeTransientBoardComponentsByMarker
} from '@/app/board-experience/components'
import {
  BOARD_COMPONENT_PERMISSIONS,
  BOARD_SHAPE_PERMISSIONS,
  reconcileBoardPage,
  runBoardMutation,
  runBoardTargetMutation,
  type BoardPermission,
  type BoardPermissionDescriptor
} from '@/app/board-permissions'
import {
  dispatchOwnedBoardShapeAction,
  type OwnedBoardShapeAction
} from '@/app/code-object/board-shapes/owned'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

const COMPONENT_SOURCE = 'export default function Component() { return <div>Board component</div> }'

function descriptor(store: EditorStore, permissions: BoardPermission[]): BoardPermissionDescriptor {
  return {
    actorId: 'board-permissions-test',
    defaultOrigin: { height: 100, width: 100, x: 40, y: 40 },
    labels: {
      create: 'Create test object',
      delete: 'Delete test object',
      update: 'Update test object'
    },
    marker: {
      key: 'owner',
      pluginId: 'openpencil-board-permissions-test',
      value: 'board-permissions-test'
    },
    name: 'Board permissions test',
    pageId: store.state.currentPageId,
    permissions
  }
}

function componentSession(store: EditorStore, permissions: BoardPermission[]) {
  const session = createBoardComponentSession(store, descriptor(store, permissions))
  if (!session) throw new Error('Board component session did not open')
  return session
}

function shapeAction(
  store: EditorStore,
  permissions: BoardPermission[],
  action: OwnedBoardShapeAction
) {
  return dispatchOwnedBoardShapeAction(store, descriptor(store, permissions), action)
}

describe('Board permissions', () => {
  test('runs an allowed mutation and denies missing permissions or out-of-scope targets', () => {
    const store = createEditorStore()
    const target = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Connected target'
    })
    const outsideScope = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Outside scope'
    })
    const permissions = descriptor(store, ['target.action.execute'])
    permissions.targetNodeIds = [target.id]

    expect(
      runBoardTargetMutation(store, permissions, {
        action: { type: 'toggle-opacity' },
        targetNodeId: target.id,
        type: 'board.target.action'
      })
    ).toMatchObject({ changed: true, status: 'applied' })
    expect(target.opacity).toBe(0.4)
    expect(
      runBoardTargetMutation(store, permissions, {
        action: { type: 'hide' },
        targetNodeId: outsideScope.id,
        type: 'board.target.action'
      })
    ).toMatchObject({ reason: 'capability-denied', status: 'denied' })
    expect(
      runBoardMutation(store, permissions, ['target.data.write'], () => 'unexpected', target.id)
    ).toEqual({ reason: 'capability-denied', status: 'denied' })
  })

  test('scopes page reconciliation to the current Board', () => {
    const store = createEditorStore()
    const currentPageId = store.state.currentPageId
    const otherPage = store.graph.addPage('Other Board')
    let applied = false
    const missingPermission = descriptor(store, [])

    expect(
      reconcileBoardPage(store, missingPermission, {
        apply: () => {
          applied = true
          return 'unexpected'
        },
        label: 'Reconcile without permission',
        provenance: { operation: 'react-design.reimport' },
        type: 'board.page.reconcile'
      })
    ).toMatchObject({
      changed: false,
      pageId: currentPageId,
      reason: 'capability-denied',
      status: 'denied'
    })
    expect(applied).toBe(false)

    const otherPermissions = descriptor(store, ['page.reconcile'])
    otherPermissions.pageId = otherPage.id
    expect(
      reconcileBoardPage(store, otherPermissions, {
        apply: () => {
          applied = true
          return 'unexpected'
        },
        label: 'Reconcile other Board',
        provenance: { operation: 'react-design.reimport' },
        type: 'board.page.reconcile'
      })
    ).toMatchObject({
      changed: false,
      pageId: otherPage.id,
      reason: 'page-mismatch',
      status: 'denied'
    })
    expect(applied).toBe(false)
  })

  test('records one reconciliation Undo entry and rolls back failure', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const card = store.graph.createNode('RECTANGLE', pageId, {
      name: 'Static card',
      width: 240
    })
    const permissions = descriptor(store, ['page.reconcile'])
    const receipt = reconcileBoardPage(store, permissions, {
      apply: () => {
        store.graph.updateNode(card.id, { width: 360 })
        return { updated: 1 }
      },
      label: 'Re-import React design',
      provenance: { operation: 'react-design.reimport', sourceId: 'card' },
      type: 'board.page.reconcile'
    })

    expect(receipt).toMatchObject({
      actorId: 'board-permissions-test',
      changed: true,
      pageId,
      result: { updated: 1 },
      status: 'applied',
      targetNodeId: pageId
    })
    expect(store.undo.undoLabel).toContain(`Re-import React design · Page 1 [${pageId}]`)
    expect(store.graph.getNode(card.id)?.width).toBe(360)
    store.undo.undo()
    expect(store.graph.getNode(card.id)?.width).toBe(240)
    store.undo.redo()
    expect(store.graph.getNode(card.id)?.width).toBe(360)

    expect(() =>
      reconcileBoardPage(store, permissions, {
        apply: () => {
          store.graph.updateNode(card.id, { width: 480 })
          throw new Error('reconciliation failed')
        },
        label: 'Fail React reconciliation',
        provenance: { operation: 'react-design.patch', sourceId: 'card' },
        type: 'board.page.reconcile'
      })
    ).toThrow('reconciliation failed')
    expect(store.graph.getNode(card.id)?.width).toBe(360)
  })

  test('enforces component permissions without exposing permission sessions to callers', () => {
    const store = createEditorStore()
    const createSession = componentSession(store, ['component.create'])
    const created = createSession.board.createComponent({
      definitionId: 'test.component',
      source: COMPONENT_SOURCE,
      state: { count: 0 },
      x: 120
    })
    const componentId = created.targetNodeId
    if (!componentId) throw new Error('Board component was not created')
    createSession.dispose()
    expect(
      createSession.board.createComponent({
        definitionId: 'test.closed',
        source: COMPONENT_SOURCE
      })
    ).toMatchObject({ reason: 'session-closed', status: 'denied' })

    const stateSession = componentSession(store, ['component.update.state'])
    expect(stateSession.board.updateComponent(componentId, { state: { count: 1 } }).status).toBe(
      'applied'
    )
    expect(stateSession.board.updateComponent(componentId, { x: 240 })).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    expect(stateSession.board.deleteComponent(componentId)).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    stateSession.dispose()

    const fullSession = componentSession(store, [...BOARD_COMPONENT_PERMISSIONS])
    expect(fullSession.board.updateComponent(componentId, { x: 240 }).status).toBe('applied')
    expect(fullSession.board.deleteComponent(componentId).status).toBe('applied')
    fullSession.dispose()
  })

  test('removes only transient components when a component session closes', () => {
    const store = createEditorStore()
    const session = componentSession(store, [...BOARD_COMPONENT_PERMISSIONS])
    const durableId = session.board.createComponent({
      definitionId: 'test.durable',
      lifecycle: 'durable',
      source: COMPONENT_SOURCE
    }).targetNodeId
    const transientId = session.board.createComponent(
      {
        definitionId: 'test.transient',
        lifecycle: 'transient',
        source: COMPONENT_SOURCE
      },
      { history: 'transient' }
    ).targetNodeId
    if (!durableId || !transientId) throw new Error('Board components were not created')
    store.select([transientId])

    expect(session.dispose()).toEqual([transientId])
    expect(store.graph.getNode(transientId)).toBeUndefined()
    expect(store.graph.getNode(durableId)).toBeDefined()
    expect(store.state.selectedIds.has(transientId)).toBe(false)
  })

  test('removes orphaned transient components by their exact owner marker', () => {
    const store = createEditorStore()
    const owner = descriptor(store, [...BOARD_COMPONENT_PERMISSIONS])
    const session = createBoardComponentSession(store, owner)
    if (!session) throw new Error('Board component session did not open')
    const durableId = session.board.createComponent({
      definitionId: 'test.durable',
      lifecycle: 'durable',
      source: COMPONENT_SOURCE
    }).targetNodeId
    const transientId = session.board.createComponent(
      {
        definitionId: 'test.transient',
        lifecycle: 'transient',
        source: COMPONENT_SOURCE
      },
      { history: 'transient' }
    ).targetNodeId
    if (!durableId || !transientId) throw new Error('Board components were not created')

    expect(
      removeTransientBoardComponentsByMarker(store, {
        marker: owner.marker,
        pageId: owner.pageId
      })
    ).toEqual([transientId])
    expect(store.graph.getNode(transientId)).toBeUndefined()
    expect(store.graph.getNode(durableId)).toBeDefined()
    session.dispose()
  })

  test('separates shape geometry, appearance, and delete permissions', () => {
    const store = createEditorStore()
    const created = shapeAction(store, ['shape.create', 'shape.update.geometry'], {
      shape: { kind: 'rectangle', x: 120 },
      type: 'board.shape.create'
    })
    const shapeId = created.targetNodeId
    if (!shapeId) throw new Error('Board shape was not created')

    expect(
      shapeAction(store, ['shape.create', 'shape.update.geometry'], {
        changes: { x: 240 },
        shapeId,
        type: 'board.shape.update'
      }).status
    ).toBe('applied')
    expect(
      shapeAction(store, ['shape.create', 'shape.update.geometry'], {
        changes: { fill: '#14B8A6' },
        shapeId,
        type: 'board.shape.update'
      })
    ).toMatchObject({ reason: 'capability-denied', status: 'denied' })
    expect(
      shapeAction(store, ['shape.create', 'shape.update.geometry'], {
        shapeId,
        type: 'board.shape.delete'
      })
    ).toMatchObject({ reason: 'capability-denied', status: 'denied' })
    expect(
      shapeAction(store, [...BOARD_SHAPE_PERMISSIONS], {
        shapeId,
        type: 'board.shape.delete'
      }).status
    ).toBe('applied')
  })
})
