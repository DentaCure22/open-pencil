import { WorkspaceDomainError, type EvidenceManifestItem } from '@/app/workspace'

export type RedactedEvidenceItemInput = {
  id: string
  providerRunId: string
  requestedScopes: string[]
  retrievedAt: string
}

export function evidenceIdPart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) throw new WorkspaceDomainError('validation_failed', 'evidence id is required')
  return result.slice(0, 100)
}

export function uniqueEvidenceScopes(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

export function redactedEvidenceItem(input: RedactedEvidenceItemInput): EvidenceManifestItem {
  return {
    access: 'redacted',
    facts: {},
    freshness: 'unknown',
    id: input.id,
    permissionScopes: input.requestedScopes,
    providerRunId: input.providerRunId,
    retrievedAt: input.retrievedAt,
    sourceRef: `redacted://${evidenceIdPart(input.id)}`,
    summary: '',
    title: 'Evidence unavailable',
    truthScope: 'derived'
  }
}
