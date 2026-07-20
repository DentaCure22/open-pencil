import { WorkspaceDomainError } from '@/app/workspace'

import type { EvidenceBriefSpec } from './types'

export function evidenceBriefStablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) throw new WorkspaceDomainError('validation_failed', 'evidence brief id is required')
  return result.slice(0, 80)
}

export function evidenceBriefIds(spec: EvidenceBriefSpec) {
  const id = evidenceBriefStablePart(spec.id)
  return {
    board: `html-board_${id}`,
    evidenceManifest: `evidence-manifest_${id}`,
    intent: `intent-record_${id}`,
    surface: `surface-run_${id}`
  }
}
