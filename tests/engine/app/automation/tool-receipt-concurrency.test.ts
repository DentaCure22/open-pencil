import { afterEach, describe, expect, test } from 'bun:test'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import {
  MUTATION_RECEIPT_PLUGIN_ID,
  MUTATION_RECEIPT_PLUGIN_KEY,
  mutationRequestLedgerState
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'
import { planSmylrProductionDocumentPersistence } from '@/app/smylr-production/document-persistence/plan'

const RUNTIME_ID = 'runtime:tool-receipt-concurrency'

type ToolMutationResult = {
  result: {
    applied?: boolean
    id?: string
    mutation_receipt: {
      reason?: string
      requestId: string
      status: 'applied' | 'rejected'
    }
  }
}

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
    documentId: 'tool-receipt-concurrency-document',
    documentName: 'Tool receipt concurrency document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:tool-receipt-concurrency'
  }
}

function createShapeRequest(expectedRevision: number, requestId: string, name: string) {
  return {
    args: {
      height: 80,
      name,
      type: 'RECTANGLE',
      width: 120,
      x: 40,
      y: 60
    },
    mutation: { expectedRevision, requestId },
    name: 'create_shape'
  }
}

function contextResult(value: unknown) {
  return value as {
    context_token: string
    request_ledger: {
      limits: { receipts: number; reservations: number; tombstones: number }
      recent_transactions: Array<{ request_id: string; route: string }>
      status: string
      usage: { receipts: number; reservations: number; tombstones: number } | null
    }
  }
}

function firstReceiptGate() {
  let enteredResolve = () => undefined
  let releaseResolve = () => undefined
  let calls = 0
  const entered = new Promise<void>((resolve) => {
    enteredResolve = resolve
  })
  const released = new Promise<void>((resolve) => {
    releaseResolve = resolve
  })
  return {
    entered,
    hook: async () => {
      calls += 1
      if (calls !== 1) return
      enteredResolve()
      await released
    },
    release: releaseResolve
  }
}

