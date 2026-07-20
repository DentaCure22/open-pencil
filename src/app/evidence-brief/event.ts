import type { EvidenceBriefEventRequest } from './types'

type UnknownRecord = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function integerProperty(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function stringProperty(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

export function parseEvidenceBriefEvent(value: unknown): EvidenceBriefEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected) || value.action !== 'approve') return null
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const artifactRevision = integerProperty(value.expected.artifactRevision)
  const surfaceRevision = integerProperty(value.expected.surfaceRevision)
  const workspaceRevision = integerProperty(value.expected.workspaceRevision)
  if (
    !eventId ||
    !surfaceRunId ||
    artifactRevision === null ||
    surfaceRevision === null ||
    workspaceRevision === null ||
    artifactRevision < 1 ||
    surfaceRevision < 1 ||
    workspaceRevision < 1
  ) {
    return null
  }
  return {
    action: 'approve',
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected: { artifactRevision, surfaceRevision, workspaceRevision },
    note: stringProperty(value.note, 180) || undefined,
    surfaceRunId
  }
}
