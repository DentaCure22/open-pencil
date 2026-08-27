import { describe, expect, test } from 'bun:test'

import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'
import { startServer } from '#mcp/server'

import { useLocalWorkspaceAuthorityFixture } from './local-workspace-authority-fixture'

const { createStore } = useLocalWorkspaceAuthorityFixture()

describe('local workspace authority client contract', () => {
  test('persists one latest-wins navigation intent and consumes it once', async () => {
    const { root, store } = await createStore()
    await store.initialize({
      document: { nodes: ['canonical-copy'] },
      requestId: 'seed-navigation',
      sourceWorkspaceId: 'workspace-canonical'
    })
    const status = await store.status()
    const first = await store.queueNavigationIntent({
      contentDocumentId: status.identity.documentId,
      pageId: 'page:first',
      workspaceId: status.identity.workspaceId
    })
    const second = await store.queueNavigationIntent({
      contentDocumentId: status.identity.documentId,
      pageId: 'page:second',
      runtimeInstanceId: 'runtime:chosen',
      workspaceId: status.identity.workspaceId
    })
    const restarted = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-canonical',
      root
    })

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(await restarted.consumeNavigationIntent(first.intentId)).toBe(false)
    expect(await restarted.pendingNavigationIntent()).toMatchObject({
      intentId: second.intentId,
      pageId: 'page:second',
      runtimeInstanceId: 'runtime:chosen',
      sequence: 2
    })
    expect(await restarted.consumeNavigationIntent(second.intentId)).toBe(true)
    expect(await restarted.consumeNavigationIntent(second.intentId)).toBe(false)
    expect(await restarted.pendingNavigationIntent()).toBeNull()

    const third = await restarted.queueNavigationIntent({
      contentDocumentId: status.identity.documentId,
      pageId: 'page:third',
      workspaceId: status.identity.workspaceId
    })
    expect(third.sequence).toBe(3)
  })

  test('protects the HTTP authority and exposes the configured canonical workspace', async () => {
    const { root } = await createStore()
    const server = startServer({
      authToken: 'authority-test-token',
      httpPort: 0,
      localWorkspaceId: 'workspace-canonical',
      localWorkspaceRoot: root,
      wsPort: 0
    })
    try {
      const unauthorized = await server.app.request('/local-workspace/v1/status')
      expect(unauthorized.status).toBe(401)

      const authorized = await server.app.request('/local-workspace/v1/status', {
        headers: { Authorization: 'Bearer authority-test-token' }
      })
      expect(authorized.status).toBe(200)
      expect(await authorized.json()).toMatchObject({
        revision: 0,
        seedWorkspaceId: 'workspace-canonical',
        state: 'configured'
      })
    } finally {
      server.close()
    }
  })

  test('publishes a bounded current Board selection with presence', async () => {
    const { store } = await createStore()
    const status = await store.status()
    await store.recordPresence({
      contentDocumentId: status.identity.documentId,
      pageId: 'page:dental',
      pageName: 'Dental Chart',
      selectedIds: ['card:first', 'card:second'],
      selectionTruncated: false,
      workspaceId: status.identity.workspaceId
    })

    expect(await store.readPresence()).toMatchObject({
      pageId: 'page:dental',
      selectedIds: ['card:first', 'card:second'],
      selectionTruncated: false
    })
    await expect(
      store.recordPresence({
        contentDocumentId: status.identity.documentId,
        pageId: 'page:dental',
        pageName: 'Dental Chart',
        selectedIds: Array.from({ length: 25 }, (_, index) => `card:${String(index)}`),
        selectionTruncated: true,
        workspaceId: status.identity.workspaceId
      })
    ).rejects.toThrow('at most 24 non-empty IDs')
  })

  test('persists the canonical Trace session over HTTP without a browser', async () => {
    const { root } = await createStore()
    const server = startServer({
      authToken: 'authority-trace-token',
      httpPort: 0,
      localWorkspaceId: 'workspace-canonical',
      localWorkspaceRoot: root,
      wsPort: 0
    })
    const headers = {
      Authorization: 'Bearer authority-trace-token',
      'Content-Type': 'application/json'
    }
    try {
      await server.app.request('/local-workspace/v1/initialize', {
        body: JSON.stringify({
          document: { value: 'initial' },
          requestId: 'seed-trace-route',
          sourceWorkspaceId: 'workspace-canonical'
        }),
        headers,
        method: 'POST'
      })
      const status = (await (
        await server.app.request('/local-workspace/v1/status', { headers })
      ).json()) as { identity: { documentId: string; workspaceId: string } }
      const gesture = {
        boardOrigin: {
          contentDocumentId: status.identity.documentId,
          pageId: 'page:dental',
          workspaceId: status.identity.workspaceId
        },
        candidates: {
          count: 1,
          items: [{ stableId: 'card:first' }],
          truncated: false
        },
        capturedAt: '2026-08-01T12:00:00.000Z',
        contract: 'trace-gesture-agent/v1',
        geometry: {
          kind: 'focus',
          pageRegion: { height: 80, width: 220, x: 100, y: 200 }
        },
        gestureId: 'gesture:http',
        sessionId: 'session:http'
      }
      const traceResponse = await server.app.request('/local-workspace/v1/trace/sessions', {
        body: JSON.stringify({
          gestures: [gesture],
          session: {
            contextDraft: [
              {
                editedText: 'Review this exact card',
                included: true,
                removed: false,
                sourceEventId: 'event:http'
              }
            ],
            durationMs: 200,
            events: [
              {
                atMs: 200,
                id: 'event:http',
                kind: 'selection',
                label: 'Selected first card'
              }
            ],
            id: gesture.sessionId,
            startedAt: gesture.capturedAt
          },
          summary: {
            id: gesture.sessionId,
            startedAt: gesture.capturedAt,
            title: 'HTTP Trace',
            updatedAt: gesture.capturedAt
          }
        }),
        headers,
        method: 'POST'
      })
      expect(traceResponse.status).toBe(200)

      const activityResponse = await server.app.request(
        '/local-workspace/v1/trace/activity?limit=1',
        { headers }
      )
      expect(activityResponse.status).toBe(200)
      expect(await activityResponse.json()).toMatchObject({
        contract: 'trace-activity-page/v1',
        hasMore: false,
        items: [
          {
            context: { editedText: 'Review this exact card' },
            event: { id: 'event:http' },
            sessionId: 'session:http'
          }
        ],
        nextCursor: null
      })

      const readResponse = await server.app.request('/rpc', {
        body: JSON.stringify({ command: 'trace_get_gesture', args: { latest: true } }),
        headers,
        method: 'POST'
      })
      expect(await readResponse.json()).toMatchObject({
        ok: true,
        result: {
          gesture: {
            boardOrigin: { contentDocumentId: status.identity.documentId },
            gestureId: 'gesture:http'
          },
          status: 'matched'
        }
      })
    } finally {
      server.close()
    }
  })

  test('releases a waiting browser as soon as the authority head commits', async () => {
    const { root } = await createStore()
    const server = startServer({
      authToken: 'authority-change-token',
      httpPort: 0,
      localWorkspaceId: 'workspace-canonical',
      localWorkspaceRoot: root,
      wsPort: 0
    })
    const headers = {
      Authorization: 'Bearer authority-change-token',
      'Content-Type': 'application/json'
    }
    try {
      const initializedResponse = await server.app.request('/local-workspace/v1/initialize', {
        body: JSON.stringify({
          document: { value: 'initial' },
          requestId: 'seed-change-stream',
          sourceWorkspaceId: 'workspace-canonical'
        }),
        headers,
        method: 'POST'
      })
      const initialized = (await initializedResponse.json()) as {
        appliedRevision: number
        contentHash: string
      }
      const waiting = server.app.request(
        `/local-workspace/v1/changes?after_revision=${String(initialized.appliedRevision)}&timeout_ms=1000`,
        { headers }
      )
      const committedResponse = await server.app.request('/local-workspace/v1/commit', {
        body: JSON.stringify({
          document: { value: 'changed' },
          expectedContentHash: initialized.contentHash,
          expectedRevision: initialized.appliedRevision,
          requestId: 'commit-change-stream',
          workspaceId: 'workspace-canonical'
        }),
        headers,
        method: 'POST'
      })
      const committed = (await committedResponse.json()) as {
        appliedRevision: number
        contentHash: string
      }
      const change = await waiting

      expect(change.status).toBe(200)
      expect(await change.json()).toEqual({
        authorityId: expect.any(String),
        changed: true,
        contentHash: committed.contentHash,
        revision: committed.appliedRevision,
        workspaceId: 'workspace-canonical'
      })
    } finally {
      server.close()
    }
  })
})
