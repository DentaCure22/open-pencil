import { describe, expect, test } from 'bun:test'

import {
  BOARD_COMPONENT_PERMISSIONS,
  BOARD_SHAPE_PERMISSIONS,
  createOwnedBoardComponentClient,
  createOwnedBoardShapeClient,
  dispatchBoardPageReconciliation,
  dispatchBoardTargetAction,
  disposeBoardAuthorityGrant,
  issueBoardAuthorityGrant,
  removeTransientBoardComponentsByMarker,
  revokeBoardAuthorityGrant,
  type BoardAuthorityGrantDescriptor,
  type BoardAuthorityPermission
} from '@/app/board-authority'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

const COMPONENT_SOURCE = 'export default function Component() { return <div>Board component</div> }'

function descriptor(
  store: EditorStore,
  permissions: BoardAuthorityPermission[]
): BoardAuthorityGrantDescriptor {
  return {
    actorId: 'board-authority-test',
    defaultOrigin: { height: 100, width: 100, x: 40, y: 40 },
    labels: {
      create: 'Create test object',
      delete: 'Delete test object',
      update: 'Update test object'
    },
    marker: {
      key: 'owner',
      pluginId: 'openpencil-board-authority-test',
      value: 'board-authority-test'
    },
    name: 'Board Authority test',
    pageId: store.state.currentPageId,
    permissions
  }
}

function issue(store: EditorStore, permissions: BoardAuthorityPermission[]) {
  const grant = issueBoardAuthorityGrant(store, descriptor(store, permissions))
  if (!grant) throw new Error('Board Authority grant was not issued')
  return grant
}

