import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  createUserCodeObjectDocument,
  serializeCodeObjectPluginData
} from '@open-pencil/core/code-object'
import { SceneGraph } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import { readAuthorityBoardDocument } from '#mcp/local-workspace-authority/document'
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

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-object-edit-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, {
    height: 120,
    name: 'Editable card',
    pluginData: [
      {
        key: 'native-card-request:old-request',
        pluginId: 'openpencil.agent-tools',
        value: '{}'
      }
    ],
    width: 240,
    x: 100,
    y: 140
  })
  const text = graph.createNode('TEXT', page.id, {
    height: 40,
    name: 'Editable note',
    text: 'Before',
    width: 180,
    x: 420,
    y: 140
  })
  graph.createNode('TEXT', frame.id, { name: 'Nested', text: 'Nested' })
  const codeObject = graph.createNode('FRAME', page.id, {
    height: 100,
    name: 'Code Object',
    width: 180,
    x: 640,
    y: 140
  })
  graph.updateNode(codeObject.id, {
    pluginData: serializeCodeObjectPluginData(
      codeObject,
      createUserCodeObjectDocument({
        definitionId: 'proof-code-object',
        name: 'Code Object',
        source: 'export default function Proof(){ return <div /> }'
      })
    )
  })
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-object-edit',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-object-edit',
    sourceWorkspaceId: 'workspace-object-edit'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected authority head')
  return {
    codeObject,
    frame,
    head,
    page,
    runtime: new LocalWorkspaceBoardRuntime(store),
    store,
    text
  }
}

function result(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Expected response')
  const candidate = (value as { result?: unknown }).result
  if (!candidate || typeof candidate !== 'object') throw new Error('Expected result')
  return candidate as Record<string, unknown>
}

async function context(f: Awaited<ReturnType<typeof fixture>>) {
  return result(
    await f.runtime.sendRpc({
      command: 'board_context',
      args: {
        content_document_id: f.head.identity.documentId,
        document_id: f.head.identity.documentId,
        page_id: f.page.id,
        workspace_id: f.head.identity.workspaceId
      }
    })
  )
}

