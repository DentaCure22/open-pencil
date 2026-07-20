import type { EditorStore } from '@/app/editor/session'
import { resolveExperienceFamily } from '@/app/experience-family'
import {
  commitObservedHumanSessionProof,
  type ObservedHumanSessionProof,
  verifyPersistedObservedSessionAttestation,
  verifyObservedHumanSessionProof
} from '@/app/human-sessions'
import { saveSmylrProductionDocument } from '@/app/smylr-production/document-state'
import {
  WorkspaceDomainError,
  createLearningReceipt,
  createWorkspaceContext,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  validateLearningAttestation,
  type DecisionReceipt,
  type KnowledgeWorkspace,
  type LearningAttestation,
  type LearningComparisonBaseline,
  type LearningReceipt,
  type SurfaceRun,
  type WorkspaceHtmlArtifactRevisionRef,
  type WorkspaceObject,
  type WorkspaceObjectRevisionRef
} from '@/app/workspace'
import { baseScope } from '@/app/workspace-ui/helpers'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene,
  workspaceDocumentId
} from '@/app/workspace-ui/persistence'

import { sameComparisonBaseline, staticAnswerBaselineForSurface } from './comparison'
import {
  compositionFieldGateFor,
  requireExactCompositionEvaluations,
  resolveLearningComposition,
  verifiedCompositionFieldGateFor
} from './composition'
import { humanLearningReviewDigest } from './digest'
import type {
  HumanLearningReviewIdentity,
  LearningReceiptState,
  RecordHumanLearningReviewRequest,
  RecordHumanLearningReviewResult,
  RecordLearningReceiptRequest,
  RecordLearningReceiptResult,
  ResolveLearningReviewContextRequest,
  ResolvedLearningReviewContext
} from './types'

function canonicalWorkspace(store: EditorStore): KnowledgeWorkspace {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const scope = baseScope(store)
  return resolveKnowledgeWorkspace({
    documentId: workspaceDocumentId(store.graph),
    name: `${scope.basePageName} Knowledge Workspace`,
    pageId: scope.basePageId
  })
}

function sameReference(
  left: WorkspaceObjectRevisionRef,
  right: WorkspaceObjectRevisionRef
): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function sameArtifact(
  left: WorkspaceHtmlArtifactRevisionRef,
  right: WorkspaceHtmlArtifactRevisionRef
): boolean {
  return (
    left.artifactId === right.artifactId &&
    left.boardId === right.boardId &&
    left.boardRevision === right.boardRevision &&
    left.boardSchemaVersion === right.boardSchemaVersion &&
    left.sourceHash === right.sourceHash
  )
}

function surfaceById(workspace: KnowledgeWorkspace, surfaceRunId: string): SurfaceRun {
  const surface = workspace.objects[surfaceRunId] as WorkspaceObject | undefined
  if (surface?.type !== 'surface-run') {
    throw new WorkspaceDomainError('not_found', `surface run ${surfaceRunId}`)
  }
  return surface
}

function exactSurface(
  workspace: KnowledgeWorkspace,
  request: RecordLearningReceiptRequest
): SurfaceRun {
  const surface = surfaceById(workspace, request.surfaceRun.objectId)
  if (surface.revision !== request.surfaceRun.revision) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `surface ${request.surfaceRun.objectId} revision ${request.surfaceRun.revision} is unavailable`
    )
  }
  return surface
}

function decisionMatchesSurface(decision: DecisionReceipt, surface: SurfaceRun): boolean {
  return (
    sameReference(decision.surfaceRun, {
      objectId: surface.id,
      revision: surface.revision
    }) &&
    sameReference(decision.intent, surface.intent) &&
    sameReference(decision.evidenceManifest, surface.evidenceManifest) &&
    sameArtifact(decision.artifact, surface.artifact)
  )
}

function exactDecision(
  workspace: KnowledgeWorkspace,
  request: RecordLearningReceiptRequest,
  surface: SurfaceRun
): DecisionReceipt | undefined {
  if (!request.decisionReceipt) return undefined
  const decision = workspace.objects[request.decisionReceipt.objectId] as
    | WorkspaceObject
    | undefined
  if (
    decision?.type !== 'decision-receipt' ||
    decision.revision !== request.decisionReceipt.revision ||
    !decisionMatchesSurface(decision, surface)
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `decision ${request.decisionReceipt.objectId} revision ${request.decisionReceipt.revision} does not match the exact surface`
    )
  }
  return decision
}

