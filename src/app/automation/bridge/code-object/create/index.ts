import { setObjectGraphPorts, type SceneNode } from '@open-pencil/scene-graph'

import { boardViewportFocusBounds } from '@/app/automation/bridge/board-tools/neighborhood'
import {
  requireVisibleBoardAnchor,
  resolveCenteredFreePlacement,
  resolveNearestFreePlacement,
  visibleBoardObstacles,
  type BoardFreePlacementTarget,
  type BoardPlacementResult
} from '@/app/automation/bridge/board-tools/placement'
import { nodeBounds } from '@/app/automation/bridge/board-tools/readback'
import {
  coalesceAutomationMutationRequest,
  enqueueAutomationMutation
} from '@/app/automation/bridge/mutation-queue'
import {
  mutationRequestLedgerSnapshot,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  restoreMutationRequestLedger,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { compileCodeObjectSource } from '@/app/code-object/compiler'
import type { WaitForCodeObjectRuntimeRender } from '@/app/code-object/compiler'
import {
  codeObjectDocument,
  createCodeObject,
  createUserCodeObjectDocument
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
import {
  assertSafeCodeObjectCreateSource,
  CODE_OBJECT_CREATE_ROUTE,
  createCodeObjectIntent,
  normalizeCodeObjectCreateArgs,
  type AutomationCodeObjectCreateArgs,
  type AutomationCodeObjectCreateResult,
  type CodeObjectCreateIntent,
  type CodeObjectExpectedReadback
} from './contract'
import { codeObjectCreateReadback, replayStoredCodeObjectCreate } from './readback'

export type { AutomationCodeObjectCreateArgs, AutomationCodeObjectCreateResult } from './contract'

function codeObjectByKey(target: AutomationTarget, objectKey: string): SceneNode | null {
  const matches: SceneNode[] = []
  for (const node of target.store.graph.getChildren(target.pageId)) {
    const document = codeObjectDocument(node)
    if (document?.component === 'user-code' && document.definitionId === objectKey) {
      matches.push(node)
    }
  }
  if (matches.length > 1) {
    const duplicateIds = matches.reduce(
      (summary, node) => (summary ? `${summary}, ${node.id}` : node.id),
      ''
    )
    throw new Error(
      `Code Object key "${objectKey}" is duplicated on board "${target.pageName}": ${duplicateIds}`
    )
  }
  return matches[0] ?? null
}

function sameSelection(target: AutomationTarget, anchorId: string): boolean {
  const selected = [...target.store.state.selectedIds]
  return selected.length === 1 && selected[0] === anchorId
}

function assertCreateContext(target: AutomationTarget, args: AutomationCodeObjectCreateArgs): void {
  if (!canWriteSmylrProductionDocument(target.store)) {
    throw new Error(
      'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
    )
  }
  if (target.store.state.currentPageId !== target.pageId) {
    throw new Error(
      'The exact Board is no longer current. Reacquire Board context before creation.'
    )
  }
  if (target.store.state.sceneVersion !== args.mutation.expected_revision) {
    throw new Error('Board revision is stale. Reacquire context before creating the Code Object.')
  }
  if (args.anchor_id) {
    requireVisibleBoardAnchor(target, args.anchor_id)
    if (!sameSelection(target, args.anchor_id)) {
      throw new Error('The anchor must be the exact singleton selection for Code Object creation.')
    }
  }
}

function freePlacement(
  target: AutomationTarget,
  args: AutomationCodeObjectCreateArgs,
  placementTarget: BoardFreePlacementTarget
): BoardPlacementResult | null {
  const footprint = { height: args.height, width: args.width }
  const common = {
    clearance: args.placement.clearance,
    footprint,
    obstacles: visibleBoardObstacles(target),
    preferredDirections: args.placement.preferred_directions
  }
  if (placementTarget.kind === 'relative') {
    return resolveNearestFreePlacement({
      ...common,
      anchor: nodeBounds(target, requireVisibleBoardAnchor(target, placementTarget.objectId))
    })
  }
  if (placementTarget.kind === 'point') {
    return resolveCenteredFreePlacement({
      ...common,
      center: { x: placementTarget.x, y: placementTarget.y },
      maxRings: 0
    })
  }
  const searchRegion =
    placementTarget.kind === 'auto'
      ? boardViewportFocusBounds(target)
      : {
          height: placementTarget.height,
          width: placementTarget.width,
          x: placementTarget.x,
          y: placementTarget.y
        }
  return resolveCenteredFreePlacement({
    ...common,
    center: {
      x: searchRegion.x + searchRegion.width / 2,
      y: searchRegion.y + searchRegion.height / 2
    },
    maxRings: 12,
    ...(placementTarget.kind === 'near_region' ? {} : { searchRegion })
  })
}

function placementFor(
  target: AutomationTarget,
  args: AutomationCodeObjectCreateArgs
): BoardPlacementResult {
  const placement = args.anchor_id
    ? resolveNearestFreePlacement({
        anchor: nodeBounds(target, requireVisibleBoardAnchor(target, args.anchor_id)),
        clearance: args.placement.clearance,
        footprint: { height: args.height, width: args.width },
        obstacles: visibleBoardObstacles(target),
        preferredDirections: args.placement.preferred_directions
      })
    : args.placement.target
      ? freePlacement(target, args, args.placement.target)
      : null
  if (!placement) {
    throw new Error('No collision-free placement was found within the bounded search region.')
  }
  return placement
}

function storeReceipt(options: {
  expected: CodeObjectExpectedReadback
  expectedRevision: number
  intent: CodeObjectCreateIntent
  placement: BoardPlacementResult
  target: AutomationTarget
}): MutationRequestReceipt {
  return recordMutationRequestReceipt(options.target, {
    inputDigest: options.intent.inputDigest,
    mutationReceipt: {
      appliedRevision: options.target.store.state.sceneVersion + 1,
      enqueuedRevision: options.expectedRevision,
      expectedRevision: options.expectedRevision,
      requestId: options.intent.requestId,
      status: 'applied',
      ...(options.intent.taskId ? { taskId: options.intent.taskId } : {}),
      touchedProperties: [`${options.target.pageId}:*`],
      ...(options.intent.traceId ? { traceId: options.intent.traceId } : {})
    },
    objectIds: [options.expected.ownerId],
    requestId: options.intent.requestId,
    result: {
      bounds: options.expected.bounds,
      content_hash: options.expected.contentHash,
      name: options.expected.name,
      object_key: options.expected.objectKey,
      owner_id: options.expected.ownerId,
      placement: options.placement,
      ports: options.expected.ports,
      source_hash: options.expected.sourceHash
    },
    route: options.intent.route,
    semanticIds: [],
    ...(options.intent.taskId ? { taskId: options.intent.taskId } : {}),
    ...(options.intent.traceId ? { traceId: options.intent.traceId } : {}),
    version: 1
  })
}

function createOnce(options: {
  args: AutomationCodeObjectCreateArgs
  intent: CodeObjectCreateIntent
  placement: BoardPlacementResult
  target: AutomationTarget
}): { expected: CodeObjectExpectedReadback; frame: SceneNode } {
  const { args, intent, placement, target } = options
  const ledger = mutationRequestLedgerSnapshot(target.store.graph.getNode(target.pageId))
  const initialChildren = new Set(
    target.store.graph.getChildren(target.pageId).map((node) => node.id)
  )
  try {
    reserveMutationRequest(target, {
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      route: intent.route,
      version: 1
    })
    return target.store.undo.runBatch('Create code object', () => {
      const document = createUserCodeObjectDocument({
        definitionId: args.object_key,
        name: args.name,
        props: args.props,
        source: args.source,
        state: args.state
      })
      const frame = createCodeObject(target.store, {
        document,
        height: placement.bounds.height,
        name: args.name,
        width: placement.bounds.width,
        x: placement.bounds.x,
        y: placement.bounds.y
      })
      if (!setObjectGraphPorts(target.store.graph, frame.id, args.ports ?? [])) {
        throw new Error('Code Object named ports could not be persisted.')
      }
      const expected: CodeObjectExpectedReadback = {
        bounds: placement.bounds,
        contentHash: intent.contentHash,
        name: args.name,
        objectKey: args.object_key,
        ownerId: frame.id,
        ports: args.ports ?? [],
        sourceHash: intent.sourceHash
      }
      storeReceipt({
        expected,
        expectedRevision: args.mutation.expected_revision,
        intent,
        placement,
        target
      })
      return { expected, frame }
    })
  } catch (error) {
    for (const node of target.store.graph.getChildren(target.pageId)) {
      if (!initialChildren.has(node.id)) target.store.graph.deleteNode(node.id)
    }
    restoreMutationRequestLedger(target, ledger)
    throw error
  }
}

export function createAutomationCodeObjectCreateHandler(
  options: {
    waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
  } = {}
) {
  return async function createCodeObjectFromAutomation(
    target: AutomationTarget,
    rawArgs: AutomationCodeObjectCreateArgs
  ): Promise<AutomationCodeObjectCreateResult> {
    const args = normalizeCodeObjectCreateArgs(rawArgs)
    const intent = await createCodeObjectIntent(args)
    return coalesceAutomationMutationRequest({
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      target,
      run: async () => {
        const ledger = readyCodeObjectLedger(target, intent)
        if (ledger.status === 'stored') {
          return replayStoredCodeObjectCreate(target, ledger.receipt, options.waitForRuntimeRender)
        }

        assertCreateContext(target, args)
        if (codeObjectByKey(target, args.object_key)) {
          throw new Error(
            `Code Object "${args.object_key}" already exists; this guarded path is create-only.`
          )
        }
        assertSafeCodeObjectCreateSource(args.source)
        const compiled = compileCodeObjectSource(args.source)
        if (!compiled.component) {
          throw new Error(`Code Object source failed trusted compile preflight: ${compiled.error}`)
        }
        const placement = placementFor(target, args)
        const outcome = await enqueueAutomationMutation({
          metadata: codeObjectMutationMetadata(intent, args.mutation.expected_revision),
          run: () => {
            readyCodeObjectLedger(target, intent)
            assertCreateContext(target, args)
            if (codeObjectByKey(target, args.object_key)) {
              throw new Error(
                `Code Object "${args.object_key}" already exists; this guarded path is create-only.`
              )
            }
            const currentPlacement = placementFor(target, args)
            if (JSON.stringify(currentPlacement) !== JSON.stringify(placement)) {
              throw new Error(
                'Code Object placement changed before mutation; reacquire Board context.'
              )
            }
            return createOnce({ args, intent, placement, target })
          },
          target,
          toolArgs: {
            ...(args.anchor_id ? { anchor_id: args.anchor_id } : {}),
            height: args.height,
            object_key: args.object_key,
            ports: args.ports ?? [],
            ...(args.placement.target ? { placement_target: args.placement.target } : {}),
            width: args.width
          },
          toolName: CODE_OBJECT_CREATE_ROUTE
        })
        if (outcome.status === 'rejected') {
          return {
            next_action: codeObjectNextAction(intent.requestId),
            owner_id: '',
            placement,
            readback: {
              code_object: {
                expected: {
                  content_hash: intent.contentHash,
                  object_key: args.object_key,
                  owner_id: '',
                  source_hash: intent.sourceHash
                },
                reconciliation: { reasons: ['mutation_rejected'], status: 'missing' }
              }
            },
            receipt: outcome.receipt,
            semantic_owner: codeObjectSemanticOwner(''),
            status: {
              attention_required: true,
              command: 'refused',
              mutation: 'not_applied',
              reason: outcome.receipt.reason ?? 'mutation_rejected'
            }
          }
        }
        const readback = await codeObjectCreateReadback(
          target,
          outcome.value.expected,
          options.waitForRuntimeRender
        )
        const failure = codeObjectReconciliationFailure(readback)
        return appliedCodeObjectResult({
          extra: { placement },
          failure,
          nextAction: codeObjectNextAction(intent.requestId),
          ownerId: outcome.value.frame.id,
          readback,
          receipt: appliedCodeObjectReceipt(
            outcome.receipt,
            intent,
            outcome.value.frame.id,
            'Create code object',
            { placement }
          )
        })
      }
    })
  }
}