function namedChildren(target: AutomationTarget, names: string[]) {
  return (target.store.graph.getNode(target.pageId)?.childIds ?? [])
    .map((id) => target.store.graph.getNode(id))
    .filter((node) => node && names.includes(node.name))
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('ToolDef receipt crash and concurrency boundary', () => {
  test('stores a synchronous delete receipt before delete persistence can snapshot', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const nodeId = store.createShape('RECTANGLE', 10, 10, 80, 60)
    const requestId = 'request:delete-before-persistence'
    let observedResolve = (_status: string) => undefined
    const observedLedgerStatus = new Promise<string>((resolve) => {
      observedResolve = resolve
    })
    const unbind = store.onEditorEvent('node:deleted', () => {
      queueMicrotask(() => {
        observedResolve(mutationRequestLedgerState(target, requestId).status)
      })
    })
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)

    await handleTool(target, {
      args: { id: nodeId },
      mutation: { expectedRevision: store.state.sceneVersion, requestId },
      name: 'delete_node'
    })
    unbind()

    expect(await observedLedgerStatus).toBe('stored')
    expect(store.graph.getNode(nodeId)).toBeUndefined()
    expect(mutationRequestLedgerState(target, requestId)).toMatchObject({
      status: 'stored'
    })
  })

  test('persists a pending reservation with an effect when receipt storage fails', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const requestId = 'request:receipt-failpoint'
    const handleTool = createAutomationToolHandler(makeFigmaFromStore, {
      beforeMutationReceiptStorage: () => {
        throw new Error('simulated receipt storage crash')
      }
    })

    await expect(
      handleTool(
        target,
        createShapeRequest(store.state.sceneVersion, requestId, 'Crash-bound shape')
      )
    ).rejects.toThrow('simulated receipt storage crash')

    expect(namedChildren(target, ['Crash-bound shape'])).toHaveLength(1)
    expect(mutationRequestLedgerState(target, requestId)).toMatchObject({
      reservation: {
        requestId,
        route: 'tool:create_shape'
      },
      status: 'pending'
    })

    const plan = planSmylrProductionDocumentPersistence(store.graph, null, new Set([target.pageId]))
    const boardSnapshot = plan.boardSnapshots.find((snapshot) => snapshot.boardId === target.pageId)
    if (!boardSnapshot) throw new Error('The crash-bound Board snapshot was not captured.')
    const persistedNodes = new Map(boardSnapshot.nodes)
    const persistedPage = persistedNodes.get(target.pageId)
    expect(
      persistedNodes.get(namedChildren(target, ['Crash-bound shape'])[0]?.id ?? '')
    ).toBeDefined()
    expect(
      persistedPage?.pluginData.some(
        (entry) =>
          entry.pluginId === MUTATION_RECEIPT_PLUGIN_ID &&
          entry.key === MUTATION_RECEIPT_PLUGIN_KEY &&
          entry.value.includes(requestId)
      )
    ).toBe(true)

    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    expect(context.request_ledger).toEqual({
      limits: { receipts: 64, reservations: 64, tombstones: 512 },
      recent_transactions: [],
      status: 'open',
      usage: { receipts: 0, reservations: 1, tombstones: 0 }
    })
    await expect(
      handlers.verify(target, {
        context_token: context.context_token,
        request_id: requestId
      })
    ).resolves.toMatchObject({
      reason: 'request_ledger_pending',
      status: 'error'
    })
    await expect(
      handleTool(
        target,
        createShapeRequest(store.state.sceneVersion, requestId, 'Crash-bound shape')
      )
    ).rejects.toThrow('incomplete mutation outcome')
    expect(namedChildren(target, ['Crash-bound shape'])).toHaveLength(1)
  })

  test('coalesces concurrent identical requests into one effect', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const gate = firstReceiptGate()
    const handleTool = createAutomationToolHandler(makeFigmaFromStore, {
      beforeMutationReceiptStorage: gate.hook
    })
    const request = createShapeRequest(
      store.state.sceneVersion,
      'request:concurrent-identical',
      'One coalesced shape'
    )

    const first = handleTool(target, request)
    await gate.entered
    const second = handleTool(target, request)
    gate.release()
    const [firstResult, secondResult] = (await Promise.all([first, second])) as [
      ToolMutationResult,
      ToolMutationResult
    ]

    expect(firstResult.result.id).toBe(secondResult.result.id)
    expect(namedChildren(target, ['One coalesced shape'])).toHaveLength(1)
    expect(mutationRequestLedgerState(target, 'request:concurrent-identical')).toMatchObject({
      status: 'stored'
    })
  })

  test('allows one same-ID payload winner and rejects the conflicting request', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const gate = firstReceiptGate()
    const handleTool = createAutomationToolHandler(makeFigmaFromStore, {
      beforeMutationReceiptStorage: gate.hook
    })
    const expectedRevision = store.state.sceneVersion
    const requestId = 'request:concurrent-conflict'

    const winner = handleTool(
      target,
      createShapeRequest(expectedRevision, requestId, 'Winning payload')
    )
    await gate.entered
    await expect(
      handleTool(target, createShapeRequest(expectedRevision, requestId, 'Conflicting payload'))
    ).rejects.toThrow('already applying a different mutation')
    gate.release()
    await winner

    expect(namedChildren(target, ['Winning payload', 'Conflicting payload'])).toHaveLength(1)
    expect(namedChildren(target, ['Winning payload'])).toHaveLength(1)
    expect(mutationRequestLedgerState(target, requestId)).toMatchObject({
      status: 'stored'
    })
  })

  test('applies one different-ID request and rejects the stale same-revision request', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const gate = firstReceiptGate()
    const handleTool = createAutomationToolHandler(makeFigmaFromStore, {
      beforeMutationReceiptStorage: gate.hook
    })
    const expectedRevision = store.state.sceneVersion

    const first = handleTool(
      target,
      createShapeRequest(expectedRevision, 'request:revision-winner', 'Revision winner')
    )
    await gate.entered
    const stale = handleTool(
      target,
      createShapeRequest(expectedRevision, 'request:revision-stale', 'Revision stale')
    )
    gate.release()
    const [winnerResult, staleResult] = (await Promise.all([first, stale])) as [
      ToolMutationResult,
      ToolMutationResult
    ]

    expect(winnerResult.result.mutation_receipt.status).toBe('applied')
    expect(staleResult.result).toMatchObject({
      applied: false,
      mutation_receipt: {
        reason: 'stale_board_revision',
        status: 'rejected'
      }
    })
    expect(namedChildren(target, ['Revision winner', 'Revision stale'])).toHaveLength(1)
    expect(namedChildren(target, ['Revision winner'])).toHaveLength(1)
    expect(mutationRequestLedgerState(target, 'request:revision-stale')).toEqual({
      status: 'missing'
    })
  })
})
