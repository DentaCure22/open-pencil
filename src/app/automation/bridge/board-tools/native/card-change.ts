import type { SceneNode } from '@open-pencil/scene-graph'

import {
  coalesceAutomationMutationRequest,
  type AutomationMutationReceipt
} from '@/app/automation/bridge/mutation-queue'
import type { MutationRequestReceipt } from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget, UnknownRecord } from '@/app/automation/bridge/target'
import { ensureGraphFonts } from '@/app/editor/fonts'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

import {
  cardReceiptEntry,
  LOCAL_LEGIBLE_CARD_PROFILE,
  nativeCardNodeProps,
  nativeCardPlan,
  nativeCardReadback,
  parseNativeCardOperation,
  parseNativeCardProfile,
  type NativeCardOperation,
  type NativeCardPlan
} from './card'
import {
  assertNativeMutationReady,
  automationErrorMessage,
  enqueueNativeArtifactMutation,
  matchingNativeRequestNode,
  nativeMutationIdentity,
  nativeMutationProofResult,
  readyNativeMutationLedger,
  replayNativeMutationReceipt,
  reserveNativeMutation,
  storeNativeMutationReceipt,
  type NativeBoardContext
} from './mutation'
import { CARD_RECEIPT_PLUGIN_KEY, RECEIPT_PLUGIN_ID, type AgentCardReceipt } from './receipts'

type PresentationResult = {
  acknowledged: boolean
  frame?: { scene_version: number }
  selected_ids?: string[]
}

type NativeCardChangeOptions = {
  ensureFonts?: typeof ensureGraphFonts
  fontProofTimeoutMs?: number
  issueContext: (target: AutomationTarget) => unknown
  presentationFrame: (target: AutomationTarget, objectIds: string[]) => Promise<PresentationResult>
  requireContext: (
    target: AutomationTarget,
    rawArgs: unknown
  ) => { args: UnknownRecord; context: NativeBoardContext }
}

const CARD_FONT_PROOF_TIMEOUT_MS = 2_000

type NativeCardIntent = {
  inputDigest: string
  operation: NativeCardOperation
  requestId: string
  route: 'board_change'
  taskId?: string
  traceId?: string
}

type CreatedCard = {
  bodyId: string
  marker: AgentCardReceipt
  owner: SceneNode
  plan: NativeCardPlan
  titleId: string
}

function mutationGuard(operation: NativeCardOperation) {
  return operation.placementTarget.kind === 'anchor'
    ? ({ anchorId: operation.placementTarget.anchorId, kind: 'anchor' } as const)
    : ({ kind: 'free' } as const)
}

async function cardIntent(args: UnknownRecord): Promise<NativeCardIntent> {
  const operation = parseNativeCardOperation(args.operation)
  const visualProfile = parseNativeCardProfile(args.visual)
  return { ...(await nativeMutationIdentity(args, { operation, visualProfile })), operation }
}

function matchingOwner(target: AutomationTarget, intent: NativeCardIntent): SceneNode | null {
  return matchingNativeRequestNode(target, intent, (node) => {
    const marker = cardReceiptEntry(node)
    return marker?.route === intent.route && marker.inputDigest === intent.inputDigest
  })
}

function appliedReceipt(receipt: AutomationMutationReceipt, created: CreatedCard): UnknownRecord {
  return {
    ...receipt,
    history_label: 'Agent: create native card',
    idempotent_replay: false,
    placement: created.plan.placement,
    product_grade_path: true,
    semantic_owner: { owner_id: created.owner.id, root_object_id: created.owner.id }
  }
}

