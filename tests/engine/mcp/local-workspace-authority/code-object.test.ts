import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  codeObjectSourceHash,
  parseCodeObjectDocument,
  serializeCodeObjectPluginData
} from '@open-pencil/core/code-object'
import { SceneGraph } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument
} from '#mcp/local-workspace-authority/document'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []
const SOURCE_CANARY = 'SOURCE_CANARY_DO_NOT_RETURN'
const PROPS_CANARY = 'PROPS_CANARY_DO_NOT_RETURN'
const STATE_CANARY = 'STATE_CANARY_DO_NOT_RETURN'
const SOURCE = `export default function Proof(){ return <section>${SOURCE_CANARY}</section> }`
const REFINED_SOURCE = `export default function Proof(){ return <main data-version="two">Refined</main> }`

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
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-code-object-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const anchor = graph.createNode('FRAME', page.id, {
    height: 100,
    name: 'Exact anchor',
    width: 200,
    x: 120,
    y: 160
  })
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-code-object',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-code-object',
    sourceWorkspaceId: 'workspace-code-object'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected authority head')
  return { anchor, head, page, runtime: new LocalWorkspaceBoardRuntime(store), store }
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

function buildArgs(
  base: Record<string, unknown>,
  anchorId: string,
  requestId = 'request:code-object'
) {
  return {
    ...base,
    anchor_id: anchorId,
    intent: 'Create one interactive proof surface',
    recipe: {
      initial_state: { secret: STATE_CANARY },
      kind: 'code_object',
      name: 'Authority proof',
      object_key: 'authority-proof',
      operation: 'create',
      props: { secret: PROPS_CANARY },
      source: SOURCE,
      source_format: 'tsx'
    },
    request_id: requestId
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local authority staged Code Objects', () => {
  test('creates one exact anchored frame with shared codec and bounded honest readback', async () => {
    const f = await fixture()
    const firstContext = await context(f)
    expect(firstContext.capabilities).toContain('board.build.code_object.tsx.create.staged')
    const applied = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(firstContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    expect(applied.status).toEqual({
      attention_required: false,
      command: 'completed',
      mutation: 'applied'
    })
    expect(applied.proof).toMatchObject({
      durable_readback: 'passed',
      normal_editor_undo: 'unavailable',
      runtime: 'unavailable',
      static_preflight: 'passed'
    })
    const ownerId = applied.owner_id as string
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed head')
    const document = readAuthorityBoardDocument(head.document)
    const owner = document.graph.getNode(ownerId)
    const codeObject = parseCodeObjectDocument(owner)
    expect(owner).toMatchObject({
      clipsContent: true,
      height: 520,
      name: 'Authority proof',
      width: 720,
      x: 368,
      y: 160
    })
    expect(codeObject).toMatchObject({
      component: 'user-code',
      definitionId: 'authority-proof',
      name: 'Authority proof',
      runtime: 'openpencil-code',
      source: SOURCE
    })
    const serialized = JSON.stringify(applied)
    expect(serialized).not.toContain(SOURCE_CANARY)
    expect(serialized).not.toContain(PROPS_CANARY)
    expect(serialized).not.toContain(STATE_CANARY)
    expect(serialized).toContain('props_hash')
    expect(serialized).toContain('state_hash')
  })

  test('refines one exact owner while preserving state, geometry, and unrelated plugin data', async () => {
    const f = await fixture()
    const firstContext = await context(f)
    const created = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(firstContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    const ownerId = created.owner_id as string
    const createdHead = await f.store.head()
    if (!createdHead) throw new Error('Expected created head')
    const changedDocument = readAuthorityBoardDocument(createdHead.document)
    const changedOwner = changedDocument.graph.getNode(ownerId)
    if (!changedOwner) throw new Error('Expected created owner')
    const preservedX = changedOwner.x + 17
    const preservedY = changedOwner.y + 23
    changedDocument.graph.updateNode(ownerId, {
      pluginData: [
        ...changedOwner.pluginData,
        { key: 'keep', pluginId: 'example.test', value: 'preserved' }
      ],
      x: preservedX,
      y: preservedY
    })
    await f.store.commit({
      document: writeAuthorityBoardDocument(changedDocument),
      expectedContentHash: createdHead.contentHash,
      expectedRevision: createdHead.revision,
      requestId: 'request:prepare-refine-preservation',
      workspaceId: createdHead.identity.workspaceId
    })

    f.runtime = new LocalWorkspaceBoardRuntime(f.store)
    const refineContext = await context(f)
    expect(refineContext.capabilities).toContain('board.build.code_object.tsx.refine.staged')
    const recipeBase = {
      expected_source_hash: await codeObjectSourceHash(SOURCE),
      kind: 'code_object',
      object_key: 'authority-proof',
      operation: 'refine',
      owner_id: ownerId,
      source_format: 'tsx'
    }
    const refineArgs = {
      ...(refineContext.board_build_base as Record<string, unknown>),
      intent: 'Refine the existing interactive proof without replacing its identity',
      recipe: {
        ...recipeBase,
        name: 'Authority proof refined',
        props: { accent: 'violet' },
        source: REFINED_SOURCE
      },
      request_id: 'request:refine-code-object'
    }
    const applied = result(await f.runtime.sendRpc({ command: 'board_build', args: refineArgs }))
    expect(applied).toMatchObject({
      owner_id: ownerId,
      proof: {
        durable_readback: 'passed',
        normal_editor_undo: 'unavailable',
        static_preflight: 'passed'
      },
      receipt: {
        idempotent_replay: false,
        refinement: {
          expected_source_hash: recipeBase.expected_source_hash,
          preservation: { geometry: true, other_plugin_data: true, state: true }
        }
      },
      status: {
        attention_required: false,
        command: 'completed',
        mutation: 'applied'
      }
    })
    const appliedRevision = (applied.persistence as { authority_revision: number })
      .authority_revision
    const refinedHead = await f.store.head()
    if (!refinedHead) throw new Error('Expected refined head')
    const refinedDocument = readAuthorityBoardDocument(refinedHead.document)
    const refinedOwner = refinedDocument.graph.getNode(ownerId)
    const refinedCodeObject = parseCodeObjectDocument(refinedOwner)
    expect(refinedOwner).toMatchObject({
      name: 'Authority proof refined',
      x: preservedX,
      y: preservedY
    })
    expect(refinedOwner?.pluginData).toContainEqual({
      key: 'keep',
      pluginId: 'example.test',
      value: 'preserved'
    })
    expect(refinedCodeObject).toMatchObject({
      definitionId: 'authority-proof',
      name: 'Authority proof refined',
      props: { accent: 'violet' },
      source: REFINED_SOURCE,
      state: { secret: STATE_CANARY }
    })

    const replayContext = await context(f)
    const replay = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...refineArgs,
          ...(replayContext.board_build_base as Record<string, unknown>)
        }
      })
    )
    expect(replay).toMatchObject({ owner_id: ownerId, status: { mutation: 'replayed' } })
    expect((replay.persistence as { authority_revision: number }).authority_revision).toBe(
      appliedRevision
    )

    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...refineArgs,
          ...(replayContext.board_build_base as Record<string, unknown>),
          recipe: { ...(refineArgs.recipe as Record<string, unknown>), name: 'Changed replay' }
        }
      })
    ).rejects.toThrow('already used for a different mutation')

    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(replayContext.board_build_base as Record<string, unknown>),
          intent: 'Attempt a stale refinement',
          recipe: {
            ...(refineArgs.recipe as Record<string, unknown>),
            expected_source_hash: recipeBase.expected_source_hash
          },
          request_id: 'request:stale-refine'
        }
      })
    ).rejects.toThrow('Code Object source is stale')

    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(replayContext.board_build_base as Record<string, unknown>),
          intent: 'Attempt unsupported state replacement',
          recipe: { ...(refineArgs.recipe as Record<string, unknown>), initial_state: {} },
          request_id: 'request:unsafe-refine-shape'
        }
      })
    ).rejects.toThrow('unsupported fields: initial_state')

    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(replayContext.board_build_base as Record<string, unknown>),
          intent: 'Attempt the wrong immutable owner key',
          recipe: {
            ...(refineArgs.recipe as Record<string, unknown>),
            expected_source_hash: (
              applied.readback as {
                code_object: { component: { source_hash: string } }
              }
            ).code_object.component.source_hash,
            object_key: 'wrong-key'
          },
          request_id: 'request:wrong-refine-key'
        }
      })
    ).rejects.toThrow('does not match immutable object key')

    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(replayContext.board_build_base as Record<string, unknown>),
          intent: 'Attempt unsafe refined source',
          recipe: {
            ...(refineArgs.recipe as Record<string, unknown>),
            expected_source_hash: (
              applied.readback as {
                code_object: { component: { source_hash: string } }
              }
            ).code_object.component.source_hash,
            source: 'export default function Unsafe(){ fetch("/secret"); return <div /> }'
          },
          request_id: 'request:unsafe-refine-source'
        }
      })
    ).rejects.toThrow('blocked ambient capability')
    expect((await f.store.head())?.revision).toBe(appliedRevision)
  })

  test('replays after restart and refuses changed input, duplicate keys, and unsafe recipes', async () => {
    const f = await fixture()
    const firstContext = await context(f)
    const args = buildArgs(firstContext.board_build_base as Record<string, unknown>, f.anchor.id)
    const applied = result(await f.runtime.sendRpc({ command: 'board_build', args }))
    const appliedRevision = (applied.persistence as { authority_revision: number })
      .authority_revision

    const restarted = new LocalWorkspaceBoardRuntime(f.store)
    f.runtime = restarted
    const replayContext = await context(f)
    const replay = result(
      await restarted.sendRpc({
        command: 'board_build',
        args: buildArgs(replayContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    expect(replay.owner_id).toBe(applied.owner_id)
    expect(replay.status).toMatchObject({ mutation: 'replayed' })
    expect((replay.persistence as { authority_revision: number }).authority_revision).toBe(
      appliedRevision
    )

    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...buildArgs(replayContext.board_build_base as Record<string, unknown>, f.anchor.id),
          recipe: {
            ...(buildArgs({}, f.anchor.id).recipe as Record<string, unknown>),
            name: 'Changed request'
          }
        }
      })
    ).rejects.toThrow('already used for a different mutation')

    const fresh = (replay.context as { board_build_base: Record<string, unknown> }).board_build_base
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: buildArgs(fresh, f.anchor.id, 'request:duplicate-key')
      })
    ).rejects.toThrow('already exists')
    await expect(
      restarted.sendRpc({
        command: 'board_build',
        args: {
          ...buildArgs(fresh, f.anchor.id, 'request:unsafe'),
          recipe: {
            ...(buildArgs({}, f.anchor.id).recipe as Record<string, unknown>),
            source: 'export default function Unsafe(){ fetch("/secret"); return <div /> }'
          }
        }
      })
    ).rejects.toThrow('blocked ambient capability')

    const latest = await f.store.head()
    if (!latest) throw new Error('Expected latest authority head')
    const document = readAuthorityBoardDocument(latest.document)
    const nested = document.graph.createNode('FRAME', f.anchor.id, {
      height: 40,
      name: 'Nested anchor',
      width: 40
    })
    await f.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: latest.contentHash,
      expectedRevision: latest.revision,
      requestId: 'request:add-nested-anchor',
      workspaceId: latest.identity.workspaceId
    })
    f.runtime = new LocalWorkspaceBoardRuntime(f.store)
    const nestedContext = await context(f)
    await expect(
      f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...buildArgs(
            nestedContext.board_build_base as Record<string, unknown>,
            nested.id,
            'request:nested-anchor'
          ),
          recipe: {
            ...(buildArgs({}, nested.id).recipe as Record<string, unknown>),
            object_key: 'nested-proof'
          }
        }
      })
    ).rejects.toThrow('must be a top-level object')
  })

  test('keeps a historical receipt after deletion and never recreates the owner', async () => {
    const f = await fixture()
    const firstContext = await context(f)
    const applied = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(firstContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    const ownerId = applied.owner_id as string
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed head')
    const document = readAuthorityBoardDocument(head.document)
    document.graph.deleteNode(ownerId)
    await f.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId: 'request:delete-owner',
      workspaceId: head.identity.workspaceId
    })

    f.runtime = new LocalWorkspaceBoardRuntime(f.store)
    const freshContext = await context(f)
    const verify = result(
      await f.runtime.sendRpc({
        command: 'board_verify',
        args: {
          ...(freshContext.board_build_base as Record<string, unknown>),
          request_id: 'request:code-object'
        }
      })
    )
    expect(verify.status).toBe('matched')
    expect(verify.code_objects).toEqual([
      expect.objectContaining({
        reconciliation: { reasons: ['owner_missing'], status: 'missing' }
      })
    ])
    const beforeReplay = await f.store.head()
    const replay = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(freshContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    expect(replay.owner_id).toBe(ownerId)
    expect(replay.proof).toMatchObject({
      durable_readback: 'historical_only',
      reconciliation: 'missing'
    })
    expect((await f.store.head())?.revision).toBe(beforeReplay?.revision)
    expect(
      readAuthorityBoardDocument((await f.store.head())?.document).graph.getNode(ownerId)
    ).toBeUndefined()
  })

  test('reports a diverged historical owner without repairing it on replay', async () => {
    const f = await fixture()
    const firstContext = await context(f)
    const applied = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(firstContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    const ownerId = applied.owner_id as string
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed head')
    const document = readAuthorityBoardDocument(head.document)
    const owner = document.graph.getNode(ownerId)
    const codeObject = parseCodeObjectDocument(owner)
    if (!owner || !codeObject) throw new Error('Expected authored Code Object')
    document.graph.updateNode(ownerId, {
      name: 'Changed outside receipt',
      pluginData: serializeCodeObjectPluginData(owner, {
        ...codeObject,
        name: 'Changed outside receipt',
        source: 'export default function Changed(){ return <aside>changed</aside> }'
      }),
      x: 999
    })
    await f.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId: 'request:diverge-owner',
      workspaceId: head.identity.workspaceId
    })

    f.runtime = new LocalWorkspaceBoardRuntime(f.store)
    const freshContext = await context(f)
    const verify = result(
      await f.runtime.sendRpc({
        command: 'board_verify',
        args: {
          ...(freshContext.board_build_base as Record<string, unknown>),
          request_id: 'request:code-object'
        }
      })
    )
    expect(verify.code_objects).toEqual([
      expect.objectContaining({
        reconciliation: expect.objectContaining({ status: 'diverged' })
      })
    ])
    const beforeReplay = await f.store.head()
    const replay = result(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: buildArgs(freshContext.board_build_base as Record<string, unknown>, f.anchor.id)
      })
    )
    expect(replay.proof).toMatchObject({
      durable_readback: 'diverged',
      reconciliation: 'diverged'
    })
    expect((await f.store.head())?.revision).toBe(beforeReplay?.revision)
    const finalHead = await f.store.head()
    if (!finalHead) throw new Error('Expected final head')
    const finalOwner = readAuthorityBoardDocument(finalHead.document).graph.getNode(ownerId)
    expect(finalOwner).toMatchObject({ name: 'Changed outside receipt', x: 999 })
  })
})
