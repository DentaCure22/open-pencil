import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import { readAuthorityBoardDocument } from '#mcp/local-workspace-authority/document'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

type JsonRecord = Record<string, unknown>

const roots: string[] = []
const SOURCE = 'export default function Proof(){ return <main>Placed proof</main> }'

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function result(value: unknown): JsonRecord {
  if (!isRecord(value) || !isRecord(value.result)) throw new Error('Expected RPC result')
  return value.result
}

function recordField(value: JsonRecord, field: string): JsonRecord {
  const fieldValue = value[field]
  if (!isRecord(fieldValue)) throw new Error(`Expected ${field} record`)
  return fieldValue
}

function stringField(value: JsonRecord, field: string): string {
  const fieldValue = value[field]
  if (typeof fieldValue !== 'string') throw new Error(`Expected ${field} string`)
  return fieldValue
}

function numberField(value: JsonRecord, field: string): number {
  const fieldValue = value[field]
  if (typeof fieldValue !== 'number') throw new Error(`Expected ${field} number`)
  return fieldValue
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

async function runtimeFixture(graph: SceneGraph) {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-code-placement-'))
  roots.push(root)
  const page = graph.getPages().at(0)
  if (!page) throw new Error('Expected Board page')
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-code-placement',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-code-placement',
    sourceWorkspaceId: 'workspace-code-placement'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected authority head')
  return { head, page, runtime: new LocalWorkspaceBoardRuntime(store), store }
}

async function emptyFixture() {
  return runtimeFixture(new SceneGraph())
}

async function anchoredFixture() {
  const graph = new SceneGraph()
  const page = graph.getPages().at(0)
  if (!page) throw new Error('Expected Board page')
  const anchor = graph.createNode('FRAME', page.id, {
    height: 100,
    name: 'Exact anchor',
    width: 200,
    x: 120,
    y: 160
  })
  return { anchor, ...(await runtimeFixture(graph)) }
}

async function context(fixture: Awaited<ReturnType<typeof runtimeFixture>>): Promise<JsonRecord> {
  return result(
    await fixture.runtime.sendRpc({
      command: 'board_context',
      args: {
        content_document_id: fixture.head.identity.documentId,
        document_id: fixture.head.identity.documentId,
        page_id: fixture.page.id,
        workspace_id: fixture.head.identity.workspaceId
      }
    })
  )
}

function recipe(overrides: JsonRecord = {}): JsonRecord {
  return {
    initial_state: { score: 60 },
    kind: 'code_object',
    name: 'Placed proof',
    object_key: 'placed-proof',
    operation: 'create',
    source: SOURCE,
    source_format: 'tsx',
    ...overrides
  }
}

function buildArgs(
  base: JsonRecord,
  target: JsonRecord,
  requestId: string,
  codeObjectRecipe: JsonRecord = recipe()
) {
  return {
    ...base,
    intent: 'Create one exact placed interactive proof',
    recipe: { ...codeObjectRecipe, placement: { target } },
    request_id: requestId
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local authority staged Code Object target placement', () => {
  test('auto-places on an empty Board and replays without duplication or changed input', async () => {
    const fixture = await emptyFixture()
    const firstContext = await context(fixture)
    const args = buildArgs(
      recordField(firstContext, 'board_build_base'),
      { kind: 'auto' },
      'request:auto-code-object'
    )
    const applied = result(await fixture.runtime.sendRpc({ command: 'board_build', args }))
    const ownerId = stringField(applied, 'owner_id')
    const appliedRevision = numberField(recordField(applied, 'persistence'), 'authority_revision')
    expect(applied).toMatchObject({
      owner_id: ownerId,
      readback: {
        code_object: {
          frame: { bounds: { height: 520, width: 720, x: 440, y: 340 }, id: ownerId }
        }
      },
      receipt: {
        idempotent_replay: false,
        placement: {
          algorithm: 'nearest-free/v1',
          bounds: { height: 520, width: 720, x: 440, y: 340 },
          rejectedCandidates: 0
        }
      },
      status: { mutation: 'applied' }
    })

    const replayContext = await context(fixture)
    const replay = result(
      await fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          recordField(replayContext, 'board_build_base'),
          { kind: 'auto' },
          'request:auto-code-object'
        )
      })
    )
    expect(replay).toMatchObject({ owner_id: ownerId, status: { mutation: 'replayed' } })
    expect(numberField(recordField(replay, 'persistence'), 'authority_revision')).toBe(
      appliedRevision
    )
    const replayHead = await fixture.store.head()
    if (!replayHead) throw new Error('Expected replay head')
    expect([
      ...readAuthorityBoardDocument(replayHead.document).graph.getDescendants(fixture.page.id)
    ]).toHaveLength(1)

    await expect(
      fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          recordField(replayContext, 'board_build_base'),
          { kind: 'point', x: 1_200, y: 900 },
          'request:auto-code-object'
        )
      })
    ).rejects.toThrow('already used for a different mutation')
    expect((await fixture.store.head())?.revision).toBe(appliedRevision)
  })

  test('uses exact relative and point targets and refuses missing or colliding targets', async () => {
    const fixture = await anchoredFixture()
    const firstContext = await context(fixture)
    const relative = result(
      await fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          recordField(firstContext, 'board_build_base'),
          { kind: 'relative', object_id: fixture.anchor.id },
          'request:relative-code-object',
          recipe({ name: 'Relative proof', object_key: 'relative-proof' })
        )
      })
    )
    expect(relative).toMatchObject({
      readback: {
        code_object: { frame: { bounds: { height: 520, width: 720, x: 368, y: 160 } } }
      },
      status: { mutation: 'applied' }
    })

    const pointContext = await context(fixture)
    const point = result(
      await fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          recordField(pointContext, 'board_build_base'),
          { kind: 'point', x: 1_600, y: 1_000 },
          'request:point-code-object',
          recipe({ name: 'Point proof', object_key: 'point-proof' })
        )
      })
    )
    expect(point).toMatchObject({
      readback: {
        code_object: { frame: { bounds: { height: 520, width: 720, x: 1_240, y: 740 } } }
      },
      status: { mutation: 'applied' }
    })

    const refusalContext = await context(fixture)
    const refusalBase = recordField(refusalContext, 'board_build_base')
    const revision = (await fixture.store.head())?.revision
    await expect(
      fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          refusalBase,
          { kind: 'relative', object_id: 'missing:anchor' },
          'request:missing-relative',
          recipe({ name: 'Missing proof', object_key: 'missing-proof' })
        )
      })
    ).rejects.toThrow('is not on Board')
    await expect(
      fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          refusalBase,
          { kind: 'point', x: 220, y: 210 },
          'request:colliding-point',
          recipe({ name: 'Collision proof', object_key: 'collision-proof' })
        )
      })
    ).rejects.toThrow('No collision-free placement')
    expect((await fixture.store.head())?.revision).toBe(revision)
  })

  test('keeps region placement bounded and refuses a region smaller than the Code Object', async () => {
    const fixture = await emptyFixture()
    const firstContext = await context(fixture)
    const region = result(
      await fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          recordField(firstContext, 'board_build_base'),
          { height: 800, kind: 'region', width: 1_000, x: 100, y: 200 },
          'request:region-code-object',
          recipe({ name: 'Region proof', object_key: 'region-proof' })
        )
      })
    )
    expect(region).toMatchObject({
      readback: {
        code_object: { frame: { bounds: { height: 520, width: 720, x: 240, y: 340 } } }
      },
      status: { mutation: 'applied' }
    })

    const refusalContext = await context(fixture)
    const revision = (await fixture.store.head())?.revision
    await expect(
      fixture.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(
          recordField(refusalContext, 'board_build_base'),
          { height: 400, kind: 'region', width: 600, x: 2_000, y: 2_000 },
          'request:small-region-code-object',
          recipe({ name: 'Small region proof', object_key: 'small-region-proof' })
        )
      })
    ).rejects.toThrow('No collision-free placement')
    expect((await fixture.store.head())?.revision).toBe(revision)
  })
})
