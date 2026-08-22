import { afterEach, describe, expect, test } from 'bun:test'

import { copyFills, copyStrokes } from '@open-pencil/scene-graph/copy'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import {
  enqueueAutomationMutation,
  resetAutomationMutationQueuesForTests
} from '@/app/automation/bridge/mutation-queue'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { createEditorStore } from '@/app/editor/session'

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    documentId: 'mutation-queue-test',
    documentName: 'Mutation queue test',
    pageId,
    pageName: page?.name ?? 'Page 1',
    store
  }
}

function mutationReceipt(result: unknown) {
  const response = result as {
    result: { mutation_receipt: { reason?: string; status: string } }
  }
  return response.result.mutation_receipt
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'window')
})

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

describe('OpenPencil automation mutation queue', () => {
  test('applies fresh fill and border edits in order and makes each one undoable', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const node = store.graph.createNode('RECTANGLE', target.pageId, { name: 'Patient card' })
    const originalFills = copyFills(node.fills)
    const originalStrokes = copyStrokes(node.strokes)
    const handleTool = createAutomationToolHandler(makeFigmaFromStore)
    const fillResult = await handleTool(target, {
      args: { color: '#7c3aed', id: node.id },
      mutation: {
        expectedRevision: store.state.sceneVersion,
        requestId: 'fill-request',
        traceId: 'trace-color'
      },
      name: 'set_fill'
    })
    const strokeResult = await handleTool(target, {
      args: { color: '#f5f3ff', id: node.id, weight: 2 },
      mutation: {
        expectedRevision: store.state.sceneVersion,
        requestId: 'stroke-request',
        traceId: 'trace-border'
      },
      name: 'set_stroke'
    })

    expect(mutationReceipt(fillResult).status).toBe('applied')
    expect(mutationReceipt(strokeResult).status).toBe('applied')
    expect(store.graph.getNode(node.id)?.fills).not.toEqual(originalFills)
    expect(store.graph.getNode(node.id)?.strokes).not.toEqual(originalStrokes)

    expect(store.undo.undo()).toBe('Agent: set_stroke')
    expect(store.graph.getNode(node.id)?.fills).not.toEqual(originalFills)
    expect(store.graph.getNode(node.id)?.strokes).toEqual(originalStrokes)
    expect(store.undo.undo()).toBe('Agent: set_fill')
    expect(store.graph.getNode(node.id)?.fills).toEqual(originalFills)
  })

  test('lets the newest pending request supersede an older request for the same property', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const node = store.graph.createNode('RECTANGLE', target.pageId, { name: 'Status card' })
    let releaseBlocker = () => undefined
    const blocked = new Promise<void>((resolve) => {
      releaseBlocker = resolve
    })
    const blocker = enqueueAutomationMutation({
      run: () => blocked,
      target,
      toolArgs: { id: node.id },
      toolName: 'set_stroke'
    })
    await Promise.resolve()
    const older = enqueueAutomationMutation({
      run: () => {
        store.graph.updateNode(node.id, {
          fills: [
            { color: { a: 1, b: 0.27, g: 0.27, r: 0.94 }, opacity: 1, type: 'SOLID', visible: true }
          ]
        })
      },
      target,
      toolArgs: { color: '#ef4444', id: node.id },
      toolName: 'set_fill'
    })
    const newer = enqueueAutomationMutation({
      run: () => {
        store.graph.updateNode(node.id, {
          fills: [
            { color: { a: 1, b: 0.37, g: 0.77, r: 0.13 }, opacity: 1, type: 'SOLID', visible: true }
          ]
        })
      },
      target,
      toolArgs: { color: '#22c55e', id: node.id },
      toolName: 'set_fill'
    })
    releaseBlocker()
    await blocker

    await expect(older).resolves.toMatchObject({
      receipt: {
        reason: 'superseded_by_newer_request',
        status: 'rejected'
      },
      status: 'rejected'
    })
    await expect(newer).resolves.toMatchObject({
      receipt: {
        status: 'applied'
      },
      status: 'applied'
    })
    expect((await older).receipt).toMatchObject({
      reason: 'superseded_by_newer_request',
      status: 'rejected'
    })
    const appliedColor = store.graph.getNode(node.id)?.fills[0]?.color
    expect(appliedColor?.g ?? 0).toBeGreaterThan(appliedColor?.r ?? 1)
  })

  test('rejects a queued edit when the user changes the same property first', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const node = store.graph.createNode('RECTANGLE', target.pageId, { name: 'Direct edit' })
    let releaseFirst: (() => void) | undefined
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const blocker = enqueueAutomationMutation({
      run: () => firstDone,
      target,
      toolArgs: { id: node.id },
      toolName: 'set_stroke'
    })
    const queued = enqueueAutomationMutation({
      run: () => 'agent fill',
      target,
      toolArgs: { color: '#000000', id: node.id },
      toolName: 'set_fill'
    })

    await Promise.resolve()
    store.graph.updateNode(node.id, {
      fills: [{ color: { a: 1, b: 0, g: 0, r: 1 }, opacity: 1, type: 'SOLID', visible: true }]
    })
    releaseFirst?.()
    await blocker

    expect(await queued).toMatchObject({
      receipt: { reason: 'touched_property_changed', status: 'rejected' },
      status: 'rejected'
    })
    expect(store.graph.getNode(node.id)?.fills[0]?.color).toMatchObject({ r: 1 })
  })
})
