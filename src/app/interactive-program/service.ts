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
  resolveKnowledgeWorkspace
} from '@/app/workspace'
import type {
  DecisionReceipt,
  DecisionRecommendation,
  KnowledgeWorkspace,
  SurfaceInteraction,
  SurfaceRun,
  WorkspaceObjectRevisionRef,
  WorkspaceOperation,
  WorkspaceView
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

import { defaultProgramScenario, evaluateInteractiveProgram } from './evaluate'
import { renderInteractiveProgram } from './render'
import type {
  InteractiveProgramCreationResult,
  InteractiveProgramEventRequest,
  InteractiveProgramEventResult,
  InteractiveProgramRenderState,
  InteractiveProgramSpec,
  ProgramResult,
  ProgramScenario
} from './types'
import { validateInteractiveProgramSpec } from './validate'

type UnknownRecord = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringProperty(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function integerProperty(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function eventAction(value: unknown): InteractiveProgramEventRequest['action'] | null {
  if (value === 'adjust') return 'adjust'
  if (value === 'approve') return 'approve'
  return null
}

function eventBasis(value: UnknownRecord): InteractiveProgramEventRequest['expected'] | null {
  const artifactRevision = integerProperty(value.artifactRevision)
  const surfaceRevision = integerProperty(value.surfaceRevision)
  const workspaceRevision = integerProperty(value.workspaceRevision)
  if (
    artifactRevision === null ||
    surfaceRevision === null ||
    workspaceRevision === null ||
    artifactRevision < 1 ||
    surfaceRevision < 1 ||
    workspaceRevision < 1
  ) {
    return null
  }
  return { artifactRevision, surfaceRevision, workspaceRevision }
}

function stablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) throw new WorkspaceDomainError('validation_failed', 'program id is required')
  return result.slice(0, 80)
}

function idsFor(spec: InteractiveProgramSpec) {
  const id = stablePart(spec.id)
  return {
    board: `html-board_${id}`,
    evidenceManifest: `evidence-manifest_${id}`,
    intent: `intent-record_${id}`,
    surface: `surface-run_${id}`
  }
}

export function parseInteractiveProgramEvent(
  value: unknown
): InteractiveProgramEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected)) return null
  const action = eventAction(value.action)
  const expected = eventBasis(value.expected)
  if (!action || !expected) return null
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const inputId = stringProperty(value.inputId, 100) || undefined
  const numericValue =
    typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : undefined
  const validAdjustment = action === 'approve' || Boolean(inputId && numericValue !== undefined)
  if (!eventId || !surfaceRunId || !validAdjustment) {
    return null
  }
  return {
    action,
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected,
    inputId,
    note: stringProperty(value.note, 240) || undefined,
    surfaceRunId,
    value: numericValue
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
    { kind: 'canvas' as const, name: 'Explore', primary: true },
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
    idempotencyKey: 'interactive-program-ensure-views-v1',
    operations
  }).workspace
}

function reviewView(workspace: KnowledgeWorkspace): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === 'review'
  )
  if (!view) throw new WorkspaceDomainError('not_found', 'interactive program review view')
  return view
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
      `interactive program ${surface.id} has no bound HTML board`
    )
  }
  return board
}

function referencedObject<ObjectType extends 'evidence-manifest' | 'intent-record'>(
  workspace: KnowledgeWorkspace,
  reference: WorkspaceObjectRevisionRef,
  objectType: ObjectType
): Extract<KnowledgeWorkspace['objects'][string], { type: ObjectType }> {
  if (!Object.hasOwn(workspace.objects, reference.objectId)) {
    throw new WorkspaceDomainError('reconstruction_conflict', `${objectType} is unavailable`)
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

function specForArtifactSource(source: string | undefined): InteractiveProgramSpec {
  if (!source) throw new WorkspaceDomainError('reconstruction_conflict', 'program source missing')
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new WorkspaceDomainError('reconstruction_conflict', 'program source is invalid')
  }
  const spec = isRecord(parsed) ? parsed.spec : null
  try {
    validateInteractiveProgramSpec(spec)
  } catch (error) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      error instanceof Error
        ? `program spec is invalid: ${error.message}`
        : 'program spec is invalid'
    )
  }
  return spec
}

