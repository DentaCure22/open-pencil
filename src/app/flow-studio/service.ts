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
  createCollection,
  createCollectionRecord,
  createDecisionReceipt,
  createDesignArtifact,
  createEvidenceManifest,
  createIntentRecord,
  createLiveAppBlock,
  createReviewObject,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceRelation,
  createWorkspaceView,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type DecisionReceipt,
  type DecisionRecommendation,
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

import { FLOW_STUDIO_RECOMMENDATIONS, FLOW_STUDIO_SPEC } from './fixture'
import { renderFlowStudioSurface } from './render'
import type {
  FlowStudioCreationResult,
  FlowStudioEventRequest,
  FlowStudioEventResult,
  FlowStudioObjectRefs,
  FlowStudioRenderState,
  FlowStudioSpec
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

function stablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) throw new WorkspaceDomainError('validation_failed', 'flow studio id is required')
  return result.slice(0, 80)
}

function idsFor(spec: FlowStudioSpec) {
  const id = stablePart(spec.id)
  return {
    board: `html-board_${id}`,
    evidenceManifest: `evidence-manifest_${id}`,
    intent: `intent-record_${id}`,
    review: `review-object_${id}`,
    sourceBlock: `live-app-block_${id}-source`,
    surface: `surface-run_${id}`,
    taskCollection: `collection_${id}-tasks`
  }
}

function objectRefsFor(spec: FlowStudioSpec): FlowStudioObjectRefs {
  const ids = idsFor(spec)
  return {
    comparisonReviewId: ids.review,
    optionArtifactIds: spec.options.map(
      (option) => `design-artifact_${stablePart(spec.id)}-${stablePart(option.id)}`
    ),
    sourceBlockId: ids.sourceBlock,
    taskCollectionId: ids.taskCollection,
    taskRecordIds: spec.tasks.map(
      (task) => `collection-record_${stablePart(spec.id)}-${stablePart(task.id)}`
    )
  }
}

export function parseFlowStudioEvent(value: unknown): FlowStudioEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected)) return null
  const action = stringProperty(value.action, 16)
  if (!['approve', 'prefer', 'unprefer'].includes(action)) return null
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const artifactRevision = integerProperty(value.expected.artifactRevision)
  const surfaceRevision = integerProperty(value.expected.surfaceRevision)
  const workspaceRevision = integerProperty(value.expected.workspaceRevision)
  const recommendationId = stringProperty(value.recommendationId, 120) || undefined
  if (
    !eventId ||
    !surfaceRunId ||
    artifactRevision === null ||
    surfaceRevision === null ||
    workspaceRevision === null ||
    artifactRevision < 1 ||
    surfaceRevision < 1 ||
    workspaceRevision < 1 ||
    (action !== 'approve' && !recommendationId)
  ) {
    return null
  }
  return {
    action: action as FlowStudioEventRequest['action'],
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected: { artifactRevision, surfaceRevision, workspaceRevision },
    note: stringProperty(value.note, 180) || undefined,
    recommendationId,
    surfaceRunId
  }
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

function ensureExperienceViews(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
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
    idempotencyKey: 'flow-studio-ensure-views-v1',
    operations
  }).workspace
}

