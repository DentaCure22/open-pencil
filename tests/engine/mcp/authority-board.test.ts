import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import WebSocket, { type WebSocketServer } from 'ws'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument
} from '#mcp/local-workspace-authority/document'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'
import { startServer } from '#mcp/server'

const roots: string[] = []

function waitForWsListening(wss: WebSocketServer): Promise<number> {
  return new Promise((resolve) => {
    if (wss.address()) {
      resolve((wss.address() as AddressInfo).port)
      return
    }
    wss.on('listening', () => resolve((wss.address() as AddressInfo).port))
  })
}

async function waitForBrowserConnection(server: ReturnType<typeof startServer>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const health = (await (await server.app.request('/health')).json()) as {
      browserConnected?: boolean
    }
    if (health.browserConnected) return
    await new Promise((resolve) => {
      setTimeout(resolve, 5)
    })
  }
  throw new Error('Mock browser did not register with the MCP server')
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

async function fixture(options: { withAnchor?: boolean } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-board-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  page.name = 'Headless Board'
  const anchor = options.withAnchor
    ? graph.createNode('FRAME', page.id, {
        height: 100,
        name: 'Headless anchor',
        width: 200,
        x: 120,
        y: 160
      })
    : undefined
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-headless',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-headless',
    sourceWorkspaceId: 'workspace-headless'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected initialized authority head')
  return { anchor, graph, head, page, root, runtime: new LocalWorkspaceBoardRuntime(store), store }
}

function requireAnchor(anchor: SceneNode | undefined): SceneNode {
  if (!anchor) throw new Error('Expected headless Board anchor')
  return anchor
}

function contextArgs(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    command: 'board_context',
    args: {
      content_document_id: f.head.identity.documentId,
      document_id: f.head.identity.documentId,
      page_id: f.page.id,
      workspace_id: f.head.identity.workspaceId
    }
  }
}

function persistedTraceGesture(f: Awaited<ReturnType<typeof fixture>>, objectId: string) {
  return {
    boardOrigin: {
      contentDocumentId: f.head.identity.documentId,
      pageId: f.page.id,
      workspaceId: f.head.identity.workspaceId
    },
    candidates: {
      count: 1,
      items: [{ stableId: objectId }],
      primaryTargetId: objectId,
      truncated: false
    },
    capturedAt: '2026-08-01T12:00:00.000Z',
    contract: 'trace-gesture-agent/v1',
    geometry: {
      kind: 'focus',
      pageRegion: { height: 120, width: 240, x: 100, y: 140 }
    },
    gestureId: 'gesture:headless',
    sessionId: 'session:headless'
  }
}

async function persistTraceGesture(f: Awaited<ReturnType<typeof fixture>>, objectId: string) {
  const gesture = persistedTraceGesture(f, objectId)
  await f.store.recordTraceSession({
    gestures: [gesture],
    session: {
      contextDraft: [],
      durationMs: 0,
      events: [],
      id: gesture.sessionId,
      startedAt: gesture.capturedAt
    },
    summary: {
      id: gesture.sessionId,
      startedAt: gesture.capturedAt,
      title: 'Headless Trace',
      updatedAt: gesture.capturedAt
    }
  })
}