function requireOutcomeContext(
  request: RecordLearningReceiptRequest,
  surface: SurfaceRun,
  decision?: DecisionReceipt
): void {
  const requiresDecidedOutcome =
    request.durableOutcome || (request.executionKind === 'human' && request.outcome === 'passed')
  if (requiresDecidedOutcome && (surface.status !== 'decided' || !decision)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'passed or durable human learning requires an exact decided surface and decision receipt'
    )
  }
}

function baselineWithoutReviewTime(baseline: LearningComparisonBaseline) {
  return {
    contentHash: baseline.contentHash,
    evidenceManifest: baseline.evidenceManifest,
    intent: baseline.intent,
    kind: baseline.kind,
    rendererId: baseline.rendererId
  }
}

function requireExactComparisonBaseline(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  request: RecordLearningReceiptRequest
): void {
  const baseline = request.comparisonBaseline
  if (!baseline) return
  const expected = staticAnswerBaselineForSurface(workspace, surface)
  if (
    !sameComparisonBaseline(baselineWithoutReviewTime(baseline), expected) ||
    !baseline.reviewedAt ||
    baseline.reviewedAt > request.recordedAt
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'comparison baseline must be the exact same-intent static answer reviewed before recording'
    )
  }
}

function attestationFor(
  request: RecordLearningReceiptRequest,
  verifiedAttestation?: LearningAttestation
): LearningAttestation {
  const attestation = verifiedAttestation ?? {
    attestedAt: request.recordedAt,
    attestedBy: request.recordedBy,
    kind: request.executionKind === 'human' ? ('self-report' as const) : ('automated-run' as const)
  }
  if (
    verifiedAttestation &&
    verifiedAttestation.kind !== 'authenticated-session' &&
    verifiedAttestation.kind !== 'observed-session'
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'verified learning attestations must come from an independent session authority'
    )
  }
  validateLearningAttestation({
    attestation,
    executionKind: request.executionKind,
    receiptId: request.receiptId,
    recordedAt: request.recordedAt,
    recordedBy: request.recordedBy
  })
  return structuredClone(attestation)
}

function formIdForSurface(surface: SurfaceRun) {
  const forms: Record<
    SurfaceRun['form']['kind'],
    'brief' | 'compare' | 'dashboard' | 'decision' | 'map' | 'presentation' | 'tool'
  > = {
    'evidence-brief': 'brief',
    'flow-studio': 'compare',
    'interactive-program': 'tool',
    'record-explorer': 'dashboard',
    'sequential-presentation': 'presentation',
    'spatial-map': 'map',
    'weekly-decision': 'decision',
    'workflow-state': 'compare'
  }
  return forms[surface.form.kind]
}

function receiptState(
  workspace: KnowledgeWorkspace,
  surface: Pick<SurfaceRun, 'id' | 'revision'>
): LearningReceiptState {
  const receipts = Object.values(workspace.objects)
    .filter(
      (object): object is LearningReceipt =>
        object.type === 'learning-receipt' &&
        sameReference(object.surfaceRun, {
          objectId: surface.id,
          revision: surface.revision
        })
    )
    .sort(
      (left, right) =>
        left.recordedAt.localeCompare(right.recordedAt) || left.id.localeCompare(right.id)
    )
  return {
    latest: receipts[receipts.length - 1],
    receipts,
    surfaceRunId: surface.id
  }
}

export function learningReceiptStateForSurface(
  store: EditorStore,
  surfaceRunId: string
): LearningReceiptState {
  const workspace = canonicalWorkspace(store)
  return receiptState(workspace, surfaceById(workspace, surfaceRunId))
}

function resolvedDecision(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  decisionReceiptId?: string
): DecisionReceipt {
  const matching = Object.values(workspace.objects).filter(
    (object): object is DecisionReceipt =>
      object.type === 'decision-receipt' && decisionMatchesSurface(object, surface)
  )
  if (decisionReceiptId) {
    const decision = workspace.objects[decisionReceiptId] as WorkspaceObject | undefined
    if (decision?.type !== 'decision-receipt' || !decisionMatchesSurface(decision, surface)) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        `decision ${decisionReceiptId} does not match decided surface ${surface.id} revision ${surface.revision}`
      )
    }
    return decision
  }
  if (matching.length === 0) {
    throw new WorkspaceDomainError(
      'not_found',
      `exact decision receipt for surface ${surface.id} revision ${surface.revision}`
    )
  }
  if (matching.length > 1) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `surface ${surface.id} revision ${surface.revision} has multiple exact decision receipts`
    )
  }
  return matching[0]
}

