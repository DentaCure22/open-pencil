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
  createEvidenceManifest,
  createIntentRecord,
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

import { SEQUENTIAL_PRESENTATION_SPEC } from './fixture'
import { renderSequentialPresentation } from './render'
import type {
  SequentialPresentationCreationResult,
  SequentialPresentationEventRequest,
  SequentialPresentationEventResult,
  SequentialPresentationRenderState,
  SequentialPresentationSpec
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
  if (!result) {
    throw new WorkspaceDomainError('validation_failed', 'sequential presentation id is required')
  }
  return result.slice(0, 80)
}

function idsFor(spec: SequentialPresentationSpec) {
  const id = stablePart(spec.id)
  return {
    board: `html-board_${id}`,
    evidenceManifest: `evidence-manifest_${id}`,
    intent: `intent-record_${id}`,
    surface: `surface-run_${id}`
  }
}

function validateSpec(spec: SequentialPresentationSpec): void {
  if (spec.slides.length < 2 || spec.slides.length > 8) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'sequential presentation requires between two and eight slides'
    )
  }
  const slideIds = spec.slides.map((slide) => slide.id)
  if (new Set(slideIds).size !== slideIds.length || slideIds.some((id) => !id)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      'sequential presentation slide ids must be unique'
    )
  }
  const evidenceIds = new Set(spec.evidence.map((item) => item.id))
  for (const slide of spec.slides) {
    if (!slide.title || !slide.body || slide.evidenceItemIds.length === 0) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `presentation slide ${slide.id} requires a title, body, and evidence`
      )
    }
    if (slide.evidenceItemIds.some((id) => !evidenceIds.has(id))) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `presentation slide ${slide.id} cites evidence outside its manifest`
      )
    }
  }
  if (spec.slides.at(-1)?.layout !== 'closing') {
    throw new WorkspaceDomainError(
      'validation_failed',
      'sequential presentation must end with a closing review slide'
    )
  }
}

export function parseSequentialPresentationEvent(
  value: unknown
): SequentialPresentationEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected)) return null
  const action = stringProperty(value.action, 16)
  if (action !== 'approve' && action !== 'navigate') return null
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const artifactRevision = integerProperty(value.expected.artifactRevision)
  const surfaceRevision = integerProperty(value.expected.surfaceRevision)
  const workspaceRevision = integerProperty(value.expected.workspaceRevision)
  const targetSlideId = stringProperty(value.targetSlideId, 120) || undefined
  if (
    !eventId ||
    !surfaceRunId ||
    artifactRevision === null ||
    surfaceRevision === null ||
    workspaceRevision === null ||
    artifactRevision < 1 ||
    surfaceRevision < 1 ||
    workspaceRevision < 1 ||
    (action === 'navigate' && !targetSlideId)
  ) {
    return null
  }
  return {
    action,
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected: { artifactRevision, surfaceRevision, workspaceRevision },
    note: stringProperty(value.note, 240) || undefined,
    surfaceRunId,
    targetSlideId
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

function ensureViews(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
  const required = [
    { kind: 'canvas' as const, name: 'Presentation', primary: true },
    { kind: 'review' as const, name: 'Presentation review', primary: false }
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
    idempotencyKey: 'sequential-presentation-ensure-views-v1',
    operations
  }).workspace
}

function reviewView(workspace: KnowledgeWorkspace): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === 'review'
  )
  if (!view) throw new WorkspaceDomainError('not_found', 'sequential presentation review view')
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
  if (object.rendererId !== 'sequential-presentation-v1') {
    throw new WorkspaceDomainError(
      'scope_conflict',
      `surface run ${surfaceId} is not a sequential presentation`
    )
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

function specForBoard(board: SceneNode): SequentialPresentationSpec {
  const source = htmlBoardDocument(board).artifact?.source
  if (!source) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'sequential presentation source is missing'
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'sequential presentation source is invalid'
    )
  }
  const spec = isRecord(parsed) ? parsed.spec : null
  if (
    !isRecord(spec) ||
    !stringProperty(spec.id, 100) ||
    !Array.isArray(spec.slides) ||
    !Array.isArray(spec.evidence) ||
    !isRecord(spec.intent) ||
    !isRecord(spec.review)
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'sequential presentation spec is unavailable'
    )
  }
  const result = spec as SequentialPresentationSpec
  validateSpec(result)
  return result
}

