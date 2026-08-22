import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalWorkspaceAuthorityStore } from '@open-pencil/mcp/local-workspace-authority'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createBoardPage } from '#cli/commands/boards'
import {
  createLocalAuthorityRpcClient,
  isLocalAuthorityRpc,
  sendLocalAuthorityRpcEnvelope
} from '#cli/local-authority-client'

const roots: string[] = []

function savedDocument(graph: SceneGraph) {
  return {
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    images: [...graph.images],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    nodes: [...graph.nodes],
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables],
    version: 2
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('direct local Board authority client', () => {
  test('routes persisted Board work directly but keeps live presentation on the service', () => {
    expect(isLocalAuthorityRpc('board_build', {})).toBe(true)
    expect(isLocalAuthorityRpc('trace_get_gesture', { latest: true })).toBe(true)
    expect(isLocalAuthorityRpc('board_present', {})).toBe(false)
    expect(isLocalAuthorityRpc('trace_query', {})).toBe(true)
    expect(isLocalAuthorityRpc('board_context', { target: 'current_visible' })).toBe(false)
    expect(isLocalAuthorityRpc('board_build', {})).toBe(true)
    expect(isLocalAuthorityRpc('board_build', { runtime_instance_id: 'runtime:live' })).toBe(true)
  })

  test('fails closed when persisted authority is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-cli-empty-authority-'))
    roots.push(root)
    const client = createLocalAuthorityRpcClient({ root })

    await expect(sendLocalAuthorityRpcEnvelope(client, 'board_build')).rejects.toThrow(
      'persisted_authority_unavailable:'
    )
  })

  test('creates a durable Board through the sole persisted authority without target flags', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-cli-create-authority-'))
    roots.push(root)
    const workspaceId = 'workspace-create-cli'
    const graph = new SceneGraph()
    const sourcePage = graph.getPages()[0]
    const store = new LocalWorkspaceAuthorityStore({ preferredWorkspaceId: workspaceId, root })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-create-cli',
      sourceWorkspaceId: workspaceId
    })
    const client = createLocalAuthorityRpcClient({ preferredWorkspaceId: workspaceId, root })

    const result = await createBoardPage(
      { name: 'One Command Board', 'request-id': 'request:one-command-create' },
      (command, args) =>
        sendLocalAuthorityRpcEnvelope<Record<string, unknown>>(client, command, args)
    )

    expect(result).toMatchObject({
      source_page_id: sourcePage.id,
      status: 'created',
      target: { pageName: 'One Command Board', workspaceId }
    })
    const reopened = createLocalAuthorityRpcClient({ preferredWorkspaceId: workspaceId, root })
    await expect(reopened.send<Record<string, unknown>>('list_documents')).resolves.toMatchObject({
      result: {
        documents: [
          {
            pages: expect.arrayContaining([expect.objectContaining({ name: 'One Command Board' })]),
            workspace_id: workspaceId
          }
        ]
      }
    })
    expect((await store.head())?.revision).toBe(2)
  })

  test('reads the latest persisted Trace without an HTTP or browser runtime', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-cli-authority-'))
    roots.push(root)
    const workspaceId = 'workspace-direct-cli'
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const card = graph.createNode('FRAME', page.id, { name: 'Traced card' })
    const store = new LocalWorkspaceAuthorityStore({ preferredWorkspaceId: workspaceId, root })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-direct-cli',
      sourceWorkspaceId: workspaceId
    })
    const head = await store.head()
    if (!head) throw new Error('Expected initialized authority head')
    const gesture = {
      boardOrigin: {
        contentDocumentId: head.identity.documentId,
        pageId: page.id,
        workspaceId
      },
      candidates: {
        count: 1,
        items: [{ stableId: card.id }],
        primaryTargetId: card.id,
        truncated: false
      },
      capturedAt: '2026-08-02T12:00:00.000Z',
      contract: 'trace-gesture-agent/v1',
      geometry: { kind: 'focus', pageRegion: { height: 100, width: 100, x: 0, y: 0 } },
      gestureId: 'gesture:direct-cli',
      sessionId: 'session:direct-cli'
    }
    await store.recordTraceSession({
      gestures: [gesture],
      session: {
        contextDraft: [],
        durationMs: 1_000,
        events: [
          {
            atMs: 250,
            id: 'event:direct-cli',
            kind: 'transcript',
            label: 'Direct CLI Trace',
            text: 'Direct CLI Trace'
          }
        ],
        id: gesture.sessionId,
        scope: {
          documentId: head.identity.documentId,
          pageId: page.id,
          workspaceId
        },
        startedAt: gesture.capturedAt
      },
      summary: {
        durationMs: 1_000,
        eventCount: 1,
        evidenceCount: 0,
        id: gesture.sessionId,
        scope: {
          documentId: head.identity.documentId,
          pageId: page.id,
          workspaceId
        },
        searchTerms: ['direct', 'cli', 'trace'],
        startedAt: gesture.capturedAt,
        title: 'Direct CLI Trace',
        updatedAt: gesture.capturedAt
      }
    })

    const client = createLocalAuthorityRpcClient({ preferredWorkspaceId: workspaceId, root })
    expect(client.isReady()).toBe(true)
    const response = await client.send<Record<string, unknown>>('trace_get_gesture', {
      latest: true
    })

    expect(response.result).toMatchObject({
      gesture: {
        boardOrigin: { runtimeInstanceId: `local-authority:${head.authorityId}` },
        candidates: { primaryTargetId: card.id },
        gestureId: 'gesture:direct-cli'
      },
      status: 'matched'
    })

    await expect(
      sendLocalAuthorityRpcEnvelope(client, 'trace_query', { query: 'Direct CLI Trace' })
    ).resolves.toMatchObject({
      result: {
        matches: [{ sessionId: gesture.sessionId }],
        status: 'matched'
      }
    })

    const context = await sendLocalAuthorityRpcEnvelope<Record<string, unknown>>(
      client,
      'board_context',
      {
        content_document_id: head.identity.documentId,
        document_id: head.identity.documentId,
        page_id: page.id,
        runtime_instance_id: `local-authority:${head.authorityId}`,
        workspace_id: workspaceId
      }
    )
    const base = context.result.board_build_base as Record<string, unknown>
    let refusal: unknown
    try {
      await sendLocalAuthorityRpcEnvelope(client, 'board_build', {
        ...base,
        intent: 'Reject before mutation',
        plan: { contract: 'unsupported-board-plan' },
        request_id: 'request:direct-cli-refusal',
        trace_id: gesture.gestureId
      })
    } catch (error) {
      refusal = error
    }

    expect(refusal).toBeInstanceOf(Error)
    expect(refusal).toMatchObject({
      name: 'LocalWorkspaceBoardRpcError',
      result: {
        current_revision: head.revision,
        failure_scope: 'pre_mutation',
        status: { command: 'refused', mutation: 'not_applied' },
        target: {
          content_document_id: head.identity.documentId,
          document_id: head.identity.documentId,
          page_id: page.id,
          page_name: page.name,
          runtime_instance_id: `local-authority:${head.authorityId}`,
          workspace_id: workspaceId
        },
        trace: { gesture_id: gesture.gestureId }
      },
      target: {
        boardRevision: head.revision,
        contentDocumentId: head.identity.documentId,
        documentId: head.identity.documentId,
        pageId: page.id,
        pageName: page.name,
        runtimeInstanceId: `local-authority:${head.authorityId}`,
        workspaceId
      }
    })
    expect((await store.head())?.revision).toBe(head.revision)
  })
})
