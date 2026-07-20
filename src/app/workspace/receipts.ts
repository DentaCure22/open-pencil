import type { WorkspaceMutationEnvelope } from './operations'
import type {
  KnowledgeWorkspace,
  WorkspaceMutationOutcome,
  WorkspaceMutationReceipt,
  WorkspaceMutationResult
} from './types'

const MAX_MUTATION_RECEIPTS = 256

type FingerprintRecord = Record<string, unknown>

function isFingerprintRecord(value: unknown): value is FingerprintRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fingerprintValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return `[${value.map(fingerprintValue).join(',')}]`
  if (isFingerprintRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${fingerprintValue(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function requestFingerprint(envelope: WorkspaceMutationEnvelope): string {
  return fingerprintValue({ operations: envelope.operations })
}

export function replayReceipt(
  workspace: KnowledgeWorkspace,
  receipt: WorkspaceMutationReceipt
): WorkspaceMutationOutcome {
  return {
    result: {
      affectedStableIds: [...receipt.affectedStableIds],
      archivedStableIds: [...receipt.archivedStableIds],
      baseRevision: receipt.baseRevision,
      createdStableIds: [...receipt.createdStableIds],
      dryRun: false,
      idempotentReplay: true,
      mutationId: receipt.mutationId,
      operationSummaries: [...receipt.operationSummaries],
      revision: receipt.revision,
      scope: receipt.scope,
      warnings: [...receipt.warnings]
    },
    workspace: structuredClone(workspace)
  }
}

export function rememberMutationReceipt(
  workspace: KnowledgeWorkspace,
  envelope: WorkspaceMutationEnvelope,
  result: WorkspaceMutationResult,
  mutationId: string,
  fingerprint: string
): void {
  workspace.mutationReceipts[envelope.idempotencyKey] = {
    affectedStableIds: [...result.affectedStableIds],
    archivedStableIds: [...result.archivedStableIds],
    baseRevision: result.baseRevision,
    createdStableIds: [...result.createdStableIds],
    idempotencyKey: envelope.idempotencyKey,
    mutationId,
    operationSummaries: [...result.operationSummaries],
    requestFingerprint: fingerprint,
    revision: result.revision,
    scope: result.scope,
    warnings: [...result.warnings]
  }
  const receiptEntries = Object.entries(workspace.mutationReceipts)
  if (receiptEntries.length <= MAX_MUTATION_RECEIPTS) return
  workspace.mutationReceipts = Object.fromEntries(
    receiptEntries
      .sort(([, left], [, right]) => left.revision - right.revision)
      .slice(receiptEntries.length - MAX_MUTATION_RECEIPTS)
  )
}
