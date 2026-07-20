import {
  WorkspaceDomainError,
  type EvidenceManifest,
  type IntentRecord,
  type KnowledgeWorkspace,
  type LearningComparisonBaseline,
  type SurfaceRun,
  type WorkspaceObject,
  type WorkspaceObjectRevisionRef
} from '@/app/workspace'

export type StaticAnswerEvidenceLine = {
  freshness: string
  summary: string
  title: string
  truthScope: string
}

export type StaticAnswerBaselineView = Omit<LearningComparisonBaseline, 'reviewedAt'> & {
  constraints: string[]
  desiredOutcome: string
  evidence: StaticAnswerEvidenceLine[]
  statement: string
  title: string
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function stableContentHash(value: unknown): string {
  const source = canonicalJson(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function exactObject<T extends WorkspaceObject['type']>(
  workspace: KnowledgeWorkspace,
  reference: WorkspaceObjectRevisionRef,
  type: T
): Extract<WorkspaceObject, { type: T }> {
  const object = workspace.objects[reference.objectId] as WorkspaceObject | undefined
  if (object?.type !== type || object.revision !== reference.revision) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `${type} ${reference.objectId} revision ${reference.revision} is unavailable`
    )
  }
  return object as Extract<WorkspaceObject, { type: T }>
}

function baselineSource(intent: IntentRecord, evidence: EvidenceManifest) {
  return {
    evidence: {
      items: evidence.items.map((item) => ({
        freshness: item.freshness,
        id: item.id,
        sourceRef: item.sourceRef,
        summary: item.summary,
        title: item.title,
        truthScope: item.truthScope
      })),
      reference: { objectId: evidence.id, revision: evidence.revision }
    },
    intent: {
      constraints: intent.constraints,
      desiredOutcome: intent.desiredOutcome,
      reference: { objectId: intent.id, revision: intent.revision },
      statement: intent.statement
    },
    rendererId: 'static-answer-v1'
  }
}

export function staticAnswerBaselineForSurface(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun
): StaticAnswerBaselineView {
  const intent = exactObject(workspace, surface.intent, 'intent-record')
  const evidence = exactObject(workspace, surface.evidenceManifest, 'evidence-manifest')
  const source = baselineSource(intent, evidence)
  return {
    constraints: [...intent.constraints],
    contentHash: stableContentHash(source),
    desiredOutcome: intent.desiredOutcome,
    evidence: evidence.items.slice(0, 4).map((item) => ({
      freshness: item.freshness,
      summary: item.summary,
      title: item.title,
      truthScope: item.truthScope
    })),
    evidenceManifest: structuredClone(surface.evidenceManifest),
    intent: structuredClone(surface.intent),
    kind: 'static-answer',
    rendererId: 'static-answer-v1',
    statement: intent.statement,
    title: `Plain answer · ${intent.desiredOutcome}`
  }
}

export function retainedComparisonBaseline(
  view: StaticAnswerBaselineView,
  reviewedAt: string
): LearningComparisonBaseline {
  return {
    contentHash: view.contentHash,
    evidenceManifest: structuredClone(view.evidenceManifest),
    intent: structuredClone(view.intent),
    kind: view.kind,
    rendererId: view.rendererId,
    reviewedAt
  }
}

export function sameComparisonBaseline(
  left: Omit<LearningComparisonBaseline, 'reviewedAt'>,
  right: Omit<LearningComparisonBaseline, 'reviewedAt'>
): boolean {
  return (
    left.contentHash === right.contentHash &&
    left.intent.objectId === right.intent.objectId &&
    left.intent.revision === right.intent.revision &&
    left.evidenceManifest.objectId === right.evidenceManifest.objectId &&
    left.evidenceManifest.revision === right.evidenceManifest.revision
  )
}
