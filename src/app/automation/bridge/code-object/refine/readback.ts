import {
  mutationRequestSignature,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord, type AutomationTarget } from '@/app/automation/bridge/target'
import { type WaitForCodeObjectRuntimeRender } from '@/app/code-object/compiler'

import { codeObjectSemanticOwner } from '../mutation'
import {
  codeObjectComponentReadback,
  codeObjectNextAction,
  codeObjectReconciliationSummary,
  readAuthoredCodeObject,
  replayedCodeObjectStatus
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
    ['board_permissions', 'geometry', 'other_plugin_data', 'state'].some(
      (key) => preservation[key] !== true
    )
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
  return readAuthoredCodeObject({
    afterGeneration: runtimeOptions.afterGeneration,
    expected: expectedSummary,
    inspect: async (document) => {
      const [propsHash, sourceHash] = await Promise.all([
        mutationRequestSignature(CODE_OBJECT_PROPS_ROUTE, document.props),
        codeObjectSourceHash(document.source)
      ])
      return {
        component: {
          ...codeObjectComponentReadback(document, sourceHash),
          props_hash: propsHash
        },
        reasons: [
          ...(document.definitionId === expected.objectKey ? [] : ['object_key_changed']),
          ...(document.name === expected.name ? [] : ['name_changed']),
          ...(propsHash === expected.propsHash ? [] : ['props_changed']),
          ...(sourceHash === expected.sourceHash ? [] : ['source_changed'])
        ]
      }
    },
    ownerId: expected.ownerId,
    target,
    waitForRuntimeRender: runtimeOptions.waitForRuntimeRender
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
  const reconciliation = codeObjectReconciliationSummary(readback)
  const { current, historicalOnly } = reconciliation
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
    ...replayedCodeObjectStatus(reconciliation, noChange ? 'no_change' : 'replayed')
  }
}