function reviewView(workspace: KnowledgeWorkspace): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === 'review'
  )
  if (!view) throw new WorkspaceDomainError('not_found', 'flow studio review view')
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
  const object = workspace.objects[surfaceId]
  if (!object || object.type !== 'surface-run') {
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
  const object = workspace.objects[reference.objectId]
  if (!object || object.type !== objectType || object.revision !== reference.revision) {
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

function specForBoard(board: SceneNode): FlowStudioSpec {
  const source = htmlBoardDocument(board).artifact?.source
  if (!source)
    throw new WorkspaceDomainError('reconstruction_conflict', 'flow studio source missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new WorkspaceDomainError('reconstruction_conflict', 'flow studio source is invalid')
  }
  const spec = isRecord(parsed) ? parsed.spec : null
  if (
    !isRecord(spec) ||
    !stringProperty(spec.id, 100) ||
    !Array.isArray(spec.options) ||
    !Array.isArray(spec.evidence) ||
    !Array.isArray(spec.views)
  ) {
    throw new WorkspaceDomainError('reconstruction_conflict', 'flow studio spec is unavailable')
  }
  return spec as unknown as FlowStudioSpec
}

function stateFor(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: FlowStudioSpec,
  receipt = receiptFor(workspace, surface.id)
): FlowStudioRenderState {
  return {
    artifactRevision: surface.artifact.boardRevision,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    objectRefs: objectRefsFor(spec),
    options: structuredClone(surface.recommendations),
    receipt,
    spec,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function flowStudioStateForBoard(
  store: EditorStore,
  board: SceneNode
): FlowStudioRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'flow-studio-surface') return null
  const workspace = canonicalWorkspace(store)
  const object = workspace.objects[artifact.artifactId]
  if (!object || object.type !== 'surface-run') return null
  return stateFor(workspace, object, specForBoard(board))
}

async function focusBoard(store: EditorStore, board: SceneNode): Promise<void> {
  if (board.parentId && board.parentId !== store.state.currentPageId) {
    await store.switchPage(board.parentId)
  }
  store.select([board.id])
  if (typeof window !== 'undefined') store.zoomToSelection(htmlBoardViewportInsets())
}

function createSupportingObjects(
  spec: FlowStudioSpec,
  context: ReturnType<typeof createWorkspaceContext>
) {
  const ids = idsFor(spec)
  const refs = objectRefsFor(spec)
  const taskRecords = spec.tasks.map((task, index) =>
    createCollectionRecord(context, {
      collectionId: ids.taskCollection,
      id: refs.taskRecordIds[index],
      properties: { status: task.status },
      tags: ['flow-studio', 'task'],
      title: task.title
    })
  )
  const taskCollection = createCollection(context, {
    description: 'Tasks sharing one identity with the flow clarification run.',
    id: ids.taskCollection,
    name: 'Tasks and roadmap',
    properties: [
      {
        id: 'status',
        label: 'Status',
        options: [
          { color: 'green', id: 'done', label: 'Done' },
          { color: 'amber', id: 'in-progress', label: 'In progress' },
          { color: 'gray', id: 'todo', label: 'Todo' }
        ],
        type: 'status'
      }
    ],
    recordIds: refs.taskRecordIds,
    tags: ['flow-studio']
  })
  const sourceBlock = createLiveAppBlock(context, {
    applicationId: spec.source.applicationId,
    capture: {
      assetRef: `reference://${stablePart(spec.id)}/source`,
      capturedAt: spec.capturedAt,
      maskedFieldIds: [],
      provenance: 'illustrative',
      sourceRevision: spec.source.sourceRevision
    },
    environment: spec.source.environment,
    id: ids.sourceBlock,
    route: spec.source.route,
    runtime: { status: 'illustrative-preview' },
    scenarioId: spec.source.scenarioId,
    sourceRevision: spec.source.sourceRevision,
    tags: ['flow-studio', 'source-reference'],
    viewport: { height: 900, name: 'desktop', width: 1440 }
  })
  const optionArtifacts = spec.options.map((option, index) =>
    createDesignArtifact(context, {
      artifactKind: 'responsive-state',
      data: { optionId: option.id, order: index + 1, sourceChanged: false },
      id: refs.optionArtifactIds[index],
      label: option.title,
      ownership: 'preview-branch',
      sourceRef: `preview://${stablePart(spec.id)}/${stablePart(option.id)}`,
      tags: ['flow-studio', 'alternative']
    })
  )
  const comparisonReview = createReviewObject(context, {
    attachedObjectIds: refs.optionArtifactIds,
    attachedRevisions: Object.fromEntries(refs.optionArtifactIds.map((id) => [id, 1])),
    body: 'Compare visible structure and recovery behavior; do not evaluate production implementation.',
    id: ids.review,
    reviewKind: 'comparison',
    reviewStatus: 'open',
    tags: ['flow-studio']
  })
  return { comparisonReview, optionArtifacts, sourceBlock, taskCollection, taskRecords }
}

export async function createFlowStudioSurface(
  store: EditorStore,
  spec: FlowStudioSpec = FLOW_STUDIO_SPEC
): Promise<FlowStudioCreationResult> {
  const ids = idsFor(spec)
  let workspace = ensureExperienceViews(canonicalWorkspace(store))
  const existing = workspace.objects[ids.surface]
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
      'flow studio board exists without its canonical surface object'
    )
  }
  const rendererRationale = explicitRendererRationale('Comparison')
  const context = createWorkspaceContext(workspace, {
    now: spec.capturedAt,
    provenance: { actorId: 'openpencil-experience-setup', kind: 'agent' }
  })
  const intent = createIntentRecord(context, {
    capturedAt: spec.capturedAt,
    constraints: spec.intent.constraints,
    desiredOutcome: spec.intent.desiredOutcome,
    id: ids.intent,
    statement: spec.intent.statement,
    tags: ['flow-studio']
  })
  const evidence = createEvidenceManifest(context, {
    id: ids.evidenceManifest,
    intent: { objectId: intent.id, revision: 1 },
    items: spec.evidence,
    snapshotAt: spec.capturedAt,
    status: 'ready',
    tags: ['flow-studio']
  })
  const supporting = createSupportingObjects(spec, context)
  const refs = objectRefsFor(spec)
  const objectBindings = [
    { objectId: intent.id, revision: 1 },
    { objectId: evidence.id, revision: 1 },
    { objectId: supporting.sourceBlock.id, revision: 1 },
    { objectId: supporting.taskCollection.id, revision: 1 },
    { objectId: supporting.comparisonReview.id, revision: 1 },
    ...supporting.taskRecords.map((object) => ({ objectId: object.id, revision: 1 })),
    ...supporting.optionArtifacts.map((object) => ({ objectId: object.id, revision: 1 }))
  ]
  const modes = spec.views.map((kind) => ({
    id: `mode-${kind}`,
    kind,
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
    rendererViewId: kind
  }))
  const viewIds = Object.values(workspace.views).map((view) => view.id)
  const provisionalSurface = createSurfaceRun(context, {
    alternativesConsidered: ['brief-v1', 'weekly-decision-v1', 'flow-clarification-v1'],
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
      objectRefs: objectBindings,
      viewIds
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formChoice: {
      consideredRendererIds: ['brief-v1', 'weekly-decision-v1', 'flow-clarification-v1'],
      rationale: rendererRationale
    },
    formKind: 'flow-studio',
    formRationale: rendererRationale,
    id: ids.surface,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: 'compare',
    modes,
    name: spec.title,
    recommendations:
      spec.options === FLOW_STUDIO_SPEC.options
        ? FLOW_STUDIO_RECOMMENDATIONS
        : spec.options.map((option, index) => ({
            evidenceItemIds: option.evidenceItemIds,
            id: option.id,
            rank: index + 1,
            rationale: option.summary,
            status: 'active' as const,
            title: option.title,
            tradeoff: option.tradeoff,
            uncertainty: option.uncertainty
          })),
    rendererId: 'flow-clarification-v1',
    tags: ['flow-studio']
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const initialState: FlowStudioRenderState = {
    artifactRevision: 1,
    evidence: { ...evidence, revision: 1 },
    intent: { ...intent, revision: 1 },
    objectRefs: refs,
    options: structuredClone(provisionalSurface.recommendations),
    spec,
    surface: predictedSurface,
    workspaceRevision: workspace.revision + 1
  }
  const rendered = renderFlowStudioSurface(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `${spec.subject} · Experience setup`,
    initialWorkflow: {
      changeSet: null,
      name: 'Experience review',
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
    }),
    createWorkspaceRelation({
      id: `relation_${stablePart(spec.id)}-source`,
      relationType: 'focuses-target',
      sourceId: surface.id,
      targetId: supporting.sourceBlock.id,
      workspaceId: workspace.id
    }),
    ...supporting.optionArtifacts.map((option, index) =>
      createWorkspaceRelation({
        id: `relation_${stablePart(spec.id)}-option-${index + 1}`,
        relationType: 'branches-from',
        sourceId: option.id,
        targetId: supporting.sourceBlock.id,
        workspaceId: workspace.id
      })
    )
  ]
  workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: `flow-studio-create-${stablePart(spec.id)}`,
    operations: [
      { object: intent, type: 'create-object' },
      { object: evidence, type: 'create-object' },
      { object: supporting.taskCollection, type: 'create-object' },
      ...supporting.taskRecords.map((object) => ({ object, type: 'create-object' as const })),
      { object: supporting.sourceBlock, type: 'create-object' },
      ...supporting.optionArtifacts.map((object) => ({ object, type: 'create-object' as const })),
      { object: supporting.comparisonReview, type: 'create-object' },
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
    formRationale: rendererRationale,
    surfaceRunId: createdSurface.id
  }
}

function recommendationsForEvent(
  surface: SurfaceRun,
  event: FlowStudioEventRequest
): DecisionRecommendation[] {
  const recommendations = structuredClone(surface.recommendations)
  if (event.action === 'approve') {
    if (!recommendations.some((item) => item.status === 'preferred')) {
      throw new WorkspaceDomainError('validation_failed', 'choose a preferred option first')
    }
    return recommendations
  }
  const index = recommendations.findIndex((item) => item.id === event.recommendationId)
  if (index === -1) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `unknown option ${event.recommendationId ?? ''}`
    )
  }
  if (event.action === 'prefer') {
    return recommendations.map((recommendation) => ({
      ...recommendation,
      status: recommendation.id === event.recommendationId ? 'preferred' : 'active'
    }))
  }
  return recommendations.map((recommendation) => ({ ...recommendation, status: 'active' }))
}

