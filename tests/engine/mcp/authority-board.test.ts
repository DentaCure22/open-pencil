import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { CODE_OBJECT_AGENT_PRESETS, parseCodeObjectDocument } from '@open-pencil/core/code-object'
import { readContentSource } from '@open-pencil/core/io'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { assetHashFromReference, computeImageHash } from '@open-pencil/scene-graph/images'

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

async function fixture(
  options: { withAnchor?: boolean; withCompact?: boolean; withNestedSpaces?: boolean } = {}
) {
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
  const compact = options.withCompact
    ? graph.createNodeWithId('art:compact:1', 'FRAME', page.id, {
        height: 180,
        name: 'Compact artifact',
        width: 280,
        x: 80,
        y: 90
      })
    : undefined
  const parentSpace = options.withNestedSpaces
    ? graph.createNodeWithId('frame:parent-space', 'FRAME', page.id, {
        height: 600,
        name: 'Parent Bot',
        width: 900,
        x: 40,
        y: 40
      })
    : undefined
  const childSpace = parentSpace
    ? graph.createNodeWithId('frame:child-space', 'FRAME', parentSpace.id, {
        height: 240,
        name: 'Sub-bot',
        width: 360,
        x: 80,
        y: 100
      })
    : undefined
  const misplacedChildSpace = parentSpace
    ? graph.createNodeWithId('frame:misplaced-child-space', 'FRAME', page.id, {
        height: 240,
        name: 'Misplaced sub-bot',
        width: 360,
        x: 1_000,
        y: 100
      })
    : undefined
  const document = savedDocument(graph)
  if (compact) {
    const pair = document.nodes.find(([id]) => id === compact.id)
    if (!pair) throw new Error('Expected compact fixture tuple')
    pair[1] = {
      childIds: [],
      height: compact.height,
      id: compact.id,
      name: compact.name,
      parentId: compact.parentId,
      type: compact.type,
      width: compact.width,
      x: compact.x,
      y: compact.y
    } as SceneNode
  }
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-headless',
    root
  })
  await store.initialize({
    document,
    requestId: 'seed-headless',
    sourceWorkspaceId: 'workspace-headless'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected initialized authority head')
  return {
    anchor,
    childSpace,
    compact,
    graph,
    head,
    misplacedChildSpace,
    page,
    parentSpace,
    root,
    runtime: new LocalWorkspaceBoardRuntime(store),
    store
  }
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

function seededShuffle<T>(values: readonly T[]): T[] {
  const result = [...values]
  let state = 0x5eedc0de
  for (let index = result.length - 1; index > 0; index -= 1) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    const target = state % (index + 1)
    ;[result[index], result[target]] = [result[target] as T, result[index] as T]
  }
  return result
}

type RpcResult = { [key: string]: unknown }
type RpcResponse = { result?: RpcResult }

function responseResult(value: unknown): RpcResult {
  if (!value || typeof value !== 'object') throw new Error('Expected RPC response object')
  const result = (value as RpcResponse).result
  if (!result || typeof result !== 'object') throw new Error('Expected RPC result object')
  return result
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace authority Board runtime', () => {
  test('validates root Bot and nested sub-bot space ancestry', async () => {
    const f = await fixture({ withNestedSpaces: true })
    if (!f.parentSpace || !f.childSpace || !f.misplacedChildSpace) {
      throw new Error('Expected nested Board space fixture')
    }

    await expect(
      f.store.assertBoardSpaceParent({
        frameId: f.parentSpace.id,
        pageId: f.page.id,
        parentFrameId: null
      })
    ).resolves.toBeUndefined()
    await expect(
      f.store.assertBoardSpaceParent({
        frameId: f.childSpace.id,
        pageId: f.page.id,
        parentFrameId: f.parentSpace.id
      })
    ).resolves.toBeUndefined()
    await expect(
      f.store.assertBoardSpaceParent({
        frameId: f.misplacedChildSpace.id,
        pageId: f.page.id,
        parentFrameId: f.parentSpace.id
      })
    ).rejects.toThrow('must be a direct child of parent Bot frame')
  })

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
    f.graph.updateNode(anchor.id, {
      pluginData: [
        { key: 'kind', pluginId: 'openpencil-code-object', value: 'code-object' },
        {
          key: 'document',
          pluginId: 'openpencil-code-object',
          value: JSON.stringify({
            component: 'agent-conversation-terminal',
            runtime: 'openpencil-code',
            schemaVersion: 1,
            state: {}
          })
        }
      ]
    })
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
      count: 1,
      requested_object_ids: [anchor.id],
      scope: 'objects',
      status: 'matched'
    })
    expect(exact.nodes).toHaveLength(1)
    expect(exact.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          child_ids: [child.id],
          code_object_component: 'agent-conversation-terminal',
          id: anchor.id,
          role: 'agent_card'
        })
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

  test('applies an ordered node batch in one guarded authority commit', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const applied = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              node: {
                height: 240,
                id: 'agent:frame:1',
                name: 'Batch frame',
                type: 'FRAME',
                width: 360,
                x: 100,
                y: 120
              },
              op: 'create',
              parent_id: f.page.id
            },
            {
              node: {
                height: 40,
                id: 'agent:text:1',
                name: 'Batch text',
                text: 'First',
                type: 'TEXT',
                width: 200,
                x: 20,
                y: 24
              },
              op: 'create',
              parent_id: 'agent:frame:1'
            },
            {
              changes: { text: 'Saved once' },
              object_id: 'agent:text:1',
              op: 'update'
            }
          ],
          page_id: f.page.id,
          request_id: 'request:board-apply-batch'
        }
      })
    )

    expect(applied).toMatchObject({
      applied_revision: f.head.revision + 1,
      changed_ids: ['agent:frame:1', 'agent:text:1'],
      created_ids: ['agent:frame:1', 'agent:text:1'],
      not_verified: ['live_runtime', 'interaction'],
      operations: 3,
      status: 'committed',
      verified: ['saved_state']
    })
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed authority head')
    const document = readAuthorityBoardDocument(head.document)
    expect(document.graph.getNode('agent:frame:1')?.parentId).toBe(f.page.id)
    expect(document.graph.getNode('agent:frame:1')?.childIds).toEqual(['agent:text:1'])
    expect(document.graph.getNode('agent:text:1')?.text).toBe('Saved once')
  })

  test('rejects legacy design-system nodes as new native Board objects', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))

    for (const type of ['COMPONENT', 'COMPONENT_SET', 'INSTANCE']) {
      await expect(
        f.runtime.sendRpc({
          command: 'board_apply',
          args: {
            ...contextArgs(f).args,
            context_token: context.context_token,
            operations: [
              {
                node: {
                  height: 100,
                  id: `agent:legacy:${type.toLowerCase()}`,
                  name: `Legacy ${type}`,
                  type,
                  width: 100
                },
                op: 'create',
                parent_id: f.page.id
              }
            ],
            request_id: `request:reject-${type.toLowerCase()}`
          }
        })
      ).rejects.toThrow('supported non-page node type')
    }

    expect((await f.store.head())?.revision).toBe(f.head.revision)
  })

  test('imports a completed local raster file as source-backed native Board media', async () => {
    const f = await fixture()
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3)
    const sourcePath = path.join(f.root, 'mirror.png')
    await writeFile(sourcePath, bytes)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const applied = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              bounds: { height: 480, width: 320, x: 100, y: 120 },
              image_scale_mode: 'FIT',
              name: 'Mirror render',
              object_id: 'agent:image:1',
              op: 'create_image',
              parent_id: f.page.id,
              source_path: sourcePath
            }
          ],
          page_id: f.page.id,
          request_id: 'request:create-image'
        }
      })
    )

    expect(applied).toMatchObject({
      changed_ids: ['agent:image:1'],
      created_ids: ['agent:image:1'],
      status: 'committed',
      verified: ['saved_state']
    })
    const head = await f.store.head()
    if (!head) throw new Error('Expected image commit')
    const document = readAuthorityBoardDocument(head.document)
    const node = document.graph.getNode('agent:image:1')
    const hash = computeImageHash(bytes)
    expect(node).toMatchObject({
      fills: [
        expect.objectContaining({
          imageHash: hash,
          imageScaleMode: 'FIT',
          type: 'IMAGE'
        })
      ],
      height: 480,
      name: 'Mirror render',
      parentId: f.page.id,
      type: 'RECTANGLE',
      width: 320,
      x: 100,
      y: 120
    })
    expect(document.graph.images.get(hash)).toEqual(bytes)
    const source = node ? readContentSource(node) : null
    expect(source).toMatchObject({ fileName: 'mirror.png', mimeType: 'image/png' })
    expect(source ? assetHashFromReference(source.source) : null).toBe(hash)
  })

  test('converts typed image page bounds when the parent is nested', async () => {
    const f = await fixture()
    const sourcePath = path.join(f.root, 'nested.png')
    await writeFile(sourcePath, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1))
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const applied = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              node: {
                height: 1200,
                id: 'agent:campus:1',
                name: 'Campus',
                type: 'FRAME',
                width: 2000,
                x: 2800,
                y: 400
              },
              op: 'create',
              parent_id: f.page.id
            },
            {
              bounds: { height: 480, width: 320, x: 3920, y: 600 },
              name: 'Nested render',
              object_id: 'agent:nested-image:1',
              op: 'create_image',
              parent_id: 'agent:campus:1',
              source_path: sourcePath
            }
          ],
          page_id: f.page.id,
          request_id: 'request:create-nested-image'
        }
      })
    )

    expect(applied.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bounds: { height: 480, width: 320, x: 3920, y: 600 },
          id: 'agent:nested-image:1',
          parent_id: 'agent:campus:1'
        })
      ])
    )
    const head = await f.store.head()
    if (!head) throw new Error('Expected nested image commit')
    const document = readAuthorityBoardDocument(head.document)
    expect(document.graph.getNode('agent:nested-image:1')).toMatchObject({
      height: 480,
      parentId: 'agent:campus:1',
      width: 320,
      x: 1120,
      y: 200
    })
  })

  test('keeps a no-op apply byte-stable for untouched compact nodes', async () => {
    const f = await fixture({ withCompact: true })
    if (!f.compact) throw new Error('Expected compact fixture node')
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const applied = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              node: { id: f.compact.id, type: f.compact.type },
              op: 'create',
              parent_id: f.page.id
            }
          ],
          page_id: f.page.id,
          request_id: 'request:board-apply-noop'
        }
      })
    )

    expect(applied).toMatchObject({
      applied_revision: f.head.revision,
      changed_ids: [],
      status: 'unchanged'
    })
    const head = await f.store.head()
    if (!head) throw new Error('Expected unchanged Board head')
    expect(head.revision).toBe(f.head.revision)
    const raw = (head.document as { nodes?: Array<[string, Record<string, unknown>]> }).nodes?.find(
      ([id]) => id === f.compact?.id
    )?.[1]
    expect(raw).not.toHaveProperty('rotation')
  })

  test('rejects unsafe authored Code Object source before saving', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    await expect(
      f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              node: {
                height: 240,
                id: 'agent:unsafe-code:1',
                name: 'Unsafe code',
                pluginData: [
                  { key: 'kind', pluginId: 'openpencil-code-object', value: 'code-object' },
                  {
                    key: 'document',
                    pluginId: 'openpencil-code-object',
                    value: JSON.stringify({
                      boardPermissions: [],
                      component: 'user-code',
                      definitionId: 'unsafe-code',
                      name: 'Unsafe code',
                      props: {},
                      runtime: 'openpencil-code',
                      schemaVersion: 1,
                      source:
                        'export default function Unsafe() { return <div>{window.location.href}</div> }',
                      state: {}
                    })
                  }
                ],
                type: 'FRAME',
                width: 360
              },
              op: 'create',
              parent_id: f.page.id
            }
          ],
          page_id: f.page.id
        }
      })
    ).rejects.toThrow('window')
    expect((await f.store.head())?.revision).toBe(f.head.revision)
  })

  test('creates and updates an authored Code Object through typed actions', async () => {
    const f = await fixture()
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const created = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              appearance: {
                preference: 'system',
                tokens: { light: { accent: '#315efb' } }
              },
              bounds: { height: 240, width: 360, x: 100, y: 120 },
              name: 'Typed app',
              object_id: 'agent:typed-code:1',
              op: 'create_code_object',
              parent_id: f.page.id,
              props: { message: 'Hello' },
              source:
                'export default function App({ props }) { return <main>{props.message}</main> }'
            }
          ],
          page_id: f.page.id,
          request_id: 'request:typed-code-create'
        }
      })
    )

    expect(created).toMatchObject({
      changed_ids: ['agent:typed-code:1'],
      created_ids: ['agent:typed-code:1'],
      not_verified: ['live_runtime', 'interaction'],
      operations: 1,
      preflight: [expect.objectContaining({ object_id: 'agent:typed-code:1' })],
      status: 'committed',
      verified: ['saved_state', 'static_preflight']
    })
    let head = await f.store.head()
    if (!head) throw new Error('Expected typed Code Object commit')
    let document = readAuthorityBoardDocument(head.document)
    let node = document.graph.getNode('agent:typed-code:1')
    expect(node).toMatchObject({
      height: 240,
      name: 'Typed app',
      parentId: f.page.id,
      type: 'FRAME',
      width: 360,
      x: 100,
      y: 120
    })
    expect(parseCodeObjectDocument(node)).toMatchObject({
      appearance: {
        preference: 'system',
        tokens: { light: { accent: '#315efb' } }
      },
      component: 'user-code',
      definitionId: 'agent:typed-code:1',
      name: 'Typed app',
      props: { message: 'Hello' },
      runtime: 'openpencil-code',
      schemaVersion: 1
    })

    const updateContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const updated = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: updateContext.context_token,
          operations: [
            {
              appearance: { preference: 'dark' },
              bounds: { x: 180 },
              name: 'Typed app updated',
              object_id: 'agent:typed-code:1',
              op: 'update_code_object',
              props: { message: 'Updated' }
            }
          ],
          page_id: f.page.id,
          request_id: 'request:typed-code-update'
        }
      })
    )
    expect(updated).toMatchObject({
      changed_ids: ['agent:typed-code:1'],
      operations: 1,
      preflight: [],
      status: 'committed',
      verified: ['saved_state']
    })
    head = await f.store.head()
    if (!head) throw new Error('Expected typed Code Object update')
    document = readAuthorityBoardDocument(head.document)
    node = document.graph.getNode('agent:typed-code:1')
    expect(node).toMatchObject({ name: 'Typed app updated', x: 180 })
    expect(parseCodeObjectDocument(node)).toMatchObject({
      appearance: { preference: 'dark' },
      name: 'Typed app updated',
      props: { message: 'Updated' }
    })
  })

  test('creates, reads, and updates a source-backed Mermaid diagram through typed actions', async () => {
    const f = await fixture()
    const source = 'flowchart TD\n  Assess --> Diagnose --> Treat\n'
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const created = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: [
            {
              appearance: 'light',
              bounds: { height: 480, width: 720, x: 100, y: 120 },
              name: 'Patient flow',
              object_id: 'agent:mermaid:patient-flow',
              op: 'create_mermaid',
              parent_id: f.page.id,
              source
            }
          ],
          page_id: f.page.id,
          request_id: 'request:typed-mermaid-create'
        }
      })
    )

    expect(created).toMatchObject({
      changed_ids: ['agent:mermaid:patient-flow'],
      created_ids: ['agent:mermaid:patient-flow'],
      operations: 1,
      preflight: [
        expect.objectContaining({
          contract: 'native_diagram',
          object_id: 'agent:mermaid:patient-flow',
          syntax: 'mermaid'
        })
      ],
      status: 'committed',
      verified: ['saved_state', 'static_preflight']
    })

    const readContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const read = responseResult(
      await f.runtime.sendRpc({
        command: 'board_read',
        args: {
          ...contextArgs(f).args,
          context_token: readContext.context_token,
          detail: 'mermaid',
          object_ids: ['agent:mermaid:patient-flow'],
          page_id: f.page.id,
          scope: 'objects'
        }
      })
    )
    expect(read.nodes).toEqual([
      expect.objectContaining({
        id: 'agent:mermaid:patient-flow',
        mermaid: expect.objectContaining({
          appearance: 'light',
          bounds: { height: 480, width: 720, x: 100, y: 120 },
          owner_id: 'agent:mermaid:patient-flow',
          source
        }),
        name: 'Patient flow'
      })
    ])

    const updatedSource = 'flowchart TD\n  Assess --> Plan --> Treat --> FollowUp'
    const updateContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const updated = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: updateContext.context_token,
          operations: [
            {
              appearance: 'dark',
              bounds: { x: 180 },
              object_id: 'agent:mermaid:patient-flow',
              op: 'update_mermaid',
              source: updatedSource
            }
          ],
          page_id: f.page.id,
          request_id: 'request:typed-mermaid-update'
        }
      })
    )
    expect(updated).toMatchObject({
      changed_ids: ['agent:mermaid:patient-flow'],
      created_ids: [],
      operations: 1,
      status: 'committed',
      verified: ['saved_state', 'static_preflight']
    })
    const head = await f.store.head()
    if (!head) throw new Error('Expected typed Mermaid update')
    const document = readAuthorityBoardDocument(head.document)
    const node = document.graph.getNode('agent:mermaid:patient-flow')
    expect(node).toMatchObject({
      height: 480,
      name: 'Patient flow',
      width: 720,
      x: 180,
      y: 120
    })
    expect(
      node?.pluginData.find(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/source'
      )?.value
    ).toBe(updatedSource)

    const revisionBeforeInvalid = head.revision
    const invalidContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    await expect(
      f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: invalidContext.context_token,
          operations: [
            {
              object_id: 'agent:mermaid:patient-flow',
              op: 'update_mermaid',
              source: 'not a diagram'
            }
          ],
          page_id: f.page.id,
          request_id: 'request:typed-mermaid-invalid'
        }
      })
    ).rejects.toThrow('Mermaid source validation failed')
    expect((await f.store.head())?.revision).toBe(revisionBeforeInvalid)
  })

  test('creates and revises every modality from randomly ordered preset operations', async () => {
    const f = await fixture()
    const randomized = seededShuffle(CODE_OBJECT_AGENT_PRESETS)
    const context = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const created = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: context.context_token,
          operations: randomized.map((preset, index) => ({
            bounds: {
              height: 220,
              width: 340,
              x: 40 + (index % 3) * 380,
              y: 50 + Math.floor(index / 3) * 260
            },
            object_id: `agent:preset-trial:${preset.id}`,
            op: 'create_code_object',
            parent_id: f.page.id,
            preset_id: preset.id
          })),
          page_id: f.page.id,
          request_id: 'request:preset-modality-create'
        }
      })
    )

    expect(created.operations).toBe(CODE_OBJECT_AGENT_PRESETS.length)
    expect(created.preflight).toHaveLength(CODE_OBJECT_AGENT_PRESETS.length)
    let head = await f.store.head()
    if (!head) throw new Error('Expected preset Code Object commit')
    let document = readAuthorityBoardDocument(head.document)
    const sources = new Map<string, string>()
    for (const preset of randomized) {
      const id = `agent:preset-trial:${preset.id}`
      const codeObject = parseCodeObjectDocument(document.graph.getNode(id))
      expect(codeObject).toMatchObject({
        component: 'user-code',
        definitionId: preset.definitionId,
        modality: preset.modality,
        name: preset.name,
        presetId: preset.id,
        props: preset.props,
        state: preset.state,
        surface: preset.surface
      })
      expect(typeof codeObject?.source).toBe('string')
      sources.set(id, String(codeObject?.source))
    }

    const updateContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    const updated = responseResult(
      await f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: updateContext.context_token,
          operations: randomized.map((preset, index) => ({
            object_id: `agent:preset-trial:${preset.id}`,
            op: 'update_code_object',
            props: { trial: { index, modality: preset.modality } },
            state: { revision: 2 }
          })),
          page_id: f.page.id,
          request_id: 'request:preset-modality-update'
        }
      })
    )
    expect(updated.operations).toBe(CODE_OBJECT_AGENT_PRESETS.length)
    expect(updated.preflight).toEqual([])

    head = await f.store.head()
    if (!head) throw new Error('Expected preset Code Object update')
    document = readAuthorityBoardDocument(head.document)
    for (const [index, preset] of randomized.entries()) {
      const id = `agent:preset-trial:${preset.id}`
      expect(parseCodeObjectDocument(document.graph.getNode(id))).toMatchObject({
        modality: preset.modality,
        presetId: preset.id,
        props: { trial: { index, modality: preset.modality } },
        source: sources.get(id),
        state: { revision: 2 }
      })
    }

    const rejectedContext = responseResult(await f.runtime.sendRpc(contextArgs(f)))
    await expect(
      f.runtime.sendRpc({
        command: 'board_apply',
        args: {
          ...contextArgs(f).args,
          context_token: rejectedContext.context_token,
          operations: [
            {
              object_id: `agent:preset-trial:${randomized[0]?.id ?? 'missing'}`,
              op: 'update_code_object',
              source: 'export default function Replacement() { return <main /> }'
            }
          ],
          page_id: f.page.id,
          request_id: 'request:preset-source-rejected'
        }
      })
    ).rejects.toThrow('owns its renderer')
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
