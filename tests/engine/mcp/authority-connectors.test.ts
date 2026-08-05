import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  SceneGraph,
  setObjectGraphConnectionsOnPage
} from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument
} from '#mcp/local-workspace-authority/document'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []

interface RpcResult {
  [key: string]: unknown
}

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

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-connectors-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  page.name = 'Connector Board'
  const source = graph.createNode('RECTANGLE', page.id, {
    height: 120,
    name: 'Source',
    width: 180,
    x: 80,
    y: 120
  })
  const target = graph.createNode('ELLIPSE', page.id, {
    height: 120,
    name: 'Target',
    width: 180,
    x: 520,
    y: 120
  })
  const alternate = graph.createNode('RECTANGLE', page.id, {
    height: 120,
    name: 'Alternate',
    width: 180,
    x: 520,
    y: 420
  })
  const otherPage = graph.addPage('Other Board')
  const otherTarget = graph.createNode('RECTANGLE', otherPage.id, {
    height: 120,
    name: 'Other target',
    width: 180,
    x: 520,
    y: 120
  })
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-connectors',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-connectors',
    sourceWorkspaceId: 'workspace-connectors'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected initialized connector authority head')
  return {
    alternate,
    head,
    otherPage,
    otherTarget,
    page,
    root,
    runtime: new LocalWorkspaceBoardRuntime(store),
    source,
    store,
    target
  }
}

function recordValue(value: unknown, message: string): RpcResult {
  if (!value || typeof value !== 'object') throw new Error(message)
  return value as RpcResult
}

function responseResult(value: unknown): RpcResult {
  if (!value || typeof value !== 'object') throw new Error('Expected RPC response object')
  const result = (value as { result?: unknown }).result
  return recordValue(result, 'Expected RPC result object')
}

async function boardContext(
  f: Awaited<ReturnType<typeof fixture>>,
  runtime = f.runtime,
  pageId = f.page.id
) {
  return responseResult(
    await runtime.sendRpc({
      command: 'board_context',
      args: {
        content_document_id: f.head.identity.documentId,
        document_id: f.head.identity.documentId,
        page_id: pageId,
        workspace_id: f.head.identity.workspaceId
      }
    })
  )
}