describe('Board Authority', () => {
  test('requires an active Board-issued grant for every mutation', () => {
    const store = createEditorStore()
    const grant = issue(store, ['component.create'])
    const client = createOwnedBoardComponentClient(store, grant)
    const created = client.createComponent({
      definitionId: 'test.component',
      source: COMPONENT_SOURCE
    })
    expect(created).toMatchObject({
      apiVersion: 2,
      changed: true,
      grantId: grant.grantId,
      status: 'applied'
    })

    expect(revokeBoardAuthorityGrant(store, grant)).toBe(true)
    expect(
      client.createComponent({
        definitionId: 'test.revoked',
        source: COMPONENT_SOURCE
      })
    ).toMatchObject({
      changed: false,
      reason: 'grant-invalid',
      status: 'denied'
    })
  })

  test('limits connected mutations to explicit targets and revokes them with the grant', () => {
    const store = createEditorStore()
    const target = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Connected target'
    })
    const outsideScope = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      name: 'Outside scope'
    })
    const grantDescriptor = descriptor(store, ['target.action.execute', 'target.data.write'])
    grantDescriptor.targetNodeIds = [target.id]
    const grant = issueBoardAuthorityGrant(store, grantDescriptor)
    if (!grant) throw new Error('Target grant was not issued')

    expect(
      dispatchBoardTargetAction(store, grant, {
        action: { type: 'toggle-opacity' },
        targetNodeId: target.id,
        type: 'board.target.action'
      })
    ).toMatchObject({ changed: true, status: 'applied' })
    expect(target.opacity).toBe(0.4)
    expect(
      dispatchBoardTargetAction(store, grant, {
        action: { type: 'hide' },
        targetNodeId: outsideScope.id,
        type: 'board.target.action'
      })
    ).toMatchObject({ reason: 'capability-denied', status: 'denied' })

    revokeBoardAuthorityGrant(store, grant)
    expect(
      dispatchBoardTargetAction(store, grant, {
        action: { type: 'hide' },
        targetNodeId: target.id,
        type: 'board.target.action'
      })
    ).toMatchObject({ reason: 'grant-invalid', status: 'denied' })
  })

  test('scopes page reconciliation to one active grant and exact Board', () => {
    const store = createEditorStore()
    const currentPageId = store.state.currentPageId
    const otherPage = store.graph.addPage('Other Board')
    const revoked = issue(store, ['page.reconcile'])
    revokeBoardAuthorityGrant(store, revoked)
    let applied = false

    expect(
      dispatchBoardPageReconciliation(store, revoked, {
        apply: () => {
          applied = true
          return 'unexpected'
        },
        label: 'Reconcile revoked Board',
        provenance: { operation: 'react-design.reimport' },
        type: 'board.page.reconcile'
      })
    ).toMatchObject({
      changed: false,
      pageId: currentPageId,
      reason: 'grant-invalid',
      status: 'denied'
    })
    expect(applied).toBe(false)

    const otherDescriptor = descriptor(store, ['page.reconcile'])
    otherDescriptor.pageId = otherPage.id
    const otherGrant = issueBoardAuthorityGrant(store, otherDescriptor)
    if (!otherGrant) throw new Error('Other Board grant was not issued')
    expect(
      dispatchBoardPageReconciliation(store, otherGrant, {
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
    revokeBoardAuthorityGrant(store, otherGrant)
  })

  test('records one provenance-bearing page reconciliation Undo entry and rolls back failure', () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const card = store.graph.createNode('RECTANGLE', pageId, {
      name: 'Static card',
      width: 240
    })
    const grant = issue(store, ['page.reconcile'])
    const receipt = dispatchBoardPageReconciliation(store, grant, {
      apply: () => {
        store.graph.updateNode(card.id, { width: 360 })
        return { updated: 1 }
      },
      label: 'Re-import React design',
      provenance: { operation: 'react-design.reimport', sourceId: 'card' },
      type: 'board.page.reconcile'
    })

    expect(receipt).toMatchObject({
      actorId: 'board-authority-test',
      changed: true,
      pageId,
      provenance: { operation: 'react-design.reimport', sourceId: 'card' },
      result: { updated: 1 },
      status: 'applied',
      targetNodeId: pageId
    })
    expect(store.undo.undoLabel).toContain(`Re-import React design · Page 1 [${pageId}]`)
    expect(store.graph.getNode(card.id)?.width).toBe(360)
    const otherPage = store.graph.addPage('Other Board')
    const otherCard = store.graph.createNode('RECTANGLE', otherPage.id, {
      name: 'Other card',
      width: 800
    })
    store.state.currentPageId = otherPage.id
    store.undo.undo()
    expect(store.graph.getNode(card.id)?.width).toBe(240)
    expect(store.graph.getNode(otherCard.id)?.width).toBe(800)
    store.undo.redo()
    expect(store.graph.getNode(card.id)?.width).toBe(360)
    expect(store.graph.getNode(otherCard.id)?.width).toBe(800)
    store.state.currentPageId = pageId
    revokeBoardAuthorityGrant(store, grant)

    const rollbackGrant = issue(store, ['page.reconcile'])
    expect(() =>
      dispatchBoardPageReconciliation(store, rollbackGrant, {
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
    expect(store.undo.undoLabel).toContain(`Re-import React design · Page 1 [${pageId}]`)
    revokeBoardAuthorityGrant(store, rollbackGrant)
  })

  test('enforces component update and delete permissions by field', () => {
    const store = createEditorStore()
    const createGrant = issue(store, ['component.create'])
    const created = createOwnedBoardComponentClient(store, createGrant).createComponent({
      definitionId: 'test.component',
      source: COMPONENT_SOURCE,
      state: { count: 0 },
      x: 120
    })
    const componentId = created.targetNodeId
    if (!componentId) throw new Error('Board component was not created')
    revokeBoardAuthorityGrant(store, createGrant)

    const stateGrant = issue(store, ['component.update.state'])
    const stateClient = createOwnedBoardComponentClient(store, stateGrant)
    expect(stateClient.updateComponent(componentId, { state: { count: 1 } }).status).toBe('applied')
    expect(stateClient.updateComponent(componentId, { x: 240 })).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    expect(
      stateClient.updateComponent(componentId, { source: `${COMPONENT_SOURCE}\n` })
    ).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    expect(stateClient.deleteComponent(componentId)).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    revokeBoardAuthorityGrant(store, stateGrant)

    const fullGrant = issue(store, [...BOARD_COMPONENT_PERMISSIONS])
    const fullClient = createOwnedBoardComponentClient(store, fullGrant)
    expect(fullClient.updateComponent(componentId, { x: 240 }).status).toBe('applied')
    expect(fullClient.deleteComponent(componentId).status).toBe('applied')
    revokeBoardAuthorityGrant(store, fullGrant)
  })

  test('cleans up only transient components from the disposed authority session', () => {
    const store = createEditorStore()
    const grant = issue(store, [...BOARD_COMPONENT_PERMISSIONS])
    const client = createOwnedBoardComponentClient(store, grant)
    const durableId = client.createComponent({
      definitionId: 'test.durable',
      lifecycle: 'durable',
      source: COMPONENT_SOURCE
    }).targetNodeId
    const transientId = client.createComponent(
      {
        definitionId: 'test.transient',
        lifecycle: 'transient',
        source: COMPONENT_SOURCE
      },
      { history: 'transient' }
    ).targetNodeId
    if (!durableId || !transientId) throw new Error('Board components were not created')
    store.select([transientId])

    expect(disposeBoardAuthorityGrant(store, grant)).toEqual([transientId])
    expect(store.graph.getNode(transientId)).toBeUndefined()
    expect(store.graph.getNode(durableId)).toBeDefined()
    expect(store.state.selectedIds.has(transientId)).toBe(false)
    expect(client.updateComponent(durableId, { x: 400 })).toMatchObject({
      reason: 'grant-invalid',
      status: 'denied'
    })
  })

  test('cleans up orphaned transient components by their exact owner marker', () => {
    const store = createEditorStore()
    const grant = issue(store, [...BOARD_COMPONENT_PERMISSIONS])
    const client = createOwnedBoardComponentClient(store, grant)
    const durableId = client.createComponent({
      definitionId: 'test.durable',
      lifecycle: 'durable',
      source: COMPONENT_SOURCE
    }).targetNodeId
    const transientId = client.createComponent(
      {
        definitionId: 'test.transient',
        lifecycle: 'transient',
        source: COMPONENT_SOURCE
      },
      { history: 'transient' }
    ).targetNodeId
    if (!durableId || !transientId) throw new Error('Board components were not created')
    revokeBoardAuthorityGrant(store, grant)

    expect(
      removeTransientBoardComponentsByMarker(store, {
        marker: grant.marker,
        pageId: grant.pageId
      })
    ).toEqual([transientId])
    expect(store.graph.getNode(transientId)).toBeUndefined()
    expect(store.graph.getNode(durableId)).toBeDefined()
  })

  test('separates shape geometry, appearance, and delete capabilities', async () => {
    const store = createEditorStore()
    const geometryGrant = issue(store, ['shape.create', 'shape.update.geometry'])
    const geometryClient = createOwnedBoardShapeClient(store, geometryGrant)
    const shapeId = (await geometryClient.createShape({ kind: 'rectangle', x: 120 })).targetNodeId
    if (!shapeId) throw new Error('Board shape was not created')

    expect((await geometryClient.updateShape(shapeId, { x: 240 })).status).toBe('applied')
    expect(await geometryClient.updateShape(shapeId, { fill: '#14B8A6' })).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    expect(await geometryClient.deleteShape(shapeId)).toMatchObject({
      reason: 'capability-denied',
      status: 'denied'
    })
    revokeBoardAuthorityGrant(store, geometryGrant)

    const fullGrant = issue(store, [...BOARD_SHAPE_PERMISSIONS])
    expect((await createOwnedBoardShapeClient(store, fullGrant).deleteShape(shapeId)).status).toBe(
      'applied'
    )
    revokeBoardAuthorityGrant(store, fullGrant)
  })
})
