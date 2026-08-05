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
  assertNativeMutationReady,
  automationErrorMessage,
  enqueueNativeArtifactMutation,
  matchingNativeRequestNode,
  nativeMutationIdentity,
  nativeMutationProofResult,
  readyNativeMutationLedger,
  reserveNativeMutation,
  storeNativeMutationReceipt,
  type NativeBoardContext
} from './native/mutation'
import {
  parseNativeTextOperation,
  placementFor,
  receiptEntry,
  RECEIPT_PLUGIN_ID,
  RECEIPT_PLUGIN_KEY,
  type AgentTextReceipt,
  type NativeTextOperation,
  nativeTextReconciliation
} from './native/text'
import type { BoardPlacementResult } from './placement'
import { nodeBounds, nodeSummary } from './readback'
import {
  createLocalLegibleTextPlan,
  MINIMUM_LEGIBLE_SCREEN_TEXT_SIZE,
  parseLocalLegibleTextProfile,
  verifyLocalLegibleText,
  type LocalLegibleTextPlan,
  type LocalLegibleTextProfile,
  type VisualPresentationEvidence
} from './visual-context'

type PresentationResult = VisualPresentationEvidence & {
  selected_ids?: string[]
}

type ChangeHandlerOptions = {
  ensureFonts?: typeof ensureGraphFonts
  fontProofTimeoutMs?: number
  issueContext: (target: AutomationTarget) => unknown
  presentationFrame: (
    target: AutomationTarget,
    objectIds: string[],
    options?: { minimumScreenTextSize?: number }
  ) => Promise<PresentationResult>
  requireContext: (
    target: AutomationTarget,
    rawArgs: unknown
  ) => { args: UnknownRecord; context: NativeBoardContext }
}

const TEXT_FONT_PROOF_TIMEOUT_MS = 2_000

type BoardChangeIntent = {
  inputDigest: string
  operation: NativeTextOperation
  requestId: string
  route: 'board_change'
  taskId?: string
  traceId?: string
  visualProfile: LocalLegibleTextProfile | null
}

type NativeTextProof = {
  error?: string
  reason?: string
  stage: 'context' | 'font' | 'presentation' | 'readback' | 'verification'
  status: 'error' | 'partial'
}

type NativeTextFinishResult = { presentation: PresentationResult } | { proof: NativeTextProof }

type AppliedNativeTextValue = NativeTextFinishResult & {
  created: SceneNode
  placement: BoardPlacementResult
  visualPlan: LocalLegibleTextPlan | null
}

function appliedNativeTextReceipt(
  receipt: AutomationMutationReceipt,
  value: AppliedNativeTextValue
): UnknownRecord {
  return {
    ...receipt,
    history_label: 'Agent: create native text',
    idempotent_replay: false,
    placement: value.placement,
    product_grade_path: true,
    semantic_owner: {
      owner_id: value.created.id,
      root_object_id: value.created.id
    }
  }
}

async function finishNativeTextMutation(
  target: AutomationTarget,
  createdId: string,
  visualPlan: LocalLegibleTextPlan | null,
  options: ChangeHandlerOptions
): Promise<NativeTextFinishResult> {
  let stage: NativeTextProof['stage'] = 'font'
  try {
    let fontTimeout: ReturnType<typeof setTimeout> | undefined
    const fontProof = (options.ensureFonts ?? ensureGraphFonts)(target.store.graph, [createdId])
    const timedOut = new Promise<never>((_resolve, reject) => {
      fontTimeout = setTimeout(
        () => reject(new Error('Native text font proof timed out.')),
        options.fontProofTimeoutMs ?? TEXT_FONT_PROOF_TIMEOUT_MS
      )
    })
    try {
      await Promise.race([fontProof, timedOut])
    } finally {
      if (fontTimeout) clearTimeout(fontTimeout)
    }
    stage = 'presentation'
    return {
      presentation: await options.presentationFrame(
        target,
        [createdId],
        visualPlan ? { minimumScreenTextSize: MINIMUM_LEGIBLE_SCREEN_TEXT_SIZE } : {}
      )
    }
  } catch (error) {
    return { proof: { error: automationErrorMessage(error), stage, status: 'error' } }
  }
}

