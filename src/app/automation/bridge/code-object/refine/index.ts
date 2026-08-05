import {
  objectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  coalesceAutomationMutationRequest,
  enqueueAutomationMutation,
  type AutomationMutationReceipt
} from '@/app/automation/bridge/mutation-queue'
import {
  mutationRequestLedgerSnapshot,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  restoreMutationRequestLedger,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  compileCodeObjectSource,
  currentCodeObjectRuntimeRenderGeneration,
  type WaitForCodeObjectRuntimeRender
} from '@/app/code-object/compiler'
import {
  codeObjectDocument,
  codeObjectPluginData,
  type UserCodeObjectDocument
} from '@/app/code-object/model'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

import {
  appliedCodeObjectResult,
  appliedCodeObjectReceipt,
  codeObjectMutationMetadata,
  codeObjectSemanticOwner,
  readyCodeObjectLedger
} from '../mutation'
import { codeObjectNextAction, codeObjectReconciliationFailure } from '../readback'
import { assertSafeCodeObjectSource, codeObjectSourceHash } from '../source'
import {
  CODE_OBJECT_REFINE_ROUTE,
  codeObjectRefineExpected,
  createCodeObjectRefineIntent,
  normalizeCodeObjectRefineArgs,
  type AutomationCodeObjectRefineArgs,
  type AutomationCodeObjectRefineResult,
  type CodeObjectRefineExpectedReadback,
  type CodeObjectRefineIntent,
  type CodeObjectRefinePreservation
} from './contract'
import { codeObjectRefineReadback, replayStoredCodeObjectRefinement } from './readback'

export type { AutomationCodeObjectRefineArgs, AutomationCodeObjectRefineResult } from './contract'

const CODE_OBJECT_PLUGIN_NAMESPACE = 'openpencil-code-object'

type RefinePlan = {
  current: UserCodeObjectDocument
  next: UserCodeObjectDocument
  owner: SceneNode
}

type PreservationSnapshot = {
  boardPermissions: string
  geometry: string
  legacyConnections: string
  objectGraphConnections: string
  otherPluginData: string
  state: string
}

const PROVEN_PRESERVATION: CodeObjectRefinePreservation = {
  board_permissions: true,
  geometry: true,
  legacy_connections: true,
  object_graph_connections: true,
  other_plugin_data: true,
  state: true
}

function assertRefineContext(
  target: AutomationTarget,
  args: AutomationCodeObjectRefineArgs
): RefinePlan {
  if (!canWriteSmylrProductionDocument(target.store)) {
    throw new Error(
      'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
    )
  }
  if (target.store.state.currentPageId !== target.pageId) {
    throw new Error('The exact Board is no longer current. Reacquire context before refinement.')
  }
  if (target.store.state.sceneVersion !== args.mutation.expected_revision) {
    throw new Error('Board revision is stale. Reacquire context before refining the Code Object.')
  }
  const owner = target.store.graph.getNode(args.owner_id)
  if (!owner || !target.store.graph.isDescendant(owner.id, target.pageId)) {
    throw new Error(`Code Object owner "${args.owner_id}" is missing from the exact Board.`)
  }
  const current = codeObjectDocument(owner)
  if (owner.type !== 'FRAME' || current?.component !== 'user-code') {
    throw new Error(`Owner "${owner.id}" is not an authored Code Object frame.`)
  }
  if (current.definitionId !== args.object_key) {
    throw new Error(
      `Code Object owner "${owner.id}" does not match immutable object key "${args.object_key}".`
    )
  }
  return {
    current,
    next: {
      ...structuredClone(current),
      ...(args.name ? { name: args.name } : {}),
      ...(args.props ? { props: structuredClone(args.props) } : {}),
      source: args.source
    },
    owner
  }
}

