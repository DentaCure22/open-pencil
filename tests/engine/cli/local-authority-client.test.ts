import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalWorkspaceAuthorityStore } from '@open-pencil/mcp/local-workspace-authority'
import { SceneGraph } from '@open-pencil/scene-graph'

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
  test('routes persisted Board reads directly but keeps live presentation on the service', () => {
    expect(isLocalAuthorityRpc('board_context', {})).toBe(true)
    expect(isLocalAuthorityRpc('board_read', {})).toBe(true)
    expect(isLocalAuthorityRpc('trace_get_gesture', { latest: true })).toBe(true)
    expect(isLocalAuthorityRpc('trace_query', {})).toBe(true)
    expect(isLocalAuthorityRpc('board_present', {})).toBe(false)
    expect(isLocalAuthorityRpc('board_context', { target: 'current_visible' })).toBe(false)
    expect(() => isLocalAuthorityRpc('board_build', {})).toThrow(
      'rpc_execution_surface_unclassified'
    )
  })

  test('fails closed when persisted authority is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-cli-empty-authority-'))
    roots.push(root)
    const client = createLocalAuthorityRpcClient({ root })

    await expect(sendLocalAuthorityRpcEnvelope(client, 'board_context')).rejects.toThrow(
      'persisted_authority_unavailable:'
    )
  })

  test('reads persisted Board and Trace state without an HTTP or browser runtime', async () => {
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
    const capturedAt = '2026-08-02T12:00:00.000Z'
    await store.recordTraceSession({
      gestures: [
        {
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
          capturedAt,
          contract: 'trace-gesture-agent/v1',
          geometry: { kind: 'focus', pageRegion: { height: 100, width: 100, x: 0, y: 0 } },
          gestureId: 'gesture:direct-cli',
          sessionId: 'session:direct-cli'
        }
      ],
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
        id: 'session:direct-cli',
        scope: { documentId: head.identity.documentId, pageId: page.id, workspaceId },
        startedAt: capturedAt
      },
      summary: {
        durationMs: 1_000,
        eventCount: 1,
        evidenceCount: 0,
        id: 'session:direct-cli',
        scope: { documentId: head.identity.documentId, pageId: page.id, workspaceId },
        searchTerms: ['direct', 'cli', 'trace'],
        startedAt: capturedAt,
        title: 'Direct CLI Trace',
        updatedAt: capturedAt
      }
    })

    const client = createLocalAuthorityRpcClient({ preferredWorkspaceId: workspaceId, root })
    const context = await client.send<Record<string, unknown>>('board_context', {
      page_id: page.id,
      workspace_id: workspaceId
    })
    expect(context.result).not.toHaveProperty('board_build_base')
    expect(context.result).not.toHaveProperty('connect_objects_base')

    await expect(
      sendLocalAuthorityRpcEnvelope(client, 'trace_query', { query: 'Direct CLI Trace' })
    ).resolves.toMatchObject({
      result: {
        matches: [{ sessionId: 'session:direct-cli' }],
        status: 'matched'
      }
    })
    expect((await store.head())?.revision).toBe(head.revision)
  })
})
