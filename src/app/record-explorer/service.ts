import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import {
  HTML_BOARD_SCHEMA_VERSION,
  approveHtmlBoardDecisionSurface,
  createHtmlBoardFrame,
  htmlBoardDocument,
  htmlBoardRevision,
  updateHtmlBoardFrame
} from '@/app/html-board/workspace'
import {
  WorkspaceDomainError,
  createDecisionReceipt,
  createEvidenceManifest,
  createIntentRecord,
  createSurfaceRun,
  createWorkspaceContext,
  mutateKnowledgeWorkspace,
  type DecisionRecommendation,
  type KnowledgeWorkspace,
  type SurfaceInteraction,
  type SurfaceRun,
  type WorkspaceOperation
} from '@/app/workspace'
import { bindWorkspaceObjectToSceneNode } from '@/app/workspace-ui/projection'

import {
  artifactRef,
  boardForSurface,
  canonicalWorkspace,
  ensureRecordExplorerViews,
  focusBoard,
  persist,
  surfaceFor,
  viewFor
} from './context'
import { recordExplorerStablePart, validateRecordExplorerSpec } from './model'
import { renderRecordExplorer } from './render'
import {
  explorerIds,
  explorerState,
  focusedRecordId,
  receiptFor,
  recommendationsFor,
  referencedObject,
  relationsFor,
  savedViewIdsFor,
  specForBoard,
  supportingObjects,
  workspaceWith
} from './state'
import type {
  RecordExplorerCreationResult,
  RecordExplorerEventRequest,
  RecordExplorerEventResult,
  RecordExplorerRenderState,
  RecordExplorerSpec
} from './types'

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

export function parseRecordExplorerEvent(value: unknown): RecordExplorerEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected)) return null
  const action = stringProperty(value.action, 20)
  if (!['activate-view', 'approve', 'focus-record'].includes(action)) return null
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const artifactRevision = integerProperty(value.expected.artifactRevision)
  const surfaceRevision = integerProperty(value.expected.surfaceRevision)
  const workspaceRevision = integerProperty(value.expected.workspaceRevision)
  const targetId = stringProperty(value.targetId, 160) || undefined
  if (
    !eventId ||
    !surfaceRunId ||
    artifactRevision === null ||
    surfaceRevision === null ||
    workspaceRevision === null ||
    artifactRevision < 1 ||
    surfaceRevision < 1 ||
    workspaceRevision < 1 ||
    (action !== 'approve' && !targetId)
  ) {
    return null
  }
  return {
    action: action as RecordExplorerEventRequest['action'],
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected: { artifactRevision, surfaceRevision, workspaceRevision },
    note: stringProperty(value.note, 180) || undefined,
    surfaceRunId,
    targetId
  }
}

