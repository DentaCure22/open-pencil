import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

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
  return { anchor, graph, head, page, runtime: new LocalWorkspaceBoardRuntime(store), store }
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
  test('reads persisted Board context without exposing mutation handshakes', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))

    expect(context).not.toHaveProperty('board_build_base')
    expect(context).not.toHaveProperty('connect_objects_base')
    expect(context).not.toHaveProperty('request_ledger')
    expect(context).toMatchObject({
      capabilities: expect.arrayContaining(['board.read.objects', 'trace.read.persisted']),
      execution_surface: 'local_workspace_authority',
      neighborhood: {
        count: 1,
        nodes: [expect.objectContaining({ id: anchor.id, name: 'Headless anchor' })]
      }
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
    expect((await f.store.head())?.revision).toBe(f.head.revision)
  })

  test('reads exact saved objects and deterministic queries without a live editor', async () => {
    const f = await fixture({ withAnchor: true })
    const anchor = requireAnchor(f.anchor)
    const child = f.graph.createNode('TEXT', anchor.id, { name: 'Child copy', text: 'Saved text' })
    const head = await f.store.head()
    if (!head) throw new Error('Expected authority head')
    await f.store.commit({
      document: savedDocument(f.graph),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId: 'request:add-read-child',
      workspaceId: head.identity.workspaceId
    })

    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const exact = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          object_ids: [anchor.id],
          scope: 'objects'
        }
      })
    )
    expect(exact).toMatchObject({
      count: 2,
      requested_object_ids: [anchor.id],
      scope: 'objects',
      status: 'matched'
    })
    expect(exact.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: anchor.id }),
        expect.objectContaining({ id: child.id, text: 'Saved text' })
      ])
    )

    const queried = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          projection: 'id_only',
          query: { name: 'headless anchor', types: ['frame'] },
          scope: 'query',
          token_budget: 256
        }
      })
    )
    expect(queried).toMatchObject({
      count: 1,
      nodes: [{ id: anchor.id, parent_id: f.page.id, type: 'FRAME' }],
      scope: 'query',
      status: 'matched'
    })
  })

  test('rejects removed semantic authoring commands', async () => {
    const f = await fixture()
    for (const command of [
      'board_build',
      'board_change',
      'board_prepare_edit',
      'board_verify',
      'connect_objects'
    ]) {
      await expect(f.runtime.sendRpc({ command, args: {} })).rejects.toThrow('no_live_runtime')
    }
  })
})
