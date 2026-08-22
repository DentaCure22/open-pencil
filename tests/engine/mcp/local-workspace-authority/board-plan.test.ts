import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseCodeObjectDocument } from '@open-pencil/core/code-object'
import { BOARD_BUILD_PLAN_CONTRACT } from '@open-pencil/core/rpc'
import {
  canonicalMemoryDerivedFromId,
  canonicalMemoryObjectId,
  canonicalMemorySourceNodeId
} from '@open-pencil/core/tools'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument
} from '#mcp/local-workspace-authority/document'
import { readAuthorityMermaidSource } from '#mcp/local-workspace-authority/native-diagram'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []

type RpcResult = Record<string, unknown>

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

async function fixture(options: { blockedGrid?: boolean; reusableNodePool?: number } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-board-plan-'))
  roots.push(root)
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  page.name = 'Plan Board'
  let gridAnchorId: string | undefined
  let gridBlockerId: string | undefined
  const reusableNodeIds: string[] = []
  if (options.blockedGrid) {
    gridAnchorId = graph.createNode('FRAME', page.id, {
      height: 80,
      name: 'Grid anchor',
      width: 120,
      x: 400,
      y: 400
    }).id
    gridBlockerId = graph.createNode('FRAME', page.id, {
      height: 200_000,
      name: 'Grid blocker',
      width: 200_000,
      x: -100_000,
      y: -100_000
    }).id
  }
  if (options.reusableNodePool) {
    const probe = graph.createNode('TEXT', page.id, { name: 'Allocator probe' })
    const nextIdNumber = Number(probe.id.split(':')[1]) + 1
    graph.deleteNode(probe.id)
    for (let index = 0; index < options.reusableNodePool; index += 1) {
      const id = `0:${String(nextIdNumber + index)}`
      graph.createNodeWithId(id, 'TEXT', page.id, {
        name: `Reusable ${String(index)}`,
        text: `Reusable ${String(index)}`,
        x: 300 + index * 300,
        y: 240
      })
      reusableNodeIds.push(id)
    }
  }
  const store = new LocalWorkspaceAuthorityStore({
    preferredWorkspaceId: 'workspace-board-plan',
    root
  })
  await store.initialize({
    document: savedDocument(graph),
    requestId: 'seed-board-plan',
    sourceWorkspaceId: 'workspace-board-plan'
  })
  const head = await store.head()
  if (!head) throw new Error('Expected initialized Board plan authority head')
  return {
    gridAnchorId,
    gridBlockerId,
    head,
    page,
    reusableNodeIds,
    root,
    runtime: new LocalWorkspaceBoardRuntime(store),
    store
  }
}

function responseResult(value: unknown): RpcResult {
  if (!value || typeof value !== 'object') throw new Error('Expected RPC response object')
  const result = (value as { result?: unknown }).result
  if (!result || typeof result !== 'object') throw new Error('Expected RPC result object')
  return result as RpcResult
}

