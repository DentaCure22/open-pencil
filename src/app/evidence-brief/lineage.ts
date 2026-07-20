import {
  WorkspaceDomainError,
  createEvidenceManifest,
  createIntentRecord,
  createWorkspaceContext,
  type EvidenceManifest,
  type IntentRecord,
  type KnowledgeWorkspace,
  type SurfaceRun,
  type WorkspaceObjectRevisionRef,
  type WorkspaceOperation
} from '@/app/workspace'

import type { EvidenceBriefSpec } from './types'

type EvidenceBriefIds = {
  evidenceManifest: string
  intent: string
}

export type EvidenceBriefLineage = {
  createOperations: WorkspaceOperation[]
  evidence: EvidenceManifest
  evidenceRef: WorkspaceObjectRevisionRef
  intent: IntentRecord
  intentRef: WorkspaceObjectRevisionRef
  objectRefs: WorkspaceObjectRevisionRef[]
  primarySurface?: SurfaceRun
  tags: string[]
}

function referencedObject<ObjectType extends 'intent-record' | 'evidence-manifest' | 'surface-run'>(
  workspace: KnowledgeWorkspace,
  reference: WorkspaceObjectRevisionRef,
  objectType: ObjectType
): Extract<KnowledgeWorkspace['objects'][string], { type: ObjectType }> {
  if (!Object.hasOwn(workspace.objects, reference.objectId)) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `${objectType} ${reference.objectId} revision ${reference.revision} is unavailable`
    )
  }
  const object = workspace.objects[reference.objectId]
  if (object.type !== objectType || object.revision !== reference.revision) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `${objectType} ${reference.objectId} revision ${reference.revision} is unavailable`
    )
  }
  return object as Extract<KnowledgeWorkspace['objects'][string], { type: ObjectType }>
}

function assertSharedEvidence(spec: EvidenceBriefSpec, evidence: EvidenceManifest): void {
  const expectedEvidenceIds = spec.evidence.map((item) => item.id).toSorted()
  const sharedEvidenceIds = evidence.items.map((item) => item.id).toSorted()
  if (JSON.stringify(expectedEvidenceIds) !== JSON.stringify(sharedEvidenceIds)) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'companion brief evidence must match the primary evidence manifest exactly'
    )
  }
}

export function evidenceBriefLineage(
  workspace: KnowledgeWorkspace,
  spec: EvidenceBriefSpec,
  ids: EvidenceBriefIds
): EvidenceBriefLineage {
  const context = createWorkspaceContext(workspace, {
    now: spec.capturedAt,
    provenance: { actorId: 'openpencil-experience-setup', kind: 'agent' }
  })
  const shared = spec.sharedLineage
  if (shared) {
    const intent = referencedObject(workspace, shared.intent, 'intent-record')
    const evidence = referencedObject(workspace, shared.evidenceManifest, 'evidence-manifest')
    const primarySurface = referencedObject(workspace, shared.primarySurfaceRun, 'surface-run')
    if (
      evidence.intent.objectId !== shared.intent.objectId ||
      evidence.intent.revision !== shared.intent.revision
    ) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'shared evidence does not resolve to the requested intent revision'
      )
    }
    assertSharedEvidence(spec, evidence)
    return {
      createOperations: [],
      evidence,
      evidenceRef: shared.evidenceManifest,
      intent,
      intentRef: shared.intent,
      objectRefs: [shared.intent, shared.evidenceManifest],
      primarySurface,
      tags: ['evidence-brief', 'companion-view', 'shared-lineage']
    }
  }

  const intent = createIntentRecord(context, {
    capturedAt: spec.capturedAt,
    constraints: spec.intent.constraints,
    desiredOutcome: spec.intent.desiredOutcome,
    id: ids.intent,
    statement: spec.intent.statement,
    tags: ['evidence-brief']
  })
  const intentRef = { objectId: intent.id, revision: 1 }
  const evidence = createEvidenceManifest(context, {
    collectionReceipt: spec.collectionReceipt,
    id: ids.evidenceManifest,
    intent: intentRef,
    items: spec.evidence,
    snapshotAt: spec.capturedAt,
    status: 'ready',
    tags: ['evidence-brief']
  })
  const evidenceRef = { objectId: evidence.id, revision: 1 }
  return {
    createOperations: [
      { object: intent, type: 'create-object' },
      { object: evidence, type: 'create-object' }
    ],
    evidence,
    evidenceRef,
    intent,
    intentRef,
    objectRefs: [intentRef, evidenceRef],
    tags: ['evidence-brief']
  }
}
