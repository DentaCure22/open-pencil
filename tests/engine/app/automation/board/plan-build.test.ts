import { afterEach, describe, expect, test } from 'bun:test'

import { createMermaidSvgSpec, type MermaidDiagram } from '@open-pencil/core/diagram'
import type { BoardBuildPlan } from '@open-pencil/core/rpc'
import { canonicalMemoryObjectId, canonicalMemorySourceNodeId } from '@open-pencil/core/tools'
import {
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  readObjectGraphPorts
} from '@open-pencil/scene-graph'

import { createAutomationBoardBuildHandler } from '@/app/automation/bridge/board-build'
import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import { resetAutomationMutationQueuesForTests } from '@/app/automation/bridge/mutation-queue'
import {
  mutationRequestLedgerState,
  mutationRequestReceipts
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { codeObjectDocument } from '@/app/code-object/model'
import { createEditorStore } from '@/app/editor/session'
import { connectObjects } from '@/app/object-graph'

const RUNTIME_ID = 'runtime:plan-build'

function target(): AutomationTarget {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  return {
    contentDocumentId: 'content:plan-build',
    documentId: 'document:plan-build',
    documentName: 'Plan build fixture',
    pageId,
    pageName: store.graph.getNode(pageId)?.name ?? 'Page 1',
    runtimeInstanceId: RUNTIME_ID,
    store,
    workspaceId: 'workspace:plan-build'
  }
}

function plan(title = 'Observe'): BoardBuildPlan {
  return {
    artifacts: [
      {
        alias: 'observe',
        recipe: {
          body: 'Collect the signal.',
          kind: 'native_card',
          placement: { target: { kind: 'point', x: 300, y: 240 } },
          title
        }
      },
      {
        alias: 'decide',
        anchor: { alias: 'observe' },
        recipe: {
          body: 'Choose the next move.',
          kind: 'native_card',
          placement: { clearance: 48, preferred_directions: ['right'] },
          title: 'Decide'
        }
      },
      {
        alias: 'caption',
        anchor: { alias: 'decide' },
        recipe: {
          kind: 'native_text',
          placement: { clearance: 32, preferred_directions: ['below'] },
          text: 'Make the result visible.'
        }
      }
    ],
    connections: [
      {
        kind: 'visual',
        label: 'informs',
        source: { alias: 'observe' },
        target: { alias: 'decide' }
      }
    ],
    contract: 'board-build-plan/v1'
  }
}

function autoPlan(title: string): BoardBuildPlan {
  return {
    artifacts: [
      {
        alias: 'card',
        recipe: {
          body: `${title} can share this Board without overwriting another agent.`,
          kind: 'native_card',
          placement: { target: { kind: 'auto' } },
          title
        }
      }
    ],
    connections: [],
    contract: 'board-build-plan/v1'
  }
}

function mixedCodePlan(source = CODE_OBJECT_SOURCE): BoardBuildPlan {
  return {
    artifacts: [
      {
        alias: 'brief',
        recipe: {
          body: 'Adjust the confidence, then act on the result.',
          kind: 'native_card',
          placement: { target: { kind: 'point', x: 280, y: 240 } },
          title: 'Decision brief'
        }
      },
      {
        alias: 'confidence',
        anchor: { alias: 'brief' },
        recipe: {
          initial_state: { confidence: 2 },
          kind: 'code_object',
          name: 'Confidence control',
          object_key: 'eval-confidence-control',
          operation: 'create',
          placement: { clearance: 64, preferred_directions: ['right'] },
          ports: [
            {
              direction: 'input',
              id: 'brief',
              kinds: ['visual'],
              label: 'Decision brief',
              offset: 0.5,
              side: 'left'
            }
          ],
          props: { label: 'Confidence' },
          source,
          source_format: 'tsx',
          width: 360,
          height: 220
        }
      },
      {
        alias: 'caption',
        anchor: { alias: 'confidence' },
        recipe: {
          kind: 'native_text',
          placement: { clearance: 32, preferred_directions: ['below'] },
          text: 'Make confidence explicit before committing.'
        }
      }
    ],
    connections: [
      {
        kind: 'visual',
        label: 'controls',
        source: { alias: 'brief' },
        target: { alias: 'confidence' },
        target_port: 'brief'
      }
    ],
    contract: 'board-build-plan/v1'
  }
}

const CODE_OBJECT_SOURCE = `export default function Confidence({ state, setState, props }) {
  const value = Number(state.confidence ?? 0)
  return <button onClick={() => setState({ ...state, confidence: value + 1 })}>{String(props.label)}: {value}</button>
}`

function planDiagram(source: string): MermaidDiagram {
  return createMermaidSvgSpec(source)
}

function harness(
  automationTarget: AutomationTarget,
  parseMermaid: (source: string) => Promise<MermaidDiagram> = (source) =>
    Promise.resolve(planDiagram(source))
) {
  const board = createAutomationBoardHandlers(RUNTIME_ID, {
    ensureFonts: () => Promise.resolve()
  })
  const build = createAutomationBoardBuildHandler({
    board,
    canWrite: () => true,
    mermaid: async () => ({ ok: false }),
    mermaidSource: async () => ({ ok: false }),
    parseMermaid,
    persist: (_store, requestedSceneRevision) =>
      Promise.resolve({
        duration_ms: 0,
        requested_scene_revision: requestedSceneRevision,
        status: 'durable',
        target: 'browser_local'
      })
  })
  return { board, build, target: automationTarget }
}

async function request(
  fixture: ReturnType<typeof harness>,
  requestId: string,
  buildPlan: BoardBuildPlan
) {
  const context = (await fixture.board.context(fixture.target)) as {
    context_token: string
    revisions: { board: number }
  }
  return fixture.build(fixture.target, {
    context_token: context.context_token,
    contract: 'board-build/v1',
    expected_revision: context.revisions.board,
    intent: 'Create an editable decision flow',
    plan: buildPlan,
    request_id: requestId
  })
}

afterEach(() => {
  resetAutomationMutationQueuesForTests()
  Reflect.deleteProperty(globalThis, 'window')
})

function installWindowFixture() {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { innerHeight: 800, innerWidth: 1200 }
  })
}