function activeSlideId(surface: SurfaceRun, spec: SequentialPresentationSpec): string {
  for (let index = surface.interactions.length - 1; index >= 0; index -= 1) {
    const interaction = surface.interactions[index]
    if (
      interaction?.action === 'adjust' &&
      interaction.inputId === 'active-slide' &&
      typeof interaction.value === 'string' &&
      spec.slides.some((slide) => slide.id === interaction.value)
    ) {
      return interaction.value
    }
  }
  const first = spec.slides[0]
  if (!first) throw new WorkspaceDomainError('validation_failed', 'presentation has no slides')
  return first.id
}

function stateFor(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: SequentialPresentationSpec,
  receipt = receiptFor(workspace, surface.id)
): SequentialPresentationRenderState {
  return {
    activeSlideId: activeSlideId(surface, spec),
    artifactRevision: surface.artifact.boardRevision,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    receipt,
    spec,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function sequentialPresentationStateForBoard(
  store: EditorStore,
  board: SceneNode
): SequentialPresentationRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'sequential-presentation-surface') return null
  const workspace = canonicalWorkspace(store)
  const object = workspace.objects[artifact.artifactId]
  if (!object || object.type !== 'surface-run') return null
  return stateFor(workspace, surfaceFor(workspace, object.id), specForBoard(board))
}

async function focusBoard(store: EditorStore, board: SceneNode): Promise<void> {
  if (board.parentId && board.parentId !== store.state.currentPageId) {
    await store.switchPage(board.parentId)
  }
  store.select([board.id])
  if (IS_BROWSER) store.zoomToSelection(htmlBoardViewportInsets())
}

export async function createSequentialPresentation(
  store: EditorStore,
  spec: SequentialPresentationSpec = SEQUENTIAL_PRESENTATION_SPEC
): Promise<SequentialPresentationCreationResult> {
  validateSpec(spec)
  const ids = idsFor(spec)
  let workspace = ensureViews(canonicalWorkspace(store))
  const existing = workspace.objects[ids.surface]
  if (existing?.type === 'surface-run') {
    const surface = surfaceFor(workspace, existing.id)
    const board = boardForSurface(store, surface)
    await focusBoard(store, board)
    return {
      boardId: board.id,
      created: false,
      formRationale: surface.formChoice.rationale,
      surfaceRunId: surface.id
    }
  }
  if (store.graph.getNode(ids.board)) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'sequential presentation board exists without its canonical surface object'
    )
  }
  const rendererRationale = explicitRendererRationale('Sequential presentation')
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
    tags: ['sequential-presentation']
  })
  const evidence = createEvidenceManifest(context, {
    collectionReceipt: spec.collectionReceipt,
    id: ids.evidenceManifest,
    intent: { objectId: intent.id, revision: 1 },
    items: spec.evidence,
    snapshotAt: spec.capturedAt,
    status: 'ready',
    tags: ['sequential-presentation']
  })
  const viewIds = Object.values(workspace.views).map((view) => view.id)
  const provisionalSurface = createSurfaceRun(context, {
    alternativesConsidered: ['sequential-presentation-v1', 'evidence-brief-v1', 'plain-prose'],
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
      objectRefs: [
        { objectId: intent.id, revision: 1 },
        { objectId: evidence.id, revision: 1 }
      ],
      viewIds
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formChoice: spec.formChoice ?? {
      consideredRendererIds: ['sequential-presentation-v1', 'evidence-brief-v1', 'plain-prose'],
      rationale: rendererRationale
    },
    formKind: 'sequential-presentation',
    formRationale: spec.formChoice?.rationale ?? rendererRationale,
    id: ids.surface,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: 'explain',
    modes: [
      { id: 'mode-overview', kind: 'overview', label: 'Outline' },
      { id: 'mode-focus', kind: 'focus', label: 'Present' },
      { id: 'mode-review', kind: 'review', label: 'Review' }
    ],
    name: spec.title,
    recommendations: [
      {
        evidenceItemIds: spec.evidence.map((item) => item.id),
        id: 'approve-sequential-presentation',
        rank: 1,
        rationale: 'Approve this ordered sequence as the current evidence-backed explanation.',
        status: 'active',
        title: 'Record this presentation',
        tradeoff: 'Approval records knowledge but does not execute external work.',
        uncertainty: 'The sequence should evolve when its evidence or intended audience changes.'
      }
    ],
    rendererId: 'sequential-presentation-v1',
    tags: ['sequential-presentation']
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const initialState: SequentialPresentationRenderState = {
    activeSlideId: spec.slides[0]?.id ?? '',
    artifactRevision: 1,
    evidence: { ...evidence, revision: 1 },
    intent: { ...intent, revision: 1 },
    spec,
    surface: predictedSurface,
    workspaceRevision: workspace.revision + 1
  }
  const rendered = renderSequentialPresentation(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `${spec.subject} · Presentation`,
    initialWorkflow: {
      changeSet: null,
      name: 'Presentation review',
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
    })
  ]
  workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
    dryRun: false,
    expectedRevision: workspace.revision,
    idempotencyKey: `sequential-presentation-create-${stablePart(spec.id)}`,
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
  return {
    boardId: board.id,
    created: true,
    formRationale: createdSurface.formChoice.rationale,
    surfaceRunId: createdSurface.id
  }
}