function interactionFor(event: FlowStudioEventRequest, surface: SurfaceRun): SurfaceInteraction {
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
    fromIndex: fromIndex >= 0 ? fromIndex : undefined,
    id: event.eventId,
    note: event.note,
    occurredAt: new Date().toISOString(),
    recommendationId: event.recommendationId
  }
}

function validateEventBasis(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  board: SceneNode,
  event: FlowStudioEventRequest
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
      'flow studio event was based on a stale workspace, surface, or artifact revision'
    )
  }
}

export async function applyFlowStudioEvent(
  store: EditorStore,
  event: FlowStudioEventRequest
): Promise<FlowStudioEventResult> {
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
    validateEventBasis(workspace, surface, board, event)
    const recommendations = recommendationsForEvent(surface, event)
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
    const predictedState = stateFor(workspace, predictedSurface, spec)
    predictedState.artifactRevision = predictedArtifactRevision
    predictedState.workspaceRevision = workspace.revision + 1
    const rendered = renderFlowStudioSurface(predictedState)
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
        `Flow studio · ${event.action}`
      )
    ) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'flow studio did not update')
    }
    if (approving && !approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'flow studio did not approve')
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'flow studio revision differed from the predicted receipt revision'
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
      const preferred = recommendations.find(
        (recommendation) => recommendation.status === 'preferred'
      )
      if (!preferred)
        throw new WorkspaceDomainError('validation_failed', 'preferred option missing')
      receiptId = `decision-receipt_${event.eventId}`
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
            rejectedRecommendationIds: recommendations
              .filter((recommendation) => recommendation.id !== preferred.id)
              .map((recommendation) => recommendation.id),
            selectedRecommendationIds: [preferred.id],
            status: 'approved'
          },
          surfaceRun: { objectId: surface.id, revision: surface.revision + 1 }
        }
      )
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
      state: stateFor(workspace, committedSurface, spec),
      status: 'applied'
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'unknown flow studio error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructFlowStudioReceipt(
  store: EditorStore,
  receiptId: string
): FlowStudioRenderState {
  const workspace = canonicalWorkspace(store)
  const object = workspace.objects[receiptId]
  if (!object || object.type !== 'decision-receipt') {
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