async function proveCard(options: {
  change: NativeCardChangeOptions
  marker: AgentCardReceipt
  mutation: 'applied' | 'replayed'
  owner: SceneNode
  receipt: UnknownRecord
  requestId: string
  target: AutomationTarget
}) {
  let stage: 'context' | 'font' | 'presentation' | 'readback' = 'font'
  try {
    let fontTimeout: ReturnType<typeof setTimeout> | undefined
    const fontProof = (options.change.ensureFonts ?? ensureGraphFonts)(options.target.store.graph, [
      options.marker.titleId,
      options.marker.bodyId
    ])
    const timedOut = new Promise<never>((_resolve, reject) => {
      fontTimeout = setTimeout(
        () => reject(new Error('Native card font proof timed out.')),
        options.change.fontProofTimeoutMs ?? CARD_FONT_PROOF_TIMEOUT_MS
      )
    })
    try {
      await Promise.race([fontProof, timedOut])
    } finally {
      if (fontTimeout) clearTimeout(fontTimeout)
    }
    stage = 'presentation'
    const presentation = await options.change.presentationFrame(options.target, [options.owner.id])
    stage = 'readback'
    const card = nativeCardReadback(options.target, options.owner, options.marker)
    stage = 'context'
    const context = options.change.issueContext(options.target)
    const evidence = {
      context,
      presentation,
      readback: { card },
      visual: { profile: LOCAL_LEGIBLE_CARD_PROFILE, verification: card.visual }
    }
    if (!presentation.acknowledged) {
      return nativeMutationProofResult({
        evidence,
        mutation: options.mutation,
        proof: {
          reason: 'presentation_not_acknowledged',
          stage: 'presentation',
          status: 'partial'
        },
        reason: 'presentation_not_acknowledged',
        receipt: options.receipt,
        requestId: options.requestId
      })
    }
    if (card.reconciliation.status !== 'current' || card.visual.status !== 'passed') {
      return nativeMutationProofResult({
        evidence,
        mutation: options.mutation,
        proof: {
          reason: 'native_card_reconciliation_failed',
          stage: 'readback',
          status: 'partial'
        },
        reason: 'native_card_reconciliation_failed',
        receipt: options.receipt,
        requestId: options.requestId
      })
    }
    return {
      ...evidence,
      receipt: options.receipt,
      status: {
        attention_required: false,
        command: 'completed',
        mutation: options.mutation
      }
    }
  } catch (error) {
    return nativeMutationProofResult({
      mutation: options.mutation,
      proof: { error: automationErrorMessage(error), stage, status: 'error' },
      reason: 'post_apply_proof_failed',
      receipt: options.receipt,
      requestId: options.requestId
    })
  }
}

function createCard(
  target: AutomationTarget,
  intent: NativeCardIntent,
  plan: NativeCardPlan
): CreatedCard {
  let ownerId = ''
  let titleId = ''
  let bodyId = ''
  const created: { marker: AgentCardReceipt | null } = { marker: null }
  target.store.undo.runBatch('Agent: create native card', () => {
    ownerId = target.store.createShape(
      'FRAME',
      plan.placement.bounds.x,
      plan.placement.bounds.y,
      plan.placement.bounds.width,
      plan.placement.bounds.height,
      target.pageId
    )
    titleId = target.store.createShape('TEXT', 0, 0, 1, 1, ownerId)
    bodyId = target.store.createShape('TEXT', 0, 0, 1, 1, ownerId)
    const commonMarker = {
      algorithm: plan.placement.algorithm,
      artifactKind: 'native_card' as const,
      body: intent.operation.body,
      bodyId,
      bounds: plan.placement.bounds,
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      route: intent.route,
      title: intent.operation.title,
      titleId
    }
    const marker: AgentCardReceipt =
      intent.operation.placementTarget.kind === 'anchor'
        ? {
            ...commonMarker,
            anchorId: intent.operation.placementTarget.anchorId,
            version: 1
          }
        : {
            ...commonMarker,
            placementTarget: intent.operation.placementTarget,
            version: 2
          }
    created.marker = marker
    const props = nativeCardNodeProps(intent.operation, plan, marker)
    target.store.updateNodeWithUndo(ownerId, props.owner, 'Agent: create native card')
    target.store.updateNodeWithUndo(titleId, props.title, 'Agent: create native card')
    target.store.updateNodeWithUndo(bodyId, props.body, 'Agent: create native card')
  })
  const owner = target.store.graph.getNode(ownerId)
  const marker = created.marker
  if (!owner || !marker) throw new Error('The native card was not created.')
  const storedMarker = cardReceiptEntry(owner)
  if (!storedMarker || storedMarker.requestId !== intent.requestId) {
    throw new Error('The native card request receipt was not attached to its owner.')
  }
  return { bodyId, marker, owner, plan, titleId }
}

