import { afterEach, describe, expect, test } from 'bun:test'

import type { Rect } from '@open-pencil/scene-graph'

import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:native-text-edge-test'

function installBrowserFixture(): void {
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
    contentDocumentId: 'content-document:native-text-edge',
    documentId: 'document:native-text-edge',
    documentName: 'Native text edge document',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:native-text-edge'
  }
}

type ContextResult = {
  context_token: string
  revisions: { board: number }
}

function changeArgs(
  context: ContextResult,
  anchorId: string,
  requestId: string,
  text: string,
  visual = true
) {
  return {
    context_token: context.context_token,
    expected_revision: context.revisions.board,
    operation: {
      anchor_id: anchorId,
      artifact: { kind: 'native_text', max_width: 180, name: 'Native text proof', text },
      kind: 'artifact.create',
      placement: { clearance: 32 }
    },
    request_id: requestId,
    ...(visual ? { visual: { profile: 'local-legible-text-v1' } } : {})
  }
}

type NativeTextResult = {
  proof?: { error?: string; stage: string }
  readback?: {
    graph: { bounds: Rect; id: string; text: string }
    reconciliation?: { reasons: string[]; status: string }
  }
  receipt: { requestId: string }
  status: { command: string; mutation: string; reason?: string }
  visual?: { verification: { text_fits: boolean } }
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'window')
})

describe('OpenPencil native-text edge handling', () => {
  test('reports a changed live owner as unavailable on same-request replay', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID, {
      ensureFonts: () => Promise.resolve(true)
    })
    const context = (await handlers.context(target)) as ContextResult
    const args = changeArgs(context, anchorId, 'request:native-text-diverged', 'Original text')
    const applied = (await handlers.change(target, args)) as NativeTextResult
    const ownerId = applied.readback?.graph.id
    expect(ownerId).toBeString()
    if (!ownerId) throw new Error('Native text owner was not returned.')

    store.updateNodeWithUndo(ownerId, { text: 'User-edited text' }, 'Edit native text')
    const replayed = (await handlers.change(target, args)) as NativeTextResult

    expect(replayed.status).toMatchObject({
      command: 'unavailable',
      mutation: 'replayed',
      reason: 'native_text_reconciliation_failed'
    })
    expect(replayed.readback?.reconciliation).toEqual({
      reasons: ['text_changed'],
      status: 'diverged'
    })
  })

  test('bounds a stalled font proof and preserves the applied receipt', async () => {
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID, {
      ensureFonts: () =>
        new Promise<boolean>((resolve) => {
          void resolve
        }),
      fontProofTimeoutMs: 15
    })
    const context = (await handlers.context(target)) as ContextResult
    const result = (await handlers.change(
      target,
      changeArgs(context, anchorId, 'request:native-text-font-timeout', 'Timeout proof')
    )) as NativeTextResult

    expect(result.status).toMatchObject({
      command: 'unavailable',
      mutation: 'applied',
      reason: 'post_apply_proof_failed'
    })
    expect(result.proof).toEqual({
      error: 'Native text font proof timed out.',
      stage: 'font',
      status: 'error'
    })
    expect(result.receipt.requestId).toBe('request:native-text-font-timeout')
  })

  test('sizes long non-ASCII text with resolved typography and refuses clipped replay', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('TEXT', 40, 60, 180, 72)
    store.updateNodeWithUndo(
      anchorId,
      {
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: 2,
        lineHeight: 48,
        text: 'Typography anchor'
      },
      'Style native text anchor'
    )
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID, {
      ensureFonts: () => Promise.resolve(true)
    })
    const context = (await handlers.context(target)) as ContextResult
    const text = `${'漢字'.repeat(10)}\n${'مرحبا'.repeat(5)}`
    const args = changeArgs(context, anchorId, 'request:native-text-fit', text)
    const applied = (await handlers.change(target, args)) as NativeTextResult
    const ownerId = applied.readback?.graph.id
    expect(applied.status.command).toBe('completed')
    expect(applied.visual?.verification.text_fits).toBe(true)
    expect(applied.readback?.graph.bounds.height).toBeGreaterThanOrEqual(48 * 4)
    if (!ownerId) throw new Error('Native text owner was not returned.')

    store.updateNodeWithUndo(ownerId, { fontSize: 256 }, 'Force native text overflow')
    const replayed = (await handlers.change(target, args)) as NativeTextResult
    expect(replayed.status).toMatchObject({
      command: 'unavailable',
      mutation: 'replayed',
      reason: 'visual_verification_not_passed'
    })
    expect(replayed.visual?.verification.text_fits).toBe(false)
  })
})
