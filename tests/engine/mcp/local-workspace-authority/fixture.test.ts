import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createUserCodeObjectDocument,
  parseCodeObjectDocument,
  serializeCodeObjectPluginData
} from '@open-pencil/core/code-object'
import {
  OBJECT_GRAPH_SCHEMA_VERSION,
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

function result(value: unknown): RpcResult {
  if (!value || typeof value !== 'object') throw new Error('Expected response')
  const candidate = (value as { result?: unknown }).result
  if (!candidate || typeof candidate !== 'object') throw new Error('Expected result')
  return candidate as RpcResult
}

function objectField(value: RpcResult, field: string): RpcResult {
  const candidate = value[field]
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error(`Expected ${field} object`)
  }
  return candidate as RpcResult
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-fixture-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  page.name = 'Mixed fixture'
  const native = graph.createNode('FRAME', page.id, {
    height: 120,
    name: 'Native card',
    width: 240,
    x: 100,
    y: 140
  })
  graph.createNode('TEXT', native.id, { name: 'Title', text: 'Baseline' })
  const codeObject = graph.createNode('FRAME', page.id, {
    height: 180,
    name: 'Interactive proof',
    width: 320,
    x: 520,
    y: 140
  })
  graph.updateNode(codeObject.id, {
    pluginData: serializeCodeObjectPluginData(
      codeObject,
      createUserCodeObjectDocument({
        definitionId: 'fixture-code-object',
        name: 'Interactive proof',
        source: 'export default function Proof(){ return <button>Baseline</button> }',
        state: { count: 2 }
      })
    )
  })
  setObjectGraphConnectionsOnPage(graph, page.id, [
    {
      automatic: false,
      id: 'object-connection:fixture',
      kind: 'visual',
      label: 'explains',
      permissions: [],
      schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
      sourceNodeId: native.id,
      sourcePort: 'auto',
      targetNodeId: codeObject.id,
      targetPort: 'auto'
    }
  ])
  graph.updateNode(page.id, {
    pluginData: [
      ...page.pluginData,
      { key: 'baseline-receipt', pluginId: 'openpencil.agent-tools', value: 'baseline' }
    ]
  })
  const otherPage = graph.addPage('Other Board')
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-fixture',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-fixture',
    sourceWorkspaceId: 'workspace-fixture'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected authority head')
  return {
    codeObject,
    head,
    native,
    otherPage,
    page,
    runtime: new LocalWorkspaceBoardRuntime(store),
    store
  }
}

