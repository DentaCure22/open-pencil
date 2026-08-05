import { afterEach, describe, expect, test } from 'bun:test'

import { createMermaidSvgSpec, type MermaidDiagram } from '@open-pencil/core/diagram'
import { reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import { createAutomationMermaidHandler } from '@/app/automation/bridge/mermaid-handler'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import { mutationRequestLedgerState } from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:mermaid-receipts-test'

function installBrowserFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

function mermaidFixture(source: string): Promise<MermaidDiagram> {
  return Promise.resolve(createMermaidSvgSpec(source, { appearance: 'light' }))
}

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    contentDocumentId: store.graph.rootId,
    documentId: 'mermaid-receipts-document',
    documentName: 'Mermaid receipts document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:mermaid-receipts'
  }
}

function contextResult(value: unknown) {
  return value as {
    context_token: string
    revisions: { board: number }
  }
}

function guardedRequest(
  revision: number,
  anchorId: string,
  requestId: string,
  source = 'flowchart LR\n Intent --> Artifact'
) {
  return {
    anchor_id: anchorId,
    mutation: {
      expectedRevision: revision,
      requestId,
      taskId: 'task:mermaid-receipt',
      traceId: 'trace:mermaid-receipt'
    },
    source,
    zoom_to_selection: false
  }
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('Mermaid durable mutation receipts', () => {
  test('stores a verifiable receipt, replays once, rejects conflicts, and never recreates after Undo', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 100, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await board.context(target))
    const insert = createAutomationMermaidHandler(mermaidFixture)
    const request = guardedRequest(context.revisions.board, anchorId, 'request:durable-mermaid')

    const first = (await insert(target, request)) as {
      result: {
        mutation_receipt: { idempotentReplay: boolean; requestId: string }
        owner_id: string
      }
    }
    const ownerId = first.result.owner_id
    const childCount = store.graph.getNode(target.pageId)?.childIds.length

    expect(first.result.mutation_receipt).toMatchObject({
      idempotentReplay: false,
      requestId: 'request:durable-mermaid'
    })
    expect(mutationRequestLedgerState(target, 'request:durable-mermaid')).toMatchObject({
      receipt: {
        objectIds: [ownerId],
        route: 'insert_mermaid_diagram',
        taskId: 'task:mermaid-receipt',
        traceId: 'trace:mermaid-receipt'
      },
      status: 'stored'
    })
    await expect(
      board.verify(target, {
        context_token: context.context_token,
        request_id: 'request:durable-mermaid'
      })
    ).resolves.toMatchObject({
      readback: { nodes: [{ id: ownerId, type: 'FRAME' }] },
      receipt: { route: 'insert_mermaid_diagram' },
      status: 'matched'
    })

    const replay = (await insert(target, request)) as {
      result: {
        applied: boolean
        mutation_receipt: { idempotentReplay: boolean; liveStatus: string }
        owner_id: string
      }
    }
    expect(replay.result).toMatchObject({
      applied: true,
      mutation_receipt: { idempotentReplay: true, liveStatus: 'present' },
      owner_id: ownerId
    })
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(childCount)

    await expect(
      insert(
        target,
        guardedRequest(
          context.revisions.board,
          anchorId,
          'request:durable-mermaid',
          'flowchart LR\n Changed --> Payload'
        )
      )
    ).rejects.toThrow('already used for a different mutation')
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(childCount)

    expect(store.undo.undo()).toBe('Insert Mermaid diagram')
    expect(store.graph.getNode(ownerId)).toBeUndefined()
    const undoneContext = contextResult(await board.context(target))
    await expect(
      board.verify(target, {
        context_token: undoneContext.context_token,
        request_id: 'request:durable-mermaid'
      })
    ).resolves.toMatchObject({
      readback: { nodes: [{ id: ownerId, missing: true }] },
      status: 'matched'
    })

    await expect(insert(target, request)).resolves.toMatchObject({
      result: {
        applied: false,
        mutation_receipt: {
          historicalOnly: true,
          idempotentReplay: true,
          liveStatus: 'missing',
          replayAction: 'none'
        },
        owner_id: ownerId,
        status: {
          command: 'unavailable',
          mutation: 'replayed',
          reason: 'historical_receipt_only'
        }
      }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId])
  })

  test('replays an unanchored empty-page insertion at its exact canvas position without duplicating it', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const board = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await board.context(target))
    const insert = createAutomationMermaidHandler(mermaidFixture)
    const request = {
      mutation: {
        expectedRevision: context.revisions.board,
        requestId: 'request:durable-mermaid-xy',
        taskId: 'task:mermaid-exact-position',
        traceId: 'trace:mermaid-exact-position'
      },
      source: 'flowchart LR\n Exact --> Position',
      x: 320,
      y: 180,
      zoom_to_selection: false
    }

    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([])
    const first = (await insert(target, request)) as {
      result: {
        mutation_receipt: { idempotentReplay: boolean }
        owner_id: string
        position: Vector
        readback: { bounds: Rect }
      }
    }
    const ownerId = first.result.owner_id

    expect(first.result).toMatchObject({
      mutation_receipt: { idempotentReplay: false },
      position: { x: 320, y: 180 },
      readback: { bounds: { x: 320, y: 180 } }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([ownerId])
    expect(store.graph.getNode(ownerId)).toMatchObject({ x: 320, y: 180 })

    const replay = (await insert(target, request)) as {
      result: {
        applied: boolean
        mutation_receipt: { idempotentReplay: boolean; liveStatus: string }
        owner_id: string
        position: Vector
        readback: { bounds: Rect }
      }
    }

    expect(replay.result).toMatchObject({
      applied: true,
      mutation_receipt: { idempotentReplay: true, liveStatus: 'present' },
      owner_id: ownerId,
      position: { x: 320, y: 180 },
      readback: { bounds: { x: 320, y: 180 } }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([ownerId])
    expect(store.graph.getNode(ownerId)).toMatchObject({ x: 320, y: 180 })
  })

  test('stores and replays an identical guarded refinement without changing the diagram or Undo history', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 100, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = contextResult(await board.context(target))
    let parseCalls = 0
    const insert = createAutomationMermaidHandler((source) => {
      parseCalls++
      return mermaidFixture(source)
    })
    const source = 'flowchart LR\n Intent --> Artifact'
    const created = (await insert(
      target,
      guardedRequest(
        initialContext.revisions.board,
        anchorId,
        'request:durable-mermaid-source',
        source
      )
    )) as { result: { owner_id: string } }
    const ownerId = created.result.owner_id
    const currentContext = contextResult(await board.context(target))
    const ownerBefore = store.graph.getNode(ownerId)
    if (!ownerBefore) throw new Error('Expected the Mermaid owner to exist.')
    const childIdsBefore = [...ownerBefore.childIds]
    const boundsBefore = store.graph.getAbsoluteBounds(ownerId)
    const pluginDataBefore = structuredClone(ownerBefore.pluginData)
    const reconciliationBefore = reconcileMermaidDiagramSource(store.graph, ownerId)
    const undoLabelBefore = store.undo.undoLabel
    const noChangeRequest = {
      mutation: {
        expectedRevision: currentContext.revisions.board,
        requestId: 'request:durable-mermaid-no-change',
        taskId: 'task:mermaid-no-change',
        traceId: 'trace:mermaid-no-change'
      },
      owner_id: ownerId,
      source,
      zoom_to_selection: false
    }

    const noChange = (await insert(target, noChangeRequest)) as {
      result: {
        applied: boolean
        mutation_receipt: {
          idempotentReplay: boolean
          outcome: string
          status: string
          touchedProperties: string[]
        }
        operation: string
        owner_id: string
        status: { attention_required: boolean; command: string; mutation: string }
      }
    }

    expect(noChange.result).toMatchObject({
      applied: false,
      mutation_receipt: {
        idempotentReplay: false,
        outcome: 'no_change',
        status: 'no_change',
        touchedProperties: []
      },
      operation: 'no_change',
      owner_id: ownerId,
      status: { attention_required: false, command: 'completed', mutation: 'no_change' }
    })
    expect(parseCalls).toBe(1)
    expect(store.graph.getNode(ownerId)).toMatchObject({
      childIds: childIdsBefore,
      pluginData: pluginDataBefore,
      x: ownerBefore.x,
      y: ownerBefore.y
    })
    expect(store.graph.getAbsoluteBounds(ownerId)).toEqual(boundsBefore)
    expect(reconcileMermaidDiagramSource(store.graph, ownerId)).toEqual(reconciliationBefore)
    expect(store.undo.undoLabel).toBe(undoLabelBefore)
    expect(mutationRequestLedgerState(target, 'request:durable-mermaid-no-change')).toMatchObject({
      receipt: {
        mutationReceipt: { touchedProperties: [] },
        objectIds: [ownerId],
        result: { operation: 'no_change', owner_id: ownerId }
      },
      status: 'stored'
    })

    const replay = (await insert(target, noChangeRequest)) as {
      result: {
        applied: boolean
        mutation_receipt: { idempotentReplay: boolean; outcome: string; status: string }
        operation: string
        owner_id: string
        status: { mutation: string }
      }
    }
    expect(replay.result).toMatchObject({
      applied: false,
      mutation_receipt: {
        idempotentReplay: true,
        outcome: 'no_change',
        status: 'no_change'
      },
      operation: 'no_change',
      owner_id: ownerId,
      status: { mutation: 'no_change' }
    })
    expect(parseCalls).toBe(1)
    expect(store.graph.getNode(ownerId)?.childIds).toEqual(childIdsBefore)
    expect(store.graph.getAbsoluteBounds(ownerId)).toEqual(boundsBefore)
    expect(store.undo.undoLabel).toBe(undoLabelBefore)

    await expect(
      insert(target, { ...noChangeRequest, source: 'flowchart LR\n Changed --> Payload' })
    ).rejects.toThrow('already used for a different mutation')
    expect(store.graph.getNode(ownerId)?.childIds).toEqual(childIdsBefore)
    expect(store.undo.undo()).toBe('Insert Mermaid diagram')
    expect(store.graph.getNode(ownerId)).toBeUndefined()
  })

  test('returns the durable applied receipt when post-commit Mermaid finishing fails', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 100, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await board.context(target))
    const insert = createAutomationMermaidHandler(mermaidFixture, {
      finishMutation: () => Promise.reject(new Error('font and zoom finish failed'))
    })
    const request = guardedRequest(
      context.revisions.board,
      anchorId,
      'request:mermaid-finish-failure'
    )

    const result = (await insert(target, request)) as {
      result: {
        applied: boolean
        mutation_receipt: { idempotentReplay: boolean; requestId: string }
        next_action: { request_id: string; retry_mutation: boolean }
        owner_id: string
        proof: { error: string; stage: string; status: string }
        status: { command: string; mutation: string; reason: string }
      }
    }

    expect(result.result).toMatchObject({
      applied: true,
      mutation_receipt: {
        idempotentReplay: false,
        requestId: 'request:mermaid-finish-failure'
      },
      next_action: {
        request_id: 'request:mermaid-finish-failure',
        retry_mutation: false
      },
      proof: {
        error: 'font and zoom finish failed',
        stage: 'finish',
        status: 'error'
      },
      status: {
        command: 'unavailable',
        mutation: 'applied',
        reason: 'post_apply_finish_failed'
      }
    })
    expect(store.graph.getNode(result.result.owner_id)).toBeDefined()
    expect(mutationRequestLedgerState(target, 'request:mermaid-finish-failure')).toMatchObject({
      receipt: { objectIds: [result.result.owner_id] },
      status: 'stored'
    })
    expect(store.undo.undoLabel).toBe('Insert Mermaid diagram')

    await expect(insert(target, request)).resolves.toMatchObject({
      result: {
        applied: true,
        mutation_receipt: { idempotentReplay: true, liveStatus: 'present' },
        owner_id: result.result.owner_id
      }
    })
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId, result.result.owner_id])
  })

  test('rolls back the normal Mermaid history entry when durable receipt storage fails', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 100, 80)
    store.select([anchorId])
    const board = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await board.context(target))
    const insert = createAutomationMermaidHandler(mermaidFixture, {
      beforeMutationReceiptStorage: () => {
        throw new Error('receipt storage failpoint')
      }
    })
    const requestId = 'request:mermaid-receipt-failure'

    await expect(
      insert(target, guardedRequest(context.revisions.board, anchorId, requestId))
    ).rejects.toThrow('receipt storage failpoint')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId])
    expect(store.undo.redo()).toBeNull()
    expect(mutationRequestLedgerState(target, requestId)).toMatchObject({ status: 'pending' })

    const failedContext = contextResult(await board.context(target))
    await expect(
      board.verify(target, {
        context_token: failedContext.context_token,
        request_id: requestId
      })
    ).resolves.toMatchObject({
      reason: 'request_ledger_pending',
      status: 'error'
    })
    await expect(
      insert(target, guardedRequest(context.revisions.board, anchorId, requestId))
    ).rejects.toThrow('incomplete mutation outcome')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId])
  })
})