function responseResult(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Expected RPC response object')
  const result = (value as { result?: unknown }).result
  if (!result || typeof result !== 'object') throw new Error('Expected RPC result object')
  return result as Record<string, unknown>
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace authority Board runtime', () => {
  test('reads and prepares persisted Trace context without a live browser', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    await persistTraceGesture(f, anchor.id)

    const trace = responseResult(
      await f.runtime.sendRpc({ command: 'trace_get_gesture', args: { latest: true } })
    )
    expect(trace).toMatchObject({
      gesture: {
        boardOrigin: {
          runtimeInstanceId: `local-authority:${f.head.authorityId}`
        },
        candidates: { primaryTargetId: anchor.id },
        gestureId: 'gesture:headless'
      },
      status: 'matched'
    })

    const prepared = responseResult(
      await f.runtime.sendRpc({
        command: 'board_prepare_edit',
        args: {
          candidate_object_ids: [anchor.id],
          content_document_id: f.head.identity.documentId,
          document_id: f.head.identity.documentId,
          gesture_id: 'gesture:headless',
          intent: 'Edit what was traced',
          page_id: f.page.id,
          primary_target_id: anchor.id,
          region: { height: 120, width: 240, x: 100, y: 140 },
          runtime_instance_id: `local-authority:${f.head.authorityId}`,
          workspace_id: f.head.identity.workspaceId
        }
      })
    )
    expect(prepared).toMatchObject({
      board_build_base: {
        expected_revision: f.head.revision,
        runtime_instance_id: `local-authority:${f.head.authorityId}`
      },
      contract: 'board-edit-context/v1',
      resolution: {
        candidate_object_ids: [anchor.id],
        selected_object_id: anchor.id,
        status: 'resolved'
      },
      trace_region: { height: 120, width: 240, x: 100, y: 140 }
    })
  })

  test('queues exact latest-wins navigation without mutating the Board', async () => {
    const f = await fixture()
    const first = responseResult(
      await f.runtime.sendRpc({ command: 'board_open', args: contextArgs(f).args })
    )
    const second = responseResult(
      await f.runtime.sendRpc({ command: 'board_open', args: contextArgs(f).args })
    )

    expect(first).toMatchObject({
      action: 'queued',
      page_id: f.page.id,
      sequence: 1,
      status: 'queued_for_editor'
    })
    expect(second).toMatchObject({
      action: 'queued',
      page_id: f.page.id,
      sequence: 2,
      status: 'queued_for_editor'
    })
    expect(await f.store.consumeNavigationIntent(String(first.intent_id))).toBe(false)
    expect(await f.store.pendingNavigationIntent()).toMatchObject({
      intentId: second.intent_id,
      sequence: 2
    })
    expect((await f.store.head())?.revision).toBe(f.head.revision)
  })

  test('runs a deterministic token-budgeted query without a live editor', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const result = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          projection: 'id_only',
          query: { name: 'headless anchor', types: ['frame'] },
          scope: 'query',
          sort: 'name',
          token_budget: 256
        }
      })
    )

    expect(result).toMatchObject({
      completeness: 'complete',
      count: 1,
      execution_surface: 'local_workspace_authority',
      index_candidates: 1,
      index_nodes: 1,
      index_scanned: 1,
      index_status: 'built',
      projection: 'id_only',
      returned: 1,
      scope: 'query',
      status: 'matched',
      token_budget: 256,
      truncated: false
    })
    expect(result.nodes).toEqual([{ id: anchor.id, parent_id: f.page.id, type: 'FRAME' }])
    expect(result.estimated_payload_tokens).toBeLessThanOrEqual(256)
    expect(result.index_revision).toBe(f.head.revision)

    const reused = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          projection: 'id_only',
          query: { name: 'headless anchor', types: ['frame'] },
          scope: 'query',
          sort: 'name',
          token_budget: 256
        }
      })
    )
    expect(reused).toMatchObject({
      index_candidates: 1,
      index_revision: f.head.revision,
      index_scanned: 1,
      index_status: 'reused'
    })

    const current = await f.store.head()
    if (!current) throw new Error('Expected authority head before query-index invalidation')
    const nextDocument = readAuthorityBoardDocument(current.document)
    nextDocument.graph.createNode('FRAME', f.page.id, {
      height: 80,
      name: 'New indexed target',
      width: 160,
      x: 500,
      y: 500
    })
    await f.store.commit({
      document: writeAuthorityBoardDocument(nextDocument),
      expectedContentHash: current.contentHash,
      expectedRevision: current.revision,
      requestId: 'request:query-index-invalidation',
      workspaceId: current.identity.workspaceId
    })
    const freshContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const rebuilt = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: freshContext.context_token,
          projection: 'id_only',
          query: { name: 'new indexed target' },
          scope: 'query',
          token_budget: 256
        }
      })
    )
    expect(rebuilt).toMatchObject({
      count: 1,
      index_candidates: 1,
      index_nodes: 2,
      index_revision: f.head.revision + 1,
      index_scanned: 1,
      index_status: 'rebuilt'
    })
  })

  test('reads exact saved objects and their descendants without a live editor', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const created = responseResult(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(context.board_build_base as Record<string, unknown>),
          intent: 'Create a targeted read fixture',
          recipe: {
            body: 'Child content',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 400, y: 300 } },
            title: 'Target owner'
          },
          request_id: 'request:targeted-read-card'
        }
      })
    )
    const ownerId = created.owner_id as string
    const result = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: (created.context as Record<string, unknown>).context_token,
          object_ids: [ownerId],
          scope: 'objects'
        }
      })
    )
    expect(result).toMatchObject({
      count: 3,
      execution_surface: 'local_workspace_authority',
      requested_object_ids: [ownerId],
      scope: 'objects',
      status: 'matched'
    })
    expect(result.nodes).toHaveLength(3)
  })

  test('sizes explicit native-card lines while keeping one-line cards compact', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const multiline = responseResult(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(context.board_build_base as Record<string, unknown>),
          intent: 'Create a readable rollout checklist',
          recipe: {
            body: '• QA\n• Docs\n• Rollout',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 400, y: 300 } },
            title: 'Ship checklist'
          },
          request_id: 'request:multiline-card'
        }
      })
    )
    const multilineCard = (
      multiline.readback as {
        card: {
          body: { bounds: { height: number; width: number; x: number; y: number } }
          owner: { bounds: { height: number; width: number; x: number; y: number } }
        }
      }
    ).card
    expect(multilineCard.body.bounds.height).toBe(60)
    expect(multilineCard.owner.bounds.height).toBe(148)
    expect(multilineCard.body.bounds.x).toBeGreaterThanOrEqual(multilineCard.owner.bounds.x)
    expect(multilineCard.body.bounds.y).toBeGreaterThanOrEqual(multilineCard.owner.bounds.y)
    expect(multilineCard.body.bounds.x + multilineCard.body.bounds.width).toBeLessThanOrEqual(
      multilineCard.owner.bounds.x + multilineCard.owner.bounds.width
    )
    expect(multilineCard.body.bounds.y + multilineCard.body.bounds.height).toBeLessThanOrEqual(
      multilineCard.owner.bounds.y + multilineCard.owner.bounds.height
    )

    const compact = responseResult(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...((multiline.context as Record<string, unknown>).board_build_base as Record<
            string,
            unknown
          >),
          intent: 'Create a compact status card',
          recipe: {
            body: 'Ready.',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 900, y: 300 } },
            title: 'Status'
          },
          request_id: 'request:compact-card'
        }
      })
    )
    const compactCard = (
      compact.readback as {
        card: { body: { bounds: { height: number } }; owner: { bounds: { height: number } } }
      }
    ).card
    expect(compactCard.body.bounds.height).toBe(20)
    expect(compactCard.owner.bounds.height).toBe(108)
  })

  test('auto-places a headless native card from deterministic persisted content bounds', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    expect(context.capabilities).toContain('board.build.native_card.auto_placement')
    const base = context.board_build_base as Record<string, unknown>
    const logicalArgs = {
      intent: 'Place an ordinary card without caller geometry math',
      recipe: {
        body: 'The persisted authority owns bounded deterministic placement.',
        kind: 'native_card',
        placement: { target: { kind: 'auto' } },
        title: 'Headless automatic placement'
      },
      request_id: 'request:headless-auto-card'
    }
    const applied = responseResult(
      await f.runtime.sendRpc({ command: 'board_build', args: { ...base, ...logicalArgs } })
    )
    const card = applied.readback as {
      card: {
        owner: { bounds: { height: number; width: number; x: number; y: number }; id: string }
      }
    }
    expect(applied).toMatchObject({
      receipt: {
        idempotent_replay: false,
        placement: { algorithm: 'nearest-free/v1', rejectedCandidates: 1 }
      },
      status: { command: 'completed', mutation: 'applied' }
    })
    expect(card.card.owner.bounds.x).toBe(anchor.x + anchor.width / 2 + 320 + 48 - 160)
    expect(card.card.owner.bounds.x).toBeGreaterThanOrEqual(anchor.x + anchor.width + 48)

    const restarted = new LocalWorkspaceBoardRuntime(
      new LocalWorkspaceAuthorityStore({ preferredWorkspaceId: 'workspace-headless', root: f.root })
    )
    const freshContext = responseResult(await restarted.sendRpc(contextArgs(f)))
    const replayed = responseResult(
      await restarted.sendRpc({
        command: 'board_build',
        args: {
          ...(freshContext.board_build_base as Record<string, unknown>),
          ...logicalArgs,
          expected_revision: base.expected_revision
        }
      })
    )
    expect(replayed).toMatchObject({
      owner_id: card.card.owner.id,
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...(freshContext.board_build_base as Record<string, unknown>),
          ...logicalArgs,
          recipe: {
            ...logicalArgs.recipe,
            placement: { target: { kind: 'point', x: 800, y: 600 } }
          }
        }
      })
    ).rejects.toThrow('already used for a different mutation')
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...(freshContext.board_build_base as Record<string, unknown>),
          intent: 'Omission must not become automatic placement',
          recipe: {
            body: 'This must not be created.',
            kind: 'native_card',
            title: 'Missing target'
          },
          request_id: 'request:headless-card-missing-target'
        }
      })
    ).rejects.toThrow('requires placement.target')
    expect((await f.store.head())?.revision).toBe(2)
  })

  test('places a headless native card beside an exact persisted object', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const applied = responseResult(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(context.board_build_base as Record<string, unknown>),
          intent: 'Place a card beside the exact persisted object',
          recipe: {
            body: 'Relative placement avoids caller-side coordinate math.',
            kind: 'native_card',
            placement: { target: { kind: 'relative', object_id: anchor.id } },
            title: 'Relative card'
          },
          request_id: 'request:headless-relative-card'
        }
      })
    )
    const owner = (
      applied.readback as {
        card: { owner: { bounds: { height: number; width: number; x: number; y: number } } }
      }
    ).card.owner

    expect(owner.bounds.x).toBe(anchor.x + anchor.width + 48)
    expect(owner.bounds.y).toBe(anchor.y)
    expect(applied).toMatchObject({
      receipt: {
        placement: { algorithm: 'nearest-free/v1', rejectedCandidates: 0 }
      },
      status: { command: 'completed', mutation: 'applied' }
    })
  })

  test('lists, contexts, reads, builds, verifies, and replays without a browser', async () => {
    const f = await fixture()
    const documents = responseResult(
      await f.runtime.sendRpc({ command: 'list_documents', args: {} })
    ) as { documents: Array<Record<string, unknown>>; runtime_instance_id: string }
    expect(documents.runtime_instance_id).toBe(`local-authority:${f.head.authorityId}`)
    expect(documents.documents).toHaveLength(1)
    expect(documents.documents[0]).toMatchObject({
      active: false,
      execution_surface: 'local_workspace_authority',
      workspace_id: 'workspace-headless'
    })

    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    expect(context).toMatchObject({
      execution_surface: 'local_workspace_authority',
      runtime: { visibility: 'headless', write_authority: 'writer' },
      viewport: { reason: 'no_live_runtime', status: 'unavailable' }
    })
    const base = context.board_build_base as Record<string, unknown>
    const buildRequest = {
      command: 'board_build',
      args: {
        ...base,
        intent: 'Persist a useful headless artifact',
        recipe: {
          body: 'This card was authored through the persisted workspace authority.',
          kind: 'native_card',
          placement: { target: { kind: 'point', x: 600, y: 400 } },
          title: 'Headless Board proof'
        },
        request_id: 'request:headless-card'
      }
    }
    const built = responseResult(await f.runtime.sendRpc(buildRequest))
    expect(built).toMatchObject({
      execution_surface: 'local_workspace_authority',
      persistence: { authority_revision: 2, status: 'durable' },
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      receipt: { idempotent_replay: false, requestId: 'request:headless-card' },
      status: { command: 'completed', mutation: 'applied' }
    })

    const restarted = new LocalWorkspaceBoardRuntime(
      new LocalWorkspaceAuthorityStore({ preferredWorkspaceId: 'workspace-headless', root: f.root })
    )
    const freshContext = responseResult(await restarted.sendRpc(contextArgs(f)))
    const verify = responseResult(
      await restarted.sendRpc({
        command: 'board_verify',
        args: {
          ...(freshContext.board_build_base as Record<string, unknown>),
          request_id: 'request:headless-card'
        }
      })
    )
    expect(verify).toMatchObject({ status: 'matched' })
    expect(verify.nodes).toHaveLength(1)

    const replay = responseResult(
      await restarted.sendRpc({
        ...buildRequest,
        args: {
          ...buildRequest.args,
          ...(freshContext.board_build_base as Record<string, unknown>)
        }
      })
    )
    expect(replay).toMatchObject({
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    await expect(
      restarted.sendRpc({
        ...buildRequest,
        args: {
          ...buildRequest.args,
          ...(freshContext.board_build_base as Record<string, unknown>),
          recipe: {
            ...buildRequest.args.recipe,
            body: 'Different content must never reuse an applied request ID.'
          }
        }
      })
    ).rejects.toThrow('already used for a different mutation')
    expect((await f.store.head())?.revision).toBe(2)
  })

  test('builds anchored native text with exact durable readback and safe refusals', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    expect(context.capabilities).toContain('board.build.native_text.anchor')
    const base = context.board_build_base as Record<string, unknown>
    const logicalArgs = {
      anchor_id: anchor.id,
      intent: 'Add one durable note beside the anchor',
      recipe: {
        font_size: 18,
        kind: 'native_text',
        max_width: 360,
        name: 'Headless text proof',
        placement: {
          clearance: 48,
          preferred_directions: ['right', 'below', 'left', 'above']
        },
        text: 'Durable headless note'
      },
      request_id: 'request:headless-text'
    }
    const applied = responseResult(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: { ...base, ...logicalArgs }
      })
    )
    const appliedReadback = applied.readback as {
      graph: {
        bounds: { height: number; width: number; x: number; y: number }
        id: string
        name: string
        text: string
        type: string
        visible: boolean
      }
      reconciliation: { reasons: string[]; status: string }
    }
    expect(applied).toMatchObject({
      execution_surface: 'local_workspace_authority',
      persistence: { authority_revision: 2, status: 'durable' },
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      proof: { durable_readback: 'passed', pixels: 'not_evaluated' },
      receipt: {
        idempotent_replay: false,
        placement: { algorithm: 'nearest-free/v1', clearance: 48 },
        requestId: 'request:headless-text'
      },
      status: { command: 'completed', mutation: 'applied' }
    })
    expect(appliedReadback).toMatchObject({
      graph: {
        id: applied.owner_id,
        name: 'Headless text proof',
        text: 'Durable headless note',
        type: 'TEXT',
        visible: true
      },
      reconciliation: { reasons: [], status: 'current' }
    })
    expect(appliedReadback.graph.bounds.x).toBe(anchor.x + anchor.width + 48)
    expect(appliedReadback.graph.bounds.y).toBe(anchor.y)
    const styledHead = await f.store.head()
    if (!styledHead) throw new Error('Expected styled native-text authority head')
    const styledDocument = readAuthorityBoardDocument(styledHead.document)
    const styledOwner = styledDocument.graph.getNode(String(applied.owner_id))
    expect(styledOwner).toMatchObject({
      effects: [
        {
          color: { a: 0.92, b: 0.02, g: 0.02, r: 0.02 },
          radius: 1,
          spread: 1,
          type: 'DROP_SHADOW',
          visible: true
        }
      ],
      fills: [
        {
          color: { a: 1, b: 0.988, g: 0.98, r: 0.973 },
          opacity: 1,
          type: 'SOLID',
          visible: true
        }
      ]
    })

    const restartedStore = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-headless',
      root: f.root
    })
    const restarted = new LocalWorkspaceBoardRuntime(restartedStore)
    const freshContext = responseResult(await restarted.sendRpc(contextArgs(f)))
    const freshBase = freshContext.board_build_base as Record<string, unknown>
    const replayed = responseResult(
      await restarted.sendRpc({
        command: 'board_build',
        args: {
          ...freshBase,
          ...logicalArgs,
          expected_revision: base.expected_revision
        }
      })
    )
    expect(replayed).toMatchObject({
      owner_id: applied.owner_id,
      readback: {
        graph: { id: applied.owner_id, text: 'Durable headless note', type: 'TEXT' },
        reconciliation: { reasons: [], status: 'current' }
      },
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    expect((await restartedStore.head())?.revision).toBe(2)

    const replayContext = replayed.context as Record<string, unknown>
    const verify = responseResult(
      await restarted.sendRpc({
        command: 'board_verify',
        args: {
          ...(replayContext.board_build_base as Record<string, unknown>),
          request_id: logicalArgs.request_id
        }
      })
    )
    expect(verify).toMatchObject({
      nodes: [{ id: applied.owner_id, text: 'Durable headless note', type: 'TEXT' }],
      status: 'matched'
    })

    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...freshBase,
          ...logicalArgs,
          recipe: { ...logicalArgs.recipe, text: 'Changed payload' }
        }
      })
    ).rejects.toThrow('already used for a different mutation')
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...freshBase,
          intent: 'Missing anchor must refuse',
          recipe: logicalArgs.recipe,
          request_id: 'request:missing-anchor'
        }
      })
    ).rejects.toThrow('native_text requires exactly one of anchor_id or placement.target')
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...freshBase,
          ...logicalArgs,
          anchor_id: 'missing-anchor',
          request_id: 'request:wrong-anchor'
        }
      })
    ).rejects.toThrow('is not on Board')
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...freshBase,
          ...logicalArgs,
          request_id: 'request:wrong-target-text',
          workspace_id: 'workspace-wrong'
        }
      })
    ).rejects.toThrow('owns workspace')
    expect((await restartedStore.head())?.revision).toBe(2)

    const staleContext = responseResult(await restarted.sendRpc(contextArgs(f)))
    const staleBase = staleContext.board_build_base as Record<string, unknown>
    const current = await restartedStore.head()
    if (!current) throw new Error('Expected authority head before stale native-text refusal')
    await restartedStore.commit({
      document: { ...(current.document as Record<string, unknown>), concurrentTextChange: true },
      expectedContentHash: current.contentHash,
      expectedRevision: current.revision,
      requestId: 'request:concurrent-text-change',
      workspaceId: current.identity.workspaceId
    })
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...staleBase,
          ...logicalArgs,
          request_id: 'request:stale-text'
        }
      })
    ).rejects.toThrow('Board context is stale')
    const refusedHead = await restartedStore.head()
    if (!refusedHead) throw new Error('Expected authority head after stale native-text refusal')
    const refusedGraph = readAuthorityBoardDocument(refusedHead.document).graph
    expect(refusedHead.revision).toBe(3)
    expect(
      [...refusedGraph.getDescendants(f.page.id)].filter((node) => node.type === 'TEXT')
    ).toHaveLength(1)
  })

  test('creates one durable page and safely replays or refuses headless requests', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const base = context.board_build_base as Record<string, unknown>
    const requestId = 'request:create-headless-page'
    const request = {
      command: 'tool',
      args: {
        ...base,
        args: { name: 'Created headlessly' },
        mutation: { expectedRevision: base.expected_revision, requestId },
        name: 'create_page'
      }
    }
    const created = responseResult(await f.runtime.sendRpc(request))
    const createdPageId = created.id
    expect(created).toMatchObject({
      execution_surface: 'local_workspace_authority',
      mutation_receipt: { idempotentReplay: false, requestId },
      persistence: { authority_revision: 2, status: 'durable' },
      presentation: { reason: 'no_live_runtime', status: 'unavailable' },
      status: { mutation: 'applied' }
    })
    expect(typeof createdPageId).toBe('string')

    const restarted = new LocalWorkspaceBoardRuntime(
      new LocalWorkspaceAuthorityStore({ preferredWorkspaceId: 'workspace-headless', root: f.root })
    )
    const freshContext = responseResult(await restarted.sendRpc(contextArgs(f)))
    const freshBase = freshContext.board_build_base as Record<string, unknown>
    const replay = responseResult(
      await restarted.sendRpc({
        command: 'tool',
        args: {
          ...freshBase,
          args: { name: 'Created headlessly' },
          mutation: { expectedRevision: base.expected_revision, requestId },
          name: 'create_page'
        }
      })
    )
    expect(replay).toMatchObject({
      id: createdPageId,
      mutation_receipt: { idempotentReplay: true, requestId },
      status: { mutation: 'replayed' }
    })
    const replayHead = await f.store.head()
    if (!replayHead) throw new Error('Expected authority head after page replay')
    expect(replayHead.revision).toBe(2)
    expect(readAuthorityBoardDocument(replayHead.document).graph.getPages()).toHaveLength(2)

    await expect(
      restarted.sendRpc({
        command: 'tool',
        args: {
          ...freshBase,
          args: { name: 'Wrong target' },
          mutation: {
            expectedRevision: freshBase.expected_revision,
            requestId: 'request:wrong-target-page-create'
          },
          name: 'create_page',
          workspace_id: 'workspace-wrong'
        }
      })
    ).rejects.toThrow('owns workspace')
    expect((await f.store.head())?.revision).toBe(2)

    const staleContext = responseResult(await restarted.sendRpc(contextArgs(f)))
    const staleBase = staleContext.board_build_base as Record<string, unknown>
    const current = await f.store.head()
    if (!current) throw new Error('Expected authority head before stale page refusal')
    await f.store.commit({
      document: { ...(current.document as Record<string, unknown>), concurrentPageChange: true },
      expectedContentHash: current.contentHash,
      expectedRevision: current.revision,
      requestId: 'request:concurrent-page-change',
      workspaceId: current.identity.workspaceId
    })
    await expect(
      restarted.sendRpc({
        command: 'tool',
        args: {
          ...staleBase,
          args: { name: 'Must not exist' },
          mutation: {
            expectedRevision: staleBase.expected_revision,
            requestId: 'request:stale-page-create'
          },
          name: 'create_page'
        }
      })
    ).rejects.toThrow('Board context is stale')
    const refusedHead = await f.store.head()
    if (!refusedHead) throw new Error('Expected authority head after stale page refusal')
    expect(refusedHead.revision).toBe(3)
    expect(readAuthorityBoardDocument(refusedHead.document).graph.getPages()).toHaveLength(2)
  })

  test('replays native-card mutations from their original stale base without duplicating', async () => {
    for (const command of ['board_build', 'board_change'] as const) {
      const f = await fixture()
      const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
      const recipe = {
        body: 'The original payload must replay exactly once.',
        kind: 'native_card',
        placement: { target: { kind: 'point', x: 600, y: 400 } },
        title: 'Stale-base replay'
      }
      const request = {
        command,
        args: {
          ...(context.board_build_base as Record<string, unknown>),
          intent: 'Recover one already-applied native card',
          ...(command === 'board_build'
            ? { recipe }
            : {
                operation: {
                  artifact: { body: recipe.body, kind: recipe.kind, title: recipe.title },
                  placement: recipe.placement
                }
              }),
          request_id: `request:stale-base-replay:${command}`
        }
      }

      const applied = responseResult(await f.runtime.sendRpc(request))
      const ownerId = (applied.readback as { card: { owner: { id: string } } }).card.owner.id
      const headAfterApply = await f.store.head()
      if (!headAfterApply) throw new Error('Expected authority head after native-card build')
      const childrenAfterApply = readAuthorityBoardDocument(headAfterApply.document).graph.getNode(
        f.page.id
      )?.childIds

      const replayed = responseResult(await f.runtime.sendRpc(request))
      expect(replayed).toMatchObject({
        readback: { card: { owner: { id: ownerId } } },
        receipt: { idempotent_replay: true },
        status: { command: 'completed', mutation: 'replayed' }
      })
      expect((await f.store.head())?.revision).toBe(headAfterApply.revision)
      expect(
        readAuthorityBoardDocument((await f.store.head())?.document).graph.getNode(f.page.id)
          ?.childIds
      ).toEqual(childrenAfterApply)

      const changedArgs =
        command === 'board_build'
          ? { ...request.args, recipe: { ...recipe, body: 'Changed payload' } }
          : {
              ...request.args,
              operation: {
                artifact: {
                  body: 'Changed payload',
                  kind: recipe.kind,
                  title: recipe.title
                },
                placement: recipe.placement
              }
            }
      await expect(f.runtime.sendRpc({ command, args: changedArgs })).rejects.toThrow(
        'already used for a different mutation'
      )
      await expect(
        f.runtime.sendRpc({
          command,
          args: { ...request.args, request_id: `request:unrelated-stale:${command}` }
        })
      ).rejects.toThrow('Board context is stale')
      expect((await f.store.head())?.revision).toBe(headAfterApply.revision)
    }
  })

  test('keeps a missing native-card owner historical without recreating it', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const request = {
      command: 'board_build',
      args: {
        ...(context.board_build_base as Record<string, unknown>),
        intent: 'Create one card whose consumed request must remain consumed',
        recipe: {
          body: 'Deleting this owner must not make the request fresh again.',
          kind: 'native_card',
          placement: { target: { kind: 'point', x: 600, y: 400 } },
          title: 'Historical owner'
        },
        request_id: 'request:historical-owner'
      }
    }
    const applied = responseResult(await f.runtime.sendRpc(request))
    const ownerId = (applied.readback as { card: { owner: { id: string } } }).card.owner.id
    const appliedHead = await f.store.head()
    if (!appliedHead) throw new Error('Expected authority head after native-card build')
    const deletedDocument = readAuthorityBoardDocument(appliedHead.document)
    deletedDocument.graph.deleteNode(ownerId)
    await f.store.commit({
      document: writeAuthorityBoardDocument(deletedDocument),
      expectedContentHash: appliedHead.contentHash,
      expectedRevision: appliedHead.revision,
      requestId: 'request:delete-historical-owner',
      workspaceId: appliedHead.identity.workspaceId
    })

    await expect(f.runtime.sendRpc(request)).rejects.toThrow('Board context is stale')
    const deletedHead = await f.store.head()
    if (!deletedHead) throw new Error('Expected authority head after owner deletion')
    expect(deletedHead.revision).toBe(appliedHead.revision + 1)
    expect(readAuthorityBoardDocument(deletedHead.document).graph.getNode(ownerId)).toBeUndefined()
    expect(
      await f.store.commit({
        document: appliedHead.document,
        expectedContentHash: appliedHead.contentHash,
        expectedRevision: appliedHead.revision,
        requestId: 'request:historical-owner',
        workspaceId: appliedHead.identity.workspaceId
      })
    ).toMatchObject({
      appliedRevision: appliedHead.revision,
      requestId: 'request:historical-owner'
    })
    expect((await f.store.head())?.revision).toBe(deletedHead.revision)
  })

  test('refuses wrong targets, stale contexts, and live-only commands before mutation', async () => {
    const f = await fixture()
    await expect(
      f.runtime.sendRpc({
        command: 'board_context',
        args: { page_id: f.page.id, workspace_id: 'workspace-wrong' }
      })
    ).rejects.toThrow('owns workspace')
    await expect(
      f.runtime.sendRpc({ command: 'board_context', args: { target: 'current_visible' } })
    ).rejects.toThrow('current_visible requires an open OpenPencil Board')
    await expect(f.runtime.sendRpc({ command: 'trace_query', args: {} })).rejects.toThrow(
      'Trace queries require exactly one'
    )

    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const current = await f.store.head()
    if (!current) throw new Error('Expected authority head')
    await f.store.commit({
      document: { ...(current.document as Record<string, unknown>), concurrentChange: true },
      expectedContentHash: current.contentHash,
      expectedRevision: current.revision,
      requestId: 'request:concurrent-change',
      workspaceId: current.identity.workspaceId
    })
    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(context.board_build_base as Record<string, unknown>),
          intent: 'This stale build must not apply',
          recipe: {
            body: 'Stale',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 600, y: 400 } },
            title: 'Blocked'
          },
          request_id: 'request:stale-card'
        }
      })
    ).rejects.toThrow('Board context is stale')
    expect((await f.store.head())?.revision).toBe(2)
  })

  test('exposes authority-ready health and RPC while no browser is connected', async () => {
    const f = await fixture()
    const server = startServer({
      authToken: 'headless-token',
      httpPort: 0,
      localWorkspaceId: 'workspace-headless',
      localWorkspaceRoot: f.root,
      wsPort: 0
    })
    try {
      const health = await server.app.request('/health')
      expect(await health.json()).toMatchObject({
        authorityReady: true,
        browserConnected: false,
        executionSurface: 'local_workspace_authority',
        status: 'ok'
      })
      const response = await server.app.request('/rpc', {
        body: JSON.stringify(contextArgs(f)),
        headers: {
          Authorization: 'Bearer headless-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        ok: true,
        result: { execution_surface: 'local_workspace_authority' }
      })

      const openResponse = await server.app.request('/rpc', {
        body: JSON.stringify({
          command: 'board_open',
          args: {
            ...contextArgs(f).args,
            runtime_instance_id: `local-authority:${f.head.authorityId}`
          }
        }),
        headers: {
          Authorization: 'Bearer headless-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(await openResponse.json()).toMatchObject({
        ok: true,
        result: { action: 'queued', page_id: f.page.id, status: 'queued_for_editor' }
      })

      const navigationResponse = await server.app.request('/local-workspace/v1/navigation', {
        headers: { Authorization: 'Bearer headless-token' }
      })
      expect(await navigationResponse.json()).toMatchObject({
        intent: { pageId: f.page.id, workspaceId: 'workspace-headless' }
      })
    } finally {
      server.close()
    }
  })

  test('never falls back to a connected browser when persisted authority is unavailable', async () => {
    const server = startServer({
      authToken: 'no-authority-token',
      httpPort: 0,
      wsPort: 0
    })
    const wsPort = await waitForWsListening(server.wss)
    const browser = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    let browserRequests = 0
    try {
      await new Promise<void>((resolve, reject) => {
        browser.once('open', () => {
          browser.send(
            JSON.stringify({
              active: true,
              runtime_instance_id: 'runtime:connected-browser',
              token: 'no-authority-token',
              type: 'register',
              visibility: 'visible',
              write_authority: 'writer'
            })
          )
          resolve()
        })
        browser.once('error', reject)
      })
      browser.on('message', (raw) => {
        const message = JSON.parse(Buffer.from(raw).toString('utf8')) as {
          id?: string
          type?: string
        }
        if (message.type !== 'request' || !message.id) return
        browserRequests += 1
        browser.send(
          JSON.stringify({
            id: message.id,
            ok: true,
            result: { execution_surface: 'live_runtime' },
            type: 'response'
          })
        )
      })
      await waitForBrowserConnection(server)

      const persistedResponse = await server.app.request('/rpc', {
        body: JSON.stringify({ command: 'board_context', args: {} }),
        headers: {
          Authorization: 'Bearer no-authority-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(persistedResponse.status).toBe(502)
      const persistedError = (await persistedResponse.json()) as { error?: string }
      expect(persistedError.error).toStartWith('persisted_authority_unavailable:')
      expect(browserRequests).toBe(0)

      const visibleResponse = await server.app.request('/rpc', {
        body: JSON.stringify({
          command: 'board_context',
          args: { target: 'current_visible' }
        }),
        headers: {
          Authorization: 'Bearer no-authority-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(visibleResponse.status).toBe(200)
      expect(browserRequests).toBe(1)
    } finally {
      browser.close()
      server.close()
    }
  })

  test('keeps persisted authority primary when a browser is also connected', async () => {
    const f = await fixture({ withAnchor: true })
    await persistTraceGesture(f, requireAnchor(f.anchor).id)
    const server = startServer({
      authToken: 'authority-primary-token',
      httpPort: 0,
      localWorkspaceId: 'workspace-headless',
      localWorkspaceRoot: f.root,
      wsPort: 0
    })
    const wsPort = await waitForWsListening(server.wss)
    const browser = new WebSocket(`ws://127.0.0.1:${wsPort}`)
    let browserRequests = 0
    let navigationNotifications = 0
    try {
      await new Promise<void>((resolve, reject) => {
        browser.once('open', () => {
          browser.send(
            JSON.stringify({
              active: true,
              navigation_targets: [
                {
                  content_document_id: f.head.identity.documentId,
                  workspace_id: f.head.identity.workspaceId
                }
              ],
              runtime_instance_id: 'runtime:connected-browser',
              token: 'authority-primary-token',
              type: 'register',
              visibility: 'visible',
              write_authority: 'writer'
            })
          )
          resolve()
        })
        browser.once('error', reject)
      })
      browser.on('message', (raw) => {
        const message = Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.from(raw).toString('utf8')
        if (message.includes('"type":"request"')) browserRequests += 1
        if (message.includes('"type":"navigation_intent"')) navigationNotifications += 1
      })
      await waitForBrowserConnection(server)

      const health = await server.app.request('/health')
      expect(await health.json()).toMatchObject({
        authorityReady: true,
        browserConnected: true,
        executionSurface: 'local_workspace_authority',
        presentationSurface: 'live_browser'
      })

      const response = await server.app.request('/rpc', {
        body: JSON.stringify({ command: 'list_documents', args: {} }),
        headers: {
          Authorization: 'Bearer authority-primary-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        ok: true,
        result: { runtime_instance_id: `local-authority:${f.head.authorityId}` }
      })

      const contextResponse = await server.app.request('/rpc', {
        body: JSON.stringify(contextArgs(f)),
        headers: {
          Authorization: 'Bearer authority-primary-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(contextResponse.status).toBe(200)
      expect(await contextResponse.json()).toMatchObject({
        ok: true,
        result: { execution_surface: 'local_workspace_authority' }
      })

      const traceResponse = await server.app.request('/rpc', {
        body: JSON.stringify({ command: 'trace_get_gesture', args: { latest: true } }),
        headers: {
          Authorization: 'Bearer authority-primary-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(traceResponse.status).toBe(200)
      expect(await traceResponse.json()).toMatchObject({
        ok: true,
        result: {
          gesture: {
            boardOrigin: {
              runtimeInstanceId: `local-authority:${f.head.authorityId}`
            },
            gestureId: 'gesture:headless'
          },
          status: 'matched'
        }
      })
      expect(browserRequests).toBe(0)

      const traceQueryResponse = await server.app.request('/rpc', {
        body: JSON.stringify({ command: 'trace_query', args: { query: 'headless' } }),
        headers: {
          Authorization: 'Bearer authority-primary-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(traceQueryResponse.status).toBe(200)
      expect(await traceQueryResponse.json()).toMatchObject({
        ok: true,
        result: { status: 'empty' }
      })
      expect(browserRequests).toBe(0)

      const openResponse = await server.app.request('/rpc', {
        body: JSON.stringify({
          command: 'board_open',
          args: {
            ...contextArgs(f).args,
            runtime_instance_id: `local-authority:${f.head.authorityId}`
          }
        }),
        headers: {
          Authorization: 'Bearer authority-primary-token',
          'Content-Type': 'application/json'
        },
        method: 'POST'
      })
      expect(await openResponse.json()).toMatchObject({
        ok: true,
        result: {
          action: 'queued',
          status: 'queued_for_editor'
        }
      })
      expect(await f.store.pendingNavigationIntent()).toMatchObject({
        pageId: f.page.id,
        workspaceId: 'workspace-headless'
      })
      expect(navigationNotifications).toBe(0)
      expect(browserRequests).toBe(0)
    } finally {
      browser.close()
      server.close()
    }
  })
})
