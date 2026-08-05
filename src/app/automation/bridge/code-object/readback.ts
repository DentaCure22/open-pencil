import type { SceneNode } from '@open-pencil/scene-graph'

import {
  waitForCodeObjectRuntimeRender,
  type WaitForCodeObjectRuntimeRender
} from '@/app/code-object/compiler'
import { codeObjectDocument, type UserCodeObjectDocument } from '@/app/code-object/model'

import { nodeSummary } from '../board-tools/readback'
import type { AutomationTarget } from '../target'
import type {
  CodeObjectNextAction,
  CodeObjectReadback,
  CodeObjectRuntimeProof,
  CodeObjectRuntimeReadback
} from './contract'

const MAX_RUNTIME_RENDER_ERROR_LENGTH = 1_000
const RUNTIME_RECONCILIATION_REASONS = new Set([
  'runtime_mount_or_render_timeout',
  'runtime_render_failed'
])

type AuthoredOwner = {
  document: UserCodeObjectDocument
  frame: SceneNode
  readback?: never
}

type AuthoredOwnerFailure<TExpected> = {
  document?: never
  frame?: never
  readback: CodeObjectReadback<never, TExpected>
}

type CodeObjectReadbackInspection<TComponent> = {
  component: TComponent
  reasons: string[]
}

type ReadAuthoredCodeObjectOptions<TComponent, TExpected> = {
  afterGeneration?: number
  expected: TExpected
  inspect: (
    document: UserCodeObjectDocument,
    frame: SceneNode
  ) => Promise<CodeObjectReadbackInspection<TComponent>>
  ownerId: string
  target: AutomationTarget
  waitForRuntimeRender?: WaitForCodeObjectRuntimeRender
}

function authoredCodeObjectOwner<TExpected>(
  target: AutomationTarget,
  ownerId: string,
  expected: TExpected
): AuthoredOwner | AuthoredOwnerFailure<TExpected> {
  const frame = target.store.graph.getNode(ownerId)
  if (!frame) {
    return {
      readback: {
        expected,
        reconciliation: { reasons: ['owner_missing'], status: 'missing' }
      }
    }
  }
  const document = codeObjectDocument(frame)
  if (document?.component !== 'user-code') {
    return {
      readback: {
        expected,
        frame: nodeSummary(target, frame),
        reconciliation: { reasons: ['owner_is_not_authored_code_object'], status: 'diverged' }
      }
    }
  }
  return { document, frame }
}

async function codeObjectRuntimeReadback(options: {
  afterGeneration?: number
  document: UserCodeObjectDocument
  ownerId: string
  waitForRuntimeRender: WaitForCodeObjectRuntimeRender
}): Promise<CodeObjectRuntimeReadback | undefined> {
  const acknowledgement = await options.waitForRuntimeRender(
    options.ownerId,
    options.document.source,
    options.afterGeneration
  )
  if (acknowledgement.status === 'unavailable') return undefined
  return acknowledgement.status === 'error'
    ? {
        ...acknowledgement,
        error: acknowledgement.error.slice(0, MAX_RUNTIME_RENDER_ERROR_LENGTH)
      }
    : acknowledgement
}

function completeCodeObjectReadback<TComponent, TExpected>(options: {
  component: TComponent
  expected: TExpected
  frame: SceneNode
  reasons: string[]
  runtime?: CodeObjectRuntimeReadback
  target: AutomationTarget
}): CodeObjectReadback<TComponent, TExpected> {
  return {
    component: options.component,
    expected: options.expected,
    frame: nodeSummary(options.target, options.frame),
    reconciliation: {
      reasons: options.reasons,
      status: options.reasons.length === 0 ? 'current' : 'diverged'
    },
    ...(options.runtime ? { runtime: options.runtime } : {})
  }
}

export async function readAuthoredCodeObject<TComponent, TExpected>(
  options: ReadAuthoredCodeObjectOptions<TComponent, TExpected>
): Promise<CodeObjectReadback<TComponent, TExpected>> {
  const owner = authoredCodeObjectOwner(options.target, options.ownerId, options.expected)
  if (owner.readback) return owner.readback
  const { document, frame } = owner
  const inspection = await options.inspect(document, frame)
  const runtime = await codeObjectRuntimeReadback({
    ...(options.afterGeneration === undefined ? {} : { afterGeneration: options.afterGeneration }),
    document,
    ownerId: options.ownerId,
    waitForRuntimeRender: options.waitForRuntimeRender ?? waitForCodeObjectRuntimeRender
  })
  const reasons = [
    ...inspection.reasons,
    ...(runtime?.status === 'error' ? ['runtime_render_failed'] : []),
    ...(runtime?.status === 'timeout' ? ['runtime_mount_or_render_timeout'] : [])
  ]
  return completeCodeObjectReadback({
    component: inspection.component,
    expected: options.expected,
    frame,
    reasons,
    ...(runtime ? { runtime } : {}),
    target: options.target
  })
}

export function codeObjectComponentReadback(document: UserCodeObjectDocument, sourceHash: string) {
  return {
    name: document.name,
    object_key: document.definitionId,
    props: structuredClone(document.props),
    source_hash: sourceHash,
    source_length: document.source.length,
    state: structuredClone(document.state)
  }
}

export function codeObjectRuntimeProof(readback: {
  runtime?: CodeObjectRuntimeReadback
}): CodeObjectRuntimeProof | undefined {
  if (readback.runtime?.status === 'error') {
    return {
      ...(readback.runtime.error ? { error: readback.runtime.error } : {}),
      reason: 'runtime_render_failed',
      stage: 'runtime_render',
      status: 'error'
    }
  }
  return readback.runtime?.status === 'timeout'
    ? {
        reason: 'runtime_mount_or_render_timeout',
        stage: 'runtime_render',
        status: 'partial'
      }
    : undefined
}

export function codeObjectReconciliationFailure(readback: {
  runtime?: CodeObjectRuntimeReadback
}): { proof?: CodeObjectRuntimeProof; reason: string } {
  const proof = codeObjectRuntimeProof(readback)
  return {
    ...(proof ? { proof } : {}),
    reason: proof?.reason ?? 'code_object_reconciliation_failed'
  }
}

export function codeObjectNextAction(requestId: string, subject?: string): CodeObjectNextAction {
  const qualifiedRequest = subject ? `${subject} request ID` : 'request ID'
  return {
    command: 'board_verify',
    instruction: `Reacquire Board context, then verify this same ${qualifiedRequest}. Do not retry the mutation with a new request ID.`,
    request_id: requestId,
    requires_fresh_context: true,
    retry_mutation: false
  }
}

export function codeObjectHistoricalOnly(readback: {
  reconciliation: { reasons: string[]; status: string }
}): boolean {
  return (
    readback.reconciliation.status === 'missing' ||
    readback.reconciliation.reasons.some((reason) => !RUNTIME_RECONCILIATION_REASONS.has(reason))
  )
}
