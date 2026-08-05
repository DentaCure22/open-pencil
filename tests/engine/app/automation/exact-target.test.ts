import { afterEach, describe, expect, test } from 'bun:test'

import { normalizeGuardedAutomationArgs } from '@/app/automation/bridge/exact-target'
import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import { createEditorStore } from '@/app/editor/session'
import { closeTab, createTab } from '@/app/tabs'
import {
  createOpenPencilWorkspaceIdentity,
  stampOpenPencilWorkspaceIdentity
} from '@/app/workspace-document/identity'

const GUARDED_COMMANDS = [
  'board_build',
  'board_change',
  'board_context',
  'board_fixture',
  'board_open',
  'board_present',
  'board_read',
  'board_verify',
  'connect_objects',
  'trace_query',
  'upsert_code_object'
]

const CONTEXT_BOUND_COMMANDS = [
  'board_change',
  'board_present',
  'board_read',
  'board_verify',
  'connect_objects'
]

const EXACT_TARGET = {
  content_document_id: 'content:exact',
  document_id: 'tab:exact',
  page_id: 'page:exact',
  runtime_instance_id: 'runtime:exact-target-test',
  workspace_id: 'workspace:exact'
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('guarded Board command target boundary', () => {
  test('expands copy-ready build and connection bases at the shared app boundary', () => {
    const buildBase = {
      ...EXACT_TARGET,
      context_token: 'context:packet',
      contract: 'board-build/v1',
      expected_revision: 7
    }
    expect(
      normalizeGuardedAutomationArgs('board_build', {
        base: buildBase,
        intent: 'Use the packet directly',
        request_id: 'request:packet'
      })
    ).toEqual({
      ...buildBase,
      intent: 'Use the packet directly',
      request_id: 'request:packet'
    })

    const { contract: _contract, ...connectionBase } = buildBase
    expect(
      normalizeGuardedAutomationArgs('connect_objects', {
        base: connectionBase,
        request_id: 'request:connection'
      })
    ).toEqual({ ...connectionBase, request_id: 'request:connection' })
    expect(() =>
      normalizeGuardedAutomationArgs('board_build', {
        base: buildBase,
        page_id: 'page:conflict'
      })
    ).toThrow('cannot be combined with flattened fields: page_id')
  })

  test('allows explicit current-visible context discovery without weakening later mutations', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1200, openPencil: {} }
    })
    const store = createEditorStore()
    stampOpenPencilWorkspaceIdentity(
      store.graph,
      createOpenPencilWorkspaceIdentity(() => 'current-visible')
    )
    const tab = createTab(store)
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    try {
      const response = (await handleRequest(store, 'board_context', {
        runtime_instance_id: 'runtime:exact-target-test',
        target: 'current_visible'
      })) as Record<string, unknown>

      expect(response).toMatchObject({
        ok: true,
        result: {
          board_build_base: {
            page_id: store.state.currentPageId,
            runtime_instance_id: 'runtime:exact-target-test'
          }
        },
        target: {
          pageId: store.state.currentPageId,
          runtimeInstanceId: 'runtime:exact-target-test'
        }
      })
      await expect(
        handleRequest(store, 'board_context', {
          page_id: store.state.currentPageId,
          runtime_instance_id: 'runtime:exact-target-test',
          target: 'current_visible'
        })
      ).rejects.toThrow('current_visible cannot be combined')
    } finally {
      closeTab(tab.id)
    }
  })

  test('opens an exact ordinary document page without inventing a workspace ID', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1200, openPencil: {} }
    })
    const store = createEditorStore()
    const destination = store.graph.addPage('CLI destination')
    const tab = createTab(store)
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    try {
      const response = await handleRequest(store, 'board_open', {
        content_document_id: store.graph.rootId,
        document_id: tab.id,
        page_id: destination.id,
        runtime_instance_id: 'runtime:exact-target-test'
      })

      expect(store.state.currentPageId).toBe(destination.id)
      expect(response).toMatchObject({
        ok: true,
        result: {
          action: 'opened',
          page_id: destination.id,
          status: 'completed'
        },
        target: {
          contentDocumentId: store.graph.rootId,
          documentId: tab.id,
          pageId: destination.id,
          runtimeInstanceId: 'runtime:exact-target-test'
        }
      })
    } finally {
      closeTab(tab.id)
    }
  })

  test('creates a page in an exact writable ordinary document with a guarded revision', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1200, openPencil: {} }
    })
    const store = createEditorStore()
    const sourcePageId = store.state.currentPageId
    const tab = createTab(store)
    const expectedRevision = store.state.sceneVersion
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    try {
      const response = await handleRequest(store, 'tool', {
        args: { name: 'CLI Board' },
        content_document_id: store.graph.rootId,
        document_id: tab.id,
        mutation: { expectedRevision, requestId: 'request:create-ordinary-board' },
        name: 'create_page',
        page_id: sourcePageId,
        runtime_instance_id: 'runtime:exact-target-test'
      })

      expect(store.graph.getPages().map((page) => page.name)).toContain('CLI Board')
      expect(response).toMatchObject({
        ok: true,
        result: {
          mutation_receipt: {
            expectedRevision,
            requestId: 'request:create-ordinary-board',
            status: 'applied'
          },
          name: 'CLI Board'
        },
        target: {
          contentDocumentId: store.graph.rootId,
          documentId: tab.id,
          pageId: sourcePageId,
          runtimeInstanceId: 'runtime:exact-target-test'
        }
      })
    } finally {
      closeTab(tab.id)
    }
  })

  test('rejects omitted target identity before active-document fallback or mutation', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const anchorId = store.createShape('RECTANGLE', 20, 30, 80, 60)
    const initialChildren = [...(store.graph.getNode(pageId)?.childIds ?? [])]
    const initialRevision = store.state.sceneVersion
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    for (const command of GUARDED_COMMANDS) {
      await expect(handleRequest(store, command, {})).rejects.toThrow(
        /requires (exact target fields|workspace_id or document_id)/
      )
    }

    expect(store.graph.getNode(pageId)?.childIds).toEqual(initialChildren)
    expect(store.graph.getNode(anchorId)).toBeDefined()
    expect(store.state.sceneVersion).toBe(initialRevision)
  })

  test('rejects partial builder identity before dispatching its recipe', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const anchorId = store.createShape('RECTANGLE', 20, 30, 80, 60)
    store.select([anchorId])
    const initialChildren = [...(store.graph.getNode(pageId)?.childIds ?? [])]
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    await expect(
      handleRequest(store, 'board_build', {
        anchor_id: anchorId,
        contract: 'board-build/v1',
        intent: 'Must not reach the active Board',
        page_id: pageId,
        recipe: { kind: 'native_card', title: 'Blocked', body: 'Partial target' },
        request_id: 'request:partial-target',
        runtime_instance_id: 'runtime:exact-target-test'
      })
    ).rejects.toThrow(
      'board_build requires exact target fields: workspace_id, document_id, content_document_id.'
    )

    expect(store.graph.getNode(pageId)?.childIds).toEqual(initialChildren)
  })

  test('rejects a partial context-bound target before command dispatch', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const initialRevision = store.state.sceneVersion
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    for (const command of CONTEXT_BOUND_COMMANDS) {
      await expect(
        handleRequest(store, command, { document_id: 'tab:partial', page_id: pageId })
      ).rejects.toThrow(`${command} requires exact target fields: runtime_instance_id.`)
    }

    expect(store.state.sceneVersion).toBe(initialRevision)
  })

  test('rejects direct mutating ToolDef RPC before active-Board resolution', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const initialChildren = [...(store.graph.getNode(pageId)?.childIds ?? [])]
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    await expect(
      handleRequest(store, 'tool', {
        args: { height: 80, type: 'RECTANGLE', width: 120, x: 40, y: 60 },
        mutation: { expectedRevision: 0, requestId: 'request:unguarded-tool' },
        name: 'create_shape'
      })
    ).rejects.toThrow(
      'tool requires exact target fields: runtime_instance_id, document_id, content_document_id, page_id.'
    )
    await expect(
      handleRequest(store, 'tool', {
        ...EXACT_TARGET,
        args: { height: 80, type: 'RECTANGLE', width: 120, x: 40, y: 60 },
        name: 'create_shape'
      })
    ).rejects.toThrow(
      'tool requires guarded mutation fields: mutation.expectedRevision, mutation.requestId.'
    )

    expect(store.graph.getNode(pageId)?.childIds).toEqual(initialChildren)
  })

  test('rejects direct Mermaid RPC without exact target or guarded mutation metadata', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const initialChildren = [...(store.graph.getNode(pageId)?.childIds ?? [])]
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    await expect(
      handleRequest(store, 'insert_mermaid_diagram', {
        mutation: { expectedRevision: 0, requestId: 'request:partial-mermaid' },
        source: 'flowchart LR\n A --> B'
      })
    ).rejects.toThrow('insert_mermaid_diagram requires exact target fields')
    await expect(
      handleRequest(store, 'insert_mermaid_diagram', {
        ...EXACT_TARGET,
        source: 'flowchart LR\n A --> B'
      })
    ).rejects.toThrow(
      'insert_mermaid_diagram requires guarded mutation fields: mutation.expectedRevision, mutation.requestId.'
    )

    expect(store.graph.getNode(pageId)?.childIds).toEqual(initialChildren)
  })

  test('rejects Code Object upsert before target resolution or unguarded dispatch', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const initialChildren = [...(store.graph.getNode(pageId)?.childIds ?? [])]
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    await expect(
      handleRequest(store, 'upsert_code_object', {
        mutation: { expectedRevision: 0, requestId: 'request:partial-code-object' },
        object_key: 'guarded-code-object',
        source: 'export default function Card() { return <div>Blocked</div> }'
      })
    ).rejects.toThrow('upsert_code_object requires exact target fields')
    await expect(
      handleRequest(store, 'upsert_code_object', {
        ...EXACT_TARGET,
        object_key: 'guarded-code-object',
        source: 'export default function Card() { return <div>Blocked</div> }'
      })
    ).rejects.toThrow(
      'upsert_code_object requires guarded mutation fields: mutation.expectedRevision, mutation.requestId.'
    )

    expect(store.graph.getNode(pageId)?.childIds).toEqual(initialChildren)
  })

  test('rejects live-app eval before target resolution or Figma API execution', async () => {
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const initialRevision = store.state.sceneVersion
    let madeFigma = false
    const { handleRequest } = createAutomationCommandHandlers((target, targetPageId) => {
      madeFigma = true
      return makeFigmaFromStore(target, targetPageId)
    }, 'runtime:exact-target-test')

    await expect(
      handleRequest(store, 'eval', {
        code: `figma.createRectangle(); throw new Error('must never run')`
      })
    ).rejects.toThrow('Live-app eval is disabled')

    expect(madeFigma).toBe(false)
    expect(store.graph.getNode(pageId)?.childIds).toEqual([])
    expect(store.state.sceneVersion).toBe(initialRevision)
  })

  test('fails live fixture control explicitly without changing the Board', async () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerHeight: 800, innerWidth: 1200, openPencil: {} }
    })
    const store = createEditorStore()
    const pageId = store.state.currentPageId
    const identity = createOpenPencilWorkspaceIdentity(() => 'fixture-live-refusal')
    stampOpenPencilWorkspaceIdentity(store.graph, identity)
    const tab = createTab(store)
    const initialRevision = store.state.sceneVersion
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime:exact-target-test'
    )

    try {
      await expect(
        handleRequest(store, 'board_fixture', {
          content_document_id: identity.documentId,
          context_token: 'context:fixture',
          document_id: tab.id,
          operation: 'capture',
          page_id: pageId,
          runtime_instance_id: 'runtime:exact-target-test',
          workspace_id: identity.workspaceId
        })
      ).rejects.toThrow('available only through persisted local_workspace_authority')
      expect(store.graph.getNode(pageId)?.childIds).toEqual([])
      expect(store.state.sceneVersion).toBe(initialRevision)
    } finally {
      closeTab(tab.id)
    }
  })
})
