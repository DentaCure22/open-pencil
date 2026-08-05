import {
  mutationRequestSignature,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import {
  waitForCodeObjectRuntimeRender,
  type WaitForCodeObjectRuntimeRender
} from '@/app/code-object/compiler'

import { codeObjectSemanticOwner } from '../mutation'
import {
  authoredCodeObjectOwner,
  codeObjectComponentReadback,
  codeObjectHistoricalOnly,
  codeObjectNextAction,
  codeObjectReconciliationFailure,
  codeObjectRuntimeReadback,
  completeCodeObjectReadback
} from '../readback'
import { codeObjectSourceHash } from '../source'
import {
  CODE_OBJECT_PROPS_ROUTE,
  type AutomationCodeObjectRefineResult,
  type CodeObjectRefineExpectedReadback,
  type CodeObjectRefinePreservation,
  type CodeObjectRefineReadback
} from './contract'

export type CodeObjectRefineRuntimeReadbackOptions = {
  afterGeneration?: number
  waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
}

function storedPreservation(receipt: MutationRequestReceipt): CodeObjectRefinePreservation {
  const preservation = isUnknownRecord(receipt.result) ? receipt.result.preservation : undefined
  if (
    !isUnknownRecord(preservation) ||
    [
      'board_permissions',
      'geometry',
      'legacy_connections',
      'object_graph_connections',
      'other_plugin_data',
      'state'
    ].some((key) => preservation[key] !== true)
  ) {
    throw new Error(`Stored Code Object receipt for request "${receipt.requestId}" is unreadable.`)
  }
  return preservation as CodeObjectRefinePreservation
}

export function expectedCodeObjectRefinementFromReceipt(
  receipt: MutationRequestReceipt
): CodeObjectRefineExpectedReadback {
  const result = receipt.result
  if (!isUnknownRecord(result)) {
    throw new Error(`Stored Code Object receipt for request "${receipt.requestId}" is unreadable.`)
  }
  const required = [
    result.name,
    result.object_key,
    result.owner_id,
    result.props_hash,
    result.source_hash
  ]
  if (required.some((value) => typeof value !== 'string')) {
    throw new Error(`Stored Code Object receipt for request "${receipt.requestId}" is unreadable.`)
  }
  return {
    name: result.name as string,
    objectKey: result.object_key as string,
    ownerId: result.owner_id as string,
    propsHash: result.props_hash as string,
    sourceHash: result.source_hash as string
  }
}

export async function codeObjectRefineReadback(
  target: AutomationTarget,
  expected: CodeObjectRefineExpectedReadback,
  runtimeOptions: CodeObjectRefineRuntimeReadbackOptions = {}
): Promise<CodeObjectRefineReadback> {
  const expectedSummary = {
    name: expected.name,
    object_key: expected.objectKey,
    owner_id: expected.ownerId,
    props_hash: expected.propsHash,
    source_hash: expected.sourceHash
  }
  const owner = authoredCodeObjectOwner(target, expected.ownerId, expectedSummary)
  if (owner.readback) return owner.readback
  const { document, frame } = owner
  const [propsHash, sourceHash] = await Promise.all([
    mutationRequestSignature(CODE_OBJECT_PROPS_ROUTE, document.props),
    codeObjectSourceHash(document.source)
  ])
  const runtime = await codeObjectRuntimeReadback({
    ...(runtimeOptions.afterGeneration === undefined
      ? {}
      : { afterGeneration: runtimeOptions.afterGeneration }),
    document,
    ownerId: expected.ownerId,
    waitForRuntimeRender: runtimeOptions.waitForRuntimeRender ?? waitForCodeObjectRuntimeRender
  })
  const reasons = [
    ...(document.definitionId === expected.objectKey ? [] : ['object_key_changed']),
    ...(document.name === expected.name ? [] : ['name_changed']),
    ...(propsHash === expected.propsHash ? [] : ['props_changed']),
    ...(sourceHash === expected.sourceHash ? [] : ['source_changed']),
    ...(runtime?.status === 'error' ? ['runtime_render_failed'] : []),
    ...(runtime?.status === 'timeout' ? ['runtime_mount_or_render_timeout'] : [])
  ]
  return completeCodeObjectReadback({
    component: {
      ...codeObjectComponentReadback(document, sourceHash),
      props_hash: propsHash
    },
    expected: expectedSummary,
    frame,
    reasons,
    ...(runtime ? { runtime } : {}),
    target
  })
}

export async function replayStoredCodeObjectRefinement(
  target: AutomationTarget,
  receipt: MutationRequestReceipt,
  runtimeOptions: CodeObjectRefineRuntimeReadbackOptions = {}
): Promise<AutomationCodeObjectRefineResult> {
  const expected = expectedCodeObjectRefinementFromReceipt(receipt)
  const preservation = storedPreservation(receipt)
  const readback = await codeObjectRefineReadback(target, expected, runtimeOptions)
  const current = readback.reconciliation.status === 'current'
  const missing = readback.reconciliation.status === 'missing'
  const historicalOnly = codeObjectHistoricalOnly(readback)
  const failure = codeObjectReconciliationFailure(readback)
  const noChange = isUnknownRecord(receipt.result) && receipt.result.outcome === 'no_change'
  return {
    ...(!current
      ? { next_action: codeObjectNextAction(receipt.requestId, 'Code Object refinement') }
      : {}),
    owner_id: expected.ownerId,
    preservation,
    readback: { code_object: readback },
    receipt: {
      ...receipt.mutationReceipt,
      historical_only: historicalOnly,
      history_label: 'Refine code object',
      idempotent_replay: true,
      input_digest: receipt.inputDigest,
      product_grade_path: true,
      ...(noChange ? { no_history: true, outcome: 'no_change' } : {}),
      semantic_owner: codeObjectSemanticOwner(expected.ownerId)
    },
    semantic_owner: codeObjectSemanticOwner(expected.ownerId),
    ...(!current && !missing && failure.proof ? { proof: failure.proof } : {}),
    status: current
      ? {
          attention_required: false,
          command: 'completed',
          mutation: noChange ? 'no_change' : 'replayed'
        }
      : {
          attention_required: true,
          command: 'unavailable',
          mutation: 'replayed',
          reason: missing ? 'historical_receipt_only' : failure.reason
        }
  }
}
