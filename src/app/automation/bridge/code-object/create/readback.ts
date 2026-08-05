import { parseObjectGraphPorts, readObjectGraphPorts, type Rect } from '@open-pencil/scene-graph'

import { nodeBounds } from '@/app/automation/bridge/board-tools/readback'
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
  const ports = parseObjectGraphPorts(result.ports ?? [])
  if (
    required.some((value) => typeof value !== 'string') ||
    !ports ||
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
    ports,
    sourceHash: result.source_hash as string
  }
}

export async function codeObjectCreateReadback(
  target: AutomationTarget,
  expected: CodeObjectExpectedReadback,
  waitForRuntimeRender: WaitForCodeObjectRuntimeRender = waitForCodeObjectRuntimeRender
): Promise<CodeObjectCreateReadback> {
  const expectedSummary = {
    content_hash: expected.contentHash,
    object_key: expected.objectKey,
    owner_id: expected.ownerId,
    source_hash: expected.sourceHash
  }
  const owner = authoredCodeObjectOwner(target, expected.ownerId, expectedSummary)
  if (owner.readback) return owner.readback
  const { document, frame } = owner
  const ports = readObjectGraphPorts(frame)
  const [currentContentHash, currentSourceHash] = await Promise.all([
    mutationRequestSignature(CODE_OBJECT_CONTENT_ROUTE, {
      name: document.name,
      object_key: document.definitionId,
      ports,
      props: document.props,
      source: document.source,
      state: document.state
    }),
    codeObjectSourceHash(document.source)
  ])
  const runtime = await codeObjectRuntimeReadback({
    document,
    ownerId: expected.ownerId,
    waitForRuntimeRender
  })
  const bounds = nodeBounds(target, frame)
  const reasons = [
    ...(document.definitionId === expected.objectKey ? [] : ['object_key_changed']),
    ...(document.name === expected.name ? [] : ['name_changed']),
    ...(currentSourceHash === expected.sourceHash ? [] : ['source_changed']),
    ...(currentContentHash === expected.contentHash ? [] : ['content_changed']),
    ...(JSON.stringify(ports) === JSON.stringify(expected.ports) ? [] : ['ports_changed']),
    ...(sameBounds(bounds, expected.bounds) ? [] : ['bounds_changed']),
    ...(runtime?.status === 'error' ? ['runtime_render_failed'] : []),
    ...(runtime?.status === 'timeout' ? ['runtime_mount_or_render_timeout'] : [])
  ]
  return completeCodeObjectReadback({
    component: { ...codeObjectComponentReadback(document, currentSourceHash), ports },
    expected: expectedSummary,
    frame,
    reasons,
    ...(runtime ? { runtime } : {}),
    target
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
  waitForRuntimeRender: WaitForCodeObjectRuntimeRender = waitForCodeObjectRuntimeRender
): Promise<AutomationCodeObjectCreateResult> {
  const expected = expectedCodeObjectFromReceipt(receipt)
  const readback = await codeObjectCreateReadback(target, expected, waitForRuntimeRender)
  const current = readback.reconciliation.status === 'current'
  const missing = readback.reconciliation.status === 'missing'
  const historicalOnly = codeObjectHistoricalOnly(readback)
  const failure = codeObjectReconciliationFailure(readback)
  return {
    ...(!current ? { next_action: codeObjectNextAction(receipt.requestId) } : {}),
    owner_id: expected.ownerId,
    ...(isUnknownRecord(receipt.result) && isUnknownRecord(receipt.result.placement)
      ? { placement: receipt.result.placement as AutomationCodeObjectCreateResult['placement'] }
      : {}),
    readback: { code_object: readback },
    receipt: { ...replayReceipt(receipt, expected.ownerId), historical_only: historicalOnly },
    semantic_owner: codeObjectSemanticOwner(expected.ownerId),
    ...(!current && !missing && failure.proof ? { proof: failure.proof } : {}),
    status: current
      ? { attention_required: false, command: 'completed', mutation: 'replayed' }
      : {
          attention_required: true,
          command: 'unavailable',
          mutation: 'replayed',
          reason: missing ? 'historical_receipt_only' : failure.reason
        }
  }
}
