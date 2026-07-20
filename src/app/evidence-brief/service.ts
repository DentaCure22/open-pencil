import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  HTML_BOARD_SCHEMA_VERSION,
  approveHtmlBoardDecisionSurface,
  createHtmlBoardFrame,
  htmlBoardDocument,
  htmlBoardRevision,
  htmlBoardViewportInsets,
  isHtmlBoardFrame,
  updateHtmlBoardFrame
} from '@/app/html-board/workspace'
import { explicitRendererRationale } from '@/app/interactive-surface/renderer-selection'
import { saveSmylrProductionDocument } from '@/app/smylr-production/document-state'
import {
  WorkspaceDomainError,
  createDecisionReceipt,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceRelation,
  createWorkspaceView,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type DecisionReceipt,
  type KnowledgeWorkspace,
  type SurfaceInteraction,
  type SurfaceRun,
  type WorkspaceObjectRevisionRef,
  type WorkspaceOperation,
  type WorkspaceView
} from '@/app/workspace'
import { baseScope } from '@/app/workspace-ui/helpers'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene,
  workspaceDocumentId
} from '@/app/workspace-ui/persistence'
import {
  bindWorkspaceObjectToSceneNode,
  sceneNodesForWorkspaceObject
} from '@/app/workspace-ui/projection'
import { IS_BROWSER } from '@/constants'

import { EVIDENCE_BRIEF_SPEC } from './fixture'
import { evidenceBriefLineage } from './lineage'
import { evidenceBriefIds, evidenceBriefStablePart } from './model'
import { renderEvidenceBrief } from './render'
import type {
  EvidenceBriefCreationResult,
  EvidenceBriefEventRequest,
  EvidenceBriefEventResult,
  EvidenceBriefRenderState,
  EvidenceBriefSpec
} from './types'

type UnknownRecord = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringProperty(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function canonicalWorkspace(store: EditorStore): KnowledgeWorkspace {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const scope = baseScope(store)
  return resolveKnowledgeWorkspace({
    documentId: workspaceDocumentId(store.graph),
    name: `${scope.basePageName} Knowledge Workspace`,
    pageId: scope.basePageId
  })
}

function ensureViews(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
  const required = [
    { kind: 'canvas' as const, name: 'Focus', primary: true },
    { kind: 'graph' as const, name: 'Overview', primary: false },
    { kind: 'review' as const, name: 'Review', primary: false }
  ]
  const operations: WorkspaceOperation[] = required.flatMap((candidate) => {
    const exists = Object.values(workspace.views).some(
      (view) => view.lifecycle === 'active' && view.kind === candidate.kind
    )
    return exists
      ? []
      : [
          {
            type: 'create-view' as const,
            view: createWorkspaceView({
              kind: candidate.kind,
              name: candidate.name,
              primary: candidate.primary && Object.keys(workspace.views).length === 0,
              workspaceId: workspace.id
            })
          }
        ]
  })
  if (operations.length === 0) return workspace
  return mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: 'evidence-brief-ensure-views-v1',
    operations
  }).workspace
}

function reviewView(workspace: KnowledgeWorkspace): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === 'review'
  )
  if (!view) throw new WorkspaceDomainError('not_found', 'evidence brief review view')
  return view
}

function artifactRef(board: SceneNode, surfaceId: string, sourceHash: string) {
  const document = htmlBoardDocument(board)
  return {
    artifactId: surfaceId,
    boardId: board.id,
    boardRevision: document.revision,
    boardSchemaVersion: HTML_BOARD_SCHEMA_VERSION,
    kind: 'html-board' as const,
    sourceHash
  }
}

async function persist(store: EditorStore): Promise<void> {
  persistKnowledgeWorkspacesToScene(store.graph)
  store.requestRender()
  await saveSmylrProductionDocument(store)
}

function surfaceFor(workspace: KnowledgeWorkspace, surfaceId: string): SurfaceRun {
  if (!Object.hasOwn(workspace.objects, surfaceId)) {
    throw new WorkspaceDomainError('not_found', `surface run ${surfaceId}`)
  }
  const object = workspace.objects[surfaceId]
  if (object.type !== 'surface-run') {
    throw new WorkspaceDomainError('not_found', `surface run ${surfaceId}`)
  }
  return object
}

function boardForSurface(store: EditorStore, surface: SurfaceRun): SceneNode {
  const board = sceneNodesForWorkspaceObject(store.graph, surface.id).find(isHtmlBoardFrame)
  if (!board) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `surface ${surface.id} has no bound HTML board`
    )
  }
  return board
}

