import { afterEach, describe, expect, test } from 'bun:test'

import { deserializeSceneGraph, serializeSceneGraph } from '@open-pencil/core/kiwi'

import { createAutomationBoardBuildHandler } from '@/app/automation/bridge/board-build'
import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import {
  createAutomationCodeObjectRefineHandler,
  createAutomationCodeObjectCreateHandler,
  createAutomationCodeObjectReadHandler,
  createAutomationCodeObjectUpsertHandler,
  type AutomationCodeObjectCreateArgs,
  type AutomationCodeObjectCreateResult
} from '@/app/automation/bridge/code-object-handler'
import { codeObjectSourceHash } from '@/app/automation/bridge/code-object/source'
import { bindAutomationPersistence } from '@/app/automation/bridge/persistence'
import { mutationRequestLedgerState } from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import { setSmylrProductionDocumentWriteGuard } from '@/app/smylr-production/document-authority'

function target(): AutomationTarget {
  const store = createEditorStore()
  const page = store.graph.getNode(store.state.currentPageId)
  if (!page) throw new Error('Missing test page')
  return {
    documentId: 'document-1',
    documentName: 'Test document',
    pageId: page.id,
    pageName: page.name,
    store
  }
}

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

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'window')
})

function mutation(target: AutomationTarget, requestId: string) {
  return { expectedRevision: target.store.state.sceneVersion, requestId }
}

function createArgs(
  automationTarget: AutomationTarget,
  anchorId: string,
  requestId: string
): AutomationCodeObjectCreateArgs {
  return {
    anchor_id: anchorId,
    height: 520,
    mutation: {
      expected_revision: automationTarget.store.state.sceneVersion,
      request_id: requestId
    },
    name: 'Signal constellation',
    object_key: 'signal-constellation',
    persist: false,
    placement: {
      clearance: 48,
      preferred_directions: ['right', 'below', 'left', 'above']
    },
    props: { title: 'Signal constellation' },
    source:
      'export default function SignalConstellation() { return <main>Signal constellation</main> }',
    state: { selected: null },
    width: 720,
    zoom: false
  }
}

function anchorTarget(): { anchorId: string; automationTarget: AutomationTarget } {
  const automationTarget = target()
  const anchorId = automationTarget.store.createShape(
    'RECTANGLE',
    100,
    100,
    160,
    120,
    automationTarget.pageId
  )
  automationTarget.store.createShape('RECTANGLE', 308, 100, 720, 520, automationTarget.pageId)
  automationTarget.store.select([anchorId])
  automationTarget.store.undo.clear()
  return { anchorId, automationTarget }
}

