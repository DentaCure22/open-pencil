import { afterEach, describe, expect, test } from 'bun:test'

import type { Rect } from '@open-pencil/scene-graph'

import {
  cardReceiptEntry,
  createAutomationBoardHandlers,
  parseNativeCardOperation,
  requestNodes
} from '@/app/automation/bridge/board-tools'
import { createAutomationNativeCardChangeHandler } from '@/app/automation/bridge/board-tools/native/card-change'
import {
  RECEIPT_PLUGIN_ID,
  TEXT_RECEIPT_PLUGIN_KEY
} from '@/app/automation/bridge/board-tools/native/receipts'
import { boardViewportFocusBounds } from '@/app/automation/bridge/board-tools/neighborhood'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import { mutationRequestLedgerState } from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

const RUNTIME_ID = 'runtime:native-card-test'

test('normalizes a title-only native card with an empty body', () => {
  expect(
    parseNativeCardOperation({
      artifact: { kind: 'native_card', title: 'Title only' },
      kind: 'artifact.create',
      placement: { target: { kind: 'auto' } }
    }).body
  ).toBe('')
})

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
    documentId: 'document:native-card',
    documentName: 'Native card document',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:native-card'
  }
}

type Context = {
  context_token: string
  revisions: { board: number }
}

function context(value: unknown): Context {
  return value as Context
}

function cardArgs(value: Context, anchorId: string, requestId = 'request:native-card') {
  return {
    context_token: value.context_token,
    expected_revision: value.revisions.board,
    operation: {
      anchor_id: anchorId,
      artifact: {
        body: 'Turn a rough thought into a clear, editable Board artifact.',
        kind: 'native_card',
        name: 'Builder card',
        title: 'General builder',
        width: 360
      },
      kind: 'artifact.create',
      placement: {
        clearance: 40,
        preferred_directions: ['right', 'below', 'left', 'above']
      }
    },
    request_id: requestId,
    trace_id: 'trace:native-card',
    visual: { profile: 'local-legible-card-v1' }
  }
}

function freeCardArgs(
  value: Context,
  target:
    | { kind: 'auto' }
    | { kind: 'point'; x: number; y: number }
    | { kind: 'relative'; object_id: string }
    | {
        height: number
        kind: 'region'
        width: number
        x: number
        y: number
      },
  requestId = 'request:native-card-free'
) {
  const args = cardArgs(value, 'unused', requestId)
  delete (args.operation as { anchor_id?: string }).anchor_id
  args.operation.placement = { ...args.operation.placement, target }
  return args
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'window')
})