function storeCardReceipt(
  target: AutomationTarget,
  intent: NativeCardIntent,
  expectedRevision: number,
  created: CreatedCard
) {
  storeNativeMutationReceipt({
    expectedRevision,
    intent,
    objectIds: [created.owner.id, created.titleId, created.bodyId],
    result: {
      body_id: created.bodyId,
      owner_id: created.owner.id,
      placement: created.plan.placement,
      title_id: created.titleId
    },
    target
  })
}

function historicalReplay(
  target: AutomationTarget,
  intent: NativeCardIntent,
  receipt: MutationRequestReceipt,
  options: NativeCardChangeOptions
) {
  let context: unknown
  try {
    context = options.issueContext(target)
  } catch (error) {
    return nativeMutationProofResult({
      mutation: 'replayed',
      proof: { error: automationErrorMessage(error), stage: 'context', status: 'error' },
      reason: 'post_apply_proof_failed',
      receipt: replayNativeMutationReceipt(receipt),
      requestId: intent.requestId
    })
  }
  return nativeMutationProofResult({
    evidence: { context, readback: { card: { missing: true } } },
    mutation: 'replayed',
    reason: 'historical_receipt_only',
    receipt: replayNativeMutationReceipt(receipt),
    requestId: intent.requestId
  })
}

export function createAutomationNativeCardChangeHandler(options: NativeCardChangeOptions) {
  return async function nativeCardChange(target: AutomationTarget, rawArgs: unknown) {
    const { args, context } = options.requireContext(target, rawArgs)
    if (!canWriteSmylrProductionDocument(target.store)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
      )
    }
    const intent = await cardIntent(args)
    return coalesceAutomationMutationRequest({
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      target,
      run: async () => {
        const ledger = readyNativeMutationLedger(target, intent)
        if (ledger.status === 'stored') {
          const owner = matchingOwner(target, intent)
          if (!owner) return historicalReplay(target, intent, ledger.receipt, options)
          const marker = cardReceiptEntry(owner)
          if (!marker) throw new Error('Stored native card receipt is unreadable.')
          return proveCard({
            change: options,
            marker,
            mutation: 'replayed',
            owner,
            receipt: replayNativeMutationReceipt(ledger.receipt, owner.id),
            requestId: intent.requestId,
            target
          })
        }
        const outcome = await enqueueNativeArtifactMutation({
          args,
          context,
          existing: matchingOwner(target, intent),
          guard: mutationGuard(intent.operation),
          intent,
          run: (expectedRevision) => {
            assertNativeMutationReady(target, intent, mutationGuard(intent.operation))
            const plan = nativeCardPlan(target, intent.operation)
            reserveNativeMutation(target, intent)
            const created = createCard(target, intent, plan)
            storeCardReceipt(target, intent, expectedRevision, created)
            return created
          },
          target,
          toolArgs: {
            ...(intent.operation.placementTarget.kind === 'anchor'
              ? { anchor_id: intent.operation.placementTarget.anchorId }
              : { placement_target: intent.operation.placementTarget }),
            body: intent.operation.body,
            title: intent.operation.title
          }
        })
        if (outcome.status === 'rejected') {
          return {
            receipt: outcome.receipt,
            status: { attention_required: true, command: 'refused', mutation: 'not_applied' }
          }
        }
        return proveCard({
          change: options,
          marker: outcome.value.marker,
          mutation: 'applied',
          owner: outcome.value.owner,
          receipt: appliedReceipt(outcome.receipt, outcome.value),
          requestId: intent.requestId,
          target
        })
      }
    })
  }
}

export { CARD_RECEIPT_PLUGIN_KEY, RECEIPT_PLUGIN_ID }