export async function createRecordExplorer(
  store: EditorStore,
  spec: RecordExplorerSpec
): Promise<RecordExplorerCreationResult> {
  validateRecordExplorerSpec(spec)
  const ids = explorerIds(spec)
  let workspace = ensureRecordExplorerViews(canonicalWorkspace(store))
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
      'record explorer board exists without its canonical surface object'
    )
  }

  const context = createWorkspaceContext(workspace, {
    now: spec.capturedAt,
    provenance: { actorId: 'openpencil-experience-setup', kind: 'agent' }
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
  const { collection, records, savedViews } = supportingObjects(spec, context)
  const canvasView = viewFor(workspace, 'canvas')
  const overviewView = viewFor(workspace, 'graph')
  const reviewView = viewFor(workspace, 'review')
  const objectRefs = [intent, evidence, collection, ...records, ...savedViews].map((object) => ({
    objectId: object.id,
    revision: 1
  }))
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
    bindings: {
      evidenceItemIds: spec.evidence.map((item) => item.id),
      objectRefs,
      viewIds: [overviewView.id, canvasView.id, reviewView.id]
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formChoice: spec.formChoice,
    formKind: 'record-explorer',
    formRationale:
      spec.formChoice?.rationale ??
      'Repeated records, declared filters, and triage require an executable saved-view surface.',
    id: ids.surface,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: 'triage',
    modes: [
      {
        id: 'mode-overview',
        kind: 'overview',
        label: 'Overview',
        rendererViewId: 'overview',
        viewId: overviewView.id
      },
      {
        id: 'mode-focus',
        kind: 'focus',
        label: 'Focus',
        rendererViewId: 'focus',
        viewId: canvasView.id
      },
      {
        id: 'mode-review',
        kind: 'review',
        label: 'Review',
        rendererViewId: 'review',
        viewId: reviewView.id
      }
    ],
    name: spec.title,
    recommendations: recommendationsFor(spec),
    rendererId: 'record-explorer-v1'
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const predictedWorkspace = workspaceWith(workspace, [
    { ...intent, revision: 1 },
    { ...evidence, revision: 1 },
    { ...collection, revision: 1 },
    ...records.map((record) => ({ ...record, revision: 1 })),
    ...savedViews.map((view) => ({ ...view, revision: 1 })),
    predictedSurface
  ])
  const initialState = explorerState(predictedWorkspace, predictedSurface, spec)
  initialState.artifactRevision = 1
  initialState.workspaceRevision = workspace.revision + 1
  const rendered = renderRecordExplorer(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `Record explorer · ${spec.title}`,
    initialWorkflow: {
      changeSet: null,
      name: 'Record explorer review',
      origin: null,
      relation: 'root',
      review: null,
      status: 'in-review'
    }
  })
  const surface = createSurfaceRun(context, {
    alternativesConsidered: provisionalSurface.form.alternativesConsidered,
    artifact: artifactRef(board, provisionalSurface.id, rendered.sourceHash),
    bindings: provisionalSurface.bindings,
    evidenceManifest: provisionalSurface.evidenceManifest,
    formChoice: provisionalSurface.formChoice,
    formKind: provisionalSurface.form.kind,
    formRationale: provisionalSurface.form.rationale,
    id: provisionalSurface.id,
    intent: provisionalSurface.intent,
    jobKind: provisionalSurface.jobKind,
    modes: provisionalSurface.modes,
    name: provisionalSurface.name,
    recommendations: provisionalSurface.recommendations,
    rendererId: provisionalSurface.rendererId
  })
  const relations = relationsFor(spec, workspace.id)
  workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: `record-explorer-create-${recordExplorerStablePart(spec.id)}`,
    operations: [
      { object: intent, type: 'create-object' },
      { object: evidence, type: 'create-object' },
      { object: collection, type: 'create-object' },
      ...records.map((object) => ({ object, type: 'create-object' as const })),
      ...savedViews.map((object) => ({ object, type: 'create-object' as const })),
      { object: surface, type: 'create-object' },
      ...relations.map((relation) => ({ relation, type: 'connect-relation' as const }))
    ]
  }).workspace
  const createdSurface = surfaceFor(workspace, surface.id)
  bindWorkspaceObjectToSceneNode(store.graph, board, createdSurface, reviewView)
  await persist(store)
  await focusBoard(store, board)
  return {
    boardId: board.id,
    created: true,
    formRationale: createdSurface.formChoice.rationale,
    surfaceRunId: createdSurface.id
  }
}

function validateEventBasis(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  board: SceneNode,
  event: RecordExplorerEventRequest
): void {
  if (surface.status === 'decided') {
    throw new WorkspaceDomainError('permission_denied', `surface ${surface.id} is decided`)
  }
  if (
    event.expected.workspaceRevision > workspace.revision ||
    surface.revision !== event.expected.surfaceRevision ||
    htmlBoardDocument(board).revision !== event.expected.artifactRevision
  ) {
    throw new WorkspaceDomainError(
      'revision_conflict',
      `record explorer event expected workspace ${event.expected.workspaceRevision}, surface ${event.expected.surfaceRevision}, artifact ${event.expected.artifactRevision}; current workspace ${workspace.revision}, surface ${surface.revision}, artifact ${htmlBoardDocument(board).revision}`
    )
  }
}

function interactionFor(event: RecordExplorerEventRequest): SurfaceInteraction {
  let inputId: string | undefined
  if (event.action === 'activate-view') inputId = 'active-view'
  else if (event.action === 'focus-record') inputId = 'focused-record'
  return {
    action: event.action === 'approve' ? 'approve' : 'adjust',
    actorId: event.actorId,
    basis: {
      artifactRevision: event.expected.artifactRevision,
      surfaceRevision: event.expected.surfaceRevision
    },
    id: event.eventId,
    inputId,
    note: event.note,
    occurredAt: new Date().toISOString(),
    value: event.targetId
  }
}