describe('OpenPencil native-card Board route', () => {
  test('auto-places inside the bounded live viewport without overlapping current content', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const viewport = boardViewportFocusBounds(target)
    const obstacleBounds = {
      height: 48,
      width: 48,
      x: viewport.x + viewport.width / 2 - 24,
      y: viewport.y + viewport.height / 2 - 24
    }
    store.createShape(
      'RECTANGLE',
      obstacleBounds.x,
      obstacleBounds.y,
      obstacleBounds.width,
      obstacleBounds.height
    )
    store.clearSelection()
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))

    const result = (await handlers.change(
      target,
      freeCardArgs(initialContext, { kind: 'auto' }, 'request:native-card-auto')
    )) as { readback: { card: { owner: { bounds: Rect; id: string } } } }
    const owner = store.graph.getNode(result.readback.card.owner.id)
    if (!owner) throw new Error('Expected the auto-placed card owner to exist.')

    expect(result.readback.card.owner.bounds.y).toBeGreaterThanOrEqual(
      obstacleBounds.y + obstacleBounds.height + 40
    )
    expect(result.readback.card.owner.bounds.x).toBeGreaterThanOrEqual(viewport.x)
    expect(result.readback.card.owner.bounds.y).toBeGreaterThanOrEqual(viewport.y)
    expect(
      result.readback.card.owner.bounds.x + result.readback.card.owner.bounds.width
    ).toBeLessThanOrEqual(viewport.x + viewport.width)
    expect(
      result.readback.card.owner.bounds.y + result.readback.card.owner.bounds.height
    ).toBeLessThanOrEqual(viewport.y + viewport.height)
    expect(cardReceiptEntry(owner)).toMatchObject({ placementTarget: { kind: 'auto' }, version: 2 })
  })

  test('creates at an exact free point without binding to the current selection', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const unrelatedId = store.createShape('ELLIPSE', 40, 60, 120, 80)
    store.select([unrelatedId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const point = { kind: 'point' as const, x: 840, y: 620 }

    const result = (await handlers.change(target, freeCardArgs(initialContext, point))) as {
      readback: { card: { owner: { bounds: Rect; id: string } } }
      status: { command: string; mutation: string }
    }

    expect(result.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(result.readback.card.owner.bounds.x).toBe(660)
    expect(result.readback.card.owner.bounds.y + result.readback.card.owner.bounds.height / 2).toBe(
      620
    )
    const owner = store.graph.getNode(result.readback.card.owner.id)
    expect(owner).toBeDefined()
    if (!owner) throw new Error('Expected the free-position card owner to exist.')
    expect(cardReceiptEntry(owner)).toMatchObject({ placementTarget: point, version: 2 })
  })

  test('places beside an exact object without binding to the current selection', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 300, 300, 200, 100)
    store.clearSelection()
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))

    const result = (await handlers.change(
      target,
      freeCardArgs(
        initialContext,
        { kind: 'relative', object_id: anchorId },
        'request:native-card-relative'
      )
    )) as { readback: { card: { owner: { bounds: Rect; id: string } } } }

    expect(result.readback.card.owner.bounds.x).toBe(540)
    expect(result.readback.card.owner.bounds.y).toBe(300)
    const owner = store.graph.getNode(result.readback.card.owner.id)
    expect(owner).toBeDefined()
    if (!owner) throw new Error('Expected the relative card owner to exist.')
    expect(cardReceiptEntry(owner)).toMatchObject({
      placementTarget: { kind: 'relative', objectId: anchorId },
      version: 2
    })
  })

  test('refuses a colliding exact point before reserving or mutating', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    store.createShape('RECTANGLE', 300, 300, 400, 300)
    store.clearSelection()
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const requestId = 'request:native-card-point-collision'
    const initialChildren = store.graph.getNode(target.pageId)?.childIds.length

    await expect(
      handlers.change(
        target,
        freeCardArgs(initialContext, { kind: 'point', x: 500, y: 450 }, requestId)
      )
    ).rejects.toThrow('No collision-free placement')
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(initialChildren)
    expect(mutationRequestLedgerState(target, requestId)).toEqual({ status: 'missing' })
    expect(requestNodes(target, requestId)).toHaveLength(0)
  })

  test('ignores an unrelated unreadable native receipt when resolving an exact request', () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const nodeId = store.createShape('RECTANGLE', 20, 20, 100, 100)
    const node = store.graph.getNode(nodeId)
    expect(node).toBeDefined()
    if (!node) throw new Error('Expected the receipt fixture node to exist.')
    store.updateNode(nodeId, {
      pluginData: [
        ...node.pluginData,
        {
          key: TEXT_RECEIPT_PLUGIN_KEY,
          pluginId: RECEIPT_PLUGIN_ID,
          value: '{not-json'
        }
      ]
    })

    expect(requestNodes(target, 'request:new-page')).toEqual([])
  })

  test('uses a bounded region deterministically when its center is occupied', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    store.createShape('RECTANGLE', 520, 360, 160, 180)
    store.clearSelection()
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const region = { height: 900, kind: 'region' as const, width: 1_200, x: 0, y: 0 }

    const result = (await handlers.change(
      target,
      freeCardArgs(initialContext, region, 'request:native-card-region')
    )) as { readback: { card: { owner: { bounds: Rect } } } }
    const bounds = result.readback.card.owner.bounds

    expect(bounds.x).toBeGreaterThanOrEqual(region.x)
    expect(bounds.y).toBeGreaterThanOrEqual(region.y)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(region.x + region.width)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(region.y + region.height)
    expect(bounds.x).toBe(820)
  })

  test('creates, verifies, replays, and restores one bounded native card through Undo/Redo', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    store.setPageColor({ a: 1, b: 0.11, g: 0.09, r: 0.07 })
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const args = cardArgs(initialContext, anchorId)

    const first = (await handlers.change(target, args)) as {
      context: Context
      presentation: { acknowledged: boolean; selected_ids: string[] }
      readback: {
        card: {
          body: { id: string; text: string; type: string }
          owner: { bounds: { x: number }; child_ids: string[]; id: string; type: string }
          reconciliation: { status: string }
          title: { id: string; text: string; type: string }
          visual: { body_contrast_ratio: number; status: string; title_contrast_ratio: number }
        }
      }
      receipt: { idempotent_replay: boolean; requestId: string }
      status: { command: string; mutation: string }
    }
    const card = first.readback.card

    expect(first.status).toEqual({
      attention_required: false,
      command: 'completed',
      mutation: 'applied'
    })
    expect(card.owner).toMatchObject({ type: 'FRAME', child_ids: [card.title.id, card.body.id] })
    expect(card.title).toMatchObject({ text: 'General builder', type: 'TEXT' })
    expect(card.body).toMatchObject({
      text: 'Turn a rough thought into a clear, editable Board artifact.',
      type: 'TEXT'
    })
    expect(card.reconciliation.status).toBe('current')
    expect(card.visual.status).toBe('passed')
    expect(card.visual.title_contrast_ratio).toBeGreaterThanOrEqual(4.5)
    expect(card.visual.body_contrast_ratio).toBeGreaterThanOrEqual(4.5)
    expect(first.presentation).toMatchObject({
      acknowledged: true,
      selected_ids: [card.owner.id]
    })
    const createdOwner = store.graph.getNode(card.owner.id)
    expect(createdOwner).toBeDefined()
    if (!createdOwner) throw new Error('Expected the native card owner to exist.')
    expect(cardReceiptEntry(createdOwner)).toMatchObject({
      bodyId: card.body.id,
      requestId: 'request:native-card',
      titleId: card.title.id
    })
    expect(requestNodes(target, 'request:native-card').map((node) => node.id)).toEqual([
      card.owner.id
    ])

    const topLevelCount = store.graph.getNode(target.pageId)?.childIds.length
    const replayContext = context(await handlers.context(target))
    const replay = (await handlers.change(target, {
      ...args,
      context_token: replayContext.context_token,
      expected_revision: replayContext.revisions.board
    })) as {
      context: Context
      readback: { card: { owner: { id: string } } }
      receipt: { idempotent_replay: boolean }
      status: { mutation: string }
    }
    expect(replay).toMatchObject({
      readback: { card: { owner: { id: card.owner.id } } },
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(topLevelCount)
    await expect(
      handlers.verify(target, {
        context_token: replay.context.context_token,
        request_id: 'request:native-card'
      })
    ).resolves.toMatchObject({
      readback: {
        nodes: [{ id: card.owner.id }, { id: card.title.id }, { id: card.body.id }]
      },
      status: 'matched'
    })

    expect(store.undo.undo()).toBe('Agent: create native card')
    expect(store.graph.getNode(card.owner.id)).toBeUndefined()
    expect(store.graph.getNode(card.title.id)).toBeUndefined()
    expect(store.graph.getNode(card.body.id)).toBeUndefined()

    expect(store.undo.redo()).toBe('Agent: create native card')
    const restoredOwner = store.graph.getNode(card.owner.id)
    expect(restoredOwner).toBeDefined()
    if (!restoredOwner) throw new Error('Expected Redo to restore the native card owner.')
    expect(restoredOwner.childIds).toEqual([card.title.id, card.body.id])
    expect(store.graph.getNode(card.title.id)?.text).toBe('General builder')
    expect(store.graph.getNode(card.body.id)?.text).toBe(
      'Turn a rough thought into a clear, editable Board artifact.'
    )
    expect(cardReceiptEntry(restoredOwner)).toMatchObject({
      bodyId: card.body.id,
      requestId: 'request:native-card',
      titleId: card.title.id
    })
    const restoredContext = context(await handlers.context(target))
    await expect(
      handlers.verify(target, {
        context_token: restoredContext.context_token,
        request_id: 'request:native-card'
      })
    ).resolves.toMatchObject({
      readback: {
        nodes: [{ id: card.owner.id }, { id: card.title.id }, { id: card.body.id }]
      },
      status: 'matched'
    })
  })

  test('reports a changed child as diverged and never creates a replacement', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const args = cardArgs(initialContext, anchorId, 'request:native-card-diverged')
    const first = (await handlers.change(target, args)) as {
      readback: { card: { body: { id: string }; owner: { id: string } } }
    }
    const ownerId = first.readback.card.owner.id
    store.updateNodeWithUndo(first.readback.card.body.id, { text: 'Locally changed' }, 'Edit card')
    store.select([anchorId])
    const fresh = context(await handlers.context(target))
    const count = store.graph.getNode(target.pageId)?.childIds.length

    const replay = await handlers.change(target, {
      ...args,
      context_token: fresh.context_token,
      expected_revision: fresh.revisions.board
    })

    expect(replay).toMatchObject({
      next_action: { command: 'board_verify', retry_mutation: false },
      proof: { reason: 'native_card_reconciliation_failed', status: 'partial' },
      readback: {
        card: {
          owner: { id: ownerId },
          reconciliation: { reasons: ['body_changed'], status: 'diverged' }
        }
      },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'native_card_reconciliation_failed'
      }
    })
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(count)
  })

  test('keeps a dense accepted card readable and fully inside its owner', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const args = cardArgs(initialContext, anchorId, 'request:native-card-dense-accepted')
    args.operation.artifact.title = 'T'.repeat(120)
    args.operation.artifact.body = 'a '.repeat(600)
    args.operation.artifact.width = 640

    const result = (await handlers.change(target, args)) as {
      readback: {
        card: {
          body: { bounds: Rect }
          owner: { bounds: Rect }
          reconciliation: { reasons: string[]; status: string }
          title: { bounds: Rect }
          visual: { status: string }
        }
      }
      status: { command: string; mutation: string }
    }
    const card = result.readback.card

    expect(result.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(card.reconciliation).toEqual({ reasons: [], status: 'current' })
    expect(card.visual.status).toBe('passed')
    expect(card.owner.bounds.height).toBeLessThanOrEqual(720)
    for (const text of [card.title, card.body]) {
      expect(text.bounds.x).toBeGreaterThanOrEqual(card.owner.bounds.x)
      expect(text.bounds.y).toBeGreaterThanOrEqual(card.owner.bounds.y)
      expect(text.bounds.x + text.bounds.width).toBeLessThanOrEqual(
        card.owner.bounds.x + card.owner.bounds.width + 0.01
      )
      expect(text.bounds.y + text.bounds.height).toBeLessThanOrEqual(
        card.owner.bounds.y + card.owner.bounds.height + 0.01
      )
    }
  })

  test('measures hard lines and non-ASCII text before reporting fixed text as visible', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID, {
      ensureFonts: () => Promise.resolve(true)
    })
    const initialContext = context(await handlers.context(target))
    const args = cardArgs(initialContext, anchorId, 'request:native-card-hard-lines')
    args.operation.artifact.body = Array.from(
      { length: 12 },
      (_value, index) => `${'界'.repeat(22)} 🦷 ${index + 1}`
    ).join('\n')
    args.operation.artifact.width = 240

    const result = (await handlers.change(target, args)) as {
      readback: {
        card: {
          body: { id: string }
          owner: { id: string }
          reconciliation: { reasons: string[]; status: string }
          visual: { status: string }
        }
      }
      status: { command: string; mutation: string }
    }
    const card = result.readback.card
    const body = store.graph.getNode(card.body.id)
    expect(body).toBeDefined()
    if (!body) throw new Error('Expected the native card body to exist.')

    expect(result.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(body.height).toBeGreaterThanOrEqual(12 * 2 * 20)
    expect(card.reconciliation).toEqual({ reasons: [], status: 'current' })
    expect(card.visual.status).toBe('passed')

    store.graph.updateNode(body.id, { height: body.height - 20 })
    store.select([anchorId])
    const replayContext = context(await handlers.context(target))
    const replay = await handlers.change(target, {
      ...args,
      context_token: replayContext.context_token,
      expected_revision: replayContext.revisions.board
    })

    expect(replay).toMatchObject({
      readback: {
        card: {
          owner: { id: card.owner.id },
          reconciliation: {
            reasons: expect.arrayContaining(['body_text_overflow']),
            status: 'diverged'
          },
          visual: { status: 'failed' }
        }
      },
      status: { mutation: 'replayed', reason: 'native_card_reconciliation_failed' }
    })
  })

  test('fails readback when card visibility, paint, opacity, or clipping diverges', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const args = cardArgs(initialContext, anchorId, 'request:native-card-visual-divergence')
    const first = (await handlers.change(target, args)) as {
      readback: { card: { body: { id: string }; owner: { id: string }; title: { id: string } } }
    }
    const { body, owner, title } = first.readback.card
    const ownerNode = store.graph.getNode(owner.id)
    expect(ownerNode).toBeDefined()
    if (!ownerNode) throw new Error('Expected the native card owner to exist.')
    store.graph.updateNode(owner.id, {
      clipsContent: true,
      fills: ownerNode.fills.map((fill) =>
        fill.type === 'SOLID' ? { ...fill, color: { ...fill.color, a: 0 } } : fill
      )
    })
    store.graph.updateNode(title.id, { opacity: 0 })
    store.graph.updateNode(body.id, { visible: false, x: ownerNode.width + 1 })
    store.select([anchorId])
    const fresh = context(await handlers.context(target))

    const replay = await handlers.change(target, {
      ...args,
      context_token: fresh.context_token,
      expected_revision: fresh.revisions.board
    })

    expect(replay).toMatchObject({
      readback: {
        card: {
          reconciliation: {
            reasons: expect.arrayContaining([
              'owner_clipping_changed',
              'owner_fill_missing',
              'title_transparent',
              'body_hidden',
              'body_out_of_bounds'
            ]),
            status: 'diverged'
          },
          visual: { status: 'failed' }
        }
      },
      status: { mutation: 'replayed', reason: 'native_card_reconciliation_failed' }
    })
  })

  test('does not poison a request ID when card planning fails before reservation', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.graph.updateNode(anchorId, { visible: false })
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const initialContext = context(await handlers.context(target))
    const requestId = 'request:native-card-preflight'
    const args = cardArgs(initialContext, anchorId, requestId)

    await expect(handlers.change(target, args)).rejects.toThrow(`Anchor "${anchorId}" is hidden.`)
    expect(mutationRequestLedgerState(target, requestId)).toEqual({ status: 'missing' })
    expect(requestNodes(target, requestId)).toHaveLength(0)

    store.graph.updateNode(anchorId, { visible: true })
    store.select([anchorId])
    const retryContext = context(await handlers.context(target))
    await expect(
      handlers.change(target, {
        ...args,
        context_token: retryContext.context_token,
        expected_revision: retryContext.revisions.board
      })
    ).resolves.toMatchObject({
      receipt: { requestId, status: 'applied' },
      status: { command: 'completed', mutation: 'applied' }
    })
  })

  test('rejects over-limit or over-height card content before mutation', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)

    for (const [requestId, body, width, message] of [
      ['request:native-card-body-limit', 'x'.repeat(1_201), 360, 'at most 1200 characters'],
      ['request:native-card-height-limit', 'x'.repeat(1_200), 240, 'measured height exceeds 720'],
      [
        'request:native-card-hard-line-height-limit',
        Array.from({ length: 34 }, (_value, index) => `行 ${index + 1} 🦷`).join('\n'),
        240,
        'measured height exceeds 720'
      ]
    ]) {
      const initialContext = context(await handlers.context(target))
      const args = cardArgs(initialContext, anchorId, requestId)
      args.operation.artifact.body = body
      args.operation.artifact.width = width
      const revision = store.state.sceneVersion
      const children = [...(store.graph.getNode(target.pageId)?.childIds ?? [])]
      const undoLabel = store.undo.undoLabel

      await expect(handlers.change(target, args)).rejects.toThrow(message)
      expect(store.state.sceneVersion).toBe(revision)
      expect(store.graph.getNode(target.pageId)?.childIds).toEqual(children)
      expect(store.undo.undoLabel).toBe(undoLabel)
      expect(mutationRequestLedgerState(target, requestId)).toEqual({ status: 'missing' })
      expect(requestNodes(target, requestId)).toHaveLength(0)
    }
  })

  test('keeps the applied receipt visible when font proof fails', async () => {
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const boardRevision = store.state.sceneVersion
    const handler = createAutomationNativeCardChangeHandler({
      async ensureFonts() {
        throw new Error('Font proof unavailable')
      },
      issueContext: () => ({ context_token: 'context:after' }),
      presentationFrame: () => Promise.resolve({ acknowledged: true }),
      requireContext(_target, rawArgs) {
        if (!isUnknownRecord(rawArgs)) throw new Error('Expected card change arguments')
        return { args: rawArgs, context: { boardRevision, selectedIds: [anchorId] } }
      }
    })

    const result = await handler(
      target,
      cardArgs(
        { context_token: 'context:before', revisions: { board: boardRevision } },
        anchorId,
        'request:native-card-font'
      )
    )

    expect(result).toMatchObject({
      next_action: {
        command: 'board_verify',
        request_id: 'request:native-card-font',
        retry_mutation: false
      },
      proof: { error: 'Font proof unavailable', stage: 'font', status: 'error' },
      receipt: { requestId: 'request:native-card-font', status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'post_apply_proof_failed'
      }
    })
    expect(requestNodes(target, 'request:native-card-font')).toHaveLength(1)
  })

  test('bounds a stalled font proof and returns the applied receipt promptly', async () => {
    const store = createEditorStore()
    const target = targetFor(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const boardRevision = store.state.sceneVersion
    const handler = createAutomationNativeCardChangeHandler({
      ensureFonts: () =>
        new Promise(() => {
          // Deliberately unresolved to exercise the bounded timeout.
        }),
      fontProofTimeoutMs: 15,
      issueContext: () => ({ context_token: 'context:after' }),
      presentationFrame: () => Promise.resolve({ acknowledged: true }),
      requireContext(_target, rawArgs) {
        if (!isUnknownRecord(rawArgs)) throw new Error('Expected card change arguments')
        return { args: rawArgs, context: { boardRevision, selectedIds: [anchorId] } }
      }
    })
    const startedAt = performance.now()

    const result = await handler(
      target,
      cardArgs(
        { context_token: 'context:before', revisions: { board: boardRevision } },
        anchorId,
        'request:native-card-font-timeout'
      )
    )

    expect(performance.now() - startedAt).toBeLessThan(250)
    expect(result).toMatchObject({
      next_action: {
        command: 'board_verify',
        request_id: 'request:native-card-font-timeout',
        retry_mutation: false
      },
      proof: {
        error: 'Native card font proof timed out.',
        stage: 'font',
        status: 'error'
      },
      receipt: { requestId: 'request:native-card-font-timeout', status: 'applied' },
      status: { mutation: 'applied', reason: 'post_apply_proof_failed' }
    })
  })
})