function validateBasis(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  board: SceneNode,
  event: SequentialPresentationEventRequest
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
      'presentation event was based on a stale workspace, surface, or artifact revision'
    )
  }
}

function interactionFor(
  surface: SurfaceRun,
  spec: SequentialPresentationSpec,
  event: SequentialPresentationEventRequest
): SurfaceInteraction {
  if (event.action === 'approve') {
    const finalSlide = spec.slides.at(-1)
    if (!finalSlide || activeSlideId(surface, spec) !== finalSlide.id) {
      throw new WorkspaceDomainError(
        'validation_failed',
        'presentation approval requires the closing review slide'
      )
    }
    return {
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
  }
  const targetSlideId = event.targetSlideId
  if (!targetSlideId || !spec.slides.some((slide) => slide.id === targetSlideId)) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `presentation slide ${targetSlideId ?? ''} is unavailable`
    )
  }
  if (activeSlideId(surface, spec) === targetSlideId) {
    throw new WorkspaceDomainError('validation_failed', 'presentation is already on that slide')
  }
  return {
    action: 'adjust',
    actorId: event.actorId,
    basis: {
      artifactRevision: event.expected.artifactRevision,
      surfaceRevision: event.expected.surfaceRevision
    },
    id: event.eventId,
    inputId: 'active-slide',
    note: event.note,
    occurredAt: new Date().toISOString(),
    value: targetSlideId
  }
}

export async function applySequentialPresentationEvent(
  store: EditorStore,
  event: SequentialPresentationEventRequest
): Promise<SequentialPresentationEventResult> {
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
    validateBasis(workspace, surface, board, event)
    const interaction = interactionFor(surface, spec, event)
    const interactions = [...surface.interactions, interaction]
    const approving = event.action === 'approve'
    const recommendations = approving
      ? surface.recommendations.map((recommendation) => ({
          ...recommendation,
          status: 'preferred' as const
        }))
      : surface.recommendations
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
    const rendered = renderSequentialPresentation(predictedState)
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
        `Sequential presentation · ${event.action}`
      )
    ) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'sequential presentation HTML did not update'
      )
    }
    if (approving && !approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'sequential presentation HTML did not approve'
      )
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'sequential presentation revision differed from its predicted receipt revision'
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
      error: error instanceof Error ? error.message : 'unknown sequential presentation error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructSequentialPresentationReceipt(
  store: EditorStore,
  receiptId: string
): SequentialPresentationRenderState {
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
    revision.artifact.kind !== 'sequential-presentation-surface' ||
    object.artifact.boardSchemaVersion !== HTML_BOARD_SCHEMA_VERSION
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `artifact revision for receipt ${receiptId} is unavailable or does not match`
    )
  }
  return stateFor(workspace, surface, specForBoard(board), object)
}