describe('live board_build plan', () => {
  test('materializes the exact canonical object on another Board in one Undo batch', async () => {
    installWindowFixture()
    const fixture = harness(target())
    const source = fixture.target.store.graph.createNode('FRAME', fixture.target.pageId, {
      height: 120,
      name: 'Pricing comparison',
      width: 180,
      x: 40,
      y: 40
    })
    const sourceText = fixture.target.store.graph.createNode('TEXT', source.id, {
      name: 'Monthly price',
      text: '$20 per month'
    })
    const destination = fixture.target.store.graph.addPage('Decision Board')
    await fixture.target.store.switchPage(destination.id)
    fixture.target.pageId = destination.id
    fixture.target.pageName = destination.name
    const result = (await request(fixture, 'request:canonical-plan', {
      artifacts: [
        {
          alias: 'pricing',
          recipe: {
            kind: 'canonical_object',
            operation: 'place',
            placement: { target: { kind: 'point', x: 500, y: 300 } },
            source_object_id: source.id
          }
        }
      ],
      connections: [],
      contract: 'board-build-plan/v1'
    })) as {
      aliases: Record<string, string>
    }
    const createdId = result.aliases.pricing
    const createdNode = fixture.target.store.graph.getNode(createdId)
    const createdText = createdNode
      ? fixture.target.store.graph.getNode(createdNode.childIds[0] ?? '')
      : undefined
    if (!createdNode || !createdText) throw new Error('Expected materialized plan placement')

    expect(createdNode).toMatchObject({ height: 120, name: source.name, width: 180 })
    expect(createdText).toMatchObject({ name: sourceText.name, text: sourceText.text })
    expect(canonicalMemoryObjectId(createdNode)).toBe(source.id)
    expect(canonicalMemorySourceNodeId(createdNode)).toBe(source.id)
    expect(canonicalMemoryObjectId(createdText)).toBe(sourceText.id)
    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(fixture.target.store.graph.getNode(createdId)).toBeUndefined()
    expect(fixture.target.store.graph.getNode(source.id)).toBeDefined()
  })

  test('applies existing-object operations as one normal Undo batch', async () => {
    const fixture = harness(target())
    const objectId = fixture.target.store.createShape(
      'FRAME',
      100,
      120,
      240,
      160,
      fixture.target.pageId
    )
    const result = (await request(fixture, 'request:live-atomic-edit-plan', {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [
        { kind: 'object.move', object_id: objectId, x: 640, y: 420 },
        { height: 300, kind: 'object.resize', object_id: objectId, width: 520 },
        { kind: 'object.update', object_id: objectId, patch: { name: 'Final frame' } }
      ]
    })) as {
      operations: Array<{ kind: string; object_id: string }>
      receipt: { history_label: string }
      status: { command: string; mutation: string }
    }

    expect(result.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(result.operations).toHaveLength(3)
    expect(fixture.target.store.graph.getNode(objectId)).toMatchObject({
      height: 300,
      name: 'Final frame',
      width: 520,
      x: 640,
      y: 420
    })
    expect(result.receipt.history_label).toBe('Agent: build Board plan')
    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(fixture.target.store.graph.getNode(objectId)).toMatchObject({
      height: 160,
      width: 240,
      x: 100,
      y: 120
    })
  })

  test('recomposes only listed Board objects and restores them in one Undo', async () => {
    const fixture = harness(target())
    const firstId = fixture.target.store.createShape(
      'FRAME',
      80,
      100,
      240,
      160,
      fixture.target.pageId
    )
    const secondId = fixture.target.store.createShape(
      'FRAME',
      420,
      120,
      280,
      180,
      fixture.target.pageId
    )
    const unrelatedId = fixture.target.store.createShape(
      'FRAME',
      2_000,
      1_600,
      320,
      200,
      fixture.target.pageId
    )
    const before = Object.fromEntries(
      [firstId, secondId, unrelatedId].map((id) => [
        id,
        fixture.target.store.graph.getAbsoluteBounds(id)
      ])
    )

    const result = (await request(fixture, 'request:semantic-recompose', {
      artifacts: [],
      composition: {
        geography: 'recompose',
        members: [{ object_id: firstId }, { object_id: secondId }],
        preferences: { direction: 'horizontal' }
      },
      connections: [],
      contract: 'board-build-plan/v1'
    })) as { operations: Array<{ kind: string; object_id: string }> }

    expect(result.operations.map(({ object_id }) => object_id)).toEqual([firstId, secondId])
    expect(fixture.target.store.graph.getAbsoluteBounds(firstId)).not.toEqual(before[firstId])
    expect(fixture.target.store.graph.getAbsoluteBounds(secondId)).not.toEqual(before[secondId])
    expect(fixture.target.store.graph.getAbsoluteBounds(unrelatedId)).toEqual(before[unrelatedId])

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(fixture.target.store.graph.getAbsoluteBounds(firstId)).toEqual(before[firstId])
    expect(fixture.target.store.graph.getAbsoluteBounds(secondId)).toEqual(before[secondId])
    expect(fixture.target.store.graph.getAbsoluteBounds(unrelatedId)).toEqual(before[unrelatedId])
  })

  test('auto-places an anchorless composition of new aliases on an empty Board', async () => {
    const fixture = harness(target())
    const result = (await request(fixture, 'request:anchorless-live-composition', {
      artifacts: [
        {
          alias: 'discover',
          recipe: { body: 'Understand the need.', kind: 'native_card', title: 'Discover' }
        },
        {
          alias: 'deliver',
          recipe: { body: 'Ship the result.', kind: 'native_card', title: 'Deliver' }
        }
      ],
      composition: {
        members: [{ alias: 'discover' }, { alias: 'deliver' }],
        preferences: { direction: 'horizontal' }
      },
      connections: [
        { kind: 'visual', source: { alias: 'discover' }, target: { alias: 'deliver' } }
      ],
      contract: 'board-build-plan/v1'
    })) as { aliases: Record<string, string>; owner_ids: string[] }

    const discover = fixture.target.store.graph.getAbsoluteBounds(result.aliases.discover ?? '')
    const deliver = fixture.target.store.graph.getAbsoluteBounds(result.aliases.deliver ?? '')
    expect(result.owner_ids).toHaveLength(2)
    expect(discover.x + discover.width).toBeLessThanOrEqual(deliver.x)

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(result.owner_ids.every((id) => !fixture.target.store.graph.getNode(id))).toBe(true)
  })

  test('places an anchorless replacement without treating deleted objects as obstacles', async () => {
    const fixture = harness(target())
    const blockerId = fixture.target.store.createShape(
      'FRAME',
      -100_000,
      -100_000,
      200_000,
      200_000,
      fixture.target.pageId
    )

    const result = (await request(fixture, 'request:anchorless-live-replacement', {
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
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [{ kind: 'object.delete', object_id: blockerId }]
    })) as { aliases: Record<string, string> }

    expect(fixture.target.store.graph.getNode(blockerId)).toBeUndefined()
    expect(fixture.target.store.graph.getNode(result.aliases.first ?? '')).toBeDefined()
    expect(fixture.target.store.graph.getNode(result.aliases.second ?? '')).toBeDefined()

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(fixture.target.store.graph.getNode(blockerId)).toBeDefined()
    expect(fixture.target.store.graph.getNode(result.aliases.first ?? '')).toBeUndefined()
    expect(fixture.target.store.graph.getNode(result.aliases.second ?? '')).toBeUndefined()
  })

  test('deletes an exact connection in the existing Undo batch and restores its full record', async () => {
    const fixture = harness(target())
    const sourceNodeId = fixture.target.store.createShape(
      'FRAME',
      100,
      120,
      240,
      160,
      fixture.target.pageId
    )
    const targetNodeId = fixture.target.store.createShape(
      'FRAME',
      500,
      120,
      240,
      160,
      fixture.target.pageId
    )
    const connection = connectObjects(fixture.target.store, {
      automatic: false,
      kind: 'visual',
      label: 'Exact connection',
      sourceNodeId,
      sourcePort: 'right',
      targetNodeId,
      targetPort: 'left'
    })
    if (!connection) throw new Error('Expected exact connection fixture')

    const result = (await request(fixture, 'request:delete-exact-live-connection', {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [{ connection_id: connection.id, kind: 'connection.delete' }]
    })) as {
      operations: Array<{ connection_id: string; effect: string; kind: string }>
    }

    expect(result.operations).toEqual([
      {
        connection_id: connection.id,
        effect: 'would_change',
        kind: 'connection.delete'
      }
    ])
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toBeNull()
    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toEqual(connection)
    expect(fixture.target.store.undo.redo()).toBe('Agent: build Board plan')
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toBeNull()

    const noChange = (await request(fixture, 'request:delete-missing-live-connection', {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [{ connection_id: connection.id, kind: 'connection.delete' }]
    })) as { operations: Array<{ effect: string }> }
    expect(noChange.operations).toEqual([expect.objectContaining({ effect: 'already_satisfied' })])
  })

  test('reverts and reapplies the latest live Board transaction by request id', async () => {
    const fixture = harness(target())
    const sourceNodeId = fixture.target.store.createShape(
      'FRAME',
      100,
      120,
      240,
      160,
      fixture.target.pageId
    )
    const targetNodeId = fixture.target.store.createShape(
      'FRAME',
      500,
      120,
      240,
      160,
      fixture.target.pageId
    )
    const connection = connectObjects(fixture.target.store, {
      automatic: false,
      kind: 'visual',
      label: 'Reversible connection',
      sourceNodeId,
      sourcePort: 'right',
      targetNodeId,
      targetPort: 'left'
    })
    if (!connection) throw new Error('Expected reversible connection fixture')

    const deletionRequestId = 'request:live-transaction-delete'
    await request(fixture, deletionRequestId, {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [{ connection_id: connection.id, kind: 'connection.delete' }]
    })
    const restoreRequestId = 'request:live-transaction-restore'
    const restored = (await request(fixture, restoreRequestId, {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [{ kind: 'transaction.revert', transaction_id: deletionRequestId }]
    })) as {
      operations: Array<{ change_count: number; effect: string; transaction_id: string }>
      receipt: { reversible: boolean; transaction_id: string }
    }

    expect(restored.operations).toEqual([
      {
        change_count: 1,
        effect: 'would_change',
        kind: 'transaction.revert',
        transaction_id: deletionRequestId
      }
    ])
    expect(restored.receipt).toMatchObject({
      reversible: true,
      transaction_id: restoreRequestId
    })
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toEqual(connection)
    const context = (await fixture.board.context(fixture.target)) as {
      request_ledger: {
        recent_transactions: Array<{ request_id: string; route: string }>
      }
    }
    expect(context.request_ledger.recent_transactions.slice(0, 2)).toEqual([
      { request_id: restoreRequestId, route: 'board_build:plan/v1' },
      { request_id: deletionRequestId, route: 'board_build:plan/v1' }
    ])

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toBeNull()
    expect(fixture.target.store.undo.redo()).toBe('Agent: build Board plan')
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toEqual(connection)

    await request(fixture, 'request:live-transaction-redo', {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [{ kind: 'transaction.revert', transaction_id: restoreRequestId }]
    })
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connection.id)
    ).toBeNull()
  })

  test('moves an object relative to another object without a geometry read', async () => {
    const fixture = harness(target())
    const anchorId = fixture.target.store.createShape(
      'FRAME',
      400,
      200,
      300,
      150,
      fixture.target.pageId
    )
    const movingId = fixture.target.store.createShape('FRAME', 0, 0, 100, 80, fixture.target.pageId)

    await request(fixture, 'request:live-relative-move-plan', {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [
        {
          kind: 'object.move',
          object_id: movingId,
          relative_to: { align: 'center', gap: 40, object_id: anchorId, side: 'below' }
        }
      ]
    })

    expect(fixture.target.store.graph.getNode(movingId)).toMatchObject({ x: 500, y: 390 })
  })

  test('builds on an exact background page without stealing the visible page', async () => {
    installWindowFixture()
    const automationTarget = target()
    const visiblePage = automationTarget.store.graph.addPage('Other agent work')
    await automationTarget.store.switchPage(visiblePage.id)
    const fixture = harness(automationTarget)

    const result = (await request(
      fixture,
      'request:background-plan',
      autoPlan('Background build')
    )) as { owner_ids: string[]; status: { command: string; mutation: string } }

    expect(result.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(automationTarget.store.state.currentPageId).toBe(visiblePage.id)
    expect(result.owner_ids).toHaveLength(1)
    expect(automationTarget.store.graph.getNode(result.owner_ids[0])?.parentId).toBe(
      automationTarget.pageId
    )
  })

  test('rebases two self-contained agent plans from the same Board context', async () => {
    const fixture = harness(target())
    const firstContext = (await fixture.board.context(fixture.target)) as {
      board_build_base: Record<string, unknown>
    }
    const secondContext = (await fixture.board.context(fixture.target)) as {
      board_build_base: Record<string, unknown>
    }

    const first = (await fixture.build(fixture.target, {
      ...firstContext.board_build_base,
      intent: 'Create the first independent agent contribution',
      plan: autoPlan('Agent A'),
      request_id: 'request:concurrent-agent-a'
    })) as { owner_ids: string[]; receipt: { expectedRevision: number } }
    const second = (await fixture.build(fixture.target, {
      ...secondContext.board_build_base,
      intent: 'Create the second independent agent contribution',
      plan: autoPlan('Agent B'),
      request_id: 'request:concurrent-agent-b'
    })) as {
      owner_ids: string[]
      receipt: { appliedRevision: number; enqueuedRevision: number; expectedRevision: number }
      status: { command: string; mutation: string }
    }

    expect(second.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(second.receipt.enqueuedRevision).toBeGreaterThan(second.receipt.expectedRevision)
    expect(first.owner_ids.every((id) => fixture.target.store.graph.getNode(id))).toBe(true)
    expect(second.owner_ids.every((id) => fixture.target.store.graph.getNode(id))).toBe(true)

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(second.owner_ids.every((id) => !fixture.target.store.graph.getNode(id))).toBe(true)
    expect(first.owner_ids.every((id) => fixture.target.store.graph.getNode(id))).toBe(true)
  })

  test('keeps exact-point plans strict when their Board context becomes stale', async () => {
    const fixture = harness(target())
    const staleContext = (await fixture.board.context(fixture.target)) as {
      board_build_base: Record<string, unknown>
    }
    await request(fixture, 'request:advance-before-exact-point', autoPlan('Advance Board'))

    await expect(
      fixture.build(fixture.target, {
        ...staleContext.board_build_base,
        intent: 'Keep this exact point strict',
        plan: {
          artifacts: [
            {
              alias: 'strict',
              recipe: {
                body: 'Do not silently rebase an exact coordinate.',
                kind: 'native_card',
                placement: { target: { kind: 'point', x: 320, y: 240 } },
                title: 'Strict point'
              }
            }
          ],
          connections: [],
          contract: 'board-build-plan/v1'
        },
        request_id: 'request:strict-stale-point'
      })
    ).rejects.toThrow('Board revision is stale')
  })

  test('precompiles and places a native Mermaid diagram inside the atomic plan', async () => {
    const fixture = harness(target())
    const result = (await request(fixture, 'request:diagram-plan', {
      artifacts: [
        {
          alias: 'brief',
          recipe: {
            body: 'Use the flow during review.',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 300, y: 240 } },
            title: 'Review brief'
          }
        },
        {
          alias: 'flow',
          anchor: { alias: 'brief' },
          recipe: {
            kind: 'native_diagram',
            placement: { clearance: 72, preferred_directions: ['right'] },
            source: 'flowchart LR\n  A --> B',
            source_format: 'mermaid'
          }
        }
      ],
      connections: [
        { kind: 'visual', label: 'explains', source: { alias: 'brief' }, target: { alias: 'flow' } }
      ],
      contract: 'board-build-plan/v1'
    })) as {
      aliases: Record<string, string>
      connection_ids: string[]
      owner_ids: string[]
      receipt: { history_label: string }
      status: { command: string; mutation: string }
    }

    const brief = fixture.target.store.graph.getAbsoluteBounds(result.aliases.brief)
    const flow = fixture.target.store.graph.getAbsoluteBounds(result.aliases.flow)
    const flowOwner = fixture.target.store.graph.getNode(result.aliases.flow)
    expect(flow.x).toBeCloseTo(brief.x + brief.width + 72)
    expect(flow.y).toBeCloseTo(brief.y)
    expect(result.owner_ids).toEqual([result.aliases.brief, result.aliases.flow])
    expect(result.connection_ids).toHaveLength(1)
    expect(
      flowOwner?.pluginData.some(
        (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/source'
      )
    ).toBe(true)
    expect(result.receipt.history_label).toBe('Agent: build Board plan')
    expect(result.status).toEqual({
      attention_required: false,
      command: 'completed',
      mutation: 'applied'
    })
  })

  test('rewrites an exact native Mermaid owner in place inside the atomic plan', async () => {
    const fixture = harness(target())
    const created = (await request(fixture, 'request:diagram-create', {
      artifacts: [
        {
          alias: 'flow',
          recipe: {
            kind: 'native_diagram',
            placement: { target: { kind: 'point', x: 420, y: 320 } },
            source: 'flowchart LR\n  A --> B',
            source_format: 'mermaid'
          }
        }
      ],
      connections: [],
      contract: 'board-build-plan/v1'
    })) as { aliases: Record<string, string> }
    const ownerId = created.aliases.flow
    const before = fixture.target.store.graph.getAbsoluteBounds(ownerId)

    const rewritten = (await request(fixture, 'request:diagram-rewrite', {
      artifacts: [
        {
          alias: 'flow',
          recipe: {
            kind: 'native_diagram',
            owner_id: ownerId,
            source: 'flowchart TD\n  A --> B',
            source_format: 'mermaid'
          }
        }
      ],
      connections: [],
      contract: 'board-build-plan/v1'
    })) as { aliases: Record<string, string>; status: { mutation: string } }

    expect(rewritten.aliases.flow).toBe(ownerId)
    expect(rewritten.status.mutation).toBe('applied')
    const after = fixture.target.store.graph.getAbsoluteBounds(ownerId)
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y })
    expect(
      fixture.target.store.graph
        .getNode(ownerId)
        ?.pluginData.find(
          (entry) => entry.pluginId === 'open-pencil' && entry.key === 'mermaid/source'
        )?.value
    ).toBe('flowchart TD\n  A --> B')
  })

  test('rejects invalid Mermaid source before any plan artifact is created', async () => {
    const automationTarget = target()
    const fixture = harness(automationTarget, () => Promise.reject(new Error('invalid Mermaid')))
    const before = [...automationTarget.store.graph.getChildren(automationTarget.pageId)].map(
      ({ id }) => id
    )

    await expect(
      request(fixture, 'request:invalid-diagram-plan', {
        artifacts: [
          {
            alias: 'brief',
            recipe: {
              body: 'This must not be partially created.',
              kind: 'native_card',
              placement: { target: { kind: 'point', x: 300, y: 240 } },
              title: 'Atomic brief'
            }
          },
          {
            alias: 'flow',
            anchor: { alias: 'brief' },
            recipe: {
              kind: 'native_diagram',
              source: 'not valid',
              source_format: 'mermaid'
            }
          }
        ],
        connections: [],
        contract: 'board-build-plan/v1'
      })
    ).rejects.toThrow('invalid Mermaid')

    expect(
      [...automationTarget.store.graph.getChildren(automationTarget.pageId)].map(({ id }) => id)
    ).toEqual(before)
    expect(
      mutationRequestLedgerState(automationTarget, 'request:invalid-diagram-plan').status
    ).toBe('missing')
  })

  test('places a first native text artifact without an anchor', async () => {
    const fixture = harness(target())
    const result = (await request(fixture, 'request:free-text-plan', {
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
      connections: [],
      contract: 'board-build-plan/v1'
    })) as { aliases: Record<string, string> }

    const caption = fixture.target.store.graph.getNode(result.aliases.caption)
    expect(caption).toMatchObject({ name: 'Experiment brief', text: 'Experiment brief' })
    const bounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.caption)
    expect(bounds.x + bounds.width / 2).toBeCloseTo(240)
    expect(bounds.y + bounds.height / 2).toBeCloseTo(180)
  })

  test('honors diagonal relative offsets for anchored native artifacts', async () => {
    const fixture = harness(target())
    const buildPlan = plan()
    const decide = buildPlan.artifacts[1]
    const caption = buildPlan.artifacts[2]
    if (decide?.recipe.kind !== 'native_card' || caption?.recipe.kind !== 'native_text') {
      throw new Error('Unexpected plan fixture shape.')
    }
    decide.recipe.placement = {
      ...decide.recipe.placement,
      relative_offset: { column: 1, row: 1 }
    }
    caption.recipe.placement = {
      ...caption.recipe.placement,
      relative_offset: { column: -1, row: 1 }
    }

    const result = (await request(fixture, 'request:diagonal-native-plan', buildPlan)) as {
      aliases: Record<string, string>
    }
    const observeBounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.observe)
    const decideBounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.decide)
    const captionBounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.caption)

    expect(decideBounds.x).toBeCloseTo(observeBounds.x + observeBounds.width + 48)
    expect(decideBounds.y).toBeCloseTo(observeBounds.y + observeBounds.height + 48)
    expect(captionBounds.x + captionBounds.width + 32).toBeCloseTo(decideBounds.x)
    expect(captionBounds.y).toBeCloseTo(decideBounds.y + decideBounds.height + 32)
  })

  test('falls back collision-safely after a blocked diagonal candidate', async () => {
    const fixture = harness(target())
    const anchorId = fixture.target.store.createShape(
      'FRAME',
      0,
      0,
      100,
      100,
      fixture.target.pageId
    )
    fixture.target.store.createShape('FRAME', 148, 148, 400, 100, fixture.target.pageId)

    const result = (await request(fixture, 'request:diagonal-fallback-plan', {
      artifacts: [
        {
          alias: 'caption',
          anchor: { object_id: anchorId },
          recipe: {
            kind: 'native_text',
            placement: {
              clearance: 48,
              preferred_directions: ['right'],
              relative_offset: { column: 1, row: 1 }
            },
            text: 'Fallback remains collision-safe.'
          }
        }
      ],
      connections: [],
      contract: 'board-build-plan/v1'
    })) as { aliases: Record<string, string> }
    const bounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.caption)

    expect(bounds.x).toBeCloseTo(148)
    expect(bounds.y).toBeCloseTo(0)
  })

  test('centers a cardinal convergence after two completed branches', async () => {
    const fixture = harness(target())
    const result = (await request(fixture, 'request:converging-plan', {
      artifacts: [
        {
          alias: 'intake',
          recipe: {
            body: 'Capture the request.',
            kind: 'native_card',
            placement: { target: { kind: 'point', x: 640, y: 600 } },
            title: 'Intake'
          }
        },
        {
          alias: 'upper',
          anchor: { alias: 'intake' },
          recipe: {
            body: 'Review the upper branch.',
            kind: 'native_card',
            placement: {
              clearance: 240,
              preferred_directions: ['right', 'above', 'below', 'left'],
              relative_offset: { column: 1, row: -1 }
            },
            title: 'Upper review'
          }
        },
        {
          alias: 'lower',
          anchor: { alias: 'intake' },
          recipe: {
            body: 'Review the lower branch.',
            kind: 'native_card',
            placement: {
              clearance: 240,
              preferred_directions: ['right', 'below', 'above', 'left'],
              relative_offset: { column: 1, row: 1 }
            },
            title: 'Lower review'
          }
        },
        {
          alias: 'decision',
          recipe: {
            body: 'Converge both reviews.',
            kind: 'native_card',
            placement: {
              clearance: 560,
              preferred_directions: ['right', 'below', 'above', 'left']
            },
            title: 'Decision'
          }
        }
      ],
      connections: [
        { kind: 'visual', source: { alias: 'upper' }, target: { alias: 'decision' } },
        { kind: 'visual', source: { alias: 'lower' }, target: { alias: 'decision' } }
      ],
      contract: 'board-build-plan/v1'
    })) as { aliases: Record<string, string> }
    const upper = fixture.target.store.graph.getAbsoluteBounds(result.aliases.upper)
    const lower = fixture.target.store.graph.getAbsoluteBounds(result.aliases.lower)
    const decision = fixture.target.store.graph.getAbsoluteBounds(result.aliases.decision)

    expect(decision.x).toBeCloseTo(upper.x + upper.width + 560)
    expect(decision.y + decision.height / 2).toBeCloseTo((upper.y + lower.y + lower.height) / 2)
    expect(decision.x).toBeGreaterThan(lower.x + lower.width)
  })

  test('honors a diagonal relative offset for an anchored Code Object', async () => {
    const fixture = harness(target())
    const buildPlan = mixedCodePlan()
    const confidence = buildPlan.artifacts[1]
    if (confidence?.recipe.kind !== 'code_object') {
      throw new Error('Unexpected mixed Code Object fixture shape.')
    }
    confidence.recipe.placement = {
      ...confidence.recipe.placement,
      relative_offset: { column: 1, row: -1 }
    }

    const result = (await request(fixture, 'request:diagonal-code-object-plan', buildPlan)) as {
      aliases: Record<string, string>
    }
    const briefBounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.brief)
    const confidenceBounds = fixture.target.store.graph.getAbsoluteBounds(result.aliases.confidence)

    expect(confidenceBounds.x).toBeCloseTo(briefBounds.x + briefBounds.width + 64)
    expect(confidenceBounds.y + confidenceBounds.height + 64).toBeCloseTo(briefBounds.y)
  })

  test('applies native artifacts, Object Graph records, and its ledger as one Undo unit', async () => {
    const fixture = harness(target())
    const result = (await request(fixture, 'request:plan-undo', plan())) as {
      aliases: Record<string, string>
      connection_ids: string[]
      object_ids: string[]
      owner_ids: string[]
      receipt: { history_label: string; idempotent_replay: boolean }
      status: { command: string; mutation: string }
    }

    expect(result.status).toEqual({
      attention_required: false,
      command: 'completed',
      mutation: 'applied'
    })
    expect(result.receipt).toMatchObject({
      history_label: 'Agent: build Board plan',
      idempotent_replay: false
    })
    expect(result.owner_ids).toEqual([
      result.aliases.observe,
      result.aliases.decide,
      result.aliases.caption
    ])
    expect(result.connection_ids).toHaveLength(1)
    expect(result.object_ids).toHaveLength(7)
    expect(
      objectGraphConnectionById(
        fixture.target.store.graph,
        fixture.target.pageId,
        result.connection_ids[0]
      )
    ).toMatchObject({
      sourceNodeId: result.aliases.observe,
      targetNodeId: result.aliases.decide
    })
    expect(
      mutationRequestReceipts(fixture.target.store.graph.getNode(fixture.target.pageId))
    ).toHaveLength(1)
    expect(fixture.target.store.undo.undoLabel).toBe('Agent: build Board plan')

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(result.owner_ids.map((id) => fixture.target.store.graph.getNode(id))).toEqual([
      undefined,
      undefined,
      undefined
    ])
    expect(
      objectGraphConnectionById(
        fixture.target.store.graph,
        fixture.target.pageId,
        result.connection_ids[0]
      )
    ).toBeNull()
    expect(mutationRequestLedgerState(fixture.target, 'request:plan-undo')).toEqual({
      status: 'missing'
    })

    expect(fixture.target.store.undo.redo()).toBe('Agent: build Board plan')
    expect(result.owner_ids.every((id) => fixture.target.store.graph.getNode(id))).toBe(true)
    expect(
      objectGraphConnectionById(
        fixture.target.store.graph,
        fixture.target.pageId,
        result.connection_ids[0]
      )
    ).not.toBeNull()
    expect(mutationRequestLedgerState(fixture.target, 'request:plan-undo').status).toBe('stored')
  })

  test('NATIVE-074 places a variable-height 4x2 card grid as one rigid Undo unit', async () => {
    const fixture = harness(target())
    const anchorId = fixture.target.store.createShape(
      'FRAME',
      40,
      80,
      120,
      96,
      fixture.target.pageId
    )
    const heights = [120, 180, 140, 200, 160, 128, 192, 144]
    const artifacts: BoardBuildPlan['artifacts'] = heights.map((height, index) => ({
      alias: `card-${index + 1}`,
      recipe: {
        body: `Grid item ${index + 1}`,
        height,
        kind: 'native_card',
        title: `Card ${index + 1}`,
        width: 240
      }
    }))
    const result = (await request(fixture, 'request:native-074-grid', {
      artifacts,
      connections: [],
      contract: 'board-build-plan/v1',
      layout: {
        align: 'center',
        anchor: { object_id: anchorId },
        column_gap: 24,
        columns: 4,
        kind: 'grid',
        members: artifacts.map(({ alias }) => alias),
        placement: { clearance: 64, preferred_directions: ['right'] },
        row_gap: 32
      }
    })) as { aliases: Record<string, string>; owner_ids: string[] }

    const bounds = artifacts.map(({ alias }) =>
      fixture.target.store.graph.getAbsoluteBounds(result.aliases[alias])
    )
    expect(bounds.map(({ height }) => height)).toEqual(heights)
    expect(bounds[0].x).toBeCloseTo(224)
    expect(bounds.slice(0, 4).map(({ x }) => x)).toEqual([224, 488, 752, 1016])
    expect(bounds.slice(0, 4).map(({ y }) => y)).toEqual([120, 90, 110, 80])
    expect(bounds.slice(4).map(({ y }) => y)).toEqual([328, 344, 312, 336])
    expect(result.owner_ids).toHaveLength(8)

    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(result.owner_ids.every((id) => !fixture.target.store.graph.getNode(id))).toBe(true)
    expect(fixture.target.store.graph.getNode(anchorId)).toBeDefined()
    expect(mutationRequestLedgerState(fixture.target, 'request:native-074-grid')).toEqual({
      status: 'missing'
    })
  })

  test('places a grouped grid inside a bounded region anchor', async () => {
    const fixture = harness(target())
    const region = { height: 480, kind: 'region' as const, width: 960, x: 800, y: 600 }
    const result = (await request(fixture, 'request:region-grid', {
      artifacts: ['one', 'two'].map((alias) => ({
        alias,
        recipe: { body: alias, height: 120, kind: 'native_card', title: alias, width: 240 }
      })),
      connections: [],
      contract: 'board-build-plan/v1',
      layout: {
        anchor: region,
        column_gap: 32,
        columns: 2,
        kind: 'grid',
        members: ['one', 'two']
      }
    })) as { aliases: Record<string, string> }

    const bounds = ['one', 'two'].map((alias) =>
      fixture.target.store.graph.getAbsoluteBounds(result.aliases[alias])
    )
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
    const fixture = harness(target())
    const region = { height: 6, kind: 'region' as const, width: 6, x: 800, y: 600 }
    const result = (await request(fixture, 'request:point-region-grid', {
      artifacts: ['one', 'two'].map((alias) => ({
        alias,
        recipe: { body: alias, height: 120, kind: 'native_card', title: alias, width: 240 }
      })),
      connections: [],
      contract: 'board-build-plan/v1',
      layout: {
        anchor: region,
        column_gap: 32,
        columns: 2,
        kind: 'grid',
        members: ['one', 'two']
      }
    })) as { aliases: Record<string, string> }

    const first = fixture.target.store.graph.getAbsoluteBounds(result.aliases.one)
    expect(first.x).toBe(region.x + region.width + 48)
    expect(first.y).toBe(region.y)
  })

  test('refuses a fully blocked grid group before creating any member', async () => {
    const automationTarget = target()
    const fixture = harness(automationTarget)
    const anchorId = automationTarget.store.createShape(
      'FRAME',
      0,
      0,
      100,
      100,
      automationTarget.pageId
    )
    automationTarget.store.createShape(
      'FRAME',
      -100_000,
      -100_000,
      200_000,
      200_000,
      automationTarget.pageId
    )
    const before = [...automationTarget.store.graph.getDescendants(automationTarget.pageId)].map(
      ({ id }) => id
    )

    await expect(
      request(fixture, 'request:blocked-grid', {
        artifacts: [
          {
            alias: 'first',
            recipe: { body: 'One', kind: 'native_card', title: 'First' }
          },
          {
            alias: 'second',
            recipe: { body: 'Two', kind: 'native_card', title: 'Second' }
          }
        ],
        connections: [],
        contract: 'board-build-plan/v1',
        layout: {
          align: 'start',
          anchor: { object_id: anchorId },
          column_gap: 32,
          columns: 2,
          kind: 'grid',
          members: ['first', 'second'],
          row_gap: 32
        }
      })
    ).rejects.toThrow('No collision-free placement was found for the plan grid group.')

    expect(
      [...automationTarget.store.graph.getDescendants(automationTarget.pageId)].map(({ id }) => id)
    ).toEqual(before)
    expect(mutationRequestLedgerState(automationTarget, 'request:blocked-grid')).toEqual({
      status: 'missing'
    })
  })

  test('replays the same digest without adding history and conflicts on a changed digest', async () => {
    const fixture = harness(target())
    const first = (await request(fixture, 'request:plan-replay', plan())) as {
      owner_ids: string[]
    }
    const undoLabel = fixture.target.store.undo.undoLabel
    const replay = (await request(fixture, 'request:plan-replay', plan())) as {
      readback: { result: { owner_ids: string[] } }
      receipt: { idempotent_replay: boolean }
      status: { mutation: string }
    }
    expect(replay.status.mutation).toBe('replayed')
    expect(replay.receipt.idempotent_replay).toBe(true)
    expect(replay.readback.result.owner_ids).toEqual(first.owner_ids)
    expect(fixture.target.store.undo.undoLabel).toBe(undoLabel)

    expect(request(fixture, 'request:plan-replay', plan('Changed'))).rejects.toThrow(
      'already used for a different mutation'
    )
    expect(fixture.target.store.undo.undoLabel).toBe(undoLabel)
  })

  test('mixes a Code Object with native artifacts and a real connection in the same Undo unit', async () => {
    const fixture = harness(target())
    const result = (await request(fixture, 'request:plan-code-object', mixedCodePlan())) as {
      aliases: Record<string, string>
      connection_ids: string[]
      object_ids: string[]
      readback: {
        code_objects: Record<
          string,
          { component: { source_hash: string; source_length: number; state: unknown } }
        >
      }
      receipt: { idempotent_replay: boolean }
      status: { mutation: string }
    }
    const ownerId = result.aliases.confidence
    const connectionId = result.connection_ids[0]

    expect(result.status.mutation).toBe('applied')
    expect(result.object_ids).toHaveLength(5)
    expect(result.readback.code_objects.confidence.component).toMatchObject({
      source_hash: expect.stringMatching(/^sha256:/u),
      source_length: CODE_OBJECT_SOURCE.length,
      state: { confidence: 2 }
    })
    expect(codeObjectDocument(fixture.target.store.graph.getNode(ownerId))).toMatchObject({
      component: 'user-code',
      definitionId: 'eval-confidence-control',
      source: CODE_OBJECT_SOURCE,
      state: { confidence: 2 }
    })
    expect(readObjectGraphPorts(fixture.target.store.graph.getNode(ownerId))).toMatchObject([
      { id: 'brief', side: 'left' }
    ])
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connectionId)
    ).toMatchObject({
      sourceNodeId: result.aliases.brief,
      targetNodeId: ownerId,
      targetPortId: 'brief'
    })
    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(result.object_ids.every((id) => !fixture.target.store.graph.getNode(id))).toBe(true)
    expect(mutationRequestLedgerState(fixture.target, 'request:plan-code-object').status).toBe(
      'missing'
    )

    expect(fixture.target.store.undo.redo()).toBe('Agent: build Board plan')
    expect(codeObjectDocument(fixture.target.store.graph.getNode(ownerId))).toMatchObject({
      definitionId: 'eval-confidence-control',
      source: CODE_OBJECT_SOURCE
    })
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, connectionId)
    ).not.toBeNull()
    const replay = (await request(fixture, 'request:plan-code-object', mixedCodePlan())) as {
      receipt: { idempotent_replay: boolean }
      status: { mutation: string }
    }
    expect(replay).toMatchObject({
      receipt: { idempotent_replay: true },
      status: { mutation: 'replayed' }
    })
    expect(fixture.target.store.undo.undoLabel).toBe('Agent: build Board plan')
  })

  test('creates four registered Smylr routes side by side in one Undo unit', async () => {
    const fixture = harness(target())
    const views = [
      ['chart', 'Dental Chart', '/dental-chart', 'dental-chart', 'phone', 390, 844],
      ['calendar', 'Calendar', '/calendar', 'calendar', 'phone', 390, 844],
      ['patients', 'Patients', '/patients', 'patients', 'phone', 390, 844],
      ['analytics', 'Analytics', '/practice-analytics', 'analytics', 'phone', 390, 844]
    ] as const
    const result = (await request(fixture, 'request:four-smylr-views', {
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
        geography: 'recompose',
        members: views.map(([alias]) => ({ alias })),
        preferences: {
          density: 'compact',
          direction: 'horizontal',
          reading_order: views.map(([alias]) => ({ alias }))
        }
      },
      connections: [],
      contract: 'board-build-plan/v1'
    })) as {
      aliases: Record<string, string>
      object_ids: string[]
      readback: {
        code_objects: Record<string, { component: { app_id: string; route: string } }>
      }
      status: { mutation: string }
    }

    expect(result.status.mutation).toBe('applied')
    expect(result.object_ids).toHaveLength(4)
    const frames = views.map(([alias, name, route, pageId, viewportPreset, width, height]) => {
      const id = result.aliases[alias]
      const frame = fixture.target.store.graph.getNode(id)
      expect(codeObjectDocument(frame)).toMatchObject({
        component: 'smylr-production-app',
        name,
        route,
        viewport: { preset: viewportPreset }
      })
      expect(frame).toMatchObject({ height, width })
      expect(result.readback.code_objects[alias]?.component).toEqual({
        app_id: 'smylr',
        definition_id: `smylr.production.${route.slice(1).replaceAll('/', '.')}`,
        name,
        route,
        viewport_preset: viewportPreset
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
    expect(frames.map(({ x }) => x)).toEqual([...frames.map(({ x }) => x)].sort((a, b) => a - b))
    expect(new Set(frames.map(({ y }) => y)).size).toBe(1)
    await request(fixture, 'request:resize-smylr-view', {
      artifacts: [],
      connections: [],
      contract: 'board-build-plan/v1',
      operations: [
        {
          kind: 'object.resize',
          object_id: result.aliases.chart,
          viewport_preset: 'desktop'
        }
      ]
    })
    expect(fixture.target.store.graph.getNode(result.aliases.chart)).toMatchObject({
      height: 900,
      width: 1440
    })
    expect(
      codeObjectDocument(fixture.target.store.graph.getNode(result.aliases.chart))
    ).toMatchObject({ viewport: { preset: 'desktop' } })
    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(
      codeObjectDocument(fixture.target.store.graph.getNode(result.aliases.chart))
    ).toMatchObject({ viewport: { preset: 'phone' } })
    expect(fixture.target.store.undo.undo()).toBe('Agent: build Board plan')
    expect(result.object_ids.every((id) => !fixture.target.store.graph.getNode(id))).toBe(true)
  })

  test('rejects invalid Code Object source before any plan mutation', async () => {
    const fixture = harness(target())
    expect(
      request(fixture, 'request:plan-invalid-code-object', mixedCodePlan('export default 42'))
    ).rejects.toThrow('failed trusted compile preflight')
    expect(fixture.target.store.graph.getNode(fixture.target.pageId)?.childIds).toEqual([])
    expect(mutationRequestLedgerState(fixture.target, 'request:plan-invalid-code-object')).toEqual({
      status: 'missing'
    })
    expect(fixture.target.store.undo.undoLabel).toBeNull()
  })

  test('rejects a missing later endpoint before mutation', async () => {
    const fixture = harness(target())
    const invalid = mixedCodePlan()
    invalid.connections.push({
      kind: 'visual',
      label: 'missing',
      source: { alias: 'confidence' },
      target: { object_id: 'node:missing' }
    })
    const revision = fixture.target.store.state.sceneVersion

    expect(request(fixture, 'request:plan-invalid-endpoint', invalid)).rejects.toThrow(
      'is missing or outside the target Board'
    )
    expect(fixture.target.store.state.sceneVersion).toBe(revision)
    expect(fixture.target.store.graph.getNode(fixture.target.pageId)?.childIds).toEqual([])
    expect(mutationRequestLedgerState(fixture.target, 'request:plan-invalid-endpoint')).toEqual({
      status: 'missing'
    })
    expect(fixture.target.store.undo.undoLabel).toBeNull()
  })

  test('reconciles missing and already-satisfied connections in one plan', async () => {
    const fixture = harness(target())
    const firstId = fixture.target.store.createShape('FRAME', 0, 0, 100, 100, fixture.target.pageId)
    const secondId = fixture.target.store.createShape(
      'FRAME',
      180,
      0,
      100,
      100,
      fixture.target.pageId
    )
    const thirdId = fixture.target.store.createShape(
      'FRAME',
      360,
      0,
      100,
      100,
      fixture.target.pageId
    )
    const existing = connectObjects(fixture.target.store, {
      kind: 'visual',
      sourceNodeId: secondId,
      targetNodeId: thirdId
    })
    if (!existing) throw new Error('Expected existing connection')

    const result = (await request(fixture, 'request:reconcile-connections', {
      artifacts: [],
      connections: [
        {
          kind: 'visual',
          source: { object_id: firstId },
          target: { object_id: secondId }
        },
        {
          kind: 'visual',
          source: { object_id: secondId },
          target: { object_id: thirdId }
        }
      ],
      contract: 'board-build-plan/v1'
    })) as {
      connection_ids: string[]
      connection_results: Array<{ connection_id: string; effect: string; index: number }>
      receipt: { history_label: string }
      status: { command: string; mutation: string }
    }

    expect(result.status).toMatchObject({ command: 'completed', mutation: 'applied' })
    expect(result.connection_ids).toHaveLength(2)
    expect(result.connection_results).toEqual([
      {
        connection_id: expect.stringMatching(/^object-connection:/u),
        effect: 'would_change',
        index: 0
      },
      { connection_id: existing.id, effect: 'already_satisfied', index: 1 }
    ])
    expect(
      objectGraphConnectionsOnPage(fixture.target.store.graph, fixture.target.pageId)
    ).toHaveLength(2)
    expect(fixture.target.store.undo.undo()).toBe(result.receipt.history_label)
    expect(
      objectGraphConnectionById(fixture.target.store.graph, fixture.target.pageId, existing.id)
    ).not.toBeNull()
    expect(
      objectGraphConnectionsOnPage(fixture.target.store.graph, fixture.target.pageId)
    ).toHaveLength(1)
  })

  test('rolls back artifacts and its ledger when a late connection is refused', async () => {
    const fixture = harness(target())
    const sourceId = fixture.target.store.createShape(
      'FRAME',
      0,
      0,
      100,
      100,
      fixture.target.pageId
    )
    const targetId = fixture.target.store.createShape(
      'FRAME',
      180,
      0,
      100,
      100,
      fixture.target.pageId
    )
    expect(
      connectObjects(fixture.target.store, {
        kind: 'visual',
        sourceNodeId: sourceId,
        targetNodeId: targetId
      })
    ).not.toBeNull()
    const originalChildren = [
      ...(fixture.target.store.graph.getNode(fixture.target.pageId)?.childIds ?? [])
    ]
    const originalUndoLabel = fixture.target.store.undo.undoLabel
    const invalid = mixedCodePlan()
    invalid.connections = [
      {
        kind: 'visual',
        label: 'Conflicting label',
        source: { object_id: sourceId },
        target: { object_id: targetId }
      }
    ]

    expect(request(fixture, 'request:plan-connection-refused', invalid)).rejects.toThrow(
      'conflicts with existing connection'
    )
    expect(fixture.target.store.graph.getNode(fixture.target.pageId)?.childIds).toEqual(
      originalChildren
    )
    expect(mutationRequestLedgerState(fixture.target, 'request:plan-connection-refused')).toEqual({
      status: 'missing'
    })
    expect(fixture.target.store.undo.undoLabel).toBe(originalUndoLabel)
  })
})