export function resolveLearningReviewContext(
  store: EditorStore,
  request: ResolveLearningReviewContextRequest
): ResolvedLearningReviewContext {
  const workspace = canonicalWorkspace(store)
  const surface = surfaceById(workspace, request.surfaceRunId)
  if (surface.status !== 'decided') {
    throw new WorkspaceDomainError(
      'permission_denied',
      `surface ${surface.id} must be decided before recording a human learning review`
    )
  }
  const decision = resolvedDecision(workspace, surface, request.decisionReceiptId)
  return {
    baseline: staticAnswerBaselineForSurface(workspace, surface),
    composition: resolveLearningComposition(workspace, surface),
    compositionGate: compositionFieldGateFor(workspace),
    decision,
    decisionRef: { objectId: decision.id, revision: decision.revision },
    existing: receiptState(workspace, surface),
    experienceFamily: surface.formChoice.composition
      ? resolveExperienceFamily(workspace, {
          objectId: surface.id,
          revision: surface.revision
        })
      : undefined,
    surface,
    surfaceRef: { objectId: surface.id, revision: surface.revision },
    workspaceRevision: workspace.revision
  }
}

function requireExactFamilyProof(
  proof: ObservedHumanSessionProof,
  lineage: ResolvedLearningReviewContext
): void {
  if (proof.claim.version !== 2) return
  const finalFamily = lineage.experienceFamily
  const initialFamily = proof.claim.scope.family
  if (!finalFamily) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'family-scoped observed proof requires an exact final experience family'
    )
  }
  const claimedFinalFamily = proof.claim.finalFamily
  const stableMember = (
    initial: (typeof initialFamily.members)[number],
    final: (typeof finalFamily.members)[number]
  ) =>
    initial.surfaceRun.objectId === final.surfaceRun.objectId &&
    initial.surfaceIndex === final.surfaceIndex &&
    initial.instanceId === final.instanceId &&
    initial.rendererId === final.rendererId &&
    initial.formKind === final.formKind &&
    initial.role === final.role &&
    (initial.role === 'primary' ||
      (final.role === 'support' &&
        initial.relation.relationId === final.relation.relationId &&
        initial.relation.revision === final.relation.revision))
  const stableLineage =
    initialFamily.compositionId === finalFamily.compositionId &&
    initialFamily.recipeDigest === finalFamily.recipeDigest &&
    initialFamily.surfaceCount === finalFamily.surfaceCount &&
    sameReference(initialFamily.intent, finalFamily.intent) &&
    sameReference(initialFamily.evidenceManifest, finalFamily.evidenceManifest) &&
    initialFamily.members.every((member, index) => {
      const final = finalFamily.members[index]
      return stableMember(member, final)
    })
  const exactFinal =
    claimedFinalFamily.familyDigest === finalFamily.familyDigest &&
    claimedFinalFamily.members.length === finalFamily.members.length &&
    finalFamily.members.every((member, index) => {
      const claimed = claimedFinalFamily.members[index]
      return Boolean(
        claimed.surfaceRunId === member.surfaceRun.objectId &&
        claimed.finalSurfaceRevision === member.surfaceRun.revision &&
        claimed.finalArtifactRevision === member.artifact.boardRevision &&
        claimed.taskInteractionCount >= 1
      )
    })
  if (!stableLineage || !exactFinal) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'observed family proof does not match the exact final family transition'
    )
  }
}

function identityPart(value: string, label: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new WorkspaceDomainError('validation_failed', `${label} is required`)
  return encodeURIComponent(trimmed).replaceAll('%', '_')
}

export function humanLearningReviewIdentity(input: {
  runId: string
  surfaceRunId: string
}): HumanLearningReviewIdentity {
  const surface = identityPart(input.surfaceRunId, 'surfaceRunId')
  const run = identityPart(input.runId, 'runId')
  return {
    idempotencyKey: `human-learning-review:${surface}:${run}`,
    receiptId: `learning-receipt_human-${surface}-${run}`
  }
}

async function persist(store: EditorStore): Promise<void> {
  persistKnowledgeWorkspacesToScene(store.graph)
  store.requestRender()
  await saveSmylrProductionDocument(store)
}