describe('Code Object automation', () => {
  test('creates directly on an empty Board from an explicit free-placement target', async () => {
    installBrowserFixture()
    const automationTarget = target()
    const create = createAutomationCodeObjectCreateHandler()
    const base = createArgs(automationTarget, 'unused', 'request:create-free-code-object')
    const created = await create(automationTarget, {
      ...base,
      anchor_id: undefined,
      placement: { ...base.placement, target: { kind: 'auto' } }
    })

    expect(created).toMatchObject({
      placement: { algorithm: 'nearest-free/v1', rejectedCandidates: 0 },
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
    expect(automationTarget.store.graph.getNode(created.owner_id)).toMatchObject({
      height: 520,
      type: 'FRAME',
      width: 720
    })
  })

  test('creates once with anchored collision-free placement and replays across reload', async () => {
    const { anchorId, automationTarget } = anchorTarget()
    const create = createAutomationCodeObjectCreateHandler()
    const args = createArgs(automationTarget, anchorId, 'request:create-signal-constellation')

    const created = await create(automationTarget, args)
    expect(created).toMatchObject({
      receipt: {
        history_label: 'Create code object',
        idempotent_replay: false,
        product_grade_path: true
      },
      readback: {
        code_object: {
          component: {
            object_key: 'signal-constellation',
            source_hash: expect.stringMatching(/^sha256:/)
          },
          reconciliation: { reasons: [], status: 'current' }
        }
      },
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
    expect(created.placement?.rejectedCandidates).toBeGreaterThan(0)
    expect(automationTarget.store.undo.undoLabel).toBe('Create code object')
    const ownerId = created.owner_id
    expect(automationTarget.store.graph.getNode(ownerId)?.type).toBe('FRAME')

    const reloadedGraph = deserializeSceneGraph(
      structuredClone(serializeSceneGraph(automationTarget.store.graph))
    )
    const reloadedStore = createEditorStore(reloadedGraph)
    const reloadedPage = reloadedStore.graph.getNode(automationTarget.pageId)
    if (!reloadedPage) throw new Error('Reloaded test page is missing')
    const reloadedTarget: AutomationTarget = {
      documentId: automationTarget.documentId,
      documentName: automationTarget.documentName,
      pageId: automationTarget.pageId,
      pageName: reloadedPage.name,
      store: reloadedStore
    }
    const replayed = await create(reloadedTarget, args)
    expect(replayed).toMatchObject({
      owner_id: ownerId,
      receipt: { idempotent_replay: true },
      readback: { code_object: { reconciliation: { status: 'current' } } },
      status: { attention_required: false, command: 'completed', mutation: 'replayed' }
    })
    expect(
      reloadedStore.graph
        .getChildren(reloadedTarget.pageId)
        .filter((node) => codeObjectDocument(node)?.definitionId === 'signal-constellation')
    ).toHaveLength(1)

    await expect(
      create(reloadedTarget, {
        ...args,
        name: 'Changed payload'
      })
    ).rejects.toThrow('different mutation')
    expect(
      reloadedStore.graph
        .getChildren(reloadedTarget.pageId)
        .filter((node) => codeObjectDocument(node)?.definitionId === 'signal-constellation')
    ).toHaveLength(1)
  })

  test('keeps a historical receipt missing after Undo without recreating', async () => {
    const { anchorId, automationTarget } = anchorTarget()
    const create = createAutomationCodeObjectCreateHandler()
    const args = createArgs(automationTarget, anchorId, 'request:create-then-undo')
    const created = await create(automationTarget, args)

    expect(automationTarget.store.undo.undo()).toBe('Create code object')
    expect(automationTarget.store.graph.getNode(created.owner_id)).toBeUndefined()
    const replayed = await create(automationTarget, args)
    expect(replayed).toMatchObject({
      owner_id: created.owner_id,
      receipt: { historical_only: true, idempotent_replay: true },
      readback: { code_object: { reconciliation: { status: 'missing' } } },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'historical_receipt_only'
      }
    })
    expect(automationTarget.store.graph.getNode(created.owner_id)).toBeUndefined()
  })

  test('rejects blocked ambient and network source before reservation or mutation', async () => {
    const { anchorId, automationTarget } = anchorTarget()
    const create = createAutomationCodeObjectCreateHandler()
    const revision = automationTarget.store.state.sceneVersion
    const blockedSources = [
      ['dynamic-import', 'import("./remote")'],
      ['eval', 'eval("1 + 1")'],
      ['function', 'new Function("return 1")'],
      ['fetch', 'fetch("https://example.com")'],
      ['xhr', 'new XMLHttpRequest()'],
      ['websocket', 'new WebSocket("wss://example.com")'],
      ['worker', 'new Worker("worker.js")'],
      ['window', 'window.location.href'],
      ['document', 'document.body'],
      ['global', 'globalThis.crypto'],
      ['navigator', 'navigator.userAgent'],
      ['local-storage', 'localStorage.getItem("x")'],
      ['session-storage', 'sessionStorage.getItem("x")'],
      ['indexed-db', 'indexedDB.open("x")']
    ] as const

    for (const [label, statement] of blockedSources) {
      const requestId = `request:blocked-${label}`
      const args = createArgs(automationTarget, anchorId, requestId)
      await expect(
        create(automationTarget, {
          ...args,
          source: `${statement}; export default function Bad() { return <div /> }`
        })
      ).rejects.toThrow('blocked ambient capability')
      expect(mutationRequestLedgerState(automationTarget, requestId)).toEqual({ status: 'missing' })
    }
    expect(
      codeObjectDocument(automationTarget.store.graph.getChildren(automationTarget.pageId)[2])
    ).toBeNull()
    expect(automationTarget.store.state.sceneVersion).toBe(revision)
  })

  test('rejects compile errors before reservation or mutation', async () => {
    const { anchorId, automationTarget } = anchorTarget()
    const create = createAutomationCodeObjectCreateHandler()
    const requestId = 'request:invalid-tsx'
    const args = createArgs(automationTarget, anchorId, requestId)
    const revision = automationTarget.store.state.sceneVersion

    await expect(
      create(automationTarget, {
        ...args,
        source: 'export default function Broken( { return <div /> }'
      })
    ).rejects.toThrow('trusted compile preflight')
    expect(mutationRequestLedgerState(automationTarget, requestId)).toEqual({ status: 'missing' })
    expect(automationTarget.store.state.sceneVersion).toBe(revision)
  })

  test('upserts by stable identity and returns canonical native readback', async () => {
    const automationTarget = target()
    const upsert = createAutomationCodeObjectUpsertHandler()
    const read = createAutomationCodeObjectReadHandler()
    const created = await upsert(automationTarget, {
      mutation: mutation(automationTarget, 'request:create-agent-metric'),
      name: 'Agent metric',
      object_key: 'agent-metric',
      props: { label: 'Throughput' },
      source: 'export default function Metric() { return <strong>Fast</strong> }',
      state: { value: 12 },
      width: 640,
      height: 360,
      zoom_to_selection: false
    })
    expect(created).toMatchObject({
      applied: true,
      component: {
        definition_id: 'agent-metric',
        name: 'Agent metric',
        props: { label: 'Throughput' },
        state: { value: 12 }
      },
      frame: { height: 360, name: 'Agent metric', type: 'FRAME', width: 640 },
      mutation_receipt: { status: 'applied' }
    })
    const frameId = (created as { frame: { id: string } }).frame.id

    const updated = await upsert(automationTarget, {
      mutation: mutation(automationTarget, 'request:update-agent-metric'),
      name: 'Agent metric',
      object_key: 'agent-metric',
      props: { label: 'Throughput' },
      source: 'export default function Metric() { return <strong>Updated</strong> }',
      state: { value: 24 },
      x: 220,
      y: 180,
      zoom_to_selection: false
    })
    expect(updated).toMatchObject({
      applied: true,
      frame: { id: frameId, x: 220, y: 180 }
    })

    const inspected = await read(automationTarget, { object_key: 'agent-metric' })
    const updatedSource = 'export default function Metric() { return <strong>Updated</strong> }'
    const updatedSourceHash = await codeObjectSourceHash(updatedSource)
    expect(inspected).toMatchObject({
      board_build_refine_recipe_base: {
        expected_source_hash: updatedSourceHash,
        kind: 'code_object',
        object_key: 'agent-metric',
        operation: 'refine',
        owner_id: frameId,
        source_format: 'tsx'
      },
      component: {
        definition_id: 'agent-metric',
        source_hash: updatedSourceHash,
        source_length: updatedSource.length,
        state: { value: 24 }
      },
      frame: { id: frameId }
    })
    expect(
      Object.keys(
        (inspected as { board_build_refine_recipe_base: Record<string, unknown> })
          .board_build_refine_recipe_base
      ).sort()
    ).toEqual([
      'expected_source_hash',
      'kind',
      'object_key',
      'operation',
      'owner_id',
      'source_format'
    ])
    expect(await read(automationTarget, { owner_id: frameId })).toMatchObject({
      component: {
        definition_id: 'agent-metric',
        source_hash: updatedSourceHash
      },
      frame: { id: frameId }
    })
    await expect(
      read(automationTarget, { object_key: 'agent-metric', owner_id: frameId })
    ).rejects.toThrow('exactly one')
    expect(codeObjectDocument(automationTarget.store.graph.getNode(frameId))?.component).toBe(
      'user-code'
    )

    expect(automationTarget.store.undo.undo()).toBe('Update Code Object')
    expect(codeObjectDocument(automationTarget.store.graph.getNode(frameId))?.source).toContain(
      'Fast'
    )
    expect(automationTarget.store.undo.redo()).toBe('Update Code Object')
    expect(codeObjectDocument(automationTarget.store.graph.getNode(frameId))?.source).toContain(
      'Updated'
    )
    expect(automationTarget.store.graph.getNode(frameId)?.id).toBe(frameId)
  })

  test('refines from the two copy-ready Board and exact-owner response packets', async () => {
    installBrowserFixture()
    const runtimeId = 'runtime:copy-ready-code-object-refine'
    const automationTarget = target()
    automationTarget.contentDocumentId = 'content-document:copy-ready-code-object-refine'
    automationTarget.runtimeInstanceId = runtimeId
    automationTarget.workspaceId = 'workspace:copy-ready-code-object-refine'
    const upsert = createAutomationCodeObjectUpsertHandler()
    const read = createAutomationCodeObjectReadHandler()
    const refine = createAutomationCodeObjectRefineHandler()
    const initialSource = 'export default function Metric() { return <strong>Initial</strong> }'
    const created = (await upsert(automationTarget, {
      mutation: mutation(automationTarget, 'request:create-copy-ready-refine'),
      name: 'Copy-ready metric',
      object_key: 'copy-ready-metric',
      source: initialSource,
      zoom_to_selection: false
    })) as { frame: { id: string } }
    automationTarget.store.undo.clear()
    bindAutomationPersistence(automationTarget.store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:copy-ready-refine',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const board = createAutomationBoardHandlers(runtimeId)
    const context = (await board.context(automationTarget)) as {
      board_build_base: Record<string, unknown>
    }
    const ownerRead = (await read(automationTarget, { owner_id: created.frame.id })) as {
      board_build_refine_recipe_base: Record<string, unknown>
    }
    const replacementSource =
      'export default function Metric() { return <strong>Refined safely</strong> }'
    const build = createAutomationBoardBuildHandler({
      board,
      codeObjectRead: read,
      codeObjectRefine: refine,
      mermaid: () => Promise.reject(new Error('Unexpected Mermaid call.')),
      mermaidSource: () => Promise.reject(new Error('Unexpected Mermaid source call.'))
    })

    const result = await build(automationTarget, {
      ...context.board_build_base,
      intent: 'Refine the current Code Object from exact prerequisite reads',
      recipe: {
        ...ownerRead.board_build_refine_recipe_base,
        source: replacementSource
      },
      request_id: 'request:copy-ready-code-object-refine'
    })

    expect(result).toMatchObject({
      build: { route: { id: 'code-object/tsx-refine/v1' } },
      owner_id: created.frame.id,
      persistence: { status: 'durable' },
      status: { command: 'completed', mutation: 'applied' }
    })
    expect(codeObjectDocument(automationTarget.store.graph.getNode(created.frame.id))?.source).toBe(
      replacementSource
    )
    expect(automationTarget.store.undo.undo()).toBe('Refine code object')
    expect(codeObjectDocument(automationTarget.store.graph.getNode(created.frame.id))?.source).toBe(
      initialSource
    )
  })

  test('refuses viewer mutation while preserving read-only inspection', async () => {
    const automationTarget = target()
    const upsert = createAutomationCodeObjectUpsertHandler()
    const read = createAutomationCodeObjectReadHandler()
    const created = await upsert(automationTarget, {
      mutation: mutation(automationTarget, 'request:create-before-viewer'),
      name: 'Read-only proof',
      object_key: 'read-only-proof',
      source: 'export default function Proof() { return <div>Still readable</div> }',
      zoom_to_selection: false
    })
    const frameId = (created as { frame: { id: string } }).frame.id
    const revision = automationTarget.store.state.sceneVersion
    setSmylrProductionDocumentWriteGuard(automationTarget.store, () => false)

    await expect(
      upsert(automationTarget, {
        mutation: { expectedRevision: revision, requestId: 'request:viewer-denied' },
        name: 'Must not update',
        object_key: 'read-only-proof',
        source: 'export default function Proof() { return <div>Mutated</div> }'
      })
    ).rejects.toThrow('view-only')

    const viewerRead = (await read(automationTarget, {
      object_key: 'read-only-proof'
    })) as Record<string, unknown>
    expect(viewerRead).toMatchObject({
      component: {
        definition_id: 'read-only-proof',
        source: expect.stringContaining('Still readable')
      },
      frame: { id: frameId }
    })
    expect(viewerRead).not.toHaveProperty('board_build_refine_recipe_base')
    expect(automationTarget.store.state.sceneVersion).toBe(revision)
  })

  test('rejects a stale revision before creating a Code Object', async () => {
    const automationTarget = target()
    const upsert = createAutomationCodeObjectUpsertHandler()
    const revision = automationTarget.store.state.sceneVersion

    const result = await upsert(automationTarget, {
      mutation: {
        expectedRevision: revision + 1,
        requestId: 'request:stale-code-object'
      },
      name: 'Stale Code Object',
      object_key: 'stale-code-object',
      source: 'export default function Stale() { return <div>Never created</div> }',
      zoom_to_selection: false
    })

    expect(result).toMatchObject({
      applied: false,
      mutation_receipt: {
        reason: 'stale_board_revision',
        requestId: 'request:stale-code-object',
        status: 'rejected'
      }
    })
    expect(automationTarget.store.graph.getChildren(automationTarget.pageId)).toEqual([])
    expect(automationTarget.store.state.sceneVersion).toBe(revision)
  })
})