function appliedNativeTextResult(
  target: AutomationTarget,
  intent: BoardChangeIntent,
  receipt: AutomationMutationReceipt,
  value: AppliedNativeTextValue,
  options: ChangeHandlerOptions
): Record<string, unknown> {
  const appliedReceipt = appliedNativeTextReceipt(receipt, value)
  if ('proof' in value) {
    return nativeMutationProofResult({
      mutation: 'applied',
      proof: value.proof,
      receipt: appliedReceipt,
      reason: 'post_apply_proof_failed',
      requestId: intent.requestId
    })
  }

  let stage: NativeTextProof['stage'] = 'verification'
  try {
    const verification = value.visualPlan
      ? verifyLocalLegibleText(target, value.created, value.presentation, receipt.appliedRevision)
      : null
    stage = 'context'
    const context = options.issueContext(target)
    stage = 'readback'
    const reconciliation = nativeTextReconciliation(target, value.created, {
      bounds: value.placement.bounds,
      text: intent.operation.text
    })
    const readback = { graph: nodeSummary(target, value.created), reconciliation }
    const evidence = {
      context,
      presentation: value.presentation,
      readback,
      ...(value.visualPlan && verification
        ? {
            visual: {
              context: value.visualPlan.context,
              placement: value.placement,
              style_resolution: value.visualPlan.styleResolution,
              verification
            }
          }
        : {})
    }
    if (!value.presentation.acknowledged) {
      return nativeMutationProofResult({
        evidence,
        mutation: 'applied',
        proof: {
          reason: 'presentation_not_acknowledged',
          stage: 'presentation',
          status: 'partial'
        },
        receipt: appliedReceipt,
        reason: 'presentation_not_acknowledged',
        requestId: intent.requestId
      })
    }
    if (reconciliation.status !== 'current') {
      return nativeMutationProofResult({
        evidence,
        mutation: 'applied',
        proof: {
          reason: 'native_text_reconciliation_failed',
          stage: 'readback',
          status: 'partial'
        },
        receipt: appliedReceipt,
        reason: 'native_text_reconciliation_failed',
        requestId: intent.requestId
      })
    }
    if (verification !== null && verification.status !== 'passed') {
      return nativeMutationProofResult({
        evidence,
        mutation: 'applied',
        proof: {
          reason: 'visual_verification_not_passed',
          stage: 'verification',
          status: 'partial'
        },
        receipt: appliedReceipt,
        reason: 'visual_verification_not_passed',
        requestId: intent.requestId
      })
    }
    return {
      ...evidence,
      receipt: appliedReceipt,
      status: {
        attention_required: false,
        command: 'completed',
        mutation: 'applied'
      }
    }
  } catch (error) {
    return nativeMutationProofResult({
      evidence: { presentation: value.presentation },
      mutation: 'applied',
      proof: { error: automationErrorMessage(error), stage, status: 'error' },
      receipt: appliedReceipt,
      reason: 'post_apply_proof_failed',
      requestId: intent.requestId
    })
  }
}

async function boardChangeIntent(args: UnknownRecord): Promise<BoardChangeIntent> {
  const operation = parseNativeTextOperation(args.operation)
  const visualProfile = parseLocalLegibleTextProfile(args.visual)
  return {
    ...(await nativeMutationIdentity(args, { operation, visualProfile })),
    operation,
    visualProfile
  }
}

function matchingNativeReceipt(
  target: AutomationTarget,
  intent: BoardChangeIntent
): SceneNode | null {
  return matchingNativeRequestNode(target, intent, (node) => {
    const marker = receiptEntry(node)
    return marker?.version === 2 && marker.inputDigest === intent.inputDigest
  })
}

