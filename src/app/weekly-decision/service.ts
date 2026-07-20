import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  HTML_BOARD_SCHEMA_VERSION,
  approveHtmlBoardDecisionSurface,
  htmlBoardDocument,
  htmlBoardRevision,
  isHtmlBoardFrame,
  updateHtmlBoardFrame
} from '@/app/html-board/workspace'
import {
  WorkspaceDomainError,
  createDecisionReceipt,
  createWorkspaceContext,
  mutateKnowledgeWorkspace,
  type DecisionReceipt,
  type DecisionRecommendation,
  type KnowledgeWorkspace,
  type SurfaceInteraction,
  type SurfaceRun,
  type WorkspaceObjectRevisionRef,
  type WorkspaceOperation
} from '@/app/workspace'
import { bindWorkspaceObjectToSceneNode } from '@/app/workspace-ui/projection'

import { boardForSurface, canonicalWorkspace, persist, reviewView, surfaceFor } from './context'
import { renderWeeklyDecisionSurface } from './render'
import type {
  WeeklyDecisionEventRequest,
  WeeklyDecisionEventResult,
  WeeklyDecisionRenderState
} from './types'

const WEEKLY_DECISION_EVENT_ACTIONS = new Set([
  'approve',
  'prefer',
  'reject',
  'reorder',
  'restore',
  'revise',
  'unprefer'
])

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

export function parseWeeklyDecisionEvent(value: unknown): WeeklyDecisionEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected)) return null
  const action = stringProperty(value.action, 16)
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const artifactRevision = integerProperty(value.expected.artifactRevision)
  const surfaceRevision = integerProperty(value.expected.surfaceRevision)
  const workspaceRevision = integerProperty(value.expected.workspaceRevision)
  if (
    !WEEKLY_DECISION_EVENT_ACTIONS.has(action) ||
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
  const recommendationId = stringProperty(value.recommendationId, 120) || undefined
  if (action !== 'approve' && !recommendationId) return null
  const toIndex = integerProperty(value.toIndex)
  if (action === 'reorder' && toIndex === null) return null
  return {
    action: action as WeeklyDecisionEventRequest['action'],
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected: { artifactRevision, surfaceRevision, workspaceRevision },
    note: stringProperty(value.note, 180) || undefined,
    recommendationId,
    surfaceRunId,
    toIndex: toIndex ?? undefined
  }
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

export function weeklyDecisionState(
  store: EditorStore,
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  receipt = receiptFor(workspace, surface.id)
): WeeklyDecisionRenderState {
  void store
  return {
    artifactRevision: surface.artifact.boardRevision,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    recommendations: structuredClone(surface.recommendations),
    receipt,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function weeklyDecisionStateForBoard(
  store: EditorStore,
  board: SceneNode
): WeeklyDecisionRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'weekly-decision-surface') return null
  const workspace = canonicalWorkspace(store)
  if (!Object.hasOwn(workspace.objects, artifact.artifactId)) return null
  const object = workspace.objects[artifact.artifactId]
  if (object.type !== 'surface-run') return null
  return weeklyDecisionState(store, workspace, object)
}

function applyRecommendationEvent(
  surface: SurfaceRun,
  event: WeeklyDecisionEventRequest
): DecisionRecommendation[] {
  const recommendations = structuredClone(surface.recommendations)
  if (event.action === 'approve') {
    if (
      surface.jobKind === 'compare' &&
      !recommendations.some((recommendation) => recommendation.status === 'preferred')
    ) {
      throw new WorkspaceDomainError(
        'validation_failed',
        'choose one preferred alternative before approving this comparison'
      )
    }
    return recommendations
  }
  const index = recommendations.findIndex((item) => item.id === event.recommendationId)
  if (index === -1) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `unknown recommendation ${event.recommendationId ?? ''}`
    )
  }
  if (event.action === 'prefer') {
    return recommendations.map((recommendation, rank) => ({
      ...recommendation,
      rank: rank + 1,
      status: recommendation.id === event.recommendationId ? 'preferred' : 'active'
    }))
  }
  if (event.action === 'unprefer') {
    return recommendations.map((recommendation, rank) => ({
      ...recommendation,
      rank: rank + 1,
      status: recommendation.status === 'preferred' ? 'active' : recommendation.status
    }))
  }
  if (event.action === 'reorder') {
    const target = event.toIndex ?? -1
    if (target < 0 || target >= recommendations.length) {
      throw new WorkspaceDomainError('validation_failed', `invalid target rank ${target}`)
    }
    const [moved] = recommendations.splice(index, 1)
    recommendations.splice(target, 0, moved)
  } else if (event.action === 'reject' || event.action === 'restore') {
    recommendations[index] = {
      ...recommendations[index],
      status: event.action === 'reject' ? 'rejected' : 'active'
    }
  } else if (event.action === 'revise') {
    if (!event.note)
      throw new WorkspaceDomainError('validation_failed', 'revision note is required')
    recommendations[index] = { ...recommendations[index], status: 'revised', title: event.note }
  }
  return recommendations.map((recommendation, rank) => ({ ...recommendation, rank: rank + 1 }))
}