function referencedObject<ObjectType extends 'intent-record' | 'evidence-manifest'>(
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

function receiptFor(workspace: KnowledgeWorkspace, surfaceId: string): DecisionReceipt | undefined {
  return Object.values(workspace.objects).find(
    (object): object is DecisionReceipt =>
      object.type === 'decision-receipt' && object.surfaceRun.objectId === surfaceId
  )
}

function specForBoard(board: SceneNode): EvidenceBriefSpec {
  const source = htmlBoardDocument(board).artifact?.source
  if (!source)
    throw new WorkspaceDomainError('reconstruction_conflict', 'evidence brief source missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new WorkspaceDomainError('reconstruction_conflict', 'evidence brief source is invalid')
  }
  const spec = isRecord(parsed) ? parsed.spec : null
  if (
    !isRecord(spec) ||
    !stringProperty(spec.id, 100) ||
    !Array.isArray(spec.sections) ||
    !Array.isArray(spec.evidence) ||
    !Array.isArray(spec.views)
  ) {
    throw new WorkspaceDomainError('reconstruction_conflict', 'evidence brief spec is unavailable')
  }
  return spec as EvidenceBriefSpec
}

function stateFor(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: EvidenceBriefSpec,
  receipt = receiptFor(workspace, surface.id)
): EvidenceBriefRenderState {
  return {
    artifactRevision: surface.artifact.boardRevision,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    receipt,
    spec,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function evidenceBriefStateForBoard(
  store: EditorStore,
  board: SceneNode
): EvidenceBriefRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'evidence-brief-surface') return null
  const workspace = canonicalWorkspace(store)
  if (!Object.hasOwn(workspace.objects, artifact.artifactId)) return null
  const object = workspace.objects[artifact.artifactId]
  if (object.type !== 'surface-run') return null
  return stateFor(workspace, object, specForBoard(board))
}

async function focusBoard(store: EditorStore, board: SceneNode): Promise<void> {
  if (board.parentId && board.parentId !== store.state.currentPageId) {
    await store.switchPage(board.parentId)
  }
  store.select([board.id])
  if (IS_BROWSER) store.zoomToSelection(htmlBoardViewportInsets())
}

export async function createEvidenceBrief(
  store: EditorStore,
  spec: EvidenceBriefSpec = EVIDENCE_BRIEF_SPEC
): Promise<EvidenceBriefCreationResult> {
  const ids = evidenceBriefIds(spec)
  let workspace = ensureViews(canonicalWorkspace(store))
  const existing = Object.hasOwn(workspace.objects, ids.surface)
    ? workspace.objects[ids.surface]
    : undefined
  if (existing?.type === 'surface-run') {
    const board = boardForSurface(store, existing)
    await focusBoard(store, board)
    return {
      boardId: board.id,
      created: false,
      formRationale: existing.formChoice.rationale,
      surfaceRunId: existing.id
    }
  }
  if (store.graph.getNode(ids.board)) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'evidence brief board exists without its canonical surface object'
    )
  }
  const rendererRationale = explicitRendererRationale('Evidence brief')
  const context = createWorkspaceContext(workspace, {
    now: spec.capturedAt,
    provenance: { actorId: 'openpencil-experience-setup', kind: 'agent' }
  })
  const lineage = evidenceBriefLineage(workspace, spec, ids)
  const { evidence, evidenceRef, intent, intentRef, primarySurface } = lineage
  const viewIds = Object.values(workspace.views).map((view) => view.id)
  const provisionalSurface = createSurfaceRun(context, {
    alternativesConsidered: ['brief-v1', 'plain-prose', 'presentation-v1'],
    artifact: {
      artifactId: ids.surface,
      boardId: ids.board,
      boardRevision: 1,
      boardSchemaVersion: HTML_BOARD_SCHEMA_VERSION,
      kind: 'html-board',
      sourceHash: 'pending'
    },
    bindings: {
      evidenceItemIds: spec.evidence.map((item) => item.id),
      objectRefs: lineage.objectRefs,
      viewIds
    },
    evidenceManifest: evidenceRef,
    formChoice: spec.formChoice ?? {
      consideredRendererIds: ['evidence-brief-v1', 'plain-prose', 'presentation-v1'],
      rationale: rendererRationale
    },
    formKind: 'evidence-brief',
    formRationale: spec.formChoice?.rationale ?? rendererRationale,
    id: ids.surface,
    intent: intentRef,
    jobKind: 'explain',
    modes: [
      { id: 'mode-overview', kind: 'overview', label: 'Overview', rendererViewId: 'overview' },
      { id: 'mode-focus', kind: 'focus', label: 'Brief', rendererViewId: 'focus' },
      { id: 'mode-review', kind: 'review', label: 'Review', rendererViewId: 'review' }
    ],
    name: spec.title,
    recommendations: [
      {
        evidenceItemIds: spec.evidence.map((item) => item.id),
        id: 'approve-evidence-brief',
        rank: 1,
        rationale: 'Approve the brief as the current shared explanation of the vision.',
        status: 'active',
        title: 'Record this evidence brief',
        tradeoff: 'Approval records knowledge but does not execute external work.',
        uncertainty: 'The brief must evolve as new proving builds change the evidence.'
      }
    ],
    rendererId: 'evidence-brief-v1',
    tags: lineage.tags
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const initialState: EvidenceBriefRenderState = {
    artifactRevision: 1,
    evidence: spec.sharedLineage ? evidence : { ...evidence, revision: 1 },
    intent: spec.sharedLineage ? intent : { ...intent, revision: 1 },
    spec,
    surface: predictedSurface,
    workspaceRevision: workspace.revision + 1
  }
  const rendered = renderEvidenceBrief(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `${spec.subject} · Evidence brief`,
    initialWorkflow: {
      changeSet: null,
      name: 'Brief review',
      origin: null,
      relation: 'root',
      review: null,
      status: 'in-review'
    }
  })
  const surface = createSurfaceRun(context, {
    ...provisionalSurface,
    alternativesConsidered: provisionalSurface.form.alternativesConsidered,
    artifact: artifactRef(board, provisionalSurface.id, rendered.sourceHash),
    formKind: provisionalSurface.form.kind,
    formRationale: provisionalSurface.form.rationale
  })
  const relations = [
    createWorkspaceRelation({
      id: `relation_${evidenceBriefStablePart(spec.id)}-intent`,
      relationType: 'fulfills-intent',
      sourceId: surface.id,
      targetId: intent.id,
      workspaceId: workspace.id
    }),
    createWorkspaceRelation({
      id: `relation_${evidenceBriefStablePart(spec.id)}-evidence`,
      relationType: 'uses-evidence',
      sourceId: surface.id,
      targetId: evidence.id,
      workspaceId: workspace.id
    }),
    ...(primarySurface
      ? [
          createWorkspaceRelation({
            id: `relation_${evidenceBriefStablePart(spec.id)}-companion`,
            relationType: 'companion-view-of',
            sourceId: surface.id,
            targetId: primarySurface.id,
            workspaceId: workspace.id
          })
        ]
      : [])
  ]
  workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: `evidence-brief-create-${evidenceBriefStablePart(spec.id)}`,
    operations: [
      ...lineage.createOperations,
      { object: surface, type: 'create-object' },
      ...relations.map((relation) => ({ relation, type: 'connect-relation' as const }))
    ]
  }).workspace
  const createdSurface = surfaceFor(workspace, surface.id)
  bindWorkspaceObjectToSceneNode(store.graph, board, createdSurface, reviewView(workspace))
  await persist(store)
  await focusBoard(store, board)
  return {
    boardId: board.id,
    created: true,
    formRationale: createdSurface.formChoice.rationale,
    surfaceRunId: createdSurface.id
  }
}

