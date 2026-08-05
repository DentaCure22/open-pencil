import { afterEach, describe, expect, test } from 'bun:test'

import {
  OBJECT_GRAPH_SCHEMA_VERSION,
  objectGraphConnectionsOnPage,
  setObjectGraphConnectionsOnPage
} from '@open-pencil/scene-graph'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import { bindAutomationPersistence } from '@/app/automation/bridge/persistence'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:object-edit-test'

function installBrowserFixture() {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { querySelector: () => null, visibilityState: 'visible' }
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(performance.now()))
      return 1
    }
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: () => undefined
  })
}

function targetFor(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  return {
    contentDocumentId: 'content-document:object-edit',
    documentId: 'document:object-edit',
    documentName: 'Object edit document',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:object-edit'
  }
}

type Context = { context_token: string; revisions: { board: number } }

function context(value: unknown): Context {
  return value as Context
}

function args(value: Context, requestId: string, operation: Record<string, unknown>) {
  return {
    context_token: value.context_token,
    expected_revision: value.revisions.board,
    operation,
    request_id: requestId
  }
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'window')
})

describe('OpenPencil live guarded object edits', () => {
  test('updates, moves, resizes, duplicates, and deletes through normal editor history', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    bindAutomationPersistence(store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:object-edit',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const objectId = store.createShape('TEXT', 40, 60, 160, 48)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)

    let current = context(await handlers.context(target))
    const updated = (await handlers.change(
      target,
      args(current, 'request:update', {
        kind: 'object.update',
        object_id: objectId,
        patch: {
          cornerRadius: 24,
          fill: '#2563EB',
          name: 'Edited note',
          opacity: 0.8,
          text: 'Updated on the Board'
        }
      })
    )) as { persistence: { status: string }; status: { mutation: string } }
    expect(updated).toMatchObject({
      persistence: { status: 'durable' },
      status: { mutation: 'applied' }
    })
    expect(store.graph.getNode(objectId)).toMatchObject({
      cornerRadius: 24,
      fills: [{ type: 'SOLID' }],
      name: 'Edited note',
      opacity: 0.8,
      text: 'Updated on the Board'
    })
    expect(store.undo.undo()).toBe('Agent: update native object')
    expect(store.graph.getNode(objectId)?.text).not.toBe('Updated on the Board')
    expect(store.undo.redo()).toBe('Agent: update native object')

    current = context(await handlers.context(target))
    await handlers.change(
      target,
      args(current, 'request:move', { kind: 'object.move', object_id: objectId, x: 300, y: 220 })
    )
    expect(store.graph.getNode(objectId)).toMatchObject({ x: 300, y: 220 })

    current = context(await handlers.context(target))
    await handlers.change(
      target,
      args(current, 'request:resize', {
        height: 96,
        kind: 'object.resize',
        object_id: objectId,
        width: 320
      })
    )
    expect(store.graph.getNode(objectId)).toMatchObject({ height: 96, width: 320 })

    current = context(await handlers.context(target))
    const duplicated = (await handlers.change(
      target,
      args(current, 'request:duplicate', {
        kind: 'object.duplicate',
        object_id: objectId,
        offset_x: 80,
        offset_y: 40
      })
    )) as { owner_id: string; status: { mutation: string } }
    expect(duplicated.status.mutation).toBe('applied')
    expect(duplicated.owner_id).not.toBe(objectId)
    expect(store.graph.getNode(duplicated.owner_id)).toMatchObject({ x: 380, y: 260 })
    expect(
      store.graph
        .getNode(duplicated.owner_id)
        ?.pluginData.some((entry) => entry.pluginId === 'openpencil.agent-tools')
    ).toBe(false)

    setObjectGraphConnectionsOnPage(store.graph, target.pageId, [
      {
        automatic: false,
        id: 'connection:delete',
        kind: 'visual',
        label: 'Delete cleanup',
        permissions: [],
        schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
        sourceNodeId: objectId,
        sourcePort: 'auto',
        targetNodeId: duplicated.owner_id,
        targetPort: 'auto'
      }
    ])
    current = context(await handlers.context(target))
    const deleted = (await handlers.change(
      target,
      args(current, 'request:delete', {
        kind: 'object.delete',
        object_id: duplicated.owner_id
      })
    )) as { owner_id: null; status: { mutation: string } }
    expect(deleted).toMatchObject({ owner_id: null, status: { mutation: 'applied' } })
    expect(store.graph.getNode(duplicated.owner_id)).toBeUndefined()
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(0)
    expect(store.undo.undo()).toBe('Agent: delete native object')
    expect(store.graph.getNode(duplicated.owner_id)).toBeDefined()
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(1)
  })

  test('fails closed for nested and locked targets, deletes Code Objects, and reports no-op honestly', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const frameId = store.createShape('FRAME', 40, 60, 240, 180)
    const nestedId = store.createShape('RECTANGLE', 10, 10, 40, 40, frameId)
    const lockedId = store.createShape('RECTANGLE', 340, 60, 120, 80)
    store.updateNode(lockedId, { locked: true })
    const codeObjectId = store.createShape('FRAME', 520, 60, 240, 180)
    const codeObject = store.graph.getNode(codeObjectId)
    if (!codeObject) throw new Error('Expected Code Object fixture frame.')
    store.updateNode(codeObjectId, {
      pluginData: [
        ...codeObject.pluginData,
        { key: 'kind', pluginId: 'openpencil-code-object', value: 'code-object' }
      ]
    })
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)

    for (const [requestId, objectId, message] of [
      ['request:nested', nestedId, 'not a top-level object'],
      ['request:locked', lockedId, 'is locked']
    ]) {
      const current = context(await handlers.context(target))
      await expect(
        handlers.change(
          target,
          args(current, requestId, { kind: 'object.delete', object_id: objectId })
        )
      ).rejects.toThrow(message)
    }

    let current = context(await handlers.context(target))
    const deletedCodeObject = (await handlers.change(
      target,
      args(current, 'request:delete-code-object', {
        kind: 'object.delete',
        object_id: codeObjectId
      })
    )) as { receipt: { history_label: string }; status: { mutation: string } }
    expect(deletedCodeObject).toMatchObject({
      receipt: { history_label: 'Agent: delete Code Object' },
      status: { mutation: 'applied' }
    })
    expect(store.graph.getNode(codeObjectId)).toBeUndefined()
    expect(store.undo.undo()).toBe('Agent: delete Code Object')
    expect(store.graph.getNode(codeObjectId)).toBeDefined()

    current = context(await handlers.context(target))
    const noChange = (await handlers.change(
      target,
      args(current, 'request:no-change', {
        kind: 'object.move',
        object_id: frameId,
        x: 40,
        y: 60
      })
    )) as { receipt: { status: string }; status: { mutation: string } }
    expect(noChange).toMatchObject({
      receipt: { status: 'no_change' },
      status: { mutation: 'no_change' }
    })
  })
})
