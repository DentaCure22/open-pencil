import type { Rect } from '@open-pencil/scene-graph'

import { nodeBounds } from '@/app/automation/bridge/board-tools/readback'
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
import {
  CODE_OBJECT_CONTENT_ROUTE,
  codeObjectSourceHash,
  type AutomationCodeObjectCreateResult,
  type CodeObjectCreateReadback,
  type CodeObjectExpectedReadback
} from './contract'

function sameBounds(left: Rect, right: Rect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

export function expectedCodeObjectFromReceipt(
  receipt: MutationRequestReceipt
): CodeObjectExpectedReadback {
  const result = receipt.result
  if (!isUnknownRecord(result) || !isUnknownRecord(result.bounds)) {
    throw new Error(`Stored Code Object receipt for request "${receipt.requestId}" is unreadable.`)
  }
  const bounds = result.bounds
  const required = [
    result.content_hash,
    result.name,
    result.object_key,
    result.owner_id,
    result.source_hash
  ]
  if (
    required.some((value) => typeof value !== 'string') ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(
      (value) => typeof value === 'number' && Number.isFinite(value)
    )
  ) {
    throw new Error(`Stored Code Object receipt for request "${receipt.requestId}" is unreadable.`)
  }
  return {
    bounds: {
      height: bounds.height as number,
      width: bounds.width as number,
      x: bounds.x as number,
      y: bounds.y as number
    },
    contentHash: result.content_hash as string,
    name: result.name as string,
    objectKey: result.object_key as string,
    ownerId: result.owner_id as string,
    sourceHash: result.source_hash as string
  }
}

export async function codeObjectCreateReadback(
  target: AutomationTarget,
  expected: CodeObjectExpectedReadback,
  waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
): Promise<CodeObjectCreateReadback> {
  const expectedSummary = {
    content_hash: expected.contentHash,
    object_key: expected.objectKey,
    owner_id: expected.ownerId,
    source_hash: expected.sourceHash
  }
  return readAuthoredCodeObject({
    expected: expectedSummary,
    inspect: async (document, frame) => {
      const [currentContentHash, currentSourceHash] = await Promise.all([
        mutationRequestSignature(CODE_OBJECT_CONTENT_ROUTE, {
          name: document.name,
          object_key: document.definitionId,
          props: document.props,
          source: document.source,
          state: document.state
        }),
        codeObjectSourceHash(document.source)
      ])
      const bounds = nodeBounds(target, frame)
      return {
        component: codeObjectComponentReadback(document, currentSourceHash),
        reasons: [
          ...(document.definitionId === expected.objectKey ? [] : ['object_key_changed']),
          ...(document.name === expected.name ? [] : ['name_changed']),
          ...(currentSourceHash === expected.sourceHash ? [] : ['source_changed']),
          ...(currentContentHash === expected.contentHash ? [] : ['content_changed']),
          ...(sameBounds(bounds, expected.bounds) ? [] : ['bounds_changed'])
        ]
      }
    },
    ownerId: expected.ownerId,
    target,
    waitForRuntimeRender
  })
}

function replayReceipt(receipt: MutationRequestReceipt, ownerId: string): Record<string, unknown> {
  return {
    ...receipt.mutationReceipt,
    historical_only: false,
    history_label: 'Create code object',
    idempotent_replay: true,
    input_digest: receipt.inputDigest,
    product_grade_path: true,
    semantic_owner: codeObjectSemanticOwner(ownerId)
  }
}

export async function replayStoredCodeObjectCreate(
  target: AutomationTarget,
  receipt: MutationRequestReceipt,
  waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
): Promise<AutomationCodeObjectCreateResult> {
  const expected = expectedCodeObjectFromReceipt(receipt)
  const readback = await codeObjectCreateReadback(target, expected, waitForRuntimeRender)
  const reconciliation = codeObjectReconciliationSummary(readback)
  const { current, historicalOnly } = reconciliation
  return {
    ...(!current ? { next_action: codeObjectNextAction(receipt.requestId) } : {}),
    owner_id: expected.ownerId,
    ...(isUnknownRecord(receipt.result) && isUnknownRecord(receipt.result.placement)
      ? { placement: receipt.result.placement as AutomationCodeObjectCreateResult['placement'] }
      : {}),
    readback: { code_object: readback },
    receipt: { ...replayReceipt(receipt, expected.ownerId), historical_only: historicalOnly },
    semantic_owner: codeObjectSemanticOwner(expected.ownerId),
    ...replayedCodeObjectStatus(reconciliation, 'replayed')
  }
}