function validateEventTarget(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: RecordExplorerSpec,
  event: RecordExplorerEventRequest
): void {
  if (event.action === 'activate-view') {
    if (!savedViewIdsFor(spec).includes(event.targetId ?? '')) {
      throw new WorkspaceDomainError('validation_failed', `unknown saved view ${event.targetId}`)
    }
    return
  }
  const state = explorerState(workspace, surface, spec)
  if (event.action === 'focus-record') {
    if (!state.records.some((record) => record.id === event.targetId)) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `record ${event.targetId} is outside the active saved view`
      )
    }
  } else if (!state.focusedRecordId) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'select a record before recording triage knowledge'
    )
  }
}

function recommendationsAfter(
  surface: SurfaceRun,
  focusedId: string | undefined,
  approving: boolean
): DecisionRecommendation[] {
  if (!approving) return structuredClone(surface.recommendations)
  return surface.recommendations.map((recommendation) => ({
    ...recommendation,
    status: recommendation.id.endsWith(focusedId ?? '') ? 'preferred' : 'active'
  }))
}

function replayedResult(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: RecordExplorerSpec,
  eventId: string
): RecordExplorerEventResult {
  return {
    eventId,
    receiptId: receiptFor(workspace, surface.id)?.id,
    state: explorerState(workspace, surface, spec),
    status: 'replayed'
  }
}

export async function applyRecordExplorerEvent(
  store: EditorStore,
  event: RecordExplorerEventRequest
): Promise<RecordExplorerEventResult> {
  try {
    let workspace = canonicalWorkspace(store)
    const surface = surfaceFor(workspace, event.surfaceRunId)
    const board = boardForSurface(store, surface)
    const spec = specForBoard(board)
    if (surface.interactions.some((interaction) => interaction.id === event.eventId)) {
      return replayedResult(workspace, surface, spec, event.eventId)
    }
    validateEventBasis(workspace, surface, board, event)
    validateEventTarget(workspace, surface, spec, event)
    const interaction = interactionFor(event)
    const interactions = [...surface.interactions, interaction]
    const approving = event.action === 'approve'
    const predictedArtifactRevision = htmlBoardDocument(board).revision + (approving ? 2 : 1)
    const predictedFocused =
      event.action === 'focus-record' ? event.targetId : focusedRecordId(surface)
    const recommendations = recommendationsAfter(surface, predictedFocused, approving)
    const predictedSurface: SurfaceRun = {
      ...surface,
      interactions,
      recommendations,
      revision: surface.revision + 1,
      status: approving ? 'decided' : 'in-review'
    }
    const predictedState = explorerState(workspace, predictedSurface, spec)
    predictedState.artifactRevision = predictedArtifactRevision
    predictedState.workspaceRevision = workspace.revision + 1
    const rendered = renderRecordExplorer(predictedState)
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
        `Record explorer · ${event.action}`
      )
    ) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'record explorer HTML surface did not update'
      )
    }
    if (approving && !approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'record explorer HTML surface did not approve'
      )
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'record explorer revision differed from its predicted receipt revision'
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
      const focusedId = predictedState.focusedRecordId
      const selected = recommendations.find((recommendation) =>
        recommendation.id.endsWith(focusedId ?? '')
      )
      if (!focusedId || !selected) {
        throw new WorkspaceDomainError('validation_failed', 'focused record is unavailable')
      }
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
          rejectedRecommendationIds: [],
          selectedRecommendationIds: recommendations.map((recommendation) => recommendation.id),
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
    const committedSurface = surfaceFor(workspace, surface.id)
    bindWorkspaceObjectToSceneNode(
      store.graph,
      finalBoard,
      committedSurface,
      viewFor(workspace, 'review')
    )
    await persist(store)
    return {
      eventId: event.eventId,
      receiptId,
      state: explorerState(workspace, committedSurface, spec),
      status: 'applied'
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'unknown record explorer error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructRecordExplorerReceipt(
  store: EditorStore,
  receiptId: string
): RecordExplorerRenderState {
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
  return explorerState(workspace, surface, specForBoard(board), object)
}