async function replayLiveResult(
  target: AutomationTarget,
  intent: BoardChangeIntent,
  receipt: MutationRequestReceipt,
  node: SceneNode,
  options: ChangeHandlerOptions
): Promise<Record<string, unknown>> {
  const marker = receiptEntry(node)
  if (marker?.version !== 2) throw new Error('Stored request receipt is unreadable.')
  const replayReceipt = {
    ...receipt.mutationReceipt,
    historical_only: false,
    idempotent_replay: true,
    input_digest: receipt.inputDigest,
    placement: {
      algorithm: marker.algorithm,
      bounds: marker.bounds
    },
    product_grade_path: true,
    semantic_owner: { owner_id: node.id, root_object_id: node.id }
  }
  let stage: NativeTextProof['stage'] = 'verification'
  try {
    const reconciliation = nativeTextReconciliation(target, node, marker)
    if (reconciliation.status !== 'current') {
      stage = 'context'
      return nativeMutationProofResult({
        evidence: {
          context: options.issueContext(target),
          readback: { graph: nodeSummary(target, node), reconciliation }
        },
        mutation: 'replayed',
        proof: {
          reason: 'native_text_reconciliation_failed',
          stage: 'readback',
          status: 'partial'
        },
        reason: 'native_text_reconciliation_failed',
        receipt: replayReceipt,
        requestId: intent.requestId
      })
    }
    const requiredSceneRevision = target.store.state.sceneVersion
    const visualPlan = intent.visualProfile
      ? createLocalLegibleTextPlan(target, {
          explicitFontSize: true,
          fontSize: node.fontSize,
          placementTarget: { anchorId: node.id, kind: 'anchor' }
        })
      : null
    stage = 'presentation'
    const presentation = await options.presentationFrame(
      target,
      [node.id],
      intent.visualProfile ? { minimumScreenTextSize: MINIMUM_LEGIBLE_SCREEN_TEXT_SIZE } : {}
    )
    stage = 'verification'
    const verification = visualPlan
      ? verifyLocalLegibleText(target, node, presentation, requiredSceneRevision)
      : null
    stage = 'context'
    const context = options.issueContext(target)
    stage = 'readback'
    const readback = { graph: nodeSummary(target, node), reconciliation }
    const evidence = {
      context,
      presentation,
      readback,
      ...(visualPlan && verification
        ? {
            visual: {
              context: visualPlan.context,
              placement: {
                algorithm: marker.algorithm,
                bounds: marker.bounds
              },
              style_resolution: {
                ...visualPlan.styleResolution,
                replay_context: true
              },
              verification
            }
          }
        : {})
    }
    if (!presentation.acknowledged) {
      return nativeMutationProofResult({
        evidence,
        mutation: 'replayed',
        proof: {
          reason: 'presentation_not_acknowledged',
          stage: 'presentation',
          status: 'partial'
        },
        receipt: replayReceipt,
        reason: 'presentation_not_acknowledged',
        requestId: intent.requestId
      })
    }
    if (verification !== null && verification.status !== 'passed') {
      return nativeMutationProofResult({
        evidence,
        mutation: 'replayed',
        proof: {
          reason: 'visual_verification_not_passed',
          stage: 'verification',
          status: 'partial'
        },
        receipt: replayReceipt,
        reason: 'visual_verification_not_passed',
        requestId: intent.requestId
      })
    }
    return {
      ...evidence,
      receipt: replayReceipt,
      status: {
        attention_required: false,
        command: 'completed',
        mutation: 'replayed'
      }
    }
  } catch (error) {
    return nativeMutationProofResult({
      mutation: 'replayed',
      proof: { error: automationErrorMessage(error), stage, status: 'error' },
      receipt: replayReceipt,
      reason: 'post_apply_proof_failed',
      requestId: intent.requestId
    })
  }
}

function replayHistoricalResult(
  target: AutomationTarget,
  receipt: MutationRequestReceipt,
  options: ChangeHandlerOptions
): Record<string, unknown> {
  const objectId = receipt.objectIds[0]
  const replayReceipt = {
    ...receipt.mutationReceipt,
    historical_only: true,
    idempotent_replay: true,
    input_digest: receipt.inputDigest,
    product_grade_path: true
  }
  try {
    return {
      context: options.issueContext(target),
      readback: {
        graph: {
          id: objectId,
          missing: true
        }
      },
      receipt: replayReceipt,
      status: {
        attention_required: true,
        command: 'unavailable',
        mutation: 'replayed',
        reason: 'historical_receipt_only'
      }
    }
  } catch (error) {
    return nativeMutationProofResult({
      mutation: 'replayed',
      proof: { error: automationErrorMessage(error), stage: 'context', status: 'error' },
      receipt: replayReceipt,
      reason: 'post_apply_proof_failed',
      requestId: receipt.requestId
    })
  }
}