function connectRequest(
  context: RpcResult,
  sourceId: string,
  targetId: string,
  requestId: string,
  overrides: RpcResult = {}
) {
  return {
    command: 'connect_objects',
    args: {
      base: context.connect_objects_base,
      kind: 'visual',
      label: 'Explains',
      request_id: requestId,
      source_id: sourceId,
      target_id: targetId,
      ...overrides
    }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace authority Object Graph connectors', () => {
  test('persists and replays one semantic connector across restart without route geometry', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    expect(context).toMatchObject({
      capabilities: expect.arrayContaining(['board.change.object_graph.connect']),
      connect_objects_base: {
        expected_revision: 1,
        page_id: f.page.id,
        workspace_id: 'workspace-connectors'
      }
    })
    const request = connectRequest(context, f.source.id, f.target.id, 'request:connector-persist')
    const applied = responseResult(await f.runtime.sendRpc(request))
    expect(applied).toMatchObject({
      persistence: { authority_revision: 2, status: 'durable' },
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      proof: {
        durable_readback: 'passed',
        normal_editor_undo: 'unavailable',
        pixels: 'not_evaluated'
      },
      readback: {
        connection_liveness: { current: 'present', historical: 'applied' },
        object_graph_connection: {
          automatic: false,
          kind: 'visual',
          sourceNodeId: f.source.id,
          targetNodeId: f.target.id
        }
      },
      receipt: { idempotent_replay: false, requestId: 'request:connector-persist' },
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'applied',
        reason: 'no_live_runtime'
      }
    })
    const connection = (applied.readback as { object_graph_connection: Record<string, unknown> })
      .object_graph_connection
    expect(Object.keys(connection).sort()).toEqual([
      'automatic',
      'id',
      'kind',
      'label',
      'permissions',
      'schemaVersion',
      'sourceNodeId',
      'sourcePort',
      'targetNodeId',
      'targetPort'
    ])

    const restarted = new LocalWorkspaceBoardRuntime(
      new LocalWorkspaceAuthorityStore({
        preferredWorkspaceId: 'workspace-connectors',
        root: f.root
      })
    )
    const fresh = await boardContext(f, restarted)
    const verified = responseResult(
      await restarted.sendRpc({
        command: 'board_verify',
        args: {
          ...recordValue(fresh.connect_objects_base, 'Expected connector base'),
          request_id: 'request:connector-persist'
        }
      })
    )
    expect(verified).toMatchObject({
      object_graph_connections: [
        {
          connection_liveness: { current: 'present', historical: 'applied' },
          object_graph_connection: { id: connection.id }
        }
      ],
      status: 'matched'
    })
    const replayed = responseResult(
      await restarted.sendRpc(
        connectRequest(fresh, f.source.id, f.target.id, 'request:connector-persist')
      )
    )
    expect(replayed).toMatchObject({
      readback: { object_graph_connection: { id: connection.id } },
      receipt: { historical_only: false, idempotent_replay: true, live_status: 'present' },
      status: { command: 'unavailable', mutation: 'replayed', reason: 'no_live_runtime' }
    })
    const head = await f.store.head()
    if (!head) throw new Error('Expected connector authority head')
    const document = readAuthorityBoardDocument(head.document)
    expect(objectGraphConnectionsOnPage(document.graph, f.page.id)).toHaveLength(1)
    expect(head.revision).toBe(2)
  })

  test('refuses unsafe activation and wrong endpoint scopes before mutation', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const cases = [
      connectRequest(context, f.source.id, f.source.id, 'request:self'),
      connectRequest(context, f.source.id, 'node:missing', 'request:missing'),
      connectRequest(context, f.source.id, f.otherTarget.id, 'request:cross-page'),
      connectRequest(context, f.source.id, f.target.id, 'request:visual-auto', {
        automatic: true
      }),
      connectRequest(context, f.source.id, f.target.id, 'request:data-unspecified', {
        kind: 'data'
      }),
      connectRequest(context, f.source.id, f.target.id, 'request:unsupported', {
        visual: { profile: 'invented' }
      })
    ]
    const fragments = [
      'connection was refused',
      'connection was refused',
      'connection was refused',
      'visual connections cannot be automatic',
      'requires explicit automatic true or false',
      'unsupported fields: visual'
    ]
    for (const [index, request] of cases.entries()) {
      await expect(f.runtime.sendRpc(request)).rejects.toThrow(fragments[index])
    }
    await expect(
      f.runtime.sendRpc({
        command: 'connect_objects',
        args: {
          ...recordValue(context.connect_objects_base, 'Expected connector base'),
          kind: 'visual',
          request_id: 'request:wrong-workspace',
          source_id: f.source.id,
          target_id: f.target.id,
          workspace_id: 'workspace-wrong'
        }
      })
    ).rejects.toThrow('owns workspace')
    expect((await f.store.head())?.revision).toBe(1)
  })

  test('replays a stale original request but rejects changed input and duplicates', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const request = connectRequest(context, f.source.id, f.target.id, 'request:stable-replay')
    const applied = responseResult(await f.runtime.sendRpc(request))
    const connectionId = (applied.readback as { object_graph_connection: { id: string } })
      .object_graph_connection.id

    await expect(
      f.runtime.sendRpc(
        connectRequest(context, f.source.id, f.target.id, 'request:stable-replay', {
          label: 'Changed intent'
        })
      )
    ).rejects.toThrow('already used for a different mutation')
    const replay = responseResult(await f.runtime.sendRpc(request))
    expect(replay).toMatchObject({
      readback: { object_graph_connection: { id: connectionId } },
      receipt: { idempotent_replay: true }
    })

    const fresh = await boardContext(f)
    await expect(
      f.runtime.sendRpc(
        connectRequest(fresh, f.source.id, f.target.id, 'request:semantic-duplicate')
      )
    ).rejects.toThrow('same connection does not already exist')
    expect((await f.store.head())?.revision).toBe(2)
  })

  test('allows only one competing CAS mutation from the same authority revision', async () => {
    const f = await fixture()
    const firstContext = await boardContext(f)
    const secondContext = await boardContext(f)
    const results = await Promise.allSettled([
      f.runtime.sendRpc(
        connectRequest(firstContext, f.source.id, f.target.id, 'request:cas-first')
      ),
      f.runtime.sendRpc(
        connectRequest(secondContext, f.source.id, f.alternate.id, 'request:cas-second')
      )
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    const rejection = results.find((result) => result.status === 'rejected')
    expect(String(rejection?.reason)).toMatch(/stale|Expected revision/)
    const head = await f.store.head()
    if (!head) throw new Error('Expected connector authority head')
    expect(head.revision).toBe(2)
    expect(
      objectGraphConnectionsOnPage(readAuthorityBoardDocument(head.document).graph, f.page.id)
    ).toHaveLength(1)
  })

  test('keeps deleted or diverged connections historical without recreating them', async () => {
    const missing = await fixture()
    const missingContext = await boardContext(missing)
    const missingRequest = connectRequest(
      missingContext,
      missing.source.id,
      missing.target.id,
      'request:historical-missing'
    )
    const missingApplied = responseResult(await missing.runtime.sendRpc(missingRequest))
    const missingId = (missingApplied.readback as { object_graph_connection: { id: string } })
      .object_graph_connection.id
    const missingHead = await missing.store.head()
    if (!missingHead) throw new Error('Expected applied missing authority head')
    const missingDocument = readAuthorityBoardDocument(missingHead.document)
    setObjectGraphConnectionsOnPage(missingDocument.graph, missing.page.id, [])
    await missing.store.commit({
      document: writeAuthorityBoardDocument(missingDocument),
      expectedContentHash: missingHead.contentHash,
      expectedRevision: missingHead.revision,
      requestId: 'request:delete-connection',
      workspaceId: missingHead.identity.workspaceId
    })
    const missingReplay = responseResult(await missing.runtime.sendRpc(missingRequest))
    expect(missingReplay).toMatchObject({
      readback: {
        connection_liveness: { current: 'missing', historical: 'applied' },
        object_graph_connection: { id: missingId, missing: true }
      },
      receipt: { historical_only: true, idempotent_replay: true, live_status: 'missing' },
      status: { mutation: 'replayed', reason: 'historical_receipt_only' }
    })
    expect((await missing.store.head())?.revision).toBe(3)

    const diverged = await fixture()
    const divergedContext = await boardContext(diverged)
    const divergedRequest = connectRequest(
      divergedContext,
      diverged.source.id,
      diverged.target.id,
      'request:historical-diverged'
    )
    const divergedApplied = responseResult(await diverged.runtime.sendRpc(divergedRequest))
    const divergedId = (divergedApplied.readback as { object_graph_connection: { id: string } })
      .object_graph_connection.id
    const divergedHead = await diverged.store.head()
    if (!divergedHead) throw new Error('Expected applied diverged authority head')
    const divergedDocument = readAuthorityBoardDocument(divergedHead.document)
    const connection = objectGraphConnectionById(
      divergedDocument.graph,
      diverged.page.id,
      divergedId
    )
    if (!connection) throw new Error('Expected connection before divergence')
    setObjectGraphConnectionsOnPage(divergedDocument.graph, diverged.page.id, [
      { ...connection, label: 'Changed outside the request' }
    ])
    await diverged.store.commit({
      document: writeAuthorityBoardDocument(divergedDocument),
      expectedContentHash: divergedHead.contentHash,
      expectedRevision: divergedHead.revision,
      requestId: 'request:diverge-connection',
      workspaceId: divergedHead.identity.workspaceId
    })
    const divergedReplay = responseResult(await diverged.runtime.sendRpc(divergedRequest))
    expect(divergedReplay).toMatchObject({
      readback: {
        connection_liveness: { current: 'diverged', historical: 'applied' },
        object_graph_connection: { id: divergedId, label: 'Changed outside the request' }
      },
      receipt: { historical_only: true, idempotent_replay: true, live_status: 'diverged' },
      status: { mutation: 'replayed', reason: 'historical_receipt_diverged' }
    })
    expect((await diverged.store.head())?.revision).toBe(3)
  })
})
