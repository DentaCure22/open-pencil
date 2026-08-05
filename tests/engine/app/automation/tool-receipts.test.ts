import { afterEach, describe, expect, test } from 'bun:test'

import { ALL_TOOLS } from '@open-pencil/core/tools'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import {
  MUTATION_RECEIPT_PLUGIN_ID,
  MUTATION_RECEIPT_PLUGIN_KEY,
  mutationRequestLedgerState,
  mutationRequestSignature,
  recordMutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'
import { setSmylrProductionDocumentWriteGuard } from '@/app/smylr-production/document-state'

const RUNTIME_ID = 'runtime:tool-receipts-test'

function installBrowserFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    documentId: 'tool-receipts-document',
    documentName: 'Tool receipts document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:tool-receipts'
  }
}

function contextResult(value: unknown) {
  return value as {
    context_token: string
    revisions: { board: number }
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

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('ToolDef mutation receipts', () => {
  test('canonicalizes Unicode and rejects non-finite request inputs', async () => {
    await expect(
      mutationRequestSignature('route:e\u0301', {
        'na\u0301me': 'Cafe\u0301',
        nested: { b: 2, a: 1 }
      })
    ).resolves.toBe(
      await mutationRequestSignature('route:é', {
        nested: { a: 1, b: 2 },
        náme: 'Café'
      })
    )
    await expect(mutationRequestSignature('route', { value: Number.NaN })).rejects.toThrow(
      'finite numbers'
    )
    await expect(
      mutationRequestSignature('route', { value: [Number.POSITIVE_INFINITY] })
    ).rejects.toThrow('finite numbers')
    await expect(mutationRequestSignature('route', { 'e\u0301': 1, é: 2 })).rejects.toThrow(
      'duplicate Unicode-normalized keys'
    )
    expect(await mutationRequestSignature('route', { value: ' Exact ' })).not.toBe(
      await mutationRequestSignature('route', { value: 'exact' })
    )
  })

  test('verifies, replays, and preserves a create_shape receipt through Undo', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const context = contextResult(await handlers.context(target))
    const request = {
      args: {
        height: 80,
        name: 'Receipt shape',
        type: 'RECTANGLE',
        width: 120,
        x: 40,
        y: 60
      },
      mutation: {
        expectedRevision: context.revisions.board,
        requestId: 'request:tool-create',
        traceId: 'trace:tool-create'
      },
      name: 'create_shape'
    }

    const first = (await handleTool(target, request)) as {
      result: { id: string; mutation_receipt: { requestId: string } }
    }
    const firstId = first.result.id
    const count = store.graph.getNode(target.pageId)?.childIds.length
    await expect(
      handlers.verify(target, {
        context_token: context.context_token,
        request_id: 'request:tool-create'
      })
    ).resolves.toMatchObject({
      readback: {
        nodes: [{ id: firstId, name: 'Receipt shape', type: 'RECTANGLE' }]
      },
      receipt: {
        requestId: 'request:tool-create',
        route: 'tool:create_shape',
        traceId: 'trace:tool-create'
      },
      status: 'matched'
    })

    const replay = (await handleTool(target, request)) as {
      result: { id: string; mutation_receipt: { idempotentReplay: boolean } }
    }
    expect(replay).toMatchObject({
      result: {
        id: firstId,
        mutation_receipt: { idempotentReplay: true }
      }
    })
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(count)

    await expect(
      handleTool(target, {
        ...request,
        args: { ...request.args, name: 'Different request content' }
      })
    ).rejects.toThrow('already used for a different mutation')

    expect(store.undo.undo()).toBe('MCP: create_shape')
    expect(store.graph.getNode(firstId)).toBeUndefined()
    const undoneContext = contextResult(await handlers.context(target))
    await expect(
      handlers.verify(target, {
        context_token: undoneContext.context_token,
        request_id: 'request:tool-create'
      })
    ).resolves.toMatchObject({
      readback: { nodes: [{ id: firstId, missing: true }] },
      status: 'matched'
    })
    await expect(handleTool(target, request)).resolves.toMatchObject({
      result: {
        mutation_receipt: {
          historicalOnly: true,
          historicalStatus: 'applied',
          idempotentReplay: true,
          liveStatus: 'missing',
          replayAction: 'none'
        },
        mutation_replay: {
          action: 'none',
          historical: 'applied',
          live: 'missing',
          readback: { nodes: [{ id: firstId, missing: true }] }
        }
      }
    })

    expect(store.undo.redo()).toBe('MCP: create_shape')
    store.updateNodeWithUndo(firstId, { name: 'Locally renamed' }, 'Rename shape')
    await expect(handleTool(target, request)).resolves.toMatchObject({
      result: {
        mutation_receipt: {
          historicalOnly: true,
          liveStatus: 'diverged',
          replayAction: 'none'
        },
        mutation_replay: {
          action: 'none',
          historical: 'applied',
          live: 'diverged',
          readback: { nodes: [{ id: firstId, name: 'Locally renamed' }] }
        }
      }
    })
  })

  test('resolves declared ToolDef defaults before hashing retry intent', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const shapeId = store.createShape('RECTANGLE', 20, 20, 80, 60)
    const requestId = 'request:default-equivalence'
    const expectedRevision = store.state.sceneVersion

    await handleTool(target, {
      args: { color: '#112233', id: shapeId },
      mutation: { expectedRevision, requestId },
      name: 'set_stroke'
    })
    await expect(
      handleTool(target, {
        args: { align: 'INSIDE', color: '#112233', id: shapeId, weight: 1 },
        mutation: { expectedRevision: store.state.sceneVersion, requestId },
        name: 'set_stroke'
      })
    ).resolves.toMatchObject({
      result: {
        mutation_receipt: {
          idempotentReplay: true,
          liveStatus: 'present',
          replayAction: 'none'
        }
      }
    })
  })

  test('does not consume a request ID when a stale revision is rejected', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const staleContext = contextResult(await handlers.context(target))
    store.createShape('RECTANGLE', 20, 20, 40, 40)
    const args = {
      height: 80,
      name: 'Fresh retry',
      type: 'RECTANGLE',
      width: 120,
      x: 80,
      y: 60
    }

    await expect(
      handleTool(target, {
        args,
        mutation: {
          expectedRevision: staleContext.revisions.board,
          requestId: 'request:stale-tool'
        },
        name: 'create_shape'
      })
    ).resolves.toMatchObject({
      result: {
        applied: false,
        mutation_receipt: { reason: 'stale_board_revision', status: 'rejected' }
      }
    })

    const freshContext = contextResult(await handlers.context(target))
    await expect(
      handlers.verify(target, {
        context_token: freshContext.context_token,
        request_id: 'request:stale-tool'
      })
    ).resolves.toMatchObject({ reason: 'request_not_found', status: 'empty' })
    await expect(
      handleTool(target, {
        args,
        mutation: {
          expectedRevision: freshContext.revisions.board,
          requestId: 'request:stale-tool'
        },
        name: 'create_shape'
      })
    ).resolves.toMatchObject({
      result: {
        id: expect.any(String),
        mutation_receipt: { requestId: 'request:stale-tool', status: 'applied' }
      }
    })
  })

  test('rejects cross-route request IDs in both native and generic directions', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const anchorId = store.createShape('RECTANGLE', 20, 20, 80, 60)
    store.select([anchorId])
    const context = contextResult(await handlers.context(target))

    await handlers.change(target, {
      context_token: context.context_token,
      expected_revision: context.revisions.board,
      operation: {
        anchor_id: anchorId,
        artifact: {
          kind: 'native_text',
          text: 'Native request owner'
        },
        kind: 'artifact.create'
      },
      request_id: 'request:cross-route'
    })
    const revision = store.state.sceneVersion
    const childIds = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]

    await expect(
      handleTool(target, createShapeRequest(revision, 'request:cross-route'))
    ).rejects.toThrow('already used for a different mutation')
    expect(store.state.sceneVersion).toBe(revision)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childIds)

    const genericRequestId = 'request:generic-owner'
    await handleTool(target, createShapeRequest(revision, genericRequestId))
    store.select([anchorId])
    const freshContext = contextResult(await handlers.context(target))
    await expect(
      handlers.change(target, {
        context_token: freshContext.context_token,
        expected_revision: freshContext.revisions.board,
        operation: {
          anchor_id: anchorId,
          artifact: {
            kind: 'native_text',
            text: 'Conflicting native route'
          },
          kind: 'artifact.create'
        },
        request_id: genericRequestId
      })
    ).rejects.toThrow('already used for a different mutation')
  })

  test('denies generic mutating ToolDefs in a viewer runtime', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    setSmylrProductionDocumentWriteGuard(store, () => false)
    const revision = store.state.sceneVersion

    await expect(
      handleTool(target, createShapeRequest(revision, 'request:view-only-tool'))
    ).rejects.toThrow('view-only')
    expect(store.state.sceneVersion).toBe(revision)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([])
  })

  test('blocks asynchronous mutating ToolDefs before any effect or reservation', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const nodeId = store.createShape('RECTANGLE', 20, 20, 80, 60)
    const revision = store.state.sceneVersion
    const childIds = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]
    const asyncMutatingToolNames = ALL_TOOLS.filter(
      (tool) => tool.mutates && tool.execute.constructor.name === 'AsyncFunction'
    )
      .map((tool) => tool.name)
      .sort()
    expect(asyncMutatingToolNames).toEqual([
      'eval',
      'import_svg',
      'insert_icon',
      'node_replace_with',
      'render',
      'stock_photo'
    ])

    for (const toolName of asyncMutatingToolNames) {
      const requestId = `request:async-blocked:${toolName}`
      await expect(
        handleTool(target, {
          args: {},
          mutation: { expectedRevision: revision, requestId },
          name: toolName
        })
      ).rejects.toThrow('not available through guarded automation')
      expect(mutationRequestLedgerState(target, requestId)).toEqual({ status: 'missing' })
    }

    expect(store.state.sceneVersion).toBe(revision)
    expect(store.graph.getNode(nodeId)).toBeDefined()
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childIds)
  })

  test('blocks unreadable and saturated ledgers before graph mutation', async () => {
    installBrowserFixture()
    for (const value of [
      '{not-json',
      JSON.stringify({
        receipts: [],
        saturated: true,
        tombstones: [],
        version: 2
      })
    ]) {
      const store = createEditorStore()
      const target = automationTarget(store)
      const handlers = createAutomationBoardHandlers(RUNTIME_ID)
      const handleTool = createAutomationToolHandler(makeFigmaFromStore)
      const page = store.graph.getNode(target.pageId)
      if (!page) throw new Error('Fixture page is missing')
      store.graph.updateNode(page.id, {
        pluginData: [
          ...page.pluginData,
          {
            key: MUTATION_RECEIPT_PLUGIN_KEY,
            pluginId: MUTATION_RECEIPT_PLUGIN_ID,
            value
          }
        ]
      })
      const revision = store.state.sceneVersion
      const childIds = [...page.childIds]
      const context = contextResult(await handlers.context(target))

      await expect(
        handlers.verify(target, {
          context_token: context.context_token,
          request_id: `request:blocked:${revision}`
        })
      ).resolves.toMatchObject({ status: 'error' })
      await expect(
        handleTool(target, createShapeRequest(revision, `request:blocked:${revision}`))
      ).rejects.toThrow(/ledger is (saturated|unreadable)/)
      expect(store.state.sceneVersion).toBe(revision)
      expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childIds)
    }
  })

  test('tombstones an evicted request ID instead of treating it as fresh', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    for (let index = 0; index < 65; index++) {
      const requestId = `request:retained:${index}`
      recordMutationRequestReceipt(target, {
        inputDigest: `sha256:${index.toString(16).padStart(64, '0')}`,
        mutationReceipt: {
          appliedRevision: store.state.sceneVersion,
          enqueuedRevision: store.state.sceneVersion,
          expectedRevision: store.state.sceneVersion,
          requestId,
          status: 'applied',
          touchedProperties: [`${target.pageId}:*`]
        },
        objectIds: [],
        requestId,
        route: 'tool:create_shape',
        semanticIds: [],
        version: 1
      })
    }
    expect(mutationRequestLedgerState(target, 'request:retained:0')).toEqual({
      status: 'expired'
    })
    const revision = store.state.sceneVersion
    const childIds = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]
    const context = contextResult(await handlers.context(target))

    await expect(
      handlers.verify(target, {
        context_token: context.context_token,
        request_id: 'request:retained:0'
      })
    ).resolves.toMatchObject({
      reason: 'request_ledger_expired',
      status: 'error'
    })
    await expect(
      handleTool(target, createShapeRequest(revision, 'request:retained:0'))
    ).rejects.toThrow('is expired and cannot be reused')
    expect(store.state.sceneVersion).toBe(revision)
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual(childIds)
  })
})
