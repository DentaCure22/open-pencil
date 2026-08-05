import { afterEach, describe, expect, test } from 'bun:test'

import { makeFigmaFromStore } from '@/app/automation/bridge/figma-factory'
import { createAutomationCommandHandlers } from '@/app/automation/bridge/handlers'
import { listAutomationDocuments, type AutomationTarget } from '@/app/automation/bridge/target'
import { handleTraceGesture, handleTraceQuery } from '@/app/automation/bridge/trace-handler'
import { createEditorStore } from '@/app/editor/session'
import { createTab } from '@/app/tabs'
import {
  createOpenPencilWorkspaceIdentity,
  stampOpenPencilWorkspaceIdentity
} from '@/app/workspace-document/identity'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

function automationTarget(store: ReturnType<typeof createEditorStore>): AutomationTarget {
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  return {
    contentDocumentId: store.graph.rootId,
    documentId: 'tab-test',
    documentName: 'Automation test',
    pageId,
    pageName: page?.name ?? 'Page 1',
    runtimeInstanceId: 'runtime-test',
    workspaceId: 'workspace-test',
    store
  }
}

describe('OpenPencil Trace automation', () => {
  test('dispatches Trace without requiring or attaching the active Board target', async () => {
    installWindowFixture()
    const store = createEditorStore()
    const identity = createOpenPencilWorkspaceIdentity(() => 'dispatch-test')
    stampOpenPencilWorkspaceIdentity(store.graph, identity)
    const tab = createTab(store)
    expect(listAutomationDocuments(store).find((document) => document.id === tab.id)).toMatchObject(
      {
        content_document_id: identity.documentId,
        workspace_id: identity.workspaceId
      }
    )
    const { handleRequest } = createAutomationCommandHandlers(
      makeFigmaFromStore,
      'runtime-dispatch-test'
    )

    const response = (await handleRequest(store, 'trace_query', { query: 'dispatch proof' })) as {
      ok: boolean
      result: { status: string }
      target?: unknown
    }

    expect(response).toMatchObject({
      ok: true,
      result: { status: 'empty' }
    })
    expect(response.target).toBeUndefined()
  })

  test('adapts the existing Trace query to the standard bridge envelope', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)

    const response = await handleTraceQuery(target, { query: 'recovery flow' }, async () => ({
      matches: [],
      scanned: { indexCandidates: 0, sessions: 0 },
      status: 'empty'
    }))

    expect(response).toEqual({
      ok: true,
      result: {
        matches: [],
        scanned: { indexCandidates: 0, sessions: 0 },
        status: 'empty'
      }
    })
  })

  test('resolves one immutable gesture without Board fallback or lexical search', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    let received: unknown = null

    const response = await handleTraceGesture(
      target,
      { include_image: false, latest: true },
      async (input) => {
        received = input
        return {
          reason: 'gesture_not_found' as const,
          scanned: { sessions: 1 },
          status: 'empty' as const
        }
      }
    )

    expect(received).toEqual({ includeImage: false, latest: true })
    expect(response).toMatchObject({
      ok: true,
      result: { reason: 'gesture_not_found', status: 'empty' }
    })
  })

  test('returns a compact owner-level gesture packet by default', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const card = store.graph.createNode('FRAME', target.pageId, {
      height: 200,
      name: 'Card',
      width: 320,
      x: 80,
      y: 60
    })
    const title = store.graph.createNode('TEXT', card.id, {
      height: 32,
      name: 'Title',
      text: 'Title',
      width: 240,
      x: 24,
      y: 20
    })

    const response = (await handleTraceGesture(target, { latest: true }, async () => ({
      gesture: {
        boardOrigin: {
          contentDocumentId: target.contentDocumentId,
          documentId: target.documentId,
          pageId: target.pageId,
          runtimeInstanceId: target.runtimeInstanceId,
          workspaceId: target.workspaceId
        },
        candidates: {
          count: 2,
          items: [
            {
              depth: 1,
              name: 'Card',
              nodeType: 'FRAME',
              relation: 'intersecting',
              stableId: card.id
            },
            { depth: 2, name: 'Title', nodeType: 'TEXT', relation: 'contained', stableId: title.id }
          ],
          primaryTargetId: title.id,
          truncated: false
        },
        capturedAt: '2026-08-01T12:00:00.000Z',
        contract: 'trace-gesture/v1',
        episode: { events: [{ id: 'event:1' }] },
        geometry: {
          kind: 'ink',
          pagePoints: Array.from({ length: 200 }, (_, index) => ({ x: index, y: index })),
          pageRegion: { height: 240, width: 360, x: 60, y: 40 },
          screenPoints: Array.from({ length: 200 }, (_, index) => ({ x: index, y: index }))
        },
        gestureId: 'gesture:compact',
        scope: { documentId: target.contentDocumentId, pageId: target.pageId },
        sessionId: 'session:compact',
        target: { name: 'Title', stableId: title.id }
      },
      scanned: { sessions: 1 },
      status: 'matched' as const
    }))) as {
      result: { gesture: Record<string, unknown> }
    }

    expect(response.result.gesture).toMatchObject({
      candidates: {
        count: 1,
        items: [{ name: 'Card', stableId: card.id }],
        primaryTargetId: card.id
      },
      contract: 'trace-gesture-agent/v1',
      geometry: { kind: 'ink', pageRegion: { height: 240, width: 360, x: 60, y: 40 } }
    })
    expect(response.result.gesture).not.toHaveProperty('episode')
    expect(response.result.gesture.geometry).not.toHaveProperty('pagePoints')
  })

  test('maps an explicit spoken-turn selector without adding ranked query text', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    let received: unknown = null

    await handleTraceQuery(
      target,
      {
        latest_spoken_turn: true
      },
      async (input) => {
        received = input
        return {
          matches: [],
          reason: 'spoken_turn_not_found',
          scanned: { indexCandidates: 0, sessions: 0 },
          status: 'empty'
        }
      }
    )

    expect(received).toMatchObject({
      latestSpokenTurn: true,
      query: undefined,
      spokenText: undefined,
      spokenTurnId: undefined
    })
    expect(received).not.toHaveProperty('runtimeTabBindingId')
    expect(received).not.toHaveProperty('scope')
  })

  test('returns the recorded Board scope instead of the active runtime target', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    const response = await handleTraceQuery(target, { query: 'recovery flow' }, async () => {
      return {
        matches: [
          {
            endedAt: '2026-08-01T12:01:00.000Z',
            events: [],
            matchedBy: ['text'],
            score: 12,
            scope: {
              documentId: 'content-document-recorded',
              pageId: 'page-recorded',
              workspaceId: 'workspace-recorded'
            },
            sessionId: 'trace-session-recorded',
            startedAt: '2026-08-01T12:00:00.000Z',
            title: 'Recorded card'
          }
        ],
        scanned: { indexCandidates: 1, sessions: 1 },
        status: 'matched' as const,
        taskCursor: 'trace-task-v3.recorded'
      }
    })

    expect(response).toMatchObject({
      result: {
        matches: [
          {
            scope: {
              documentId: 'content-document-recorded',
              pageId: 'page-recorded',
              workspaceId: 'workspace-recorded'
            }
          }
        ]
      }
    })
  })

  test('rejects ambiguous Trace selectors and spoken time-range overrides before querying', async () => {
    const store = createEditorStore()
    const target = automationTarget(store)
    let calls = 0
    const query = async () => {
      calls += 1
      return {
        matches: [],
        scanned: { indexCandidates: 0, sessions: 0 },
        status: 'empty' as const
      }
    }
    await expect(
      handleTraceQuery(
        target,
        {
          query: 'recovery flow',
          task_cursor: 'trace-cursor:1'
        },
        query
      )
    ).rejects.toThrow('exactly one')
    await expect(
      handleTraceQuery(
        target,
        {
          latest_spoken_turn: true,
          until: '2026-07-27T00:00:00.000Z'
        },
        query
      )
    ).rejects.toThrow('cannot be combined')
    expect(calls).toBe(0)
  })
})