async function edit(
  f: Awaited<ReturnType<typeof fixture>>,
  base: Record<string, unknown>,
  operation: Record<string, unknown>,
  requestId: string
) {
  return result(
    await f.runtime.sendRpc({
      command: 'board_change',
      args: { ...base, operation, request_id: requestId }
    })
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local authority native object edits', () => {
  test('updates, moves, resizes, duplicates, deletes, verifies, and replays exact objects', async () => {
    const f = await fixture()
    let current = await context(f)
    expect(current.capabilities).toEqual(
      expect.arrayContaining([
        'board.change.object.update',
        'board.change.object.move',
        'board.change.object.resize',
        'board.change.object.delete',
        'board.change.object.duplicate'
      ])
    )

    const updated = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      {
        kind: 'object.update',
        object_id: f.text.id,
        patch: {
          cornerRadius: 24,
          fill: '#2563EB',
          name: 'Updated note',
          opacity: 0.8,
          text: 'After',
          visible: true
        }
      },
      'request:update'
    )
    expect(updated).toMatchObject({
      owner_id: f.text.id,
      proof: { durable_readback: 'passed', normal_editor_undo: 'unavailable' },
      readback: {
        object_edit: { object: { cornerRadius: 24, fills: [{ type: 'SOLID' }] } }
      },
      status: { mutation: 'applied' }
    })
    current = updated.context as Record<string, unknown>

    const moved = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { kind: 'object.move', object_id: f.text.id, x: 510, y: 260 },
      'request:move'
    )
    expect(moved.readback).toMatchObject({
      object_edit: { object: { bounds: { x: 510, y: 260 } } }
    })
    current = moved.context as Record<string, unknown>

    const resized = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { height: 72, kind: 'object.resize', object_id: f.text.id, width: 280 },
      'request:resize'
    )
    expect(resized.readback).toMatchObject({
      object_edit: { object: { bounds: { height: 72, width: 280 } } }
    })
    current = resized.context as Record<string, unknown>

    const duplicated = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { kind: 'object.duplicate', object_id: f.frame.id, offset_x: 30, offset_y: 40 },
      'request:duplicate'
    )
    const duplicateId = duplicated.owner_id as string
    expect(duplicateId).not.toBe(f.frame.id)
    expect(duplicated.readback).toMatchObject({
      object_edit: {
        object: { bounds: { x: 130, y: 180 }, child_ids: expect.any(Array) }
      }
    })
    current = duplicated.context as Record<string, unknown>

    const headAfterDuplicate = await f.store.head()
    if (!headAfterDuplicate) throw new Error('Expected duplicate head')
    const duplicateDocument = readAuthorityBoardDocument(headAfterDuplicate.document)
    const duplicate = duplicateDocument.graph.getNode(duplicateId)
    expect(duplicate?.pluginData.some((entry) => entry.pluginId === 'openpencil.agent-tools')).toBe(
      false
    )

    const deleted = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { kind: 'object.delete', object_id: duplicateId },
      'request:delete'
    )
    expect(deleted).toMatchObject({
      owner_id: null,
      readback: {
        object_edit: { reconciliation: { reasons: [], status: 'current' } }
      },
      status: { mutation: 'applied' }
    })
    const appliedRevision = (deleted.persistence as { authority_revision: number })
      .authority_revision

    f.runtime = new LocalWorkspaceBoardRuntime(f.store)
    current = await context(f)
    const replay = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { kind: 'object.delete', object_id: duplicateId },
      'request:delete'
    )
    expect(replay).toMatchObject({ owner_id: null, status: { mutation: 'replayed' } })
    expect((replay.persistence as { authority_revision: number }).authority_revision).toBe(
      appliedRevision
    )

    const verify = result(
      await f.runtime.sendRpc({
        command: 'board_verify',
        args: {
          ...(replay.context as { board_build_base: Record<string, unknown> }).board_build_base,
          request_id: 'request:delete'
        }
      })
    )
    expect(verify).toMatchObject({
      object_edits: [{ reconciliation: { reasons: [], status: 'current' } }],
      status: 'matched'
    })
  })

  test('moves, resizes, and deletes Code Objects without opening their content contract', async () => {
    const f = await fixture()
    let current = await context(f)
    const moved = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { kind: 'object.move', object_id: f.codeObject.id, x: 720, y: 220 },
      'request:move-code-object'
    )
    expect(moved).toMatchObject({
      readback: {
        object_edit: { object: { bounds: { x: 720, y: 220 } } }
      },
      status: { mutation: 'applied' }
    })

    current = moved.context as typeof current
    const resized = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { height: 240, kind: 'object.resize', object_id: f.codeObject.id, width: 360 },
      'request:resize-code-object'
    )
    expect(resized).toMatchObject({
      readback: {
        object_edit: { object: { bounds: { height: 240, width: 360 } } }
      },
      status: { mutation: 'applied' }
    })

    current = resized.context as typeof current
    const deleted = await edit(
      f,
      current.board_build_base as Record<string, unknown>,
      { kind: 'object.delete', object_id: f.codeObject.id },
      'request:delete-code-object'
    )
    expect(deleted).toMatchObject({
      owner_id: null,
      readback: {
        object_edit: { reconciliation: { reasons: [], status: 'current' } }
      },
      status: { mutation: 'applied' }
    })
    expect((await f.store.head())?.revision).toBe(f.head.revision + 3)
  })

  test('fails closed for no-ops, stale context, changed replay, locked/nested objects, and Code Object content changes', async () => {
    const f = await fixture()
    const first = await context(f)
    const noChange = await edit(
      f,
      first.board_build_base as Record<string, unknown>,
      { kind: 'object.move', object_id: f.frame.id, x: 100, y: 140 },
      'request:no-change'
    )
    expect(noChange).toMatchObject({
      persistence: { authority_revision: f.head.revision, status: 'unchanged' },
      status: { mutation: 'no_change' }
    })
    expect((await f.store.head())?.revision).toBe(f.head.revision)

    const applied = await edit(
      f,
      first.board_build_base as Record<string, unknown>,
      { kind: 'object.update', object_id: f.frame.id, patch: { locked: true } },
      'request:lock'
    )
    await expect(
      edit(
        f,
        first.board_build_base as Record<string, unknown>,
        { kind: 'object.move', object_id: f.text.id, x: 200, y: 200 },
        'request:stale'
      )
    ).rejects.toThrow('Board context is stale')

    const fresh = (applied.context as { board_build_base: Record<string, unknown> })
      .board_build_base
    await expect(
      edit(
        f,
        fresh,
        { kind: 'object.update', object_id: f.frame.id, patch: { locked: false } },
        'request:lock'
      )
    ).rejects.toThrow('already used for a different mutation')
    await expect(
      edit(
        f,
        fresh,
        { kind: 'object.move', object_id: f.frame.id, x: 200, y: 200 },
        'request:locked'
      )
    ).rejects.toThrow('is locked')
    await expect(
      edit(
        f,
        fresh,
        { kind: 'object.move', object_id: f.frame.childIds[0], x: 10, y: 10 },
        'request:nested'
      )
    ).rejects.toThrow('is not a top-level object')
    await expect(
      edit(
        f,
        fresh,
        { kind: 'object.update', object_id: f.codeObject.id, patch: { name: 'Wrong path' } },
        'request:code-object-update'
      )
    ).rejects.toThrow('use the Code Object contract for content or identity changes')
    await expect(
      edit(
        f,
        fresh,
        { kind: 'object.duplicate', object_id: f.codeObject.id },
        'request:code-object-duplicate'
      )
    ).rejects.toThrow('use the Code Object contract for content or identity changes')
    expect((await f.store.head())?.revision).toBe(f.head.revision + 1)
  })
})
