import type { EditorStore } from '@/app/editor/session'
import { HTML_BOARD_SCHEMA_VERSION, createHtmlBoardFrame } from '@/app/html-board/workspace'
import {
  WorkspaceDomainError,
  createEvidenceManifest,
  createIntentRecord,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceRelation,
  mutateKnowledgeWorkspace
} from '@/app/workspace'
import { bindWorkspaceObjectToSceneNode } from '@/app/workspace-ui/projection'

import {
  artifactRef,
  boardForSurface,
  canonicalWorkspace,
  ensureDecisionViews,
  focusBoard,
  persist,
  reviewView,
  surfaceFor
} from './context'
import { WEEKLY_DECISION_SPEC } from './fixture'
import { renderWeeklyDecisionSurface } from './render'
import type {
  OptionWorkbenchSpec,
  WeeklyDecisionCreationResult,
  WeeklyDecisionRenderState
} from './types'

function stablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result)
    throw new WorkspaceDomainError('validation_failed', 'option workbench id is required')
  return result.slice(0, 80)
}

function idsFor(spec: OptionWorkbenchSpec) {
  const id = stablePart(spec.id)
  return {
    board: `html-board_${id}`,
    evidenceManifest: `evidence-manifest_${id}`,
    intent: `intent-record_${id}`,
    surface: `surface-run_${id}`
  }
}

function validateSpec(spec: OptionWorkbenchSpec): void {
  if (spec.recommendations.length < 2 || spec.recommendations.length > 6) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'option workbench requires between two and six alternatives'
    )
  }
  const recommendationIds = new Set<string>()
  const evidenceIds = new Set(spec.evidence.map((item) => item.id))
  for (const recommendation of spec.recommendations) {
    if (recommendationIds.has(recommendation.id)) {
      throw new WorkspaceDomainError('validation_failed', `duplicate option ${recommendation.id}`)
    }
    recommendationIds.add(recommendation.id)
    if (recommendation.evidenceItemIds.some((id) => !evidenceIds.has(id))) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `option ${recommendation.id} references unavailable evidence`
      )
    }
  }
}

export async function createWeeklyDecisionSurface(
  store: EditorStore,
  spec: OptionWorkbenchSpec = WEEKLY_DECISION_SPEC
): Promise<WeeklyDecisionCreationResult> {
  validateSpec(spec)
  const ids = idsFor(spec)
  let workspace = ensureDecisionViews(canonicalWorkspace(store))
  const existing = Object.hasOwn(workspace.objects, ids.surface)
    ? workspace.objects[ids.surface]
    : undefined
  if (existing?.type === 'surface-run') {
    const board = boardForSurface(store, existing)
    await focusBoard(store, board)
    return { boardId: board.id, created: false, surfaceRunId: existing.id }
  }
  if (store.graph.getNode(ids.board)) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'option workbench board exists without its canonical surface object'
    )
  }

  const context = createWorkspaceContext(workspace, {
    now: spec.capturedAt,
    provenance: { actorId: spec.actorId ?? 'openpencil-experience-setup', kind: 'agent' }
  })
  const intent = createIntentRecord(context, {
    capturedAt: spec.capturedAt,
    constraints: spec.intent.constraints,
    desiredOutcome: spec.intent.desiredOutcome,
    id: ids.intent,
    statement: spec.intent.statement
  })
  const evidence = createEvidenceManifest(context, {
    collectionReceipt: spec.collectionReceipt,
    id: ids.evidenceManifest,
    intent: { objectId: intent.id, revision: 1 },
    items: spec.evidence,
    snapshotAt: spec.capturedAt,
    status: 'ready'
  })
  const formKind = spec.mode === 'compare' ? 'flow-studio' : 'weekly-decision'
  const provisionalSurface = createSurfaceRun(context, {
    alternativesConsidered: spec.formChoice?.consideredRendererIds,
    artifact: {
      artifactId: ids.surface,
      boardId: ids.board,
      boardRevision: 1,
      boardSchemaVersion: HTML_BOARD_SCHEMA_VERSION,
      kind: 'html-board',
      sourceHash: 'pending'
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formChoice: spec.formChoice,
    formKind,
    formRationale: spec.formRationale,
    id: ids.surface,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: spec.mode === 'compare' ? 'compare' : 'decide',
    modes:
      spec.mode === 'compare'
        ? [
            { id: 'mode-compare', kind: 'compare', label: 'Compare' },
            { id: 'mode-review', kind: 'review', label: 'Review' }
          ]
        : [
            { id: 'mode-focus', kind: 'focus', label: 'Focus' },
            { id: 'mode-review', kind: 'review', label: 'Review' }
          ],
    name: spec.title,
    recommendations: spec.recommendations,
    rendererId: spec.rendererId
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const initialState: WeeklyDecisionRenderState = {
    artifactRevision: 1,
    evidence: { ...evidence, revision: 1 },
    intent: { ...intent, revision: 1 },
    recommendations: structuredClone(spec.recommendations),
    surface: predictedSurface,
    workspaceRevision: workspace.revision + 1
  }
  const rendered = renderWeeklyDecisionSurface(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `${spec.mode === 'compare' ? 'Compare' : 'Decision'} · ${spec.title}`,
    initialWorkflow: {
      changeSet: null,
      name: 'Decision review',
      origin: null,
      relation: 'root',
      review: null,
      status: 'in-review'
    }
  })
  const surface = createSurfaceRun(context, {
    alternativesConsidered: provisionalSurface.form.alternativesConsidered,
    artifact: artifactRef(board, rendered.sourceHash, provisionalSurface.id),
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formChoice: provisionalSurface.formChoice,
    formKind: provisionalSurface.form.kind,
    formRationale: provisionalSurface.form.rationale,
    id: provisionalSurface.id,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: provisionalSurface.jobKind,
    modes: provisionalSurface.modes,
    name: provisionalSurface.name,
    recommendations: provisionalSurface.recommendations,
    rendererId: provisionalSurface.rendererId
  })
  const relations = [
    createWorkspaceRelation({
      id: `relation_${stablePart(spec.id)}-intent`,
      relationType: 'fulfills-intent',
      sourceId: surface.id,
      targetId: intent.id,
      workspaceId: workspace.id
    }),
    createWorkspaceRelation({
      id: `relation_${stablePart(spec.id)}-evidence`,
      relationType: 'uses-evidence',
      sourceId: surface.id,
      targetId: evidence.id,
      workspaceId: workspace.id
    })
  ]
  workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: `option-workbench-create-${stablePart(spec.id)}`,
    operations: [
      { object: intent, type: 'create-object' },
      { object: evidence, type: 'create-object' },
      { object: surface, type: 'create-object' },
      ...relations.map((relation) => ({ relation, type: 'connect-relation' as const }))
    ]
  }).workspace
  const createdSurface = surfaceFor(workspace, surface.id)
  bindWorkspaceObjectToSceneNode(store.graph, board, createdSurface, reviewView(workspace))
  await persist(store)
  await focusBoard(store, board)
  return { boardId: board.id, created: true, surfaceRunId: createdSurface.id }
}
