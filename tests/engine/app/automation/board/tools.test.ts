import { afterEach, describe, expect, test } from 'bun:test'

import type { Rect } from '@open-pencil/scene-graph'
import {
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  setObjectGraphConnectionsOnPage
} from '@open-pencil/scene-graph'

import { createAutomationBoardHandlers, requestNodes } from '@/app/automation/bridge/board-tools'
import { createAutomationBoardChangeHandler } from '@/app/automation/bridge/board-tools/change-handler'
import { waitForConnectionVisualProof } from '@/app/automation/bridge/board-tools/connect-visual-proof'
import {
  parseConnectObjectsInput,
  parseConnectObjectsInputStructure
} from '@/app/automation/bridge/board-tools/object-graph'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import { bindAutomationPersistence } from '@/app/automation/bridge/persistence'
import {
  mutationRequestSignature,
  recordMutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'
import { connectObjects } from '@/app/object-graph'
import { setSmylrProductionDocumentWriteGuard } from '@/app/smylr-production/document-state'

const RUNTIME_ID = 'runtime:board-tools-test'

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

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    contentDocumentId: 'content-document:board-tools',
    documentId: 'board-tools-document',
    documentName: 'Board tools document',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:board-tools'
  }
}

function contextResult(value: unknown) {
  return value as {
    board_build_base: {
      content_document_id: string
      context_token: string
      contract: 'board-build/v1'
      document_id: string
      expected_revision: number
      page_id: string
      runtime_instance_id: string
      workspace_id: string
    }
    connect_objects_base: {
      content_document_id: string
      context_token: string
      document_id: string
      expected_revision: number
      page_id: string
      runtime_instance_id: string
      workspace_id: string
    }
    context_token: string
    revisions: { board: number }
    runtime: { instance_id: string }
  }
}

function changeArgs(
  context: ReturnType<typeof contextResult>,
  anchorId: string,
  requestId: string,
  options: { fontSize?: number; visual?: boolean } = {}
) {
  return {
    context_token: context.context_token,
    expected_revision: context.revisions.board,
    operation: {
      anchor_id: anchorId,
      artifact: {
        kind: 'native_text',
        name: 'Agent note',
        text: 'Trace-linked evidence',
        ...(options.fontSize === undefined ? {} : { font_size: options.fontSize })
      },
      kind: 'artifact.create',
      placement: { clearance: 32 }
    },
    request_id: requestId,
    ...(options.visual ? { visual: { profile: 'local-legible-text-v1' } } : {})
  }
}

test('requires explicit safe automatic behavior at the public connection boundary', () => {
  const connection = {
    kind: 'visual',
    source_id: 'node:source',
    target_id: 'node:target'
  }

  expect(parseConnectObjectsInput(connection)).toMatchObject({ kind: 'visual' })
  expect(parseConnectObjectsInput({ ...connection, automatic: false })).toMatchObject({
    automatic: false,
    kind: 'visual'
  })
  expect(() => parseConnectObjectsInput({ ...connection, automatic: true })).toThrow(
    'visual connections cannot be automatic'
  )
  for (const kind of ['data', 'action'] as const) {
    expect(() => parseConnectObjectsInput({ ...connection, kind })).toThrow(
      'requires explicit automatic true or false'
    )
    expect(parseConnectObjectsInput({ ...connection, automatic: false, kind })).toMatchObject({
      automatic: false,
      kind
    })
    expect(parseConnectObjectsInput({ ...connection, automatic: true, kind })).toMatchObject({
      automatic: true,
      kind
    })
  }
})

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'window')
})