function interactionFor(
  event: WeeklyDecisionEventRequest,
  surface: SurfaceRun
): SurfaceInteraction {
  const fromIndex = surface.recommendations.findIndex(
    (recommendation) => recommendation.id === event.recommendationId
  )
  return {
    action: event.action,
    actorId: event.actorId,
    basis: {
      artifactRevision: event.expected.artifactRevision,
      surfaceRevision: event.expected.surfaceRevision
    },
    fromIndex: fromIndex !== -1 ? fromIndex : undefined,
    id: event.eventId,
    note: event.note,
    occurredAt: new Date().toISOString(),
    recommendationId: event.recommendationId,
    toIndex: event.toIndex
  }
}

function validateEventBasis(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  board: SceneNode,
  event: WeeklyDecisionEventRequest
): void {
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
      'weekly decision event was based on a stale workspace, surface, or artifact revision'
    )
  }
}

function replayedResult(
  store: EditorStore,
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  eventId: string
): WeeklyDecisionEventResult {
  return {
    eventId,
    receiptId: receiptFor(workspace, surface.id)?.id,
    state: weeklyDecisionState(store, workspace, surface),
    status: 'replayed'
  }
}

export async function applyWeeklyDecisionEvent(
  store: EditorStore,
  event: WeeklyDecisionEventRequest
): Promise<WeeklyDecisionEventResult> {
  try {
    let workspace = canonicalWorkspace(store)
    const surface = surfaceFor(workspace, event.surfaceRunId)
    if (surface.interactions.some((interaction) => interaction.id === event.eventId)) {
      return replayedResult(store, workspace, surface, event.eventId)
    }
    const board = boardForSurface(store, surface)
    validateEventBasis(workspace, surface, board, event)
    const recommendations = applyRecommendationEvent(surface, event)
    const interaction = interactionFor(event, surface)
    const interactions = [...surface.interactions, interaction]
    const approving = event.action === 'approve'
    const predictedArtifactRevision = htmlBoardDocument(board).revision + (approving ? 2 : 1)
    const predictedSurface: SurfaceRun = {
      ...surface,
      interactions,
      recommendations,
      revision: surface.revision + 1,
      status: approving ? 'decided' : 'in-review'
    }
    const predictedState = weeklyDecisionState(store, workspace, predictedSurface)
    predictedState.artifactRevision = predictedArtifactRevision
    predictedState.workspaceRevision = workspace.revision + 1
    const rendered = renderWeeklyDecisionSurface(predictedState)
    const finalArtifact = {
      artifactId: surface.id,
      boardId: board.id,
      boardRevision: predictedArtifactRevision,
      boardSchemaVersion: HTML_BOARD_SCHEMA_VERSION,
      kind: 'html-board' as const,
      sourceHash: rendered.sourceHash
    }
    const updated = updateHtmlBoardFrame(
      store,
      board.id,
      rendered.html,
      rendered.css,
      rendered.js,
      `Weekly decision · ${event.action}`
    )
    if (!updated) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'HTML decision surface did not update'
      )
    }
    if (approving && !approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'HTML decision surface did not approve'
      )
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'HTML decision surface revision differed from the predicted receipt revision'
      )
    }

    const operations: WorkspaceOperation[] = [
      {
        expectedObjectRevision: surface.revision,
        objectId: surface.id,
        objectType: 'surface-run',
        patch: {
          artifact: finalArtifact,
          interactions,
          recommendations,
          status: approving ? 'decided' : 'in-review'
        },
        type: 'update-object'
      }
    ]
    let receiptId: string | undefined
    if (approving) {
      receiptId = `decision-receipt_${event.eventId}`
      const context = createWorkspaceContext(workspace, {
        provenance: { actorId: event.actorId, kind: 'user' }
      })
      const receipt = createDecisionReceipt(context, {
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
          rejectedRecommendationIds: recommendations
            .filter((recommendation) => recommendation.status === 'rejected')
            .map((recommendation) => recommendation.id),
          selectedRecommendationIds: recommendations
            .filter((recommendation) => recommendation.status !== 'rejected')
            .map((recommendation) => recommendation.id),
          status: 'approved'
        },
        surfaceRun: { objectId: surface.id, revision: surface.revision + 1 }
      })
      operations.push({ object: receipt, type: 'create-object' })
    }
    workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: event.eventId,
      operations
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
      state: weeklyDecisionState(store, workspace, committedSurface),
      status: 'applied'
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'unknown weekly decision error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructWeeklyDecisionReceipt(
  store: EditorStore,
  receiptId: string
): WeeklyDecisionRenderState {
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
  return weeklyDecisionState(store, workspace, surface, object)
}