async function boardContext(f: Awaited<ReturnType<typeof fixture>>) {
  return responseResult(
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

async function savedMermaidSource(f: Awaited<ReturnType<typeof fixture>>, ownerId: string) {
  const head = await f.store.head()
  if (!head) throw new Error('Expected saved Mermaid authority head')
  return readAuthorityMermaidSource(readAuthorityBoardDocument(head.document), f.page.id, ownerId)
}

function mixedPlan() {
  return {
    artifacts: [
      {
        alias: 'decision',
        recipe: {
          body: 'Ship after the final review.',
          height: 240,
          kind: 'native_card',
          placement: { target: { kind: 'point', x: 400, y: 300 } },
          title: 'Release decision'
        }
      },
      {
        alias: 'caption',
        anchor: { alias: 'decision' },
        recipe: {
          kind: 'native_text',
          placement: {
            clearance: 24,
            preferred_directions: ['below', 'right', 'left', 'above']
          },
          text: 'Owner: launch team'
        }
      },
      {
        alias: 'followup',
        anchor: { alias: 'decision' },
        recipe: {
          body: 'This card must prefer the branch below the decision.',
          kind: 'native_card',
          placement: {
            clearance: 32,
            preferred_directions: ['below', 'right', 'left', 'above']
          },
          title: 'Follow-up review'
        }
      }
    ],
    contract: BOARD_BUILD_PLAN_CONTRACT
  }
}

function codeObjectPlan() {
  return {
    artifacts: [
      {
        alias: 'brief',
        recipe: {
          body: 'Choose a severity and preserve it.',
          kind: 'native_card',
          placement: { target: { kind: 'point', x: 400, y: 300 } },
          title: 'Risk triage'
        }
      },
      {
        alias: 'app',
        anchor: { alias: 'brief' },
        recipe: {
          initial_state: { severity: 'Medium' },
          kind: 'code_object',
          name: 'Risk triage control',
          object_key: 'risk-triage-control-v1',
          operation: 'create',
          source:
            'export default function App({state}){return <main><strong>{state.severity}</strong></main>}',
          source_format: 'tsx'
        }
      }
    ],
    contract: BOARD_BUILD_PLAN_CONTRACT
  }
}

function mermaidPlan() {
  return {
    artifacts: [
      {
        alias: 'flow',
        recipe: {
          kind: 'native_diagram',
          placement: { target: { kind: 'point', x: 640, y: 536 } },
          source: 'flowchart LR\n  Observe --> Decide --> Improve',
          source_format: 'mermaid'
        }
      }
    ],
    contract: BOARD_BUILD_PLAN_CONTRACT
  }
}

function planRequest(context: RpcResult, plan: unknown, requestId = 'request:mixed-plan') {
  return {
    command: 'board_build',
    args: {
      ...(context.board_build_base as RpcResult),
      intent: 'Create one release composition',
      plan,
      request_id: requestId
    }
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace authority Board build plans', () => {
  test('materializes and explicitly forks a reusable object in durable revisions', async () => {
    const f = await fixture({ reusableNodePool: 1 })
    const existingId = f.reusableNodeIds[0]
    if (!existingId) throw new Error('Expected reusable placement')
    const context = await boardContext(f)
    const revisionBefore = (context.board_build_base as { expected_revision: number })
      .expected_revision
    const request = planRequest(
      context,
      {
        artifacts: [
          {
            alias: 'pricing',
            recipe: {
              kind: 'canonical_object',
              operation: 'place',
              placement: { target: { kind: 'point', x: 900, y: 600 } },
              source_object_id: existingId
            }
          }
        ],
        contract: BOARD_BUILD_PLAN_CONTRACT
      },
      'request:canonical-object-plan'
    )
    const applied = responseResult(await f.runtime.sendRpc(request))
    const createdId = (applied.owner_ids as Record<string, string>).pricing
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed canonical object plan')
    const document = readAuthorityBoardDocument(head.document)
    const existingNode = document.graph.getNode(existingId)
    const createdNode = document.graph.getNode(createdId)
    if (!existingNode || !createdNode) throw new Error('Expected durable canonical placement')

    expect(head.revision).toBe(revisionBefore + 1)
    expect(createdNode).toMatchObject({ name: existingNode.name, text: existingNode.text })
    expect(canonicalMemoryObjectId(existingNode)).toBe(existingId)
    expect(canonicalMemoryObjectId(createdNode)).toBe(existingId)
    expect(canonicalMemorySourceNodeId(createdNode)).toBe(existingId)
    expect(applied).toMatchObject({
      proof: { durable_readback: 'passed' },
      readback: {
        plan: {
          current: true,
          artifact_kinds: { pricing: 'canonical_object' }
        }
      },
      status: { command: 'completed', mutation: 'applied' }
    })

    const replay = responseResult(await f.runtime.sendRpc(request))
    expect(replay.status).toMatchObject({ command: 'completed', mutation: 'replayed' })
    expect((await f.store.head())?.revision).toBe(revisionBefore + 1)

    const sharedContext = await boardContext(f)
    await f.runtime.sendRpc(
      planRequest(
        sharedContext,
        {
          artifacts: [],
          contract: BOARD_BUILD_PLAN_CONTRACT,
          operations: [
            {
              kind: 'object.update',
              object_id: createdId,
              patch: { name: 'Shared pricing', text: 'Annual plan is $200' }
            }
          ]
        },
        'request:update-shared-canonical-object'
      )
    )
    const sharedHead = await f.store.head()
    if (!sharedHead) throw new Error('Expected committed shared canonical update')
    const sharedDocument = readAuthorityBoardDocument(sharedHead.document)
    expect(sharedDocument.graph.getNode(existingId)).toMatchObject({
      name: 'Shared pricing',
      text: 'Annual plan is $200'
    })
    expect(sharedDocument.graph.getNode(createdId)).toMatchObject({
      name: 'Shared pricing',
      text: 'Annual plan is $200'
    })

    const forkContext = await boardContext(f)
    const forked = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          forkContext,
          {
            artifacts: [],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            operations: [
              { kind: 'canonical_object.fork', object_id: createdId },
              {
                kind: 'object.update',
                object_id: createdId,
                patch: { name: 'Pricing recommendation', text: 'Choose annual billing' }
              }
            ]
          },
          'request:fork-canonical-object'
        )
      )
    )
    const forkHead = await f.store.head()
    if (!forkHead) throw new Error('Expected committed canonical object fork')
    const forkDocument = readAuthorityBoardDocument(forkHead.document)
    const unchangedSource = forkDocument.graph.getNode(existingId)
    const variant = forkDocument.graph.getNode(createdId)
    if (!unchangedSource || !variant) throw new Error('Expected source and variant after fork')
    expect(unchangedSource).toMatchObject({ name: 'Shared pricing', text: 'Annual plan is $200' })
    expect(variant).toMatchObject({ name: 'Pricing recommendation', text: 'Choose annual billing' })
    expect(canonicalMemoryObjectId(variant)).toBe(createdId)
    expect(canonicalMemoryDerivedFromId(variant)).toBe(existingId)
    expect(canonicalMemorySourceNodeId(variant)).toBeUndefined()
    expect(forked).toMatchObject({
      readback: {
        plan: {
          current: true,
          operations: [
            {
              canonical_object_id: createdId,
              derived_from_canonical_object_id: existingId,
              operation: 'canonical_object.fork',
              status: 'current'
            },
            { expected: { name: 'Pricing recommendation', text: 'Choose annual billing' } }
          ]
        }
      }
    })
  })

  test('updates one existing object through one atomic board build plan', async () => {
    const f = await fixture()
    const createContext = await boardContext(f)
    const created = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          createContext,
          {
            artifacts: [
              {
                alias: 'card',
                recipe: {
                  body: 'Original body',
                  kind: 'native_card',
                  placement: { target: { kind: 'point', x: 300, y: 240 } },
                  title: 'Original title'
                }
              }
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT
          },
          'request:create-edit-target'
        )
      )
    )
    const objectId = (created.owner_ids as Record<string, string>).card
    const editContext = await boardContext(f)
    const revisionBefore = (editContext.board_build_base as { expected_revision: number })
      .expected_revision
    const request = planRequest(
      editContext,
      {
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT,
        operations: [
          { kind: 'object.move', object_id: objectId, x: 720, y: 480 },
          { height: 300, kind: 'object.resize', object_id: objectId, width: 520 },
          { kind: 'object.update', object_id: objectId, patch: { name: 'Final card' } }
        ]
      },
      'request:atomic-edit-plan'
    )
    const applied = responseResult(await f.runtime.sendRpc(request))

    expect(applied.final_revision).toBe(revisionBefore + 1)
    expect(applied.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed atomic edit plan')
    const document = readAuthorityBoardDocument(head.document)
    expect(document.graph.getNode(objectId)).toMatchObject({
      height: 300,
      name: 'Final card',
      width: 520,
      x: 720,
      y: 480
    })

    const replay = responseResult(await f.runtime.sendRpc(request))
    expect(replay.final_revision).toBe(revisionBefore + 1)
    expect(replay.status).toMatchObject({ command: 'completed', mutation: 'replayed' })

    const noChangeContext = await boardContext(f)
    const noChange = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          noChangeContext,
          {
            artifacts: [],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            operations: [
              { kind: 'object.move', object_id: objectId, x: 720, y: 480 },
              { height: 300, kind: 'object.resize', object_id: objectId, width: 520 },
              { kind: 'object.update', object_id: objectId, patch: { name: 'Final card' } }
            ]
          },
          'request:already-satisfied-edit-plan'
        )
      )
    )
    expect(
      (noChange.readback as { plan: { operations: Array<{ effect: string }> } }).plan.operations
    ).toEqual([
      expect.objectContaining({ effect: 'already_satisfied' }),
      expect.objectContaining({ effect: 'already_satisfied' }),
      expect.objectContaining({ effect: 'already_satisfied' })
    ])
  })

  test('durably recomposes only listed existing objects in one revision', async () => {
    const f = await fixture()
    const created = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          await boardContext(f),
          {
            artifacts: ['first', 'second', 'unrelated'].map((alias, index) => ({
              alias,
              recipe: {
                body: alias,
                kind: 'native_card',
                placement: { target: { kind: 'point', x: 200 + index * 500, y: 200 } },
                title: alias
              }
            })),
            contract: BOARD_BUILD_PLAN_CONTRACT
          },
          'request:create-composition-targets'
        )
      )
    )
    const ids = created.owner_ids as Record<string, string>
    const beforeHead = await f.store.head()
    if (!beforeHead) throw new Error('Expected composition fixture head.')
    const before = readAuthorityBoardDocument(beforeHead.document)
    const original = Object.fromEntries(
      Object.values(ids).map((id) => [id, before.graph.getAbsoluteBounds(id)])
    )
    const context = await boardContext(f)
    const revision = (context.board_build_base as { expected_revision: number }).expected_revision

    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [],
            composition: {
              geography: 'recompose',
              members: [{ object_id: ids.first }, { object_id: ids.second }],
              preferences: { direction: 'horizontal' }
            },
            contract: BOARD_BUILD_PLAN_CONTRACT
          },
          'request:persisted-semantic-recompose'
        )
      )
    )

    expect(applied.final_revision).toBe(revision + 1)
    const head = await f.store.head()
    if (!head) throw new Error('Expected recomposed authority head.')
    const document = readAuthorityBoardDocument(head.document)
    expect(document.graph.getAbsoluteBounds(ids.first)).not.toEqual(original[ids.first])
    expect(document.graph.getAbsoluteBounds(ids.second)).not.toEqual(original[ids.second])
    expect(document.graph.getAbsoluteBounds(ids.unrelated)).toEqual(original[ids.unrelated])
  })

  test('durably auto-places an anchorless composition of new aliases in one revision', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const revision = (context.board_build_base as { expected_revision: number }).expected_revision
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'discover',
                recipe: {
                  body: 'Understand the need.',
                  kind: 'native_card',
                  title: 'Discover',
                  width: 640
                }
              },
              {
                alias: 'measure',
                recipe: {
                  body: 'Measure the result.',
                  kind: 'native_card',
                  title: 'Measure',
                  width: 640
                }
              },
              {
                alias: 'deliver',
                recipe: {
                  body: 'Ship the result.',
                  kind: 'native_card',
                  title: 'Deliver',
                  width: 640
                }
              }
            ],
            composition: {
              members: [{ alias: 'discover' }, { alias: 'measure' }, { alias: 'deliver' }],
              preferences: { direction: 'horizontal' }
            },
            contract: BOARD_BUILD_PLAN_CONTRACT
          },
          'request:persisted-anchorless-composition'
        )
      )
    )

    expect(applied.final_revision).toBe(revision + 1)
    const ids = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected anchorless composition authority head.')
    const document = readAuthorityBoardDocument(head.document)
    const discover = document.graph.getAbsoluteBounds(ids.discover)
    const measure = document.graph.getAbsoluteBounds(ids.measure)
    const deliver = document.graph.getAbsoluteBounds(ids.deliver)
    expect(discover.x + discover.width).toBeLessThanOrEqual(measure.x)
    expect(measure.x + measure.width).toBeLessThanOrEqual(deliver.x)
  })

  test('durably replaces deleted obstacles with an anchorless composition in one revision', async () => {
    const f = await fixture({ blockedGrid: true })
    if (!f.gridBlockerId) throw new Error('Expected blocked-grid obstacle.')
    const context = await boardContext(f)
    const revision = (context.board_build_base as { expected_revision: number }).expected_revision
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'first',
                recipe: {
                  body: 'Replace the old Board in one build.',
                  kind: 'native_card',
                  title: 'First replacement'
                }
              },
              {
                alias: 'second',
                recipe: {
                  body: 'Keep the replacement composition grouped.',
                  kind: 'native_card',
                  title: 'Second replacement'
                }
              }
            ],
            composition: { members: [{ alias: 'first' }, { alias: 'second' }] },
            contract: BOARD_BUILD_PLAN_CONTRACT,
            operations: [{ kind: 'object.delete', object_id: f.gridBlockerId }]
          },
          'request:persisted-anchorless-replacement'
        )
      )
    )

    expect(applied.final_revision).toBe(revision + 1)
    const replacementIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected replacement authority head.')
    const document = readAuthorityBoardDocument(head.document)
    expect(document.graph.getNode(f.gridBlockerId)).toBeUndefined()
    expect(document.graph.getNode(replacementIds.first)).toBeDefined()
    expect(document.graph.getNode(replacementIds.second)).toBeDefined()
  })

  test('accepts a deleted object ID reused by a new artifact in the same plan', async () => {
    const f = await fixture({ reusableNodePool: 16 })
    const oldIds = f.reusableNodeIds

    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          await boardContext(f),
          {
            artifacts: [
              {
                alias: 'replacement',
                recipe: {
                  kind: 'native_text',
                  placement: { target: { kind: 'point', x: 300, y: 240 } },
                  text: 'Replacement text.'
                }
              }
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            operations: oldIds.map((objectId) => ({ kind: 'object.delete', object_id: objectId }))
          },
          'request:replace-and-reuse-id'
        )
      )
    )

    const replacementId = (applied.owner_ids as Record<string, string>).replacement
    expect(oldIds).toContain(replacementId)
    expect(applied).toMatchObject({
      proof: { durable_readback: 'passed' },
      readback: {
        plan: {
          current: true
        }
      },
      status: { command: 'completed', mutation: 'applied' }
    })
    const operations = (applied.readback as { plan: { operations: Record<string, unknown>[] } })
      .plan.operations
    expect(operations).toContainEqual(
      expect.objectContaining({
        reconciliation: { reasons: [], status: 'current' },
        replacement: { alias: 'replacement', object_id: replacementId }
      })
    )
  })

  test('creates a first native text artifact at an explicit point', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'caption',
                recipe: {
                  kind: 'native_text',
                  placement: { target: { kind: 'point', x: 240, y: 180 } },
                  text: 'Experiment brief'
                }
              }
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT
          },
          'request:free-text-plan'
        )
      )
    )

    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed free-text Board plan')
    const document = readAuthorityBoardDocument(head.document)
    const caption = document.graph.getNode(ownerIds.caption)
    expect(caption).toMatchObject({ name: 'Experiment brief', text: 'Experiment brief' })
    const bounds = document.graph.getAbsoluteBounds(ownerIds.caption)
    expect(bounds.x + bounds.width / 2).toBeCloseTo(240)
    expect(bounds.y + bounds.height / 2).toBeCloseTo(180)
  })

  test('preserves diagonal relative offsets through one atomic plan build', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'intake',
                recipe: {
                  body: 'Start here.',
                  kind: 'native_card',
                  placement: { target: { kind: 'point', x: 400, y: 400 } },
                  title: 'Intake'
                }
              },
              {
                alias: 'upper',
                anchor: { alias: 'intake' },
                recipe: {
                  body: 'Upper branch.',
                  kind: 'native_card',
                  placement: {
                    clearance: 80,
                    relative_offset: { column: 1, row: -1 }
                  },
                  title: 'Upper review'
                }
              },
              {
                alias: 'lower',
                anchor: { alias: 'intake' },
                recipe: {
                  body: 'Lower branch.',
                  kind: 'native_card',
                  placement: {
                    clearance: 80,
                    relative_offset: { column: 1, row: 1 }
                  },
                  title: 'Lower review'
                }
              }
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT
          },
          'request:diagonal-plan'
        )
      )
    )

    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed diagonal Board plan')
    const graph = readAuthorityBoardDocument(head.document).graph
    const intake = graph.getAbsoluteBounds(ownerIds.intake)
    const upper = graph.getAbsoluteBounds(ownerIds.upper)
    const lower = graph.getAbsoluteBounds(ownerIds.lower)
    expect(upper.x).toBe(intake.x + intake.width + 80)
    expect(upper.y + upper.height + 80).toBe(intake.y)
    expect(lower.x).toBe(intake.x + intake.width + 80)
    expect(lower.y).toBe(intake.y + intake.height + 80)
    expect(applied).toMatchObject({
      final_revision: 2,
      persistence: { status: 'durable' },
      receipt: { baseRevision: 1, appliedRevision: 2 },
      status: { mutation: 'applied' }
    })
  })

  test('commits aliased artifacts in one authority revision', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    expect(context.capabilities).toContain('board.build.plan.v1')
    expect(context.capabilities).toContain('board.build.plan.grid.v1')
    expect(context.capabilities).toContain('board.build.plan.flow.v1')
    const commit = spyOn(f.store, 'commit')

    const applied = responseResult(await f.runtime.sendRpc(planRequest(context, mixedPlan())))

    expect(commit).toHaveBeenCalledTimes(1)
    expect(applied).toMatchObject({
      execution_surface: 'local_workspace_authority',
      persistence: { authority_revision: 2, status: 'durable' },
      proof: { durable_readback: 'passed', normal_editor_undo: 'unavailable' },
      receipt: {
        appliedRevision: 2,
        baseRevision: 1,
        idempotent_replay: false,
        requestId: 'request:mixed-plan',
        status: 'applied'
      },
      status: { command: 'completed', mutation: 'applied' }
    })
    const ownerIds = applied.owner_ids as Record<string, string>
    expect(Object.keys(ownerIds).sort()).toEqual(['caption', 'decision', 'followup'])
    expect(ownerIds.caption).not.toBe(ownerIds.decision)
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed Board plan authority head')
    const document = readAuthorityBoardDocument(head.document)
    expect(head.revision).toBe(2)
    expect(document.graph.getNode(ownerIds.decision)?.name).toBe('Release decision')
    expect(document.graph.getNode(ownerIds.decision)?.height).toBe(240)
    expect(document.graph.getNode(ownerIds.caption)?.name).toBe('Owner: launch team')
    const decisionBounds = document.graph.getAbsoluteBounds(ownerIds.decision)
    const followupBounds = document.graph.getAbsoluteBounds(ownerIds.followup)
    expect(followupBounds.y).toBeGreaterThanOrEqual(decisionBounds.y + decisionBounds.height)
    const page = document.graph.getNode(f.page.id)
    expect(
      page?.pluginData.filter((entry) =>
        entry.key.startsWith('authority-board-plan-request:request:mixed-plan')
      )
    ).toHaveLength(1)
    commit.mockRestore()
  })

  test('commits registered Smylr pages as trusted web app frames in one authority revision', async () => {
    const f = await fixture()
    const views = [
      ['home', 'Smylr Home', '/home', 'home', 'phone', 390, 844],
      ['calendar', 'Smylr Calendar', '/calendar', 'calendar', 'phone', 390, 844],
      ['chart', 'Smylr Dental Chart', '/dental-chart', 'dental-chart', 'phone', 390, 844],
      ['analytics', 'Smylr Analytics', '/practice-analytics', 'analytics', 'phone', 390, 844]
    ] as const
    const plan = {
      artifacts: views.map(([alias, name, route, , viewportPreset]) => ({
        alias,
        recipe: {
          app_id: 'smylr' as const,
          kind: 'trusted_web_app' as const,
          name,
          operation: 'create' as const,
          route,
          viewport_preset: viewportPreset
        }
      })),
      composition: {
        geography: 'recompose' as const,
        members: views.map(([alias]) => ({ alias })),
        preferences: {
          density: 'compact' as const,
          direction: 'horizontal' as const,
          reading_order: views.map(([alias]) => ({ alias }))
        }
      },
      contract: BOARD_BUILD_PLAN_CONTRACT
    }
    const commit = spyOn(f.store, 'commit')
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(await boardContext(f), plan, 'request:four-smylr-trusted-pages')
      )
    )

    expect(commit).toHaveBeenCalledTimes(1)
    expect(applied).toMatchObject({
      final_revision: 2,
      persistence: { authority_revision: 2, status: 'durable' },
      proof: { durable_readback: 'passed' },
      status: { command: 'completed', mutation: 'applied' }
    })
    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed trusted web app Board plan')
    const document = readAuthorityBoardDocument(head.document)
    const frames = views.map(([alias, name, route, pageId, viewportPreset, width, height]) => {
      const frame = document.graph.getNode(ownerIds[alias])
      expect(frame).toMatchObject({ height, name, type: 'FRAME', width })
      expect(parseCodeObjectDocument(frame)).toMatchObject({
        component: 'smylr-production-app',
        definitionId: `smylr.production.${route.slice(1).replaceAll('/', '.')}`,
        label: name,
        launch: { launcherId: 'smylr', startScript: 'npm run dev' },
        props: { route },
        route,
        state: { view: 'live' },
        viewport: { preset: viewportPreset }
      })
      if (!frame) throw new Error(`Expected trusted web app frame for ${alias}`)
      expect(frame.pluginData).toEqual(
        expect.arrayContaining([
          { key: 'kind', pluginId: 'smylr-production', value: 'smylr-code-object-frame' },
          { key: 'pageId', pluginId: 'smylr-production', value: pageId },
          { key: 'route', pluginId: 'smylr-production', value: route },
          { key: 'state', pluginId: 'smylr-production', value: 'current' }
        ])
      )
      return frame
    })
    expect(frames.map(({ x }) => x)).toEqual(frames.map(({ x }) => x).sort((a, b) => a - b))
    expect(new Set(frames.map(({ y }) => y)).size).toBe(1)
    responseResult(
      await f.runtime.sendRpc(
        planRequest(
          await boardContext(f),
          {
            artifacts: [],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            operations: [
              {
                kind: 'object.resize',
                object_id: ownerIds.home,
                viewport_preset: 'desktop'
              }
            ]
          },
          'request:resize-smylr-view'
        )
      )
    )
    const resizedHead = await f.store.head()
    if (!resizedHead) throw new Error('Expected committed Smylr viewport resize')
    const resizedDocument = readAuthorityBoardDocument(resizedHead.document)
    expect(resizedDocument.graph.getNode(ownerIds.home)).toMatchObject({
      height: 1069,
      width: 1728
    })
    expect(parseCodeObjectDocument(resizedDocument.graph.getNode(ownerIds.home))).toMatchObject({
      viewport: { preset: 'desktop' }
    })
    expect(commit).toHaveBeenCalledTimes(2)
    commit.mockRestore()
  })

  test('reverts and reapplies an exact persisted Board transaction by request id', async () => {
    const f = await fixture()
    const seeded = responseResult(
      await f.runtime.sendRpc(planRequest(await boardContext(f), mixedPlan()))
    )
    const decisionId = (seeded.owner_ids as Record<string, string>).decision
    if (!decisionId) throw new Error('Expected seeded decision card')
    const seededHead = await f.store.head()
    if (!seededHead) throw new Error('Expected seeded Board head')
    const originalBounds = readAuthorityBoardDocument(seededHead.document).graph.getAbsoluteBounds(
      decisionId
    )

    const moveRequestId = 'request:move-for-transaction-revert'
    await f.runtime.sendRpc(
      planRequest(
        await boardContext(f),
        {
          artifacts: [],
          contract: BOARD_BUILD_PLAN_CONTRACT,
          operations: [{ kind: 'object.move', object_id: decisionId, x: 720, y: 480 }]
        },
        moveRequestId
      )
    )

    const revertRequestId = 'request:restore-moved-transaction'
    const revertRequest = planRequest(
      await boardContext(f),
      {
        artifacts: [],
        contract: BOARD_BUILD_PLAN_CONTRACT,
        operations: [{ kind: 'transaction.revert', transaction_id: moveRequestId }]
      },
      revertRequestId
    )
    const restored = responseResult(await f.runtime.sendRpc(revertRequest))
    expect(restored).toMatchObject({
      proof: { durable_readback: 'passed' },
      readback: {
        plan: {
          current: true,
          operations: [
            {
              change_count: 1,
              effect: 'would_change',
              operation: 'transaction.revert',
              status: 'current',
              transaction_id: moveRequestId
            }
          ]
        }
      },
      receipt: { reversible: true, transaction_id: revertRequestId },
      status: { command: 'completed', mutation: 'applied' }
    })
    const restoredHead = await f.store.head()
    if (!restoredHead) throw new Error('Expected restored Board head')
    expect(
      readAuthorityBoardDocument(restoredHead.document).graph.getNode(decisionId)
    ).toMatchObject({ x: originalBounds.x, y: originalBounds.y })

    const replay = responseResult(await f.runtime.sendRpc(revertRequest))
    expect(replay.status).toMatchObject({ command: 'completed', mutation: 'replayed' })
    expect((await f.store.head())?.revision).toBe(restoredHead.revision)

    await f.runtime.sendRpc(
      planRequest(
        await boardContext(f),
        {
          artifacts: [],
          contract: BOARD_BUILD_PLAN_CONTRACT,
          operations: [{ kind: 'transaction.revert', transaction_id: revertRequestId }]
        },
        'request:reapply-moved-transaction'
      )
    )
    const redoneHead = await f.store.head()
    if (!redoneHead) throw new Error('Expected reapplied Board head')
    expect(readAuthorityBoardDocument(redoneHead.document).graph.getNode(decisionId)).toMatchObject(
      {
        x: 720,
        y: 480
      }
    )
    const recentTransactions = (
      (await boardContext(f)).request_ledger as {
        recent_transactions: Array<{ request_id: string }>
      }
    ).recent_transactions
    expect(recentTransactions.slice(0, 3)).toMatchObject([
      { request_id: 'request:reapply-moved-transaction' },
      { request_id: revertRequestId },
      { request_id: moveRequestId }
    ])
  })

  test('reverts a live transaction from its durable authority receipt after restart', async () => {
    const f = await fixture()
    const seeded = responseResult(
      await f.runtime.sendRpc(planRequest(await boardContext(f), mixedPlan()))
    )
    const decisionId = (seeded.owner_ids as Record<string, string>).decision
    if (!decisionId) throw new Error('Expected seeded decision card')
    const beforeLiveMutation = await f.store.head()
    if (!beforeLiveMutation) throw new Error('Expected Board head before live mutation')
    const liveDocument = readAuthorityBoardDocument(beforeLiveMutation.document)
    const original = liveDocument.graph.getNode(decisionId)
    if (!original) throw new Error('Expected seeded decision node')
    const originalX = original.x
    liveDocument.graph.updateNode(decisionId, { x: originalX + 320 })
    const liveRequestId = 'request:live-move-persisted-across-restart'
    await f.store.commit({
      document: writeAuthorityBoardDocument(liveDocument),
      expectedContentHash: beforeLiveMutation.contentHash,
      expectedRevision: beforeLiveMutation.revision,
      requestId: 'workspace-save-live-move',
      transaction: {
        pageId: f.page.id,
        requestId: liveRequestId,
        route: 'board_build:plan/v1'
      },
      workspaceId: beforeLiveMutation.identity.workspaceId
    })

    const restartedStore = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-board-plan',
      root: f.root
    })
    const restarted = {
      ...f,
      runtime: new LocalWorkspaceBoardRuntime(restartedStore),
      store: restartedStore
    }
    expect(await restartedStore.transactionReceipts(liveRequestId)).toHaveLength(1)
    const restored = responseResult(
      await restarted.runtime.sendRpc(
        planRequest(
          await boardContext(restarted),
          {
            artifacts: [],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            operations: [{ kind: 'transaction.revert', transaction_id: liveRequestId }]
          },
          'request:restore-live-move-after-restart'
        )
      )
    )

    expect(restored).toMatchObject({
      proof: { durable_readback: 'passed' },
      status: { command: 'completed', mutation: 'applied' }
    })
    const restoredHead = await restartedStore.head()
    if (!restoredHead) throw new Error('Expected restored Board head')
    expect(
      readAuthorityBoardDocument(restoredHead.document).graph.getNode(decisionId)
    ).toMatchObject({ x: originalX })
  })

  test('restores an exact deleted native subtree from transaction history', async () => {
    const f = await fixture()
    const seeded = responseResult(
      await f.runtime.sendRpc(planRequest(await boardContext(f), mixedPlan()))
    )
    const decisionId = (seeded.owner_ids as Record<string, string>).decision
    if (!decisionId) throw new Error('Expected seeded decision card')
    const seededHead = await f.store.head()
    if (!seededHead) throw new Error('Expected seeded Board head')
    const seededDocument = readAuthorityBoardDocument(seededHead.document)
    const originalNodes = [
      seededDocument.graph.getNode(decisionId),
      ...seededDocument.graph.getDescendants(decisionId)
    ].filter((node): node is SceneNode => node !== undefined)
    const originalPageChildren = [...(seededDocument.graph.getNode(f.page.id)?.childIds ?? [])]
    const deleteRequestId = 'request:delete-native-subtree'

    await f.runtime.sendRpc(
      planRequest(
        await boardContext(f),
        {
          artifacts: [],
          contract: BOARD_BUILD_PLAN_CONTRACT,
          operations: [{ kind: 'object.delete', object_id: decisionId }]
        },
        deleteRequestId
      )
    )
    const deletedHead = await f.store.head()
    if (!deletedHead) throw new Error('Expected deleted Board head')
    const deletedDocument = readAuthorityBoardDocument(deletedHead.document)
    expect(deletedDocument.graph.getNode(decisionId)).toBeUndefined()

    await f.runtime.sendRpc(
      planRequest(
        await boardContext(f),
        {
          artifacts: [],
          contract: BOARD_BUILD_PLAN_CONTRACT,
          operations: [{ kind: 'transaction.revert', transaction_id: deleteRequestId }]
        },
        'request:restore-native-subtree'
      )
    )
    const restoredHead = await f.store.head()
    if (!restoredHead) throw new Error('Expected restored Board head')
    const restoredDocument = readAuthorityBoardDocument(restoredHead.document)
    expect(restoredDocument.graph.getNode(f.page.id)?.childIds).toEqual(originalPageChildren)
    for (const original of originalNodes) {
      expect(restoredDocument.graph.getNode(original.id)).toEqual(original)
    }
  })

  test('replays the same request without a commit and rejects a changed digest', async () => {
    const f = await fixture()
    const firstContext = await boardContext(f)
    const commit = spyOn(f.store, 'commit')
    const applied = responseResult(await f.runtime.sendRpc(planRequest(firstContext, mixedPlan())))
    const freshContext = await boardContext(f)

    const replayed = responseResult(await f.runtime.sendRpc(planRequest(freshContext, mixedPlan())))
    expect(replayed).toMatchObject({
      owner_ids: applied.owner_ids,
      persistence: { authority_revision: 2 },
      receipt: {
        idempotent_replay: true
      },
      status: { mutation: 'replayed' }
    })
    expect(commit).toHaveBeenCalledTimes(1)

    const changed = mixedPlan()
    changed.artifacts[0].recipe.body = 'Changed after the request was already used.'
    await expect(f.runtime.sendRpc(planRequest(freshContext, changed))).rejects.toThrow(
      'already used for a different mutation'
    )
    expect(commit).toHaveBeenCalledTimes(1)
    expect((await f.store.head())?.revision).toBe(2)
    commit.mockRestore()
  })

  test('stages an aliased Code Object in one commit with exact replay', async () => {
    const f = await fixture()
    const firstContext = await boardContext(f)
    const commit = spyOn(f.store, 'commit')

    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(firstContext, codeObjectPlan(), 'request:code-object-plan')
      )
    )

    expect(commit).toHaveBeenCalledTimes(1)
    expect(applied).toMatchObject({
      final_revision: 2,
      proof: {
        code_object_interaction: 'unavailable',
        code_object_runtime: 'unavailable',
        code_object_static_preflight: 'passed',
        code_objects: 'staged',
        durable_readback: 'passed'
      },
      readback: {
        plan: {
          artifact_kinds: { app: 'code_object', brief: 'native_card' },
          code_objects: {
            app: {
              component: { definition_id: 'risk-triage-control-v1' },
              reconciliation: { status: 'current' }
            }
          },
          current: true
        }
      },
      receipt: { appliedRevision: 2, idempotent_replay: false },
      status: { command: 'completed', mutation: 'applied' }
    })
    const ownerIds = applied.owner_ids as Record<string, string>
    expect(Object.keys(ownerIds).sort()).toEqual(['app', 'brief'])
    const replayed = responseResult(
      await f.runtime.sendRpc(
        planRequest(await boardContext(f), codeObjectPlan(), 'request:code-object-plan')
      )
    )
    expect(replayed).toMatchObject({
      owner_ids: ownerIds,
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    expect(commit).toHaveBeenCalledTimes(1)
    commit.mockRestore()
  })

  test('builds one Mermaid SVG frame and reads persisted source without a live runtime', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const commit = spyOn(f.store, 'commit')

    const applied = responseResult(
      await f.runtime.sendRpc(planRequest(context, mermaidPlan(), 'request:mermaid-plan'))
    )

    expect(commit).toHaveBeenCalledTimes(1)
    expect(applied).toMatchObject({
      final_revision: 2,
      readback: {
        plan: {
          artifact_kinds: { flow: 'native_diagram' },
          current: true
        }
      },
      receipt: { appliedRevision: 2, idempotent_replay: false },
      status: { command: 'completed', mutation: 'applied' }
    })
    const ownerId = (applied.owner_ids as Record<string, string>).flow
    expect(ownerId).toBeString()
    const source = await savedMermaidSource(f, ownerId)
    expect(source).toMatchObject({
      owner_id: ownerId,
      reconciliation: { status: 'current' },
      source: 'flowchart LR\n  Observe --> Decide --> Improve'
    })
    expect(source).toMatchObject({ editable_layers: 0, parser: 'mermaid@11.16.0/svg' })
    commit.mockRestore()
  })

  test('rewrites one exact Mermaid owner through a direct board build recipe', async () => {
    const f = await fixture()
    const created = responseResult(
      await f.runtime.sendRpc(
        planRequest(await boardContext(f), mermaidPlan(), 'request:mermaid-create')
      )
    )
    const ownerId = (created.owner_ids as Record<string, string>).flow
    const beforeHead = await f.store.head()
    if (!beforeHead) throw new Error('Expected Mermaid authority head before rewrite')
    const beforeDocument = readAuthorityBoardDocument(beforeHead.document)
    const beforeBounds = beforeDocument.graph.getAbsoluteBounds(ownerId)
    const context = await boardContext(f)

    const rewritten = responseResult(
      await f.runtime.sendRpc({
        command: 'board_build',
        args: {
          ...(context.board_build_base as RpcResult),
          intent: 'Rearrange the existing Mermaid workflow',
          recipe: {
            kind: 'native_diagram',
            owner_id: ownerId,
            source: 'flowchart TD\n  Observe --> Decide --> Improve',
            source_format: 'mermaid'
          },
          request_id: 'request:mermaid-rewrite'
        }
      })
    )

    expect(rewritten).toMatchObject({
      final_revision: 3,
      owner_ids: { diagram: ownerId },
      readback: { plan: { current: true } },
      status: { command: 'completed', mutation: 'applied' }
    })
    const afterHead = await f.store.head()
    if (!afterHead) throw new Error('Expected Mermaid authority head after rewrite')
    const afterDocument = readAuthorityBoardDocument(afterHead.document)
    const afterBounds = afterDocument.graph.getAbsoluteBounds(ownerId)
    expect({ x: afterBounds.x, y: afterBounds.y }).toEqual({
      x: beforeBounds.x,
      y: beforeBounds.y
    })
    const source = await savedMermaidSource(f, ownerId)
    expect(source).toMatchObject({
      owner_id: ownerId,
      reconciliation: { status: 'current' },
      source: 'flowchart TD\n  Observe --> Decide --> Improve'
    })
  })

  test('fails invalid Mermaid compilation before any authority mutation', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const before = await f.store.head()
    const commit = spyOn(f.store, 'commit')
    const invalid = mermaidPlan()
    invalid.artifacts[0].recipe.source = 'flowchart LR\n  Observe --'

    await expect(
      f.runtime.sendRpc(planRequest(context, invalid, 'request:invalid-mermaid-plan'))
    ).rejects.toThrow(/Mermaid source validation failed:[\s\S]*No mutation was applied\./u)

    expect(commit).not.toHaveBeenCalled()
    const after = await f.store.head()
    expect(after?.revision).toBe(before?.revision)
    expect(after?.contentHash).toBe(before?.contentHash)
    commit.mockRestore()
  })

  test('accepts normal Mermaid subgraphs without native-node restrictions', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const commit = spyOn(f.store, 'commit')
    const supported = mermaidPlan()
    supported.artifacts[0].recipe.source =
      'flowchart TD\n  subgraph Intake\n    Observe --> Decide\n  end'

    const applied = responseResult(
      await f.runtime.sendRpc(planRequest(context, supported, 'request:supported-mermaid-subgraph'))
    )

    expect(applied).toMatchObject({ status: { command: 'completed', mutation: 'applied' } })
    expect(commit).toHaveBeenCalledTimes(1)
    commit.mockRestore()
  })

  test('preflights every Code Object source before compiling any artifact', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const before = await f.store.head()
    const commit = spyOn(f.store, 'commit')
    const invalid = codeObjectPlan()
    invalid.artifacts[1].recipe.source =
      'import danger from "untrusted-package"; export default function App(){return <main />}'

    await expect(
      f.runtime.sendRpc(planRequest(context, invalid, 'request:invalid-code-object-plan'))
    ).rejects.toThrow()

    expect(commit).not.toHaveBeenCalled()
    const after = await f.store.head()
    expect(after?.revision).toBe(before?.revision)
    expect(after?.contentHash).toBe(before?.contentHash)
    commit.mockRestore()
  })

  test('reports historical-only replay after an artifact semantically diverges', async () => {
    const f = await fixture()
    const applied = responseResult(
      await f.runtime.sendRpc(planRequest(await boardContext(f), mixedPlan()))
    )
    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected applied Board plan authority head')
    const document = readAuthorityBoardDocument(head.document)
    const caption = document.graph.getNode(ownerIds.caption ?? '')
    if (!caption || caption.type !== 'TEXT') throw new Error('Expected planned caption text')
    caption.text = 'Edited after the plan was applied.'
    await f.store.commit({
      document: savedDocument(document.graph),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId: 'request:edit-planned-caption',
      workspaceId: head.identity.workspaceId
    })

    const replayed = responseResult(
      await f.runtime.sendRpc(planRequest(await boardContext(f), mixedPlan()))
    )
    expect(replayed).toMatchObject({
      proof: { durable_readback: 'historical_only' },
      status: { attention_required: true, command: 'unavailable', mutation: 'replayed' }
    })
  })

  test('fails closed for ambiguous or reserved plan requests', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const before = await f.store.head()
    if (!before) throw new Error('Expected Board plan authority head before refusal')
    const beforeDocument = readAuthorityBoardDocument(before.document)
    const beforeNodeIds = [...beforeDocument.graph.nodes.keys()].sort()
    const commit = spyOn(f.store, 'commit')
    await expect(
      f.runtime.sendRpc({
        ...planRequest(context, mixedPlan(), 'request:ambiguous-plan'),
        args: {
          ...planRequest(context, mixedPlan(), 'request:ambiguous-plan').args,
          recipe: { body: 'Ignored', kind: 'native_card', title: 'Must reject' }
        }
      })
    ).rejects.toThrow('unsupported fields: recipe')
    await expect(
      f.runtime.sendRpc(
        planRequest(context, mixedPlan(), '__openpencil_board_plan__:reserved-public-request')
      )
    ).rejects.toThrow('reserved internal Board plan prefix')
    expect(commit).not.toHaveBeenCalled()
    const after = await f.store.head()
    if (!after) throw new Error('Expected Board plan authority head after refusal')
    const afterDocument = readAuthorityBoardDocument(after.document)
    expect(after.revision).toBe(before.revision)
    expect(after.contentHash).toBe(before.contentHash)
    expect([...afterDocument.graph.nodes.keys()].sort()).toEqual(beforeNodeIds)
    expect(
      afterDocument.graph
        .getNode(f.page.id)
        ?.pluginData.some((entry) => entry.key.includes('request:ambiguous-plan'))
    ).toBe(false)
    commit.mockRestore()
  })

  test('keeps variable-height research cards on two aligned grid rows in one revision', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const heights = [216, 236, 236, 216, 216, 216, 216, 236]
    const members = heights.map((_, index) => `card_${index + 1}`)
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'title',
                recipe: {
                  kind: 'native_text',
                  placement: { target: { kind: 'auto' } },
                  text: 'Two-Week Field Research Plan'
                }
              },
              ...heights.map((height, index) => ({
                alias: members[index],
                recipe: {
                  body: `Participant, owner, and expected learning for research day ${index + 1}.`,
                  height,
                  kind: 'native_card',
                  title: `Day ${index + 1} — Research activity`
                }
              }))
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            layout: {
              anchor: { alias: 'title' },
              column_gap: 48,
              columns: 4,
              kind: 'grid',
              members,
              placement: { clearance: 72, preferred_directions: ['below'] },
              row_gap: 48
            }
          },
          'request:variable-height-grid'
        )
      )
    )

    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed variable-height grid')
    const graph = readAuthorityBoardDocument(head.document).graph
    const bounds = members.map((member) => graph.getAbsoluteBounds(ownerIds[member]))
    const firstRow = bounds.slice(0, 4)
    const secondRow = bounds.slice(4)
    expect(new Set(firstRow.map(({ y }) => y)).size).toBe(1)
    expect(new Set(secondRow.map(({ y }) => y)).size).toBe(1)
    expect(secondRow[0]?.y).toBe((firstRow[0]?.y ?? 0) + 236 + 48)
    expect(secondRow.map(({ x }) => x)).toEqual(firstRow.map(({ x }) => x))
    expect(applied).toMatchObject({
      final_revision: 2,
      proof: { durable_readback: 'passed' },
      receipt: { appliedRevision: 2, baseRevision: 1, status: 'applied' },
      status: { mutation: 'applied' }
    })
  })

  test('commits measured schema ranks in one revision', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'title',
                recipe: {
                  kind: 'native_text',
                  placement: { target: { kind: 'auto' } },
                  text: 'Workspace schema'
                }
              },
              ...['users', 'workspaces', 'memberships', 'projects'].map((alias, index) => ({
                alias,
                recipe: {
                  body: `PK  id · uuid\nFK  parent_${index} · uuid`,
                  height: index % 2 === 0 ? 220 : 250,
                  kind: 'native_card',
                  title: alias,
                  width: 360
                }
              }))
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            layout: {
              anchor: { alias: 'title' },
              direction: 'right',
              kind: 'flow',
              node_gap: 72,
              rank_gap: 180,
              ranks: [['users'], ['workspaces', 'memberships'], ['projects']]
            }
          },
          'request:schema-flow'
        )
      )
    )

    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed schema flow')
    const graph = readAuthorityBoardDocument(head.document).graph
    const users = graph.getAbsoluteBounds(ownerIds.users)
    const workspaces = graph.getAbsoluteBounds(ownerIds.workspaces)
    const memberships = graph.getAbsoluteBounds(ownerIds.memberships)
    const projects = graph.getAbsoluteBounds(ownerIds.projects)
    expect(workspaces.x).toBeGreaterThanOrEqual(users.x + users.width + 180)
    expect(memberships.x).toBe(workspaces.x)
    expect(memberships.y).toBeGreaterThanOrEqual(workspaces.y + workspaces.height + 72)
    expect(projects.x).toBeGreaterThanOrEqual(workspaces.x + workspaces.width + 180)
    expect(applied).toMatchObject({
      final_revision: 2,
      proof: { durable_readback: 'passed' },
      receipt: {
        appliedRevision: 2,
        baseRevision: 1,
        status: 'applied'
      },
      status: { mutation: 'applied' }
    })
  })

  test('fails a blocked grid as one group without committing partial members', async () => {
    const f = await fixture({ blockedGrid: true })
    const context = await boardContext(f)
    const before = await f.store.head()
    if (!before || !f.gridAnchorId) throw new Error('Expected blocked-grid fixture')
    const commit = spyOn(f.store, 'commit')

    await expect(
      f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: [
              {
                alias: 'one',
                recipe: { body: 'First grid card.', kind: 'native_card', title: 'One' }
              },
              {
                alias: 'two',
                recipe: { body: 'Second grid card.', kind: 'native_card', title: 'Two' }
              }
            ],
            contract: BOARD_BUILD_PLAN_CONTRACT,
            layout: {
              anchor: { object_id: f.gridAnchorId },
              columns: 2,
              kind: 'grid',
              members: ['one', 'two']
            }
          },
          'request:blocked-grid'
        )
      )
    ).rejects.toThrow(/No collision-free placement for Board plan layout.*No mutation was applied/u)

    expect(commit).not.toHaveBeenCalled()
    const after = await f.store.head()
    if (!after) throw new Error('Expected authority head after blocked grid')
    expect(after.revision).toBe(before.revision)
    expect(after.contentHash).toBe(before.contentHash)
    commit.mockRestore()
  })

  test('places a grouped grid inside a bounded region anchor', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const region = { height: 480, kind: 'region' as const, width: 960, x: 5_000, y: 5_000 }
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: ['one', 'two'].map((alias) => ({
              alias,
              recipe: {
                body: alias,
                height: 120,
                kind: 'native_card',
                title: alias,
                width: 240
              }
            })),
            contract: BOARD_BUILD_PLAN_CONTRACT,
            layout: {
              anchor: region,
              column_gap: 32,
              columns: 2,
              kind: 'grid',
              members: ['one', 'two']
            }
          },
          'request:region-grid'
        )
      )
    )

    const head = await f.store.head()
    if (!head) throw new Error('Expected committed region grid')
    const graph = readAuthorityBoardDocument(head.document).graph
    const ownerIds = applied.owner_ids as Record<string, string>
    const bounds = Object.values(ownerIds).map((id) => graph.getAbsoluteBounds(id))
    expect(
      bounds.every(
        (item) =>
          item.x >= region.x &&
          item.y >= region.y &&
          item.x + item.width <= region.x + region.width &&
          item.y + item.height <= region.y + region.height
      )
    ).toBe(true)
  })

  test('places a grouped grid beside a point-sized region anchor', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const region = { height: 6, kind: 'region' as const, width: 6, x: 5_000, y: 5_000 }
    const applied = responseResult(
      await f.runtime.sendRpc(
        planRequest(
          context,
          {
            artifacts: ['one', 'two'].map((alias) => ({
              alias,
              recipe: {
                body: alias,
                height: 120,
                kind: 'native_card',
                title: alias,
                width: 240
              }
            })),
            contract: BOARD_BUILD_PLAN_CONTRACT,
            layout: {
              anchor: region,
              column_gap: 32,
              columns: 2,
              kind: 'grid',
              members: ['one', 'two']
            }
          },
          'request:point-region-grid'
        )
      )
    )

    const ownerIds = applied.owner_ids as Record<string, string>
    const head = await f.store.head()
    if (!head) throw new Error('Expected committed point-region grid')
    const graph = readAuthorityBoardDocument(head.document).graph
    const first = graph.getAbsoluteBounds(ownerIds.one)
    expect(first.x).toBe(region.x + region.width + 48)
    expect(first.y).toBe(region.y)
  })

  test('identifies the exact plan artifact and conflict when point placement is blocked', async () => {
    const f = await fixture()
    const context = await boardContext(f)
    const before = await f.store.head()
    if (!before) throw new Error('Expected Board plan authority head before placement refusal')
    const commit = spyOn(f.store, 'commit')
    const blockedPlan = {
      artifacts: [
        {
          alias: 'first',
          recipe: {
            body: 'First card.',
            height: 160,
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 400, y: 300 } },
            title: 'First'
          }
        },
        {
          alias: 'blocked',
          recipe: {
            body: 'This exact point is only 35 units below the first card.',
            height: 160,
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 400, y: 495 } },
            title: 'Blocked'
          }
        }
      ],
      contract: BOARD_BUILD_PLAN_CONTRACT
    }

    await expect(
      f.runtime.sendRpc(planRequest(context, blockedPlan, 'request:blocked-point-plan'))
    ).rejects.toThrow(
      /No collision-free placement for Board plan artifact "blocked" at index 1: target=\{"kind":"point","x":400,"y":495\}; footprint=320x160; clearance=48; conflict=\{"alias":"first","bounds":.*"name":"First","object_id":".*"\}\. No mutation was applied\./u
    )

    expect(commit).not.toHaveBeenCalled()
    const after = await f.store.head()
    if (!after) throw new Error('Expected Board plan authority head after placement refusal')
    expect(after.revision).toBe(before.revision)
    expect(after.contentHash).toBe(before.contentHash)
    commit.mockRestore()
  })
})
