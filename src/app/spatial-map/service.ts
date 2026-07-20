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
  createGraphEdge,
  createGraphNode,
  createIntentRecord,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceRelation,
  createWorkspaceView,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type DecisionReceipt,
  type GraphEdge,
  type GraphNode,
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

import { OPENPENCIL_SPATIAL_MAP } from './fixture'
import {
  deriveSpatialMapModel,
  spatialMapObjectIds,
  spatialMapStablePart,
  validateSpatialMapSpec
} from './model'
import { renderSpatialMap } from './render'
import type {
  SpatialMapCreationResult,
  SpatialMapEventRequest,
  SpatialMapEventResult,
  SpatialMapRenderState,
  SpatialMapSpec
} from './types'

type UnknownRecord = { [key: string]: unknown }

const READ_ONLY_PERMISSIONS = { canComment: true, canEdit: false, canView: true } as const

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringProperty(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function integerProperty(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

export function parseSpatialMapEvent(value: unknown): SpatialMapEventRequest | null {
  if (!isRecord(value) || !isRecord(value.expected)) return null
  if (value.action !== 'approve' && value.action !== 'focus-node') return null
  const eventId = stringProperty(value.eventId, 120)
  const surfaceRunId = stringProperty(value.surfaceRunId, 120)
  const nodeId = stringProperty(value.nodeId, 120)
  const artifactRevision = integerProperty(value.expected.artifactRevision)
  const surfaceRevision = integerProperty(value.expected.surfaceRevision)
  const workspaceRevision = integerProperty(value.expected.workspaceRevision)
  if (
    !eventId ||
    !surfaceRunId ||
    (value.action === 'focus-node' && !nodeId) ||
    artifactRevision === null ||
    surfaceRevision === null ||
    workspaceRevision === null ||
    artifactRevision < 1 ||
    surfaceRevision < 1 ||
    workspaceRevision < 1
  ) {
    return null
  }
  return {
    action: value.action,
    actorId: stringProperty(value.actorId, 120) || undefined,
    eventId,
    expected: { artifactRevision, surfaceRevision, workspaceRevision },
    nodeId: nodeId || undefined,
    note: stringProperty(value.note, 180) || undefined,
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

function ensureViews(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
  const required = [
    { kind: 'graph' as const, name: 'Relationship Map', primary: true },
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
    idempotencyKey: 'spatial-map-ensure-views-v1',
    operations
  }).workspace
}

function graphView(workspace: KnowledgeWorkspace): WorkspaceView {
  const view = Object.values(workspace.views).find(
    (candidate) => candidate.lifecycle === 'active' && candidate.kind === 'graph'
  )
  if (!view) throw new WorkspaceDomainError('not_found', 'spatial map graph view')
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
  if (object.rendererId !== 'spatial-map-v1' || object.form.kind !== 'spatial-map') {
    throw new WorkspaceDomainError('validation_failed', `surface ${surfaceId} is not a spatial map`)
  }
  return object
}

function boardForSurface(store: EditorStore, surface: SurfaceRun): SceneNode {
  const direct = store.graph.getNode(surface.artifact.boardId)
  if (direct && isHtmlBoardFrame(direct)) return direct
  const bound = sceneNodesForWorkspaceObject(store.graph, surface.id).find(isHtmlBoardFrame)
  if (!bound) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `surface ${surface.id} has no bound HTML board`
    )
  }
  return bound
}

function referencedObject<ObjectType extends 'evidence-manifest' | 'intent-record' | 'surface-run'>(
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

function specFromArtifactSource(source?: string): SpatialMapSpec {
  if (!source) {
    throw new WorkspaceDomainError('reconstruction_conflict', 'spatial map source missing')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new WorkspaceDomainError('reconstruction_conflict', 'spatial map source is invalid')
  }
  if (!isRecord(parsed)) {
    throw new WorkspaceDomainError('reconstruction_conflict', 'spatial map source is unavailable')
  }
  return validateSpatialMapSpec(parsed.spec)
}

function specForBoard(board: SceneNode): SpatialMapSpec {
  const artifact = htmlBoardDocument(board).artifact
  if (artifact?.kind !== 'spatial-map-surface') {
    throw new WorkspaceDomainError('reconstruction_conflict', 'spatial map artifact is unavailable')
  }
  return specFromArtifactSource(artifact.source)
}

function focusedNodeId(surface: SurfaceRun, spec: SpatialMapSpec): string {
  for (let index = surface.interactions.length - 1; index >= 0; index -= 1) {
    const interaction = surface.interactions[index]
    if (
      interaction?.action === 'adjust' &&
      interaction.inputId === 'focused-node' &&
      typeof interaction.value === 'string'
    ) {
      return interaction.value
    }
  }
  return spec.defaultFocusedNodeId
}

function canonicalGraphObjects(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: SpatialMapSpec
): { edges: GraphEdge[]; nodes: GraphNode[] } {
  const ids = spatialMapObjectIds(spec)
  const references = new Map(
    surface.bindings.objectRefs.map((reference) => [reference.objectId, reference.revision])
  )
  const nodes = spec.nodes.map((node) => {
    const objectId = ids.nodes[node.id]
    const object = objectId ? workspace.objects[objectId] : undefined
    if (
      !object ||
      object.type !== 'graph-node' ||
      object.graphId !== ids.graph ||
      object.graphKind !== 'dependency' ||
      object.label !== node.label ||
      references.get(object.id) !== object.revision
    ) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        `spatial map node ${node.id} is unavailable at its bound revision`
      )
    }
    return object
  })
  const edges = spec.edges.map((edge) => {
    const objectId = ids.edges[edge.id]
    const object = objectId ? workspace.objects[objectId] : undefined
    if (
      !object ||
      object.type !== 'graph-edge' ||
      object.graphId !== ids.graph ||
      object.graphKind !== 'dependency' ||
      object.sourceId !== ids.nodes[edge.sourceId] ||
      object.targetId !== ids.nodes[edge.targetId] ||
      object.relationshipType !== edge.relationshipType ||
      references.get(object.id) !== object.revision
    ) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        `spatial map edge ${edge.id} is unavailable at its bound revision`
      )
    }
    return object
  })
  return { edges, nodes }
}

