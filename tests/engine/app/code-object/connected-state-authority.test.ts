import { describe, expect, test } from 'bun:test'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'
import { objectGraphConnectionsOnPage } from '@open-pencil/scene-graph'

import {
  dispatchBoardTargetAction,
  issueBoardAuthorityGrant,
  revokeBoardAuthorityGrant,
  type BoardAuthorityGrantDescriptor
} from '@/app/board-authority'
import {
  codeObjectDocument,
  createCodeObject,
  createCodeObjectBoardClient,
  createUserCodeObjectDocument,
  dispatchCodeObjectBoardAction,
  normalizeLegacyCodeObjectConnections
} from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'

describe('Code Object connected-state authority', () => {
  test('migrates legacy state.write metadata into a page-owned Object Graph record', () => {
    const store = createEditorStore()
    const target = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Legacy target', state: { count: 0 } }),
      height: 240,
      name: 'Legacy target',
      width: 360
    })
    const source = createCodeObject(store, {
      document: createUserCodeObjectDocument({
        connections: [
          {
            id: 'legacy-state-link',
            label: 'Advance target',
            permissions: ['state.write'],
            targetFrameId: target.id
          }
        ],
        name: 'Legacy source',
        state: { count: 0 }
      }),
      height: 240,
      name: 'Legacy source',
      width: 360
    })
    const sourceId = source.id
    const targetId = target.id

    expect(normalizeLegacyCodeObjectConnections(store)).toBe(true)
    expect(normalizeLegacyCodeObjectConnections(store)).toBe(false)
    expect(store.graph.getNode(sourceId)?.id).toBe(sourceId)
    expect(store.graph.getNode(targetId)?.id).toBe(targetId)
    expect(codeObjectDocument(store.graph.getNode(sourceId))?.connections).toEqual([])
    expect(objectGraphConnectionsOnPage(store.graph, store.state.currentPageId)).toEqual([
      {
        automatic: true,
        id: 'legacy-state-link',
        kind: 'data',
        label: 'Advance target',
        permissions: ['target.data.write'],
        schemaVersion: 1,
        sourceNodeId: sourceId,
        sourcePort: 'auto',
        targetNodeId: targetId,
        targetPort: 'auto'
      }
    ])

    const client = createCodeObjectBoardClient(store, sourceId, async (action) =>
      dispatchCodeObjectBoardAction(store, sourceId, action, { interactionEnabled: true })
    )
    expect(client.connections).toEqual([
      {
        id: 'legacy-state-link',
        label: 'Advance target',
        permissions: ['state.write']
      }
    ])

    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    expect(reloaded.getNode(sourceId)?.id).toBe(sourceId)
    expect(reloaded.getNode(targetId)?.id).toBe(targetId)
    expect(codeObjectDocument(reloaded.getNode(sourceId))?.connections).toEqual([])
    expect(objectGraphConnectionsOnPage(reloaded, store.state.currentPageId)[0]).toMatchObject({
      id: 'legacy-state-link',
      sourceNodeId: sourceId,
      targetNodeId: targetId
    })
  })

  test('applies source and exact-target state through one receipted authority history step', () => {
    const store = createEditorStore()
    const target = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Counter', state: { count: 0 } }),
      height: 240,
      name: 'Counter',
      width: 360
    })
    const source = createCodeObject(store, {
      document: createUserCodeObjectDocument({
        connections: [
          {
            id: 'migrated-state-link',
            label: 'Update counter',
            permissions: ['state.write'],
            targetFrameId: target.id
          }
        ],
        name: 'Controller',
        state: { count: 0 }
      }),
      height: 240,
      name: 'Controller',
      width: 360
    })
    normalizeLegacyCodeObjectConnections(store)

    const receipt = dispatchCodeObjectBoardAction(
      store,
      source.id,
      {
        connectionId: 'migrated-state-link',
        sourceStatePatch: { count: 1 },
        targetStatePatch: { count: 2 },
        type: 'code-object.state.patch'
      },
      { interactionEnabled: true }
    )

    expect(receipt).toMatchObject({
      actorFrameId: source.id,
      authorityReceipt: {
        actorId: source.id,
        changed: true,
        status: 'applied',
        targetNodeId: target.id,
        type: 'board.target.state'
      },
      changed: true,
      status: 'applied',
      targetFrameId: target.id
    })
    expect(receipt.authorityReceipt?.grantId).toMatch(/^board-grant:/)
    expect(codeObjectDocument(store.graph.getNode(source.id))?.state).toEqual({ count: 1 })
    expect(codeObjectDocument(store.graph.getNode(target.id))?.state).toEqual({ count: 2 })

    store.undo.undo()
    expect(codeObjectDocument(store.graph.getNode(source.id))?.state).toEqual({ count: 0 })
    expect(codeObjectDocument(store.graph.getNode(target.id))?.state).toEqual({ count: 0 })

    store.undo.redo()
    expect(codeObjectDocument(store.graph.getNode(source.id))?.state).toEqual({ count: 1 })
    expect(codeObjectDocument(store.graph.getNode(target.id))?.state).toEqual({ count: 2 })

    const reloaded = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    expect(codeObjectDocument(reloaded.getNode(target.id))?.state).toEqual({ count: 2 })
    expect(objectGraphConnectionsOnPage(reloaded, store.state.currentPageId)[0]).toMatchObject({
      id: 'migrated-state-link',
      sourceNodeId: source.id,
      targetNodeId: target.id
    })
  })

  test('denies a target outside the exact Board Authority grant', () => {
    const store = createEditorStore()
    const source = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Source' }),
      height: 240,
      name: 'Source',
      width: 360
    })
    const allowed = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Allowed', state: { value: 0 } }),
      height: 240,
      name: 'Allowed',
      width: 360
    })
    const denied = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Denied', state: { value: 0 } }),
      height: 240,
      name: 'Denied',
      width: 360
    })
    const descriptor: BoardAuthorityGrantDescriptor = {
      actorId: source.id,
      defaultOrigin: { height: 0, width: 0, x: 0, y: 0 },
      labels: {
        create: 'Create connected object',
        delete: 'Delete connected object',
        update: 'Update connected state'
      },
      marker: {
        key: 'source-frame-id',
        pluginId: 'openpencil-object-graph',
        value: source.id
      },
      name: 'Exact target test',
      pageId: store.state.currentPageId,
      permissions: ['target.state.write'],
      targetNodeIds: [allowed.id]
    }
    const grant = issueBoardAuthorityGrant(store, descriptor)
    if (!grant) throw new Error('Expected an exact-target Board Authority grant')
    const receipt = dispatchBoardTargetAction(store, grant, {
      connectionId: 'not-authorized',
      patch: { value: 9 },
      sourceNodeId: source.id,
      targetNodeId: denied.id,
      type: 'board.target.state'
    })
    revokeBoardAuthorityGrant(store, grant)

    expect(receipt).toMatchObject({
      changed: false,
      reason: 'capability-denied',
      status: 'denied',
      targetNodeId: denied.id
    })
    expect(codeObjectDocument(store.graph.getNode(allowed.id))?.state).toEqual({ value: 0 })
    expect(codeObjectDocument(store.graph.getNode(denied.id))?.state).toEqual({ value: 0 })
  })

  test('retains an unreadable legacy link until its target can be resolved', () => {
    const store = createEditorStore()
    const source = createCodeObject(store, {
      document: createUserCodeObjectDocument({
        connections: [
          {
            id: 'deferred-state-link',
            label: 'Deferred target',
            permissions: ['state.write'],
            targetFrameId: 'missing-frame'
          }
        ],
        name: 'Deferred source'
      }),
      height: 240,
      name: 'Deferred source',
      width: 360
    })

    expect(normalizeLegacyCodeObjectConnections(store)).toBe(false)
    expect(codeObjectDocument(store.graph.getNode(source.id))?.connections).toEqual([
      {
        id: 'deferred-state-link',
        label: 'Deferred target',
        permissions: ['state.write'],
        targetFrameId: 'missing-frame'
      }
    ])
    expect(objectGraphConnectionsOnPage(store.graph, store.state.currentPageId)).toEqual([])
  })
})
