import { afterEach, describe, expect, test } from 'bun:test'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import {
  mutationRequestLedgerState,
  mutationRequestReadback,
  mutationRequestSignature
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'

function target(): AutomationTarget {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  return {
    contentDocumentId: store.graph.rootId,
    documentId: 'document:tool-receipts',
    documentName: 'Tool receipts',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: 'runtime:tool-receipts',
    store,
    workspaceId: 'workspace:tool-receipts'
  }
}

function createShapeRequest(expectedRevision: number, requestId: string) {
  return {
    args: {
      height: 80,
      name: 'Receipt shape',
      type: 'RECTANGLE',
      width: 120,
      x: 40,
      y: 60
    },
    mutation: { expectedRevision, requestId },
    name: 'create_shape'
  }
}

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('live primitive-tool receipts', () => {
  test('canonicalizes request signatures and rejects invalid numbers', async () => {
    expect(
      await mutationRequestSignature('route:é', {
        nested: { a: 1, b: 2 },
        náme: 'Café'
      })
    ).toBe(
      await mutationRequestSignature('route:e\u0301', {
        'na\u0301me': 'Cafe\u0301',
        nested: { b: 2, a: 1 }
      })
    )
    await expect(mutationRequestSignature('route', { value: Number.NaN })).rejects.toThrow(
      'finite numbers'
    )
  })

  test('stores one receipt, replays it, and preserves history through Undo', async () => {
    installWindowFixture()
    const liveTarget = target()
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const request = createShapeRequest(liveTarget.store.state.sceneVersion, 'request:tool-create')

    const first = (await handleTool(liveTarget, request)) as {
      result: { id: string; mutation_receipt: { requestId: string } }
    }
    const objectId = first.result.id
    const stored = mutationRequestLedgerState(liveTarget, 'request:tool-create')
    expect(stored).toMatchObject({
      receipt: { requestId: 'request:tool-create', route: 'tool:create_shape' },
      status: 'stored'
    })
    if (stored.status !== 'stored') throw new Error('Expected a stored mutation receipt.')
    expect(mutationRequestReadback(liveTarget, stored.receipt)).toMatchObject({
      nodes: [{ id: objectId, name: 'Receipt shape', type: 'RECTANGLE' }]
    })

    await expect(handleTool(liveTarget, request)).resolves.toMatchObject({
      result: {
        id: objectId,
        mutation_receipt: { idempotentReplay: true, liveStatus: 'present' }
      }
    })
    expect(liveTarget.store.undo.undo()).toBe('Agent: create_shape')
    expect(liveTarget.store.graph.getNode(objectId)).toBeUndefined()
    expect(mutationRequestReadback(liveTarget, stored.receipt)).toMatchObject({
      nodes: [{ id: objectId, missing: true }]
    })
  })

  test('rejects a stale revision without consuming the request ID', async () => {
    installWindowFixture()
    const liveTarget = target()
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const staleRevision = liveTarget.store.state.sceneVersion
    liveTarget.store.createShape('RECTANGLE', 0, 0, 40, 40)

    await expect(
      handleTool(liveTarget, createShapeRequest(staleRevision, 'request:stale'))
    ).resolves.toMatchObject({
      result: {
        applied: false,
        mutation_receipt: { reason: 'stale_board_revision', status: 'rejected' }
      }
    })
    expect(mutationRequestLedgerState(liveTarget, 'request:stale')).toEqual({ status: 'missing' })

    await expect(
      handleTool(
        liveTarget,
        createShapeRequest(liveTarget.store.state.sceneVersion, 'request:stale')
      )
    ).resolves.toMatchObject({
      result: { id: expect.any(String), mutation_receipt: { status: 'applied' } }
    })
  })
})