function stateFor(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: SpatialMapSpec,
  receipt = receiptFor(workspace, surface.id)
): SpatialMapRenderState {
  const graph = canonicalGraphObjects(workspace, surface, spec)
  return {
    artifactRevision: surface.artifact.boardRevision,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    graphEdges: graph.edges,
    graphNodes: graph.nodes,
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    model: deriveSpatialMapModel(spec, focusedNodeId(surface, spec)),
    receipt,
    spec,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function spatialMapStateForBoard(
  store: EditorStore,
  board: SceneNode
): SpatialMapRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'spatial-map-surface') return null
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

export async function createSpatialMapSurface(
  store: EditorStore,
  spec: SpatialMapSpec = OPENPENCIL_SPATIAL_MAP
): Promise<SpatialMapCreationResult> {
  validateSpatialMapSpec(spec)
  const ids = spatialMapObjectIds(spec)
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
      'spatial map board exists without its canonical surface object'
    )
  }
  const rendererRationale = explicitRendererRationale('Spatial map')
  const context = createWorkspaceContext(workspace, {
    now: spec.capturedAt,
    provenance: { actorId: 'openpencil-spatial-map', kind: 'agent' }
  })
  const shared = spec.sharedLineage
  const primarySurface = shared
    ? referencedObject(workspace, shared.primarySurfaceRun, 'surface-run')
    : undefined
  const intent = shared
    ? referencedObject(workspace, shared.intent, 'intent-record')
    : createIntentRecord(context, {
        capturedAt: spec.capturedAt,
        constraints: spec.intent.constraints,
        desiredOutcome: spec.intent.desiredOutcome,
        id: ids.intent,
        statement: spec.intent.statement,
        tags: ['spatial-map']
      })
  const intentRef = shared ? shared.intent : { objectId: intent.id, revision: 1 }
  const evidence = shared
    ? referencedObject(workspace, shared.evidenceManifest, 'evidence-manifest')
    : createEvidenceManifest(context, {
        collectionReceipt: spec.collectionReceipt,
        id: ids.evidenceManifest,
        intent: intentRef,
        items: spec.evidence,
        snapshotAt: spec.capturedAt,
        status: 'ready',
        tags: ['spatial-map']
      })
  const evidenceRef = shared ? shared.evidenceManifest : { objectId: evidence.id, revision: 1 }
  if (
    shared &&
    (evidence.intent.objectId !== intentRef.objectId ||
      evidence.intent.revision !== intentRef.revision ||
      JSON.stringify(evidence.items.map((item) => item.id).toSorted()) !==
        JSON.stringify(spec.evidence.map((item) => item.id).toSorted()))
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      'companion spatial map must use the primary intent and evidence exactly'
    )
  }
  const graphNodes = spec.nodes.map((node) =>
    createGraphNode(context, {
      data: {
        evidenceItemIds: node.evidenceItemIds,
        mapNodeId: node.id,
        status: node.status,
        summary: node.summary
      },
      graphId: ids.graph,
      graphKind: 'dependency',
      id: ids.nodes[node.id],
      label: node.label,
      layoutRole: node.kind,
      permissions: READ_ONLY_PERMISSIONS,
      tags: ['spatial-map', node.kind]
    })
  )
  const graphEdges = spec.edges.map((edge) =>
    createGraphEdge(context, {
      confidence: edge.confidence,
      direction: 'directed',
      graphId: ids.graph,
      graphKind: 'dependency',
      id: ids.edges[edge.id],
      label: edge.label,
      permissions: READ_ONLY_PERMISSIONS,
      relationshipType: edge.relationshipType,
      sourceId: ids.nodes[edge.sourceId] ?? '',
      tags: ['spatial-map', 'relationship'],
      targetId: ids.nodes[edge.targetId] ?? ''
    })
  )
  const objectRefs = [
    intentRef,
    evidenceRef,
    ...[...graphNodes, ...graphEdges].map((object) => ({ objectId: object.id, revision: 1 }))
  ]
  const provisionalSurface = createSurfaceRun(context, {
    alternativesConsidered: ['spatial-map-v1', 'evidence-brief-v1', 'presentation-v1'],
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
      viewIds: Object.values(workspace.views).map((view) => view.id)
    },
    evidenceManifest: evidenceRef,
    formChoice: spec.formChoice ?? {
      consideredRendererIds: ['spatial-map-v1', 'evidence-brief-v1', 'presentation-v1'],
      rationale: rendererRationale
    },
    formKind: 'spatial-map',
    formRationale: spec.formChoice?.rationale ?? rendererRationale,
    id: ids.surface,
    intent: intentRef,
    jobKind: 'explain',
    modes: [
      { id: 'mode-map', kind: 'focus', label: 'Map', rendererViewId: 'map' },
      { id: 'mode-review', kind: 'review', label: 'Review', rendererViewId: 'review' }
    ],
    name: spec.title,
    recommendations: [
      {
        evidenceItemIds: spec.evidence.map((item) => item.id),
        id: 'record-spatial-map',
        rank: 1,
        rationale: 'Record the dependency model as the current shared explanation.',
        status: 'active',
        title: 'Approve this relationship map',
        tradeoff: 'Approval records knowledge but does not execute or change source.',
        uncertainty: 'Durable learning and connector-backed evidence remain future work.'
      }
    ],
    rendererId: 'spatial-map-v1',
    tags: shared ? ['spatial-map', 'companion-view', 'shared-lineage'] : ['spatial-map']
  })
  const predictedSurface = { ...provisionalSurface, revision: 1 }
  const initialState: SpatialMapRenderState = {
    artifactRevision: 1,
    evidence: shared ? evidence : { ...evidence, revision: 1 },
    graphEdges: graphEdges.map((edge) => ({ ...edge, revision: 1 })),
    graphNodes: graphNodes.map((node) => ({ ...node, revision: 1 })),
    intent: shared ? intent : { ...intent, revision: 1 },
    model: deriveSpatialMapModel(spec),
    spec,
    surface: predictedSurface,
    workspaceRevision: workspace.revision + 1
  }
  const rendered = renderSpatialMap(initialState)
  const board = createHtmlBoardFrame(store, rendered.html, rendered.css, rendered.js, {
    frameId: ids.board,
    frameName: `${spec.title} · Relationship map`,
    initialWorkflow: {
      changeSet: null,
      name: 'Relationship review',
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
      id: `relation_${spatialMapStablePart(spec.id)}-intent`,
      relationType: 'fulfills-intent',
      sourceId: surface.id,
      targetId: intent.id,
      workspaceId: workspace.id
    }),
    createWorkspaceRelation({
      id: `relation_${spatialMapStablePart(spec.id)}-evidence`,
      relationType: 'uses-evidence',
      sourceId: surface.id,
      targetId: evidence.id,
      workspaceId: workspace.id
    }),
    ...(primarySurface
      ? [
          createWorkspaceRelation({
            id: `relation_${spatialMapStablePart(spec.id)}-companion`,
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
    idempotencyKey: `spatial-map-create-${spatialMapStablePart(spec.id)}`,
    operations: [
      ...(shared
        ? []
        : [
            { object: intent, type: 'create-object' as const },
            { object: evidence, type: 'create-object' as const }
          ]),
      ...graphNodes.map((object) => ({ object, type: 'create-object' as const })),
      ...graphEdges.map((object) => ({ object, type: 'create-object' as const })),
      { object: surface, type: 'create-object' },
      ...relations.map((relation) => ({ relation, type: 'connect-relation' as const }))
    ]
  }).workspace
  const createdSurface = surfaceFor(workspace, surface.id)
  bindWorkspaceObjectToSceneNode(store.graph, board, createdSurface, graphView(workspace))
  await persist(store)
  await focusBoard(store, board)
  return {
    boardId: board.id,
    created: true,
    formRationale: createdSurface.formChoice.rationale,
    surfaceRunId: createdSurface.id
  }
}

export async function applySpatialMapEvent(
  store: EditorStore,
  event: SpatialMapEventRequest
): Promise<SpatialMapEventResult> {
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
        'spatial map event was based on a stale workspace, surface, or artifact revision'
      )
    }
    if (event.action === 'focus-node' && !spec.nodes.some((node) => node.id === event.nodeId)) {
      throw new WorkspaceDomainError(
        'validation_failed',
        `unknown spatial map node ${event.nodeId}`
      )
    }
    const approving = event.action === 'approve'
    const interaction: SurfaceInteraction = {
      action: approving ? 'approve' : 'adjust',
      actorId: event.actorId,
      basis: {
        artifactRevision: event.expected.artifactRevision,
        surfaceRevision: event.expected.surfaceRevision
      },
      id: event.eventId,
      inputId: approving ? undefined : 'focused-node',
      note: event.note,
      occurredAt: new Date().toISOString(),
      recommendationId: approving ? surface.recommendations[0]?.id : undefined,
      value: approving ? undefined : event.nodeId
    }
    const interactions = [...surface.interactions, interaction]
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
    const rendered = renderSpatialMap(predictedState)
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
        `Spatial map · ${event.action}`
      )
    ) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'spatial map did not update')
    }
    if (approving && !approveHtmlBoardDecisionSurface(store, board.id)) {
      throw new WorkspaceDomainError('reconstruction_conflict', 'spatial map did not approve')
    }
    const finalBoard = store.graph.getNode(board.id)
    if (!finalBoard || htmlBoardDocument(finalBoard).revision !== predictedArtifactRevision) {
      throw new WorkspaceDomainError(
        'reconstruction_conflict',
        'spatial map revision differed from the predicted receipt revision'
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
      operations.push({
        object: createDecisionReceipt(
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
        ),
        type: 'create-object'
      })
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
      graphView(workspace)
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
      error: error instanceof Error ? error.message : 'unknown spatial map error',
      eventId: event.eventId,
      status: 'rejected'
    }
  }
}

export function reconstructSpatialMapReceipt(
  store: EditorStore,
  receiptId: string
): SpatialMapRenderState {
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
    revision.artifact.kind !== 'spatial-map-surface' ||
    revision.artifact.sourceHash !== object.artifact.sourceHash ||
    object.artifact.boardSchemaVersion !== HTML_BOARD_SCHEMA_VERSION
  ) {
    throw new WorkspaceDomainError(
      'reconstruction_conflict',
      `artifact revision for receipt ${receiptId} is unavailable or does not match`
    )
  }
  return stateFor(workspace, surface, specFromArtifactSource(revision.artifact.source), object)
}