async function context(f: Awaited<ReturnType<typeof fixture>>, pageId = f.page.id) {
  return result(
    await f.runtime.sendRpc({
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

function fixtureArgs(
  base: RpcResult,
  operation: 'assert' | 'capture' | 'reset',
  fixtureId?: string,
  requestId?: string
) {
  return {
    ...base,
    ...(fixtureId ? { fixture_id: fixtureId } : {}),
    operation,
    ...(requestId ? { request_id: requestId } : {})
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local authority Board fixtures', () => {
  test('captures, detects divergence, and durably restores mixed semantic state', async () => {
    const f = await fixture()
    const initial = await context(f)
    expect(initial.capabilities).toContain('board.fixture.capture_assert_reset.external')
    const base = objectField(initial, 'board_build_base')
    const captured = result(
      await f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(base, 'capture')
      })
    )
    expect(captured).toMatchObject({
      fixture: { node_count: 3, top_level_count: 2 },
      proof: { authority_owned_token: 'passed', normal_editor_undo: 'not_applicable' },
      status: 'captured'
    })
    const fixtureId = (captured.fixture as { fixture_id: string }).fixture_id

    const beforeRun = await f.store.head()
    if (!beforeRun) throw new Error('Expected authority head before simulated run')
    const runDocument = readAuthorityBoardDocument(beforeRun.document)
    runDocument.graph.updateNode(f.native.id, { x: 900 })
    runDocument.graph.deleteNode(f.codeObject.id)
    runDocument.graph.createNode('ELLIPSE', f.page.id, { name: 'Run residue' })
    setObjectGraphConnectionsOnPage(runDocument.graph, f.page.id, [])
    const runPage = runDocument.graph.getNode(f.page.id)
    if (!runPage) throw new Error('Expected fixture page during simulated run')
    runDocument.graph.updateNode(runPage.id, {
      pluginData: [
        ...runPage.pluginData,
        { key: 'run-receipt', pluginId: 'openpencil.agent-tools', value: 'preserve-me' }
      ]
    })
    await f.store.commit({
      document: writeAuthorityBoardDocument(runDocument),
      expectedContentHash: beforeRun.contentHash,
      expectedRevision: beforeRun.revision,
      requestId: 'simulate-run',
      workspaceId: beforeRun.identity.workspaceId
    })

    const divergedContext = await context(f)
    const divergedBase = objectField(divergedContext, 'board_build_base')
    expect(
      result(
        await f.runtime.sendRpc({
          command: 'board_fixture',
          args: fixtureArgs(divergedBase, 'assert', fixtureId)
        })
      )
    ).toMatchObject({ matched: false, status: 'diverged' })

    const reset = result(
      await f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(divergedBase, 'reset', fixtureId, 'request:fixture-reset')
      })
    )
    expect(reset).toMatchObject({
      persistence: { status: 'durable' },
      proof: {
        durable_readback: 'passed',
        normal_editor_undo: 'unavailable',
        reset_boundary: 'external_evaluator_control'
      },
      receipt: { idempotent_replay: false },
      status: { command: 'completed', mutation: 'applied' }
    })

    const restoredHead = await f.store.head()
    if (!restoredHead) throw new Error('Expected restored authority head')
    const restored = readAuthorityBoardDocument(restoredHead.document)
    expect(restored.graph.getNode(f.native.id)).toMatchObject({ x: 100 })
    expect(parseCodeObjectDocument(restored.graph.getNode(f.codeObject.id))).toMatchObject({
      definitionId: 'fixture-code-object',
      state: { count: 2 }
    })
    expect(objectGraphConnectionsOnPage(restored.graph, f.page.id)).toHaveLength(1)
    expect([...restored.graph.getDescendants(f.page.id)].map((node) => node.name)).not.toContain(
      'Run residue'
    )
    const restoredPage = restored.graph.getNode(f.page.id)
    expect(restoredPage?.pluginData).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'baseline-receipt', value: 'baseline' }),
        expect.objectContaining({ key: 'run-receipt', value: 'preserve-me' }),
        expect.objectContaining({ key: 'fixture-reset-request:request:fixture-reset' })
      ])
    )

    const resetContext = objectField(reset, 'context')
    expect(
      result(
        await f.runtime.sendRpc({
          command: 'board_fixture',
          args: fixtureArgs(objectField(resetContext, 'board_build_base'), 'assert', fixtureId)
        })
      )
    ).toMatchObject({ matched: true, status: 'matched' })
    expect(
      result(
        await f.runtime.sendRpc({
          command: 'board_fixture',
          args: fixtureArgs(
            objectField(resetContext, 'board_build_base'),
            'reset',
            fixtureId,
            'request:fixture-reset'
          )
        })
      )
    ).toMatchObject({
      receipt: { idempotent_replay: true },
      status: { command: 'completed', mutation: 'replayed' }
    })

    const restarted = new LocalWorkspaceBoardRuntime(f.store)
    const restartedContext = result(
      await restarted.sendRpc({
        command: 'board_context',
        args: {
          content_document_id: f.head.identity.documentId,
          document_id: f.head.identity.documentId,
          page_id: f.page.id,
          workspace_id: f.head.identity.workspaceId
        }
      })
    )
    expect(
      result(
        await restarted.sendRpc({
          command: 'board_fixture',
          args: fixtureArgs(
            objectField(restartedContext, 'board_build_base'),
            'reset',
            fixtureId,
            'request:fixture-reset'
          )
        })
      )
    ).toMatchObject({
      receipt: { idempotent_replay: true },
      status: { command: 'completed', mutation: 'replayed' }
    })
  })

  test('fails closed for a wrong page, stale context, missing token, and changed request reuse', async () => {
    const f = await fixture()
    const initial = await context(f)
    const base = objectField(initial, 'board_build_base')
    const captured = result(
      await f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(base, 'capture')
      })
    )
    const fixtureId = (captured.fixture as { fixture_id: string }).fixture_id
    const other = await context(f, f.otherPage.id)
    await expect(
      f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(objectField(other, 'board_build_base'), 'assert', fixtureId)
      })
    ).rejects.toThrow('different page')
    await expect(
      f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(base, 'assert', 'authority-fixture:missing')
      })
    ).rejects.toThrow('tokens do not survive server restart')

    const head = await f.store.head()
    if (!head) throw new Error('Expected head before stale mutation')
    const document = readAuthorityBoardDocument(head.document)
    document.graph.updateNode(f.native.id, { x: 300 })
    await f.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId: 'make-context-stale',
      workspaceId: head.identity.workspaceId
    })
    await expect(
      f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(base, 'reset', fixtureId, 'request:stale-reset')
      })
    ).rejects.toThrow('context is stale')

    const fresh = await context(f)
    const freshBase = objectField(fresh, 'board_build_base')
    await f.runtime.sendRpc({
      command: 'board_fixture',
      args: fixtureArgs(freshBase, 'reset', fixtureId, 'request:one-reset')
    })
    const afterReset = await context(f)
    const changedFixture = result(
      await f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(objectField(afterReset, 'board_build_base'), 'capture')
      })
    )
    const changedFixtureId = (changedFixture.fixture as { fixture_id: string }).fixture_id
    await expect(
      f.runtime.sendRpc({
        command: 'board_fixture',
        args: fixtureArgs(
          objectField(afterReset, 'board_build_base'),
          'reset',
          changedFixtureId,
          'request:one-reset'
        )
      })
    ).rejects.toThrow('already used for a different reset')
  })
})