function requireHumanReviewUniqueness(
  workspace: KnowledgeWorkspace,
  request: RecordLearningReceiptRequest,
  surface: SurfaceRun,
  decision?: DecisionReceipt
): void {
  if (request.executionKind !== 'human' || !decision) return
  const existing = receiptState(workspace, surface).receipts.find(
    (receipt) =>
      receipt.executionKind === 'human' &&
      receipt.decisionReceipt !== undefined &&
      sameReference(receipt.decisionReceipt, {
        objectId: decision.id,
        revision: decision.revision
      })
  )
  if (existing && existing.id !== request.receiptId) {
    throw new WorkspaceDomainError(
      'idempotency_conflict',
      `surface ${surface.id} decision ${decision.id} already has human learning review ${existing.id}`
    )
  }
}

async function recordLearningReceiptInternal(
  store: EditorStore,
  request: RecordLearningReceiptRequest,
  verifiedAttestation?: LearningAttestation
): Promise<RecordLearningReceiptResult> {
  const workspace = canonicalWorkspace(store)
  const surface = exactSurface(workspace, request)
  const decision = exactDecision(workspace, request, surface)
  requireOutcomeContext(request, surface, decision)
  requireExactComparisonBaseline(workspace, surface, request)
  requireHumanReviewUniqueness(workspace, request, surface, decision)
  const attestation = attestationFor(request, verifiedAttestation)
  const receipt = createLearningReceipt(
    createWorkspaceContext(workspace, {
      createdBy: request.recordedBy,
      now: request.recordedAt,
      provenance: { actorId: request.recordedBy, kind: 'user' }
    }),
    {
      attestation,
      comparisonBaseline: request.comparisonBaseline,
      comparisonOutcome: request.comparisonOutcome,
      compositionEvaluations: request.compositionEvaluations,
      decisionReceipt: request.decisionReceipt,
      durableOutcome: request.durableOutcome,
      evidenceManifest: surface.evidenceManifest,
      evidenceTraceable: request.evidenceTraceable,
      executionKind: request.executionKind,
      formDisposition: request.formDisposition,
      formId: formIdForSurface(surface),
      id: request.receiptId,
      intent: surface.intent,
      intentCompleted: request.intentCompleted,
      keyboardAccepted: request.keyboardAccepted,
      modelId: request.modelId,
      occurredAt: request.occurredAt,
      outcome: request.outcome,
      qualitativeFeedback: request.qualitativeFeedback,
      recordedAt: request.recordedAt,
      recordedBy: request.recordedBy,
      rendererId: surface.rendererId,
      repairCount: request.repairCount,
      runId: request.runId,
      safetyViolation: request.safetyViolation,
      surfaceRun: request.surfaceRun,
      visualAccepted: request.visualAccepted
    }
  )
  const outcome = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: request.expectedWorkspaceRevision,
    idempotencyKey: request.idempotencyKey,
    operations: [{ object: receipt, type: 'create-object' }]
  })
  const recorded = outcome.workspace.objects[receipt.id] as WorkspaceObject | undefined
  if (recorded?.type !== 'learning-receipt') {
    throw new WorkspaceDomainError('not_found', `learning receipt ${receipt.id}`)
  }
  await persist(store)
  return {
    created: !outcome.result.idempotentReplay,
    idempotentReplay: outcome.result.idempotentReplay,
    receipt: recorded,
    workspaceRevision: outcome.workspace.revision
  }
}

export async function recordLearningReceipt(
  store: EditorStore,
  request: RecordLearningReceiptRequest
): Promise<RecordLearningReceiptResult> {
  if ('attestation' in request) {
    throw new WorkspaceDomainError(
      'permission_denied',
      'independent session attestations can only be recorded through their verified authority'
    )
  }
  return recordLearningReceiptInternal(store, request)
}

function existingHumanReview(context: ResolvedLearningReviewContext): LearningReceipt | undefined {
  return context.existing.receipts.find(
    (receipt) =>
      receipt.executionKind === 'human' &&
      receipt.decisionReceipt !== undefined &&
      sameReference(receipt.decisionReceipt, context.decisionRef)
  )
}