function specForBoard(board: SceneNode): InteractiveProgramSpec {
  return specForArtifactSource(htmlBoardDocument(board).artifact?.source)
}

function scenarioFor(spec: InteractiveProgramSpec, surface: SurfaceRun): ProgramScenario {
  const scenario = defaultProgramScenario(spec)
  for (const interaction of surface.interactions) {
    if (
      interaction.action === 'adjust' &&
      interaction.inputId &&
      typeof interaction.value === 'number'
    ) {
      scenario[interaction.inputId] = interaction.value
    }
  }
  return scenario
}

function recommendationsFor(results: ProgramResult[], approved = false): DecisionRecommendation[] {
  return results.map((result) => ({
    evidenceItemIds: result.evidenceItemIds,
    id: `program-result_${result.itemId}`,
    rank: result.rank,
    rationale: result.explanation,
    status: approved ? (result.selected ? 'preferred' : 'rejected') : 'active',
    title: result.label,
    tradeoff: result.selected
      ? 'Included by the current scenario.'
      : 'Excluded by the current scenario.',
    uncertainty:
      'The result changes when declared inputs change; the evidence snapshot remains fixed.'
  }))
}

function stateFor(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: InteractiveProgramSpec,
  receipt = receiptFor(workspace, surface.id)
): InteractiveProgramRenderState {
  const evaluated = evaluateInteractiveProgram(spec, scenarioFor(spec, surface))
  return {
    artifactRevision: surface.artifact.boardRevision,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    receipt,
    results: evaluated.results,
    scenario: evaluated.scenario,
    spec,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function interactiveProgramStateForBoard(
  store: EditorStore,
  board: SceneNode
): InteractiveProgramRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'interactive-program-surface') return null
  const workspace = canonicalWorkspace(store)
  if (!Object.hasOwn(workspace.objects, artifact.artifactId)) return null
  const object = workspace.objects[artifact.artifactId]
  if (object.type !== 'surface-run') return null
  return stateFor(workspace, object, specForBoard(board))
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

async function focusBoard(store: EditorStore, board: SceneNode): Promise<void> {
  if (board.parentId && board.parentId !== store.state.currentPageId) {
    await store.switchPage(board.parentId)
  }
  store.select([board.id])
  if (IS_BROWSER) store.zoomToSelection(htmlBoardViewportInsets())
}

export async function createInteractiveProgram(
  store: EditorStore,
  spec: InteractiveProgramSpec
): Promise<InteractiveProgramCreationResult> {
  validateInteractiveProgramSpec(spec)
  const evaluated = evaluateInteractiveProgram(spec, defaultProgramScenario(spec))
  const ids = idsFor(spec)
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
      'program board exists without its canonical surface object'
    )
  }
  const rendererRationale = explicitRendererRationale('Interactive program')
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
    tags: ['interactive-program']
  })
  const evidence = createEvidenceManifest(context, {
    collectionReceipt: spec.collectionReceipt,
    id: ids.evidenceManifest,
    intent: { objectId: intent.id, revision: 1 },
    items: spec.evidence,
    snapshotAt: spec.capturedAt,
    status: 'ready',
    tags: ['interactive-program']
  })
  const provisionalSurface = createSurfaceRun(context, {
    alternativesConsidered: ['interactive-program-v1', 'static-brief', 'comparison-table'],
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
      viewIds: Object.keys(workspace.views)
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formChoice: spec.formChoice ?? {
      consideredRendererIds: ['interactive-program-v1', 'evidence-brief-v1', 'plain-prose'],
      rationale: rendererRationale
    },
    formKind: 'interactive-program',
    formRationale: spec.formChoice?.rationale ?? rendererRationale,
    id: ids.surface,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: 'simulate',
    modes: [
      { id: 'mode-overview', kind: 'overview', label: 'Overview', rendererViewId: 'overview' },
      { id: 'mode-focus', kind: 'focus', label: 'Explore', rendererViewId: 'explore' },
      { id: 'mode-review', kind: 'review', label: 'Review', rendererViewId: 'review' }
    ],
    name: spec.title,
    recommendations: recommendationsFor(evaluated.results),
    rendererId: 'interactive-program-v1',
    tags: ['interactive-program', spec.model.kind]
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const initialState: InteractiveProgramRenderState = {
    artifactRevision: 1,
    evidence: { ...evidence, revision: 1 },
    intent: { ...intent, revision: 1 },
    results: evaluated.results,
    scenario: evaluated.scenario,
    spec,
    surface: predictedSurface,
    workspaceRevision: workspace.revision + 1
  }
  const rendered = renderInteractiveProgram(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `${spec.title} · Interactive program`,
    initialWorkflow: {
      changeSet: null,
      name: 'Scenario review',
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
    idempotencyKey: `interactive-program-create-${stablePart(spec.id)}`,
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

function validateEventBasis(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  board: SceneNode,
  event: InteractiveProgramEventRequest
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
      'program event was based on stale workspace, surface, or artifact state'
    )
  }
}

function interactionFor(event: InteractiveProgramEventRequest): SurfaceInteraction {
  return {
    action: event.action,
    actorId: event.actorId,
    basis: {
      artifactRevision: event.expected.artifactRevision,
      surfaceRevision: event.expected.surfaceRevision
    },
    id: event.eventId,
    inputId: event.inputId,
    note: event.note,
    occurredAt: new Date().toISOString(),
    value: event.value
  }
}

function validateAdjustment(spec: InteractiveProgramSpec, event: InteractiveProgramEventRequest) {
  if (event.action !== 'adjust') return
  const input = spec.inputs.find((candidate) => candidate.id === event.inputId)
  const value = event.value
  const stepOffset = input && value !== undefined ? (value - input.min) / input.step : Number.NaN
  if (
    !input ||
    value === undefined ||
    !Number.isFinite(value) ||
    value < input.min ||
    value > input.max ||
    Math.abs(stepOffset - Math.round(stepOffset)) > 1e-8
  ) {
    throw new WorkspaceDomainError(
      'validation_failed',
      `invalid program input ${event.inputId ?? ''}`
    )
  }
}

export async function applyInteractiveProgramEvent(
  store: EditorStore,
  event: InteractiveProgramEventRequest
): Promise<InteractiveProgramEventResult> {
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
    validateAdjustment(spec, event)
    const interaction = interactionFor(event)
    const interactions = [...surface.interactions, interaction]
    const scenario = scenarioFor(spec, { ...surface, interactions })
    const evaluated = evaluateInteractiveProgram(spec, scenario)
    const approving = event.action === 'approve'
    const recommendations = recommendationsFor(evaluated.results, approving)
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
    const rendered = renderInteractiveProgram(predictedState)
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
        `Interactive program · ${event.action}`
      )
    ) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'program board did not update')
    }
    if (approving && !approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'program board did not approve')
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'program artifact revision differed from its predicted receipt revision'
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
      const selected = recommendations
        .filter((recommendation) => recommendation.status === 'preferred')
        .map((recommendation) => recommendation.id)
      const rejected = recommendations
        .filter((recommendation) => recommendation.status === 'rejected')
        .map((recommendation) => recommendation.id)
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
            rejectedRecommendationIds: rejected,
            selectedRecommendationIds: selected,
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
      error: error instanceof Error ? error.message : 'unknown interactive program error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructInteractiveProgramReceipt(
  store: EditorStore,
  receiptId: string
): InteractiveProgramRenderState {
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
  return stateFor(workspace, surface, specForArtifactSource(revision.artifact.source), object)
}