export async function applyEvidenceBriefEvent(
  store: EditorStore,
  event: EvidenceBriefEventRequest
): Promise<EvidenceBriefEventResult> {
  try {
    let workspace = canonicalWorkspace(store)
    const surface = surfaceFor(workspace, event.surfaceRunId)
    const board = boardForSurface(store, surface)
    const spec = specForBoard(board)
    if (surface.interactions.some((interaction) => interaction.id === event.eventId)) {
      return {
        eventId: event.eventId,
        receiptId: receiptFor(workspace, surface.id)?.id,
        state: stateFor(workspace, surface, spec),
        status: 'replayed'
      }
    }
    if (surface.status === 'decided') {
      throw new WorkspaceDomainError('permission_denied', `surface ${surface.id} is decided`)
    }
    if (
      workspace.revision !== event.expected.workspaceRevision ||
      surface.revision !== event.expected.surfaceRevision ||
      htmlBoardDocument(board).revision !== event.expected.artifactRevision
    ) {
      throw new WorkspaceDomainError(
        'revision_conflict',
        'evidence brief event was based on a stale workspace, surface, or artifact revision'
      )
    }
    const interaction: SurfaceInteraction = {
      action: 'approve',
      actorId: event.actorId,
      basis: {
        artifactRevision: event.expected.artifactRevision,
        surfaceRevision: event.expected.surfaceRevision
      },
      id: event.eventId,
      note: event.note,
      occurredAt: new Date().toISOString(),
      recommendationId: surface.recommendations[0]?.id
    }
    const interactions = [...surface.interactions, interaction]
    const recommendations = surface.recommendations.map((recommendation) => ({
      ...recommendation,
      status: 'preferred' as const
    }))
    const predictedArtifactRevision = htmlBoardDocument(board).revision + 2
    const predictedSurface: SurfaceRun = {
      ...surface,
      interactions,
      recommendations,
      revision: surface.revision + 1,
      status: 'decided'
    }
    const predictedState = stateFor(workspace, predictedSurface, spec)
    predictedState.artifactRevision = predictedArtifactRevision
    predictedState.workspaceRevision = workspace.revision + 1
    const rendered = renderEvidenceBrief(predictedState)
    const finalArtifact = {
      artifactId: surface.id,
      boardId: board.id,
      boardRevision: predictedArtifactRevision,
      boardSchemaVersion: HTML_BOARD_SCHEMA_VERSION,
      kind: 'html-board' as const,
      sourceHash: rendered.sourceHash
    }
    if (
      !updateHtmlBoardFrame(
        store,
        board.id,
        rendered.html,
        rendered.css,
        rendered.js,
        'Evidence brief · approve'
      )
    ) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'evidence brief did not update')
    }
    if (!approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'evidence brief did not approve')
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'evidence brief revision differed from the predicted receipt revision'
      )
    }
    const receiptId = `decision-receipt_${event.eventId}`
    const receipt = createDecisionReceipt(
      createWorkspaceContext(workspace, {
        provenance: { actorId: event.actorId, kind: 'user' }
      }),
      {
        artifact: finalArtifact,
        corrections: interactions,
        evidenceManifest: surface.evidenceManifest,
        id: receiptId,
        intent: surface.intent,
        outcome: {
          actorId: event.actorId,
          decidedAt: interaction.occurredAt,
          finalOrder: recommendations.map((recommendation) => recommendation.id),
          note: event.note,
          rejectedRecommendationIds: [],
          selectedRecommendationIds: recommendations.map((recommendation) => recommendation.id),
          status: 'approved'
        },
        surfaceRun: { objectId: surface.id, revision: surface.revision + 1 }
      }
    )
    workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: event.eventId,
      operations: [
        {
          expectedObjectRevision: surface.revision,
          objectId: surface.id,
          objectType: 'surface-run',
          patch: { artifact: finalArtifact, interactions, recommendations, status: 'decided' },
          type: 'update-object'
        },
        { object: receipt, type: 'create-object' }
      ]
    }).workspace
    bindWorkspaceObjectToSceneNode(
      store.graph,
      finalBoard,
      surfaceFor(workspace, surface.id),
      reviewView(workspace)
    )
    await persist(store)
    const committedSurface = surfaceFor(workspace, surface.id)
    return {
      eventId: event.eventId,
      receiptId,
      state: stateFor(workspace, committedSurface, spec),
      status: 'applied'
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'unknown evidence brief error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructEvidenceBriefReceipt(
  store: EditorStore,
  receiptId: string
): EvidenceBriefRenderState {
  const workspace = canonicalWorkspace(store)
  if (!Object.hasOwn(workspace.objects, receiptId)) {
    throw new WorkspaceDomainError('not_found', `decision receipt ${receiptId}`)
  }
  const object = workspace.objects[receiptId]
  if (object.type !== 'decision-receipt') {
    throw new WorkspaceDomainError('not_found', `decision receipt ${receiptId}`)
  }
  const surface = surfaceFor(workspace, object.surfaceRun.objectId)
  if (surface.revision !== object.surfaceRun.revision || surface.status !== 'decided') {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `surface ${surface.id} no longer matches receipt ${receiptId}`
    )
  }
  referencedObject(workspace, object.intent, 'intent-record')
  referencedObject(workspace, object.evidenceManifest, 'evidence-manifest')
  const board = boardForSurface(store, surface)
  const revision = htmlBoardRevision(board, object.artifact.boardRevision)
  if (
    !revision ||
    revision.artifact?.artifactId !== object.artifact.artifactId ||
    revision.artifact.sourceHash !== object.artifact.sourceHash ||
    object.artifact.boardSchemaVersion !== HTML_BOARD_SCHEMA_VERSION
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `artifact revision for receipt ${receiptId} is unavailable or does not match`
    )
  }
  return stateFor(workspace, surface, specForBoard(board), object)
}