export async function recordHumanLearningReview(
  store: EditorStore,
  request: RecordHumanLearningReviewRequest
): Promise<RecordHumanLearningReviewResult> {
  const lineage = resolveLearningReviewContext(store, {
    decisionReceiptId: request.decisionReceiptId,
    surfaceRunId: request.surfaceRunId
  })
  requireExactCompositionEvaluations(
    lineage.composition,
    request.compositionEvaluations,
    request.recordedAt
  )
  if (request.sessionProof) requireExactFamilyProof(request.sessionProof, lineage)
  const requestedIdentity = humanLearningReviewIdentity(request)
  const existing = existingHumanReview(lineage)
  if (existing && existing.id !== requestedIdentity.receiptId) {
    const identity = humanLearningReviewIdentity({
      runId: existing.runId,
      surfaceRunId: request.surfaceRunId
    })
    return {
      created: false,
      idempotentReplay: false,
      identity,
      lineage,
      receipt: existing,
      resolution: 'existing',
      state: lineage.existing,
      workspaceRevision: lineage.workspaceRevision
    }
  }
  const attestation = request.sessionProof
    ? await verifyObservedHumanSessionProof(request.sessionProof, {
        actorId: request.recordedBy,
        decisionReceiptId: lineage.decision.id,
        occurredAt: request.occurredAt,
        recordedAt: request.recordedAt,
        reviewDigest: await humanLearningReviewDigest(request),
        runId: request.runId,
        surfaceRunId: lineage.surface.id,
        finalFamilyDigest:
          request.sessionProof.claim.version === 2
            ? lineage.experienceFamily?.familyDigest
            : undefined
      })
    : undefined
  const recorded = await recordLearningReceiptInternal(
    store,
    {
      comparisonBaseline: request.comparisonBaseline,
      comparisonOutcome: request.comparisonOutcome,
      compositionEvaluations: request.compositionEvaluations,
      decisionReceipt: lineage.decisionRef,
      durableOutcome: request.durableOutcome,
      evidenceTraceable: request.evidenceTraceable,
      executionKind: 'human',
      expectedWorkspaceRevision: request.expectedWorkspaceRevision,
      formDisposition: request.formDisposition,
      idempotencyKey: requestedIdentity.idempotencyKey,
      intentCompleted: request.intentCompleted,
      keyboardAccepted: request.keyboardAccepted,
      modelId: request.modelId,
      occurredAt: request.occurredAt,
      outcome: request.outcome,
      qualitativeFeedback: request.qualitativeFeedback,
      receiptId: requestedIdentity.receiptId,
      recordedAt: request.recordedAt,
      recordedBy: request.recordedBy,
      repairCount: request.repairCount,
      runId: request.runId,
      safetyViolation: request.safetyViolation,
      surfaceRun: lineage.surfaceRef,
      visualAccepted: request.visualAccepted
    },
    attestation
  )
  if (request.sessionProof) commitObservedHumanSessionProof(request.sessionProof.proofDigest)
  const state = learningReceiptStateForSurface(store, request.surfaceRunId)
  return {
    ...recorded,
    identity: requestedIdentity,
    lineage: {
      ...lineage,
      existing: state,
      workspaceRevision: recorded.workspaceRevision
    },
    resolution: recorded.idempotentReplay ? 'replayed' : 'created',
    state
  }
}

export async function verifyPersistedLearningReceiptAttestation(
  receipt: LearningReceipt,
  crypto: Crypto = globalThis.crypto
): Promise<LearningAttestation> {
  if (!receipt.decisionReceipt) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `learning receipt ${receipt.id} has no exact decision to verify`
    )
  }
  return verifyPersistedObservedSessionAttestation(
    receipt.attestation,
    {
      actorId: receipt.recordedBy,
      decisionReceiptId: receipt.decisionReceipt.objectId,
      occurredAt: receipt.occurredAt,
      recordedAt: receipt.recordedAt,
      reviewDigest: await humanLearningReviewDigest(receipt),
      runId: receipt.runId,
      surfaceRunId: receipt.surfaceRun.objectId
    },
    crypto
  )
}

export async function verifiedCompositionFieldGateForStore(
  store: EditorStore,
  crypto: Crypto = globalThis.crypto
) {
  const workspace = canonicalWorkspace(store)
  const receipts = Object.values(workspace.objects).filter(
    (object): object is LearningReceipt =>
      object.type === 'learning-receipt' &&
      object.lifecycle === 'active' &&
      object.executionKind === 'human' &&
      object.attestation.kind === 'observed-session' &&
      object.attestation.proof?.claim.version === 2
  )
  const verifiedReceiptIds = new Set<string>()
  await Promise.all(
    receipts.map(async (receipt) => {
      try {
        await verifyPersistedLearningReceiptAttestation(receipt, crypto)
        verifiedReceiptIds.add(receipt.id)
      } catch (error) {
        console.warn(
          `[Composition gate] Receipt ${receipt.id} is readable but its family proof did not reverify`,
          error
        )
      }
    })
  )
  return verifiedCompositionFieldGateFor(workspace, verifiedReceiptIds)
}