describe('OpenPencil semantic Board tools', () => {
  test('creates one native text object with collision-free placement, readback, and one-step Undo', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.createShape('RECTANGLE', 192, 60, 160, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    expect(context).toMatchObject({
      board_build_base: {
        content_document_id: 'content-document:board-tools',
        context_token: context.context_token,
        contract: 'board-build/v1',
        document_id: 'board-tools-document',
        expected_revision: context.revisions.board,
        page_id: target.pageId,
        runtime_instance_id: RUNTIME_ID,
        workspace_id: 'workspace:board-tools'
      },
      connect_objects_base: {
        content_document_id: 'content-document:board-tools',
        context_token: context.context_token,
        document_id: 'board-tools-document',
        expected_revision: context.revisions.board,
        page_id: target.pageId,
        runtime_instance_id: RUNTIME_ID,
        workspace_id: 'workspace:board-tools'
      }
    })
    expect(context.board_build_base).not.toHaveProperty('anchor_id')
    expect(context.board_build_base).not.toHaveProperty('request_id')
    expect(context.connect_objects_base).not.toHaveProperty('contract')
    for (const staticPolicyField of [
      'recommended_recipe',
      'recipe_templates',
      'routing_hints',
      'specialist_recommendations',
      'suggested_modality',
      'supported_recipe_examples'
    ]) {
      expect(context).not.toHaveProperty(staticPolicyField)
    }
    expect((await handlers.context(target)) as { capabilities: string[] }).toMatchObject({
      capabilities: [
        'board.read.selection',
        'board.read.page',
        'board.read.objects',
        'board.build.native_text',
        'board.build.native_card',
        'board.build.plan.v1',
        'board.build.plan.grid.v1',
        'board.build.plan.flow.v1',
        'board.build.native_diagram.mermaid',
        'board.build.code_object.tsx.create',
        'board.build.code_object.tsx.refine',
        'board.change.artifact.create.native_text',
        'board.change.artifact.create.native_text.visual.local_legible_text_v1',
        'board.change.artifact.create.native_card',
        'board.change.artifact.create.native_card.visual.local_legible_card_v1',
        'board.change.object.update',
        'board.change.object.move',
        'board.change.object.resize',
        'board.change.object.delete',
        'board.change.object.duplicate',
        'board.change.object_graph.connect',
        'board.present',
        'board.verify.request'
      ]
    })

    const result = (await handlers.change(
      target,
      changeArgs(context, anchorId, 'request:native-text')
    )) as {
      context: ReturnType<typeof contextResult>
      presentation: { acknowledged: boolean; selected_ids: string[] }
      readback: {
        graph: {
          bounds: Rect
          id: string
          text: string
          type: string
        }
      }
      receipt: {
        idempotent_replay: boolean
        placement: { rejectedCandidates: number }
        requestId: string
      }
      status: { command: string; mutation: string }
    }

    expect(context.runtime.instance_id).toBe(RUNTIME_ID)
    expect(result.status).toEqual({
      attention_required: false,
      command: 'completed',
      mutation: 'applied'
    })
    expect(result.context.board_build_base).toMatchObject({
      context_token: result.context.context_token,
      expected_revision: result.context.revisions.board
    })
    expect(result.context.context_token).not.toBe(context.context_token)
    expect(result.context.revisions.board).toBeGreaterThan(context.revisions.board)
    expect(result.readback.graph).toMatchObject({
      text: 'Trace-linked evidence',
      type: 'TEXT'
    })
    expect(result.readback.graph.bounds).toMatchObject({ x: 192 })
    expect(result.readback.graph.bounds.y).toBeGreaterThanOrEqual(172)
    expect(result.receipt).toMatchObject({
      idempotent_replay: false,
      requestId: 'request:native-text'
    })
    expect(result.receipt.placement.rejectedCandidates).toBeGreaterThan(0)
    expect(result.presentation).toMatchObject({
      acknowledged: true,
      selected_ids: [result.readback.graph.id]
    })
    expect('visual' in result).toBe(false)
    expect(store.graph.getNode(result.readback.graph.id)?.fills[0]?.color).toMatchObject({
      b: 0,
      g: 0,
      r: 0
    })
    expect(store.undo.undo()).toBe('Agent: create native text')
    expect(store.graph.getNode(result.readback.graph.id)).toBeUndefined()
  })

  test('requires fresh returned context before an optional post-build connection', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    bindAutomationPersistence(store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:post-build-connect',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const buildContext = contextResult(await handlers.context(target))
    const buildResult = (await handlers.change(
      target,
      changeArgs(buildContext, anchorId, 'request:build-before-connect')
    )) as {
      context: ReturnType<typeof contextResult>
      readback: { graph: { id: string } }
    }
    const connectionArgs = {
      context_token: buildContext.context_token,
      expected_revision: buildContext.revisions.board,
      kind: 'visual',
      request_id: 'request:post-build-connect',
      source_id: anchorId,
      target_id: buildResult.readback.graph.id
    }

    await expect(handlers.connect(target, connectionArgs)).rejects.toThrow(
      'Board revision is stale. Reacquire context before changing the Board.'
    )
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(0)

    await expect(
      handlers.connect(target, {
        ...connectionArgs,
        context_token: buildResult.context.context_token,
        expected_revision: buildResult.context.revisions.board
      })
    ).resolves.toMatchObject({
      readback: {
        object_graph_connection: {
          sourceNodeId: anchorId,
          targetNodeId: buildResult.readback.graph.id
        },
        object_graph_visual: { status: 'headless_unavailable' }
      },
      status: {
        command: 'unavailable',
        mutation: 'applied',
        reason: 'connector_visual_not_acknowledged'
      }
    })
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(1)
  })

  test('keeps an applied connector receipt and persistence when its React Flow edge is not mounted', async () => {
    installBrowserFixture()
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: {},
        defaultView: { getComputedStyle: () => ({}) },
        querySelector: () => null,
        querySelectorAll: () => [],
        visibilityState: 'visible'
      }
    })
    const store = createEditorStore()
    const target = automationTarget(store)
    const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const targetId = store.createShape('RECTANGLE', 360, 60, 120, 80)
    bindAutomationPersistence(store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:connector-visual-proof',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    const args = {
      context_token: context.context_token,
      expected_revision: context.revisions.board,
      kind: 'visual',
      label: 'Explains',
      request_id: 'request:connector-visual-proof',
      source_id: sourceId,
      target_id: targetId
    }

    const result = (await handlers.connect(target, args)) as {
      next_action: { request_id: string; retry_mutation: boolean }
      persistence: { status: string }
      proof: { reason: string; stage: string; status: string }
      readback: {
        object_graph_connection: { id: string }
        object_graph_visual: { reasons: string[]; status: string }
      }
      receipt: { requestId: string; status: string }
      status: { attention_required: boolean; command: string; mutation: string; reason: string }
    }

    expect(result).toMatchObject({
      next_action: { request_id: args.request_id, retry_mutation: false },
      persistence: { status: 'durable' },
      proof: {
        reason: 'connector_visual_not_acknowledged',
        stage: 'presentation',
        status: 'partial'
      },
      readback: { object_graph_visual: { reasons: ['edge_not_mounted'], status: 'missing' } },
      receipt: { requestId: args.request_id, status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'connector_visual_not_acknowledged'
      }
    })
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(1)

    const replayContext = contextResult(await handlers.context(target))
    const replay = (await handlers.connect(target, {
      ...args,
      context_token: replayContext.context_token,
      expected_revision: replayContext.revisions.board
    })) as { receipt: { idempotent_replay: boolean }; status: { mutation: string } }
    expect(replay).toMatchObject({
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(1)
  })

  test('acknowledges the exact mounted built-in React Flow path in the connect response', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const targetId = store.createShape('RECTANGLE', 360, 60, 120, 80)
    bindAutomationPersistence(store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:connector-mounted-proof',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const expectedPath = 'M160,100 C260,100 260,100 360,100'
    const path = Object.assign(Object.create(null) as SVGPathElement, {
      getAttribute: (name: string) => (name === 'd' ? expectedPath : null),
      getTotalLength: () => 200,
      isConnected: true,
      tagName: 'path'
    })
    const edge = Object.assign(Object.create(null) as SVGGElement, {
      getAttribute: (name: string) =>
        name === 'data-id'
          ? (objectGraphConnectionsOnPage(store.graph, target.pageId)[0]?.id ?? null)
          : null,
      isConnected: true,
      querySelector: (selector: string) => (selector === '.react-flow__edge-path' ? path : null),
      tagName: 'g'
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: {},
        defaultView: {
          getComputedStyle: (element: Element) => ({
            display: 'block',
            opacity: '1',
            stroke: element === path ? '#b1b1b7' : 'none',
            strokeOpacity: '1',
            strokeWidth: element === path ? '1px' : '0px',
            visibility: 'visible'
          })
        },
        querySelector: () => null,
        querySelectorAll: (selector: string) =>
          selector === '.react-flow__edge[data-id]' ? [edge] : [],
        visibilityState: 'visible'
      }
    })
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const result = (await handlers.connect(target, {
      context_token: context.context_token,
      expected_revision: context.revisions.board,
      kind: 'visual',
      label: 'Explains',
      request_id: 'request:connector-mounted-proof',
      source_id: sourceId,
      target_id: targetId
    })) as {
      readback: {
        object_graph_visual: {
          expected_path: string
          path_visible: boolean
          rendered_path: string
          status: string
        }
      }
      status: { attention_required: boolean; command: string; mutation: string }
    }

    expect(result).toMatchObject({
      readback: {
        object_graph_visual: {
          expected_path: expectedPath,
          path_visible: true,
          rendered_path: expectedPath,
          status: 'rendered'
        }
      },
      status: { attention_required: false, command: 'completed', mutation: 'applied' }
    })
  })

  test('bounds connector visual proof when animation frames never fire', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const targetId = store.createShape('RECTANGLE', 360, 60, 120, 80)
    const connection = connectObjects(store, {
      kind: 'visual',
      label: 'Bounded proof',
      sourceNodeId: sourceId,
      targetNodeId: targetId
    })
    if (!connection) throw new Error('Connection was not created')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        body: {},
        defaultView: { getComputedStyle: () => ({}) },
        querySelectorAll: () => [],
        visibilityState: 'visible'
      }
    })
    let cancelledFrames = 0
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: () => 1
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: () => {
        cancelledFrames += 1
      }
    })

    const started = performance.now()
    const proof = await waitForConnectionVisualProof(
      store.graph,
      store.state.currentPageId,
      connection
    )
    const duration = performance.now() - started

    expect(proof).toMatchObject({ reasons: ['edge_not_mounted'], status: 'missing' })
    expect(duration).toBeLessThan(150)
    expect(cancelledFrames).toBe(2)
  })

  test('bounds large selection summaries and explicit reads without weakening full guards', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const selection = Array.from({ length: 105 }, (_, index) =>
      store.createShape('RECTANGLE', index * 16, 60, 12, 12)
    )
    store.select(selection)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = (await handlers.context(target)) as ReturnType<typeof contextResult> & {
      selection: Array<{ id: string }>
      selection_summary: {
        byte_limit: number
        count: number
        limit: number
        omitted: {
          child_ids: number
          name_bytes: number | null
          name_code_units: number
          nodes: number
          text_bytes: number | null
          text_code_units: number
        }
        payload_bytes: number
        returned: number
        truncated: boolean
      }
    }
    const repeated = (await handlers.context(target)) as { selection: Array<{ id: string }> }

    expect(context.selection.map(({ id }) => id)).toEqual(
      selection.slice(0, context.selection_summary.returned)
    )
    expect(repeated.selection).toEqual(context.selection)
    expect(context.selection_summary.byte_limit).toBe(8_192)
    expect(context.selection_summary.count).toBe(105)
    expect(context.selection_summary.limit).toBe(25)
    expect(context.selection_summary.returned).toBeLessThanOrEqual(25)
    expect(context.selection_summary.omitted).toEqual({
      child_ids: 0,
      name_bytes: 0,
      name_code_units: 0,
      nodes: 105 - context.selection_summary.returned,
      text_bytes: 0,
      text_code_units: 0
    })
    expect(context.selection_summary.payload_bytes).toBeLessThanOrEqual(8_192)
    expect(context.selection_summary.truncated).toBe(true)

    const defaultRead = (await handlers.read(target, {
      context_token: context.context_token,
      scope: 'selection'
    })) as { count: number; limit: number; nodes: unknown[]; truncated: boolean }
    expect(defaultRead).toMatchObject({ count: 105, limit: 25, truncated: true })
    expect(defaultRead.nodes).toHaveLength(25)
    const forty = (await handlers.read(target, {
      context_token: context.context_token,
      limit: 40,
      scope: 'selection',
      token_budget: 6_000
    })) as { nodes: unknown[] }
    expect(forty.nodes).toHaveLength(40)
    const clamped = (await handlers.read(target, {
      context_token: context.context_token,
      limit: 200,
      scope: 'selection'
    })) as {
      limit: number
      nodes: unknown[]
      truncated: boolean
      truncation_reason: string
    }
    expect(clamped).toMatchObject({
      limit: 100,
      truncated: true,
      truncation_reason: 'token_budget'
    })
    expect(clamped.nodes.length).toBeLessThan(100)

    const revision = store.state.sceneVersion
    await expect(
      handlers.change(target, changeArgs(context, selection[0], 'request:large-selection-guard'))
    ).rejects.toThrow('context must contain exactly the requested anchor selection')
    expect(store.state.sceneVersion).toBe(revision)
    expect(requestNodes(target, 'request:large-selection-guard')).toHaveLength(0)
  })

  test('reads exact known objects with their descendants without scanning the page', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const first = store.graph.createNode('FRAME', target.pageId, { name: 'First owner' })
    const firstChild = store.graph.createNode('TEXT', first.id, { name: 'First child' })
    const second = store.graph.createNode('FRAME', target.pageId, { name: 'Second owner' })
    store.graph.createNode('TEXT', second.id, { name: 'Second child' })
    store.graph.createNode('RECTANGLE', target.pageId, { name: 'Unrelated' })
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const result = (await handlers.read(target, {
      context_token: context.context_token,
      object_ids: [first.id, second.id],
      scope: 'objects'
    })) as {
      count: number
      nodes: Array<{ id: string }>
      requested_object_ids: string[]
      scope: string
    }
    expect(result).toMatchObject({
      count: 4,
      requested_object_ids: [first.id, second.id],
      scope: 'objects'
    })
    expect(result.nodes.map(({ id }) => id)).toEqual([
      first.id,
      firstChild.id,
      second.id,
      second.childIds[0]
    ])
    expect(() =>
      handlers.read(target, {
        context_token: context.context_token,
        object_ids: ['missing'],
        scope: 'objects'
      })
    ).toThrow('missing or outside the target page')
  })

  test('keeps the native-text receipt visible when post-apply proof fails', async () => {
    const scenarios = ['font', 'presentation', 'context'] as const

    for (const stage of scenarios) {
      const store = createEditorStore()
      const target = automationTarget(store)
      const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
      store.select([anchorId])
      const boardRevision = store.state.sceneVersion
      const requestId = `request:native-text-${stage}`
      const handler = createAutomationBoardChangeHandler({
        async ensureFonts() {
          if (stage === 'font') throw new Error('Font proof unavailable')
          return false
        },
        issueContext() {
          if (stage === 'context') throw new Error('Context proof unavailable')
          return { context_token: 'context:after' }
        },
        async presentationFrame() {
          if (stage === 'presentation') throw new Error('Presentation proof unavailable')
          return { acknowledged: true, selected_ids: [] }
        },
        requireContext(_target, rawArgs) {
          if (!isUnknownRecord(rawArgs)) throw new Error('Expected Board change arguments')
          return {
            args: rawArgs,
            context: { boardRevision, selectedIds: [anchorId] }
          }
        }
      })

      const result = (await handler(
        target,
        changeArgs(
          {
            context_token: 'context:before',
            revisions: { board: boardRevision },
            runtime: { instance_id: RUNTIME_ID }
          },
          anchorId,
          requestId
        )
      )) as Record<string, unknown>

      expect(result).toMatchObject({
        next_action: {
          command: 'board_verify',
          request_id: requestId,
          retry_mutation: false
        },
        proof: { stage, status: 'error' },
        receipt: { requestId, status: 'applied' },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'applied',
          reason: 'post_apply_proof_failed'
        }
      })
      expect(requestNodes(target, requestId)).toHaveLength(1)
    }
  })

  test('does not call an unacknowledged native-text presentation completed', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const boardRevision = store.state.sceneVersion
    const requestId = 'request:native-text-unacknowledged'
    const handler = createAutomationBoardChangeHandler({
      async ensureFonts() {
        return false
      },
      issueContext: () => ({ context_token: 'context:after' }),
      async presentationFrame() {
        return { acknowledged: false, selected_ids: [] }
      },
      requireContext(_target, rawArgs) {
        if (!isUnknownRecord(rawArgs)) throw new Error('Expected Board change arguments')
        return { args: rawArgs, context: { boardRevision, selectedIds: [anchorId] } }
      }
    })

    const result = (await handler(
      target,
      changeArgs(
        {
          context_token: 'context:before',
          revisions: { board: boardRevision },
          runtime: { instance_id: RUNTIME_ID }
        },
        anchorId,
        requestId
      )
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      next_action: { command: 'board_verify', request_id: requestId },
      proof: {
        reason: 'presentation_not_acknowledged',
        stage: 'presentation',
        status: 'partial'
      },
      receipt: { requestId, status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'presentation_not_acknowledged'
      }
    })
    expect(requestNodes(target, requestId)).toHaveLength(1)
  })

  test('replays the same request receipt without duplicating the object', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    const args = {
      ...changeArgs(context, anchorId, 'request:replay'),
      task_id: 'task:replay',
      trace_id: 'trace:replay'
    }

    const first = (await handlers.change(target, args)) as {
      readback: { graph: { id: string } }
    }
    const childCount = store.graph.getNode(target.pageId)?.childIds.length
    const freshContext = contextResult(await handlers.context(target))
    const replay = (await handlers.change(target, {
      ...args,
      context_token: freshContext.context_token,
      expected_revision: freshContext.revisions.board
    })) as {
      readback: { graph: { id: string } }
      receipt: { idempotent_replay: boolean; taskId: string; traceId: string }
      status: { mutation: string }
    }

    expect(replay).toMatchObject({
      readback: { graph: { id: first.readback.graph.id } },
      receipt: {
        idempotent_replay: true,
        taskId: 'task:replay',
        traceId: 'trace:replay'
      },
      status: { mutation: 'replayed' }
    })
    expect(store.graph.getNode(target.pageId)?.childIds.length).toBe(childCount)

    await expect(
      handlers.change(target, {
        ...args,
        context_token: freshContext.context_token,
        expected_revision: freshContext.revisions.board,
        operation: {
          ...args.operation,
          artifact: { ...args.operation.artifact, text: 'Changed payload' }
        }
      })
    ).rejects.toThrow('already used for a different mutation')
    await expect(
      handlers.change(target, {
        ...args,
        context_token: freshContext.context_token,
        expected_revision: freshContext.revisions.board,
        trace_id: 'trace:changed'
      })
    ).rejects.toThrow('already used for a different mutation')
  })

  test('connects exact objects with guarded replay, verification, Trace attribution, and Undo', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const targetId = store.createShape('ELLIPSE', 320, 60, 120, 80)
    bindAutomationPersistence(store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:board-tools',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    const args = {
      context_token: context.context_token,
      expected_revision: context.revisions.board,
      kind: 'visual',
      label: 'Trace flow',
      request_id: 'request:connect',
      source_id: sourceId,
      target_id: targetId,
      trace_id: 'trace:connect'
    }

    await expect(
      handlers.connect(target, {
        ...args,
        visual: { profile: 'unsupported-connector-style' }
      })
    ).rejects.toThrow('connect_objects received unsupported fields: visual')
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(0)

    const first = (await handlers.connect(target, args)) as {
      context: { context_token: string }
      readback: { object_graph_connection: { id: string } }
      receipt: { idempotent_replay: boolean; traceId: string }
      status: { mutation: string }
    }
    const connectionId = first.readback.object_graph_connection.id
    expect(first).toMatchObject({
      persistence: {
        authority_id: 'authority:board-tools',
        status: 'durable',
        target: 'local_workspace_authority'
      },
      receipt: { idempotent_replay: false, traceId: 'trace:connect' },
      status: { mutation: 'applied' },
      timing: {
        contract: 'automation-stage-timing/v1',
        stages: {
          mutation_ms: expect.any(Number),
          persistence_ms: expect.any(Number),
          preflight_ms: expect.any(Number),
          presentation_ms: expect.any(Number)
        },
        total_ms: expect.any(Number)
      }
    })
    expect(objectGraphConnectionById(store.graph, target.pageId, connectionId)).toMatchObject({
      kind: 'visual',
      label: 'Trace flow',
      sourceNodeId: sourceId,
      targetNodeId: targetId
    })

    const replay = (await handlers.connect(target, args)) as {
      readback: { object_graph_connection: { id: string } }
      receipt: { idempotent_replay: boolean }
      status: { mutation: string }
    }
    expect(replay).toMatchObject({
      persistence: { status: 'durable', target: 'local_workspace_authority' },
      readback: { object_graph_connection: { id: connectionId } },
      receipt: { idempotent_replay: true },
      status: { action: 'none', mutation: 'replayed' },
      timing: {
        contract: 'automation-stage-timing/v1',
        stages: {
          persistence_ms: expect.any(Number),
          preflight_ms: expect.any(Number),
          replay_reconciliation_ms: expect.any(Number)
        },
        total_ms: expect.any(Number)
      }
    })
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(1)

    const changedConnection = objectGraphConnectionById(store.graph, target.pageId, connectionId)
    if (!changedConnection) throw new Error('Connection disappeared before divergence test')
    for (const divergentConnection of [
      { ...changedConnection, automatic: !changedConnection.automatic },
      { ...changedConnection, permissions: ['target.data.write'] as const }
    ]) {
      setObjectGraphConnectionsOnPage(store.graph, target.pageId, [divergentConnection])
      await expect(handlers.connect(target, args)).resolves.toMatchObject({
        readback: { connection_liveness: { current: 'diverged', historical: 'applied' } },
        receipt: { historical_only: true, live_status: 'diverged' },
        status: { command: 'unavailable', reason: 'historical_receipt_diverged' }
      })
    }
    setObjectGraphConnectionsOnPage(store.graph, target.pageId, [
      { ...changedConnection, label: 'Changed outside the request' }
    ])
    await expect(handlers.connect(target, args)).resolves.toMatchObject({
      readback: {
        connection_liveness: { current: 'diverged', historical: 'applied' },
        object_graph_connection: {
          id: connectionId,
          label: 'Changed outside the request'
        }
      },
      receipt: {
        historical_only: true,
        historical_status: 'applied',
        live_status: 'diverged'
      },
      status: {
        action: 'none',
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'historical_receipt_diverged'
      }
    })
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toEqual([
      expect.objectContaining({
        id: connectionId,
        label: 'Changed outside the request'
      })
    ])

    await expect(
      handlers.verify(target, {
        context_token: first.context.context_token,
        request_id: 'request:connect'
      })
    ).resolves.toMatchObject({
      readback: {
        object_graph_connections: [{ id: connectionId }]
      },
      receipt: {
        requestId: 'request:connect',
        traceId: 'trace:connect'
      },
      status: 'matched'
    })

    expect(store.undo.undo()).toBe('Connect objects with visual')
    expect(objectGraphConnectionById(store.graph, target.pageId, connectionId)).toBeNull()
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(0)
    await expect(handlers.connect(target, args)).resolves.toMatchObject({
      readback: { object_graph_connection: { id: connectionId, missing: true } },
      receipt: { historical_only: true, idempotent_replay: true },
      status: {
        action: 'none',
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'historical_receipt_only'
      }
    })
  })

  test('replays exact legacy connection receipts without permitting a new unsafe mutation', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const dataTargetId = store.createShape('RECTANGLE', 320, 60, 120, 80)
    const visualTargetId = store.createShape('RECTANGLE', 600, 60, 120, 80)
    const route = 'connect_objects'

    async function seedLegacyReceipt(
      requestId: string,
      rawInput: { automatic?: boolean; kind: 'data' | 'visual'; target_id: string }
    ) {
      const input = parseConnectObjectsInputStructure({
        ...rawInput,
        source_id: sourceId
      })
      const connection = connectObjects(store, input)
      if (!connection) throw new Error('Legacy connection fixture was not created')
      const revision = store.state.sceneVersion
      recordMutationRequestReceipt(target, {
        inputDigest: await mutationRequestSignature(route, { input }),
        mutationReceipt: {
          appliedRevision: revision,
          enqueuedRevision: revision,
          expectedRevision: revision,
          requestId,
          status: 'applied',
          touchedProperties: [`${target.pageId}:*`]
        },
        objectIds: [connection.sourceNodeId, connection.targetNodeId],
        requestId,
        result: { ...connection, pageId: target.pageId },
        route,
        semanticIds: [connection.id],
        version: 1
      })
      return connection
    }

    const legacyData = await seedLegacyReceipt('request:legacy-data', {
      kind: 'data',
      target_id: dataTargetId
    })
    const legacyVisual = await seedLegacyReceipt('request:legacy-visual', {
      automatic: true,
      kind: 'visual',
      target_id: visualTargetId
    })
    bindAutomationPersistence(store, (requestedSceneRevision) =>
      Promise.resolve({
        authority_id: 'authority:legacy-replay',
        authority_revision: requestedSceneRevision,
        content_hash: `hash:${requestedSceneRevision}`,
        status: 'durable',
        target: 'local_workspace_authority'
      })
    )
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)

    for (const legacy of [
      {
        connection: legacyData,
        input: { kind: 'data', target_id: dataTargetId },
        requestId: 'request:legacy-data'
      },
      {
        connection: legacyVisual,
        input: { automatic: true, kind: 'visual', target_id: visualTargetId },
        requestId: 'request:legacy-visual'
      }
    ] as const) {
      const context = contextResult(await handlers.context(target))
      await expect(
        handlers.connect(target, {
          ...legacy.input,
          context_token: context.context_token,
          expected_revision: context.revisions.board,
          request_id: legacy.requestId,
          source_id: sourceId
        })
      ).resolves.toMatchObject({
        readback: { object_graph_connection: { id: legacy.connection.id } },
        receipt: { idempotent_replay: true },
        status: { action: 'none', mutation: 'replayed' }
      })
    }
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(2)

    const conflictContext = contextResult(await handlers.context(target))
    await expect(
      handlers.connect(target, {
        automatic: false,
        context_token: conflictContext.context_token,
        expected_revision: conflictContext.revisions.board,
        kind: 'data',
        request_id: 'request:legacy-data',
        source_id: sourceId,
        target_id: dataTargetId
      })
    ).rejects.toThrow('already used for a different mutation')

    const revision = store.state.sceneVersion
    const unsafeContext = contextResult(await handlers.context(target))
    await expect(
      handlers.connect(target, {
        context_token: unsafeContext.context_token,
        expected_revision: unsafeContext.revisions.board,
        kind: 'data',
        request_id: 'request:new-data-omission',
        source_id: sourceId,
        target_id: dataTargetId
      })
    ).rejects.toThrow('requires explicit automatic true or false')
    await expect(
      handlers.connect(target, {
        automatic: true,
        context_token: unsafeContext.context_token,
        expected_revision: unsafeContext.revisions.board,
        kind: 'visual',
        request_id: 'request:new-visual-automatic',
        source_id: sourceId,
        target_id: visualTargetId
      })
    ).rejects.toThrow('visual connections cannot be automatic')
    expect(store.state.sceneVersion).toBe(revision)
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toHaveLength(2)
  })

  test('keeps an applied connection receipt when persistence is not acknowledged', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const sourceId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const targetId = store.createShape('ELLIPSE', 320, 60, 120, 80)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const result = await handlers.connect(target, {
      automatic: false,
      context_token: context.context_token,
      expected_revision: context.revisions.board,
      kind: 'visual',
      request_id: 'request:connect-unknown-persistence',
      source_id: sourceId,
      target_id: targetId
    })

    expect(result).toMatchObject({
      next_action: {
        command: 'board_verify',
        request_id: 'request:connect-unknown-persistence',
        retry_mutation: false
      },
      persistence: { reason: 'persistence_unavailable', status: 'unknown' },
      proof: { reason: 'persistence_not_acknowledged', stage: 'persistence', status: 'partial' },
      receipt: { requestId: 'request:connect-unknown-persistence', status: 'applied' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'persistence_not_acknowledged'
      }
    })
    expect(objectGraphConnectionsOnPage(store.graph, target.pageId)).toEqual([
      expect.objectContaining({ automatic: false, sourceNodeId: sourceId, targetNodeId: targetId })
    ])
  })

  test('rejects stale revisions and changed singleton selection before creating', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const otherId = store.createShape('RECTANGLE', 240, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    store.updateNodeWithUndo(otherId, { name: 'Revision changed' }, 'User edit')
    await expect(
      handlers.change(target, changeArgs(context, anchorId, 'request:stale'))
    ).rejects.toThrow('Board revision is stale')

    store.undo.undo()
    const fresh = contextResult(await handlers.context(target))
    store.select([otherId])
    await expect(
      handlers.change(target, changeArgs(fresh, anchorId, 'request:selection'))
    ).rejects.toThrow('must remain the singleton selection')
  })

  test('verifies matched and empty stable request receipts honestly', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))
    const changed = (await handlers.change(
      target,
      changeArgs(context, anchorId, 'request:verified')
    )) as { context: { context_token: string } }

    await expect(
      handlers.verify(target, {
        context_token: changed.context.context_token,
        request_id: 'request:verified'
      })
    ).resolves.toMatchObject({ status: 'matched' })
    await expect(
      handlers.verify(target, {
        context_token: changed.context.context_token,
        request_id: 'request:missing'
      })
    ).resolves.toMatchObject({ reason: 'request_not_found', status: 'empty' })
  })

  test('omits change capability and refuses mutation when the workspace is view-only', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    setSmylrProductionDocumentWriteGuard(store, () => false)
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const viewerContext = (await handlers.context(target)) as {
      board_build_base?: unknown
      capabilities: string[]
    }
    expect(viewerContext).toMatchObject({
      capabilities: [
        'board.read.selection',
        'board.read.page',
        'board.read.objects',
        'board.present',
        'board.verify.request'
      ]
    })
    expect(viewerContext.board_build_base).toBeUndefined()
    await expect(
      handlers.change(target, changeArgs(context, anchorId, 'request:view-only'))
    ).rejects.toThrow('view-only')
    expect(store.graph.getNode(target.pageId)?.childIds).toEqual([anchorId])
  })

  test('uses selected native text style, dark-page contrast, bounded context, and revision-bound verification', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    store.setPageColor({ a: 1, b: 0.11, g: 0.09, r: 0.08 })
    const target = automationTarget(store)
    const anchorId = store.createShape('TEXT', 40, 60, 180, 48)
    store.updateNodeWithUndo(
      anchorId,
      {
        fills: [
          {
            color: { a: 1, b: 0.06, g: 0.05, r: 0.04 },
            opacity: 1,
            type: 'SOLID',
            visible: true
          }
        ],
        fontSize: 24,
        fontWeight: 700,
        text: 'private selected source'
      },
      'Fixture: selected text'
    )
    for (let index = 0; index < 4; index++) {
      const id = store.createShape('TEXT', 300 + index * 180, 60, 160, 40)
      store.updateNodeWithUndo(
        id,
        { fontSize: 16 + index, text: `private nearby source ${index}` },
        'Fixture: nearby text'
      )
    }
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const result = (await handlers.change(
      target,
      changeArgs(context, anchorId, 'request:visual-dark', { visual: true })
    )) as {
      readback: { graph: { id: string } }
      receipt: { appliedRevision: number }
      status: { attention_required: boolean }
      visual: {
        context: {
          nearby_text_styles: Array<Record<string, unknown>>
          viewport: {
            css_pixels_per_board_unit: number
            usable_board: Rect
            usable_css: Rect
          }
        }
        style_resolution: {
          color_source: string
          source_node_id: string
          typography_source: string
        }
        verification: {
          contrast_ratio: number
          effective_text_size_css_px: number
          required_scene_revision: number
          status: string
          visible_fraction: number
        }
      }
    }

    const created = store.graph.getNode(result.readback.graph.id)
    expect(created).toMatchObject({ fontSize: 24, fontWeight: 700 })
    expect(created?.fills[0]?.color).toMatchObject({ b: 1, g: 1, r: 1 })
    expect(result.status.attention_required).toBe(false)
    expect(result.visual.style_resolution).toMatchObject({
      color_source: 'page_contrast_fallback',
      source_node_id: anchorId,
      typography_source: 'selected_text'
    })
    expect(result.visual.context.nearby_text_styles).toHaveLength(3)
    expect(JSON.stringify(result.visual.context.nearby_text_styles)).not.toContain('private')
    expect(result.visual.context.nearby_text_styles.every((item) => !('name' in item))).toBe(true)
    expect(result.visual.context.nearby_text_styles.every((item) => !('text' in item))).toBe(true)
    expect(result.visual.context.viewport).toMatchObject({
      css_pixels_per_board_unit: expect.any(Number),
      usable_board: expect.any(Object),
      usable_css: expect.any(Object)
    })
    expect(result.visual.verification).toMatchObject({
      required_scene_revision: result.receipt.appliedRevision,
      status: 'passed'
    })
    expect(result.visual.verification.contrast_ratio).toBeGreaterThanOrEqual(4.5)
    expect(result.visual.verification.effective_text_size_css_px).toBeGreaterThanOrEqual(11)
    expect(result.visual.verification.visible_fraction).toBeGreaterThanOrEqual(0.99)
    expect(store.undo.undo()).toBe('Agent: create native text')
    expect(store.graph.getNode(result.readback.graph.id)).toBeUndefined()
  })

  test('uses nearest typography, explicit font size, and dark text on a light page', async () => {
    installBrowserFixture()
    const store = createEditorStore()
    store.setPageColor({ a: 1, b: 0.96, g: 0.96, r: 0.96 })
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    const nearbyTextId = store.createShape('TEXT', 200, 60, 180, 48)
    store.updateNodeWithUndo(
      nearbyTextId,
      {
        fills: [
          {
            color: { a: 1, b: 1, g: 1, r: 1 },
            opacity: 1,
            type: 'SOLID',
            visible: true
          }
        ],
        fontSize: 28,
        fontWeight: 600,
        text: 'nearby white source'
      },
      'Fixture: light nearby text'
    )
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const result = (await handlers.change(
      target,
      changeArgs(context, anchorId, 'request:visual-light', {
        fontSize: 36,
        visual: true
      })
    )) as {
      readback: { graph: { id: string } }
      visual: {
        style_resolution: {
          font_size_source: string
          source_node_id: string
          typography_source: string
        }
        verification: { status: string }
      }
    }

    const created = store.graph.getNode(result.readback.graph.id)
    expect(created).toMatchObject({ fontSize: 36, fontWeight: 600 })
    expect(created?.fills[0]?.color).toMatchObject({ b: 0, g: 0, r: 0 })
    expect(result.visual.style_resolution).toMatchObject({
      font_size_source: 'explicit_request',
      source_node_id: nearbyTextId,
      typography_source: 'nearest_text'
    })
    expect(result.visual.verification.status).toBe('passed')
  })

  test('reports render-timeout honestly without rolling back an applied visual-profile mutation', async () => {
    installBrowserFixture()
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
    const store = createEditorStore()
    const target = automationTarget(store)
    const anchorId = store.createShape('RECTANGLE', 40, 60, 120, 80)
    store.select([anchorId])
    const handlers = createAutomationBoardHandlers(RUNTIME_ID)
    const context = contextResult(await handlers.context(target))

    const result = (await handlers.change(
      target,
      changeArgs(context, anchorId, 'request:visual-timeout', { visual: true })
    )) as {
      readback: { graph: { id: string } }
      status: { attention_required: boolean; mutation: string }
      visual: { verification: { status: string } }
    }

    expect(result.status).toMatchObject({ attention_required: true, mutation: 'applied' })
    expect(result.visual.verification.status).toBe('render-timeout')
    expect(store.graph.getNode(result.readback.graph.id)?.type).toBe('TEXT')
  })
})