export function createAutomationBoardChangeHandler(options: ChangeHandlerOptions) {
  return async function change(target: AutomationTarget, rawArgs: unknown) {
    const { args, context } = options.requireContext(target, rawArgs)
    if (!canWriteSmylrProductionDocument(target.store)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
      )
    }
    const intent = await boardChangeIntent(args)
    if (intent.operation.placementTarget.kind !== 'anchor') {
      throw new Error('board_change native text requires an anchored placement target.')
    }
    const anchorId = intent.operation.placementTarget.anchorId
    return coalesceAutomationMutationRequest({
      inputDigest: intent.inputDigest,
      requestId: intent.requestId,
      run: async () => {
        const ledgerState = readyNativeMutationLedger(target, intent)
        if (ledgerState.status === 'stored') {
          const existing = matchingNativeReceipt(target, intent)
          return existing
            ? replayLiveResult(target, intent, ledgerState.receipt, existing, options)
            : replayHistoricalResult(target, ledgerState.receipt, options)
        }
        const existing = matchingNativeReceipt(target, intent)
        const outcome = await enqueueNativeArtifactMutation({
          args,
          context,
          existing,
          guard: { anchorId, kind: 'anchor' },
          intent,
          run: async (expectedRevision) => {
            assertNativeMutationReady(target, intent, {
              anchorId,
              kind: 'anchor'
            })
            const visualPlan = intent.visualProfile
              ? createLocalLegibleTextPlan(target, intent.operation)
              : null
            const effectiveOperation = visualPlan
              ? { ...intent.operation, fontSize: visualPlan.nodeProps.fontSize }
              : intent.operation
            const placement = placementFor(target, effectiveOperation, visualPlan?.nodeProps)
            reserveNativeMutation(target, intent)
            let createdId = ''
            target.store.undo.runBatch('Agent: create native text', () => {
              createdId = target.store.createShape(
                'TEXT',
                placement.bounds.x,
                placement.bounds.y,
                placement.bounds.width,
                placement.bounds.height,
                target.pageId
              )
              const created = target.store.graph.getNode(createdId)
              if (!created) throw new Error('The native text object was not created.')
              const marker: AgentTextReceipt = {
                algorithm: placement.algorithm,
                anchorId,
                bounds: placement.bounds,
                inputDigest: intent.inputDigest,
                requestId: intent.requestId,
                route: intent.route,
                text: intent.operation.text,
                version: 2
              }
              target.store.updateNodeWithUndo(
                createdId,
                {
                  ...(visualPlan ? visualPlan.nodeProps : {}),
                  fontSize: effectiveOperation.fontSize,
                  height: placement.bounds.height,
                  name: intent.operation.name,
                  pluginData: [
                    ...created.pluginData,
                    {
                      key: RECEIPT_PLUGIN_KEY,
                      pluginId: RECEIPT_PLUGIN_ID,
                      value: JSON.stringify(marker)
                    }
                  ],
                  text: intent.operation.text,
                  textAutoResize: 'NONE',
                  width: placement.bounds.width
                },
                'Agent: create native text'
              )
            })
            const created = target.store.graph.getNode(createdId)
            if (!created) throw new Error('The created native text disappeared during readback.')
            const actualBounds = nodeBounds(target, created)
            if (
              Math.abs(actualBounds.x - placement.bounds.x) > 0.01 ||
              Math.abs(actualBounds.y - placement.bounds.y) > 0.01
            ) {
              throw new Error('The created native text moved away from its resolved placement.')
            }
            storeNativeMutationReceipt({
              expectedRevision,
              intent,
              objectIds: [createdId],
              result: { id: createdId, placement },
              target
            })
            const finish = await finishNativeTextMutation(target, createdId, visualPlan, options)
            const value: AppliedNativeTextValue = { created, placement, visualPlan, ...finish }
            return value
          },
          target,
          toolArgs: {
            anchor_id: anchorId,
            text: intent.operation.text
          }
        })

        if (outcome.status === 'rejected') {
          return {
            receipt: outcome.receipt,
            status: {
              attention_required: true,
              command: 'refused',
              mutation: 'not_applied'
            }
          }
        }
        return appliedNativeTextResult(target, intent, outcome.receipt, outcome.value, options)
      },
      target
    })
  }
}