function ownerConnections(target: AutomationTarget, ownerId: string): ObjectGraphConnection[] {
  return objectGraphConnectionsOnPage(target.store.graph, target.pageId)
    .filter(
      (connection) => connection.sourceNodeId === ownerId || connection.targetNodeId === ownerId
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

function preservationSnapshot(
  target: AutomationTarget,
  owner: SceneNode,
  document: UserCodeObjectDocument
): PreservationSnapshot {
  return {
    boardPermissions: JSON.stringify(document.boardPermissions),
    geometry: JSON.stringify({
      height: owner.height,
      parentId: owner.parentId,
      rotation: owner.rotation,
      width: owner.width,
      x: owner.x,
      y: owner.y
    }),
    legacyConnections: JSON.stringify(document.connections),
    objectGraphConnections: JSON.stringify(ownerConnections(target, owner.id)),
    otherPluginData: JSON.stringify(
      owner.pluginData.filter((entry) => entry.pluginId !== CODE_OBJECT_PLUGIN_NAMESPACE)
    ),
    state: JSON.stringify(document.state)
  }
}

function assertPreserved(
  target: AutomationTarget,
  ownerId: string,
  before: PreservationSnapshot
): CodeObjectRefinePreservation {
  const owner = target.store.graph.getNode(ownerId)
  const document = codeObjectDocument(owner)
  if (!owner || document?.component !== 'user-code') {
    throw new Error('The Code Object disappeared during refinement readback.')
  }
  const after = preservationSnapshot(target, owner, document)
  const changed = (Object.keys(before) as Array<keyof PreservationSnapshot>).filter(
    (key) => before[key] !== after[key]
  )
  if (changed.length > 0) {
    throw new Error(`Code Object refinement changed protected state: ${changed.join(', ')}.`)
  }
  return PROVEN_PRESERVATION
}

function storeReceipt(options: {
  expected: CodeObjectRefineExpectedReadback
  expectedRevision: number
  intent: CodeObjectRefineIntent
  outcome?: 'no_change'
  preservation: CodeObjectRefinePreservation
  target: AutomationTarget
  touchedProperties?: string[]
}): MutationRequestReceipt {
  const { expected, expectedRevision, intent, outcome, preservation, target } = options
  const attribution = {
    ...(intent.taskId ? { taskId: intent.taskId } : {}),
    ...(intent.traceId ? { traceId: intent.traceId } : {})
  }
  const mutationReceipt = {
    appliedRevision: target.store.state.sceneVersion + 1,
    enqueuedRevision: expectedRevision,
    expectedRevision,
    requestId: intent.requestId,
    status: 'applied' as const,
    ...attribution,
    touchedProperties: options.touchedProperties ?? [
      `${expected.ownerId}:name`,
      `${expected.ownerId}:pluginData`
    ]
  }
  const result = {
    name: expected.name,
    object_key: expected.objectKey,
    owner_id: expected.ownerId,
    ...(outcome ? { outcome } : {}),
    preservation,
    props_hash: expected.propsHash,
    source_hash: expected.sourceHash
  }
  return recordMutationRequestReceipt(target, {
    ...attribution,
    inputDigest: intent.inputDigest,
    mutationReceipt,
    objectIds: [expected.ownerId],
    requestId: intent.requestId,
    result,
    route: intent.route,
    semanticIds: [],
    version: 1
  })
}

function applyRefinement(options: {
  expected: CodeObjectRefineExpectedReadback
  expectedRevision: number
  intent: CodeObjectRefineIntent
  plan: RefinePlan
  target: AutomationTarget
}): CodeObjectRefinePreservation {
  const { expected, intent, plan, target } = options
  const ledger = mutationRequestLedgerSnapshot(target.store.graph.getNode(target.pageId))
  const before = preservationSnapshot(target, plan.owner, plan.current)
  try {
    reserveMutationRequest(target, {
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      route: intent.route,
      version: 1
    })
    return target.store.undo.runBatch('Refine code object', () => {
      target.store.updateNodeWithUndo(
        plan.owner.id,
        {
          name: plan.next.name,
          pluginData: codeObjectPluginData(plan.owner, plan.next)
        },
        'Refine code object'
      )
      const preservation = assertPreserved(target, plan.owner.id, before)
      storeReceipt({
        expected,
        expectedRevision: options.expectedRevision,
        intent,
        preservation,
        target
      })
      return preservation
    })
  } catch (error) {
    restoreMutationRequestLedger(target, ledger)
    throw error
  }
}

function noChangeResult(
  intent: CodeObjectRefineIntent,
  ownerId: string,
  readback: Awaited<ReturnType<typeof codeObjectRefineReadback>>,
  receipt: AutomationMutationReceipt
): AutomationCodeObjectRefineResult {
  const current = readback.reconciliation.status === 'current'
  const failure = codeObjectReconciliationFailure(readback)
  return {
    ...(!current
      ? { next_action: codeObjectNextAction(intent.requestId, 'Code Object refinement') }
      : {}),
    owner_id: ownerId,
    preservation: PROVEN_PRESERVATION,
    readback: { code_object: readback },
    receipt: {
      ...receipt,
      idempotent_replay: false,
      input_digest: intent.inputDigest,
      no_history: true,
      outcome: 'no_change',
      product_grade_path: true,
      semantic_owner: codeObjectSemanticOwner(ownerId)
    },
    semantic_owner: codeObjectSemanticOwner(ownerId),
    ...(!current && failure.proof ? { proof: failure.proof } : {}),
    status: current
      ? {
          attention_required: false,
          command: 'completed',
          mutation: 'no_change',
          reason: 'no_change'
        }
      : {
          attention_required: true,
          command: 'unavailable',
          mutation: 'no_change',
          reason: failure.reason
        }
  }
}

function recordNoChangeReceipt(options: {
  expected: CodeObjectRefineExpectedReadback
  expectedRevision: number
  intent: CodeObjectRefineIntent
  target: AutomationTarget
}): CodeObjectRefinePreservation {
  const { expected, expectedRevision, intent, target } = options
  const ledger = mutationRequestLedgerSnapshot(target.store.graph.getNode(target.pageId))
  const preservation = PROVEN_PRESERVATION
  try {
    reserveMutationRequest(target, {
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      route: intent.route,
      version: 1
    })
    storeReceipt({
      expected,
      expectedRevision,
      intent,
      outcome: 'no_change',
      preservation,
      target,
      touchedProperties: []
    })
    return preservation
  } catch (error) {
    restoreMutationRequestLedger(target, ledger)
    throw error
  }
}

async function rejectedRefinementResult(options: {
  expected: CodeObjectRefineExpectedReadback
  intent: CodeObjectRefineIntent
  ownerId: string
  receipt: AutomationMutationReceipt
  target: AutomationTarget
  waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
}): Promise<AutomationCodeObjectRefineResult> {
  return {
    next_action: codeObjectNextAction(options.intent.requestId, 'Code Object refinement'),
    owner_id: options.ownerId,
    readback: {
      code_object: await codeObjectRefineReadback(options.target, options.expected, {
        waitForRuntimeRender: options.waitForRuntimeRender
      })
    },
    receipt: options.receipt,
    semantic_owner: codeObjectSemanticOwner(options.ownerId),
    status: {
      attention_required: true,
      command: 'refused',
      mutation: 'not_applied',
      reason: options.receipt.reason ?? 'mutation_rejected'
    }
  }
}

export function createAutomationCodeObjectRefineHandler(
  options: {
    currentRuntimeGeneration?: (frameId: string) => number | null
    waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
  } = {}
) {
  return async function refineCodeObjectFromAutomation(
    target: AutomationTarget,
    rawArgs: AutomationCodeObjectRefineArgs
  ): Promise<AutomationCodeObjectRefineResult> {
    const args = normalizeCodeObjectRefineArgs(rawArgs)
    const intent = await createCodeObjectRefineIntent(args)
    return coalesceAutomationMutationRequest({
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      target,
      run: async () => {
        const ledger = readyCodeObjectLedger(target, intent)
        if (ledger.status === 'stored') {
          return replayStoredCodeObjectRefinement(target, ledger.receipt, {
            waitForRuntimeRender: options.waitForRuntimeRender
          })
        }

        const plan = assertRefineContext(target, args)
        const currentSourceHash = await codeObjectSourceHash(plan.current.source)
        if (currentSourceHash !== args.expected_source_hash) {
          throw new Error(
            'Code Object source changed before refinement. Re-read the exact owner and use its current source hash.'
          )
        }
        assertSafeCodeObjectSource(args.source)
        const compiled = compileCodeObjectSource(args.source)
        if (!compiled.component) {
          throw new Error(`Code Object source failed trusted compile preflight: ${compiled.error}`)
        }
        const expected = await codeObjectRefineExpected({
          name: plan.next.name,
          objectKey: plan.next.definitionId,
          ownerId: plan.owner.id,
          props: plan.next.props,
          source: plan.next.source
        })
        const rejectedResult = (receipt: AutomationMutationReceipt) =>
          rejectedRefinementResult({
            expected,
            intent,
            ownerId: plan.owner.id,
            receipt,
            target,
            waitForRuntimeRender: options.waitForRuntimeRender
          })
        if (
          plan.current.name === plan.next.name &&
          plan.current.source === plan.next.source &&
          JSON.stringify(plan.current.props) === JSON.stringify(plan.next.props)
        ) {
          const outcome = await enqueueAutomationMutation({
            metadata: codeObjectMutationMetadata(intent, args.mutation.expected_revision),
            run: () => {
              readyCodeObjectLedger(target, intent)
              const currentPlan = assertRefineContext(target, args)
              if (JSON.stringify(currentPlan.next) !== JSON.stringify(plan.next)) {
                throw new Error(
                  'Code Object changed before the no-change receipt; reacquire Board context.'
                )
              }
              return recordNoChangeReceipt({
                expected,
                expectedRevision: args.mutation.expected_revision,
                intent,
                target
              })
            },
            target,
            toolArgs: { id: plan.owner.id, object_key: args.object_key },
            toolName: CODE_OBJECT_REFINE_ROUTE
          })
          if (outcome.status === 'rejected') {
            return rejectedResult(outcome.receipt)
          }
          return noChangeResult(
            intent,
            plan.owner.id,
            await codeObjectRefineReadback(target, expected, {
              waitForRuntimeRender: options.waitForRuntimeRender
            }),
            outcome.receipt
          )
        }

        let baselineRuntimeGeneration = -1
        const outcome = await enqueueAutomationMutation({
          metadata: codeObjectMutationMetadata(intent, args.mutation.expected_revision),
          run: () => {
            readyCodeObjectLedger(target, intent)
            const currentPlan = assertRefineContext(target, args)
            if (
              currentPlan.current.source !== plan.current.source ||
              JSON.stringify(currentPlan.next) !== JSON.stringify(plan.next)
            ) {
              throw new Error('Code Object changed before refinement; reacquire Board context.')
            }
            baselineRuntimeGeneration =
              (options.currentRuntimeGeneration ?? currentCodeObjectRuntimeRenderGeneration)(
                plan.owner.id
              ) ?? -1
            const preservation = applyRefinement({
              expected,
              expectedRevision: args.mutation.expected_revision,
              intent,
              plan: currentPlan,
              target
            })
            return { preservation }
          },
          target,
          toolArgs: { id: plan.owner.id, object_key: args.object_key },
          toolName: CODE_OBJECT_REFINE_ROUTE
        })
        if (outcome.status === 'rejected') {
          return rejectedResult(outcome.receipt)
        }
        const readback = await codeObjectRefineReadback(target, expected, {
          afterGeneration: baselineRuntimeGeneration,
          waitForRuntimeRender: options.waitForRuntimeRender
        })
        const failure = codeObjectReconciliationFailure(readback)
        return appliedCodeObjectResult({
          extra: { preservation: outcome.value.preservation },
          failure,
          nextAction: codeObjectNextAction(intent.requestId, 'Code Object refinement'),
          ownerId: plan.owner.id,
          readback,
          receipt: appliedCodeObjectReceipt(
            outcome.receipt,
            intent,
            plan.owner.id,
            'Refine code object'
          )
        })
      }
    })
  }
}
