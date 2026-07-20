import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import type { WorkLifecycleAction, WorkLifecycleStatus } from '@/app/flow-state'
import {
  ensureSmylrAlternateLiveAppFrameOnPage,
  findSmylrAppViewPage,
  isSmylrLiveAppFrameNode,
  smylrLiveAppFrameState
} from '@/app/smylr-production/workspace'
import {
  createDesignArtifact,
  createEvidenceManifest,
  createIntentRecord,
  createReviewObject,
  createSurfaceRun,
  createWorkspaceContext,
  createWorkspaceRelation,
  mutateKnowledgeWorkspace,
  resolveKnowledgeWorkspace,
  type KnowledgeWorkspace,
  type ReviewObjectKind,
  type ReviewStatus,
  type SurfaceInteraction,
  type SurfaceRun,
  type WorkspaceObjectRevisionRef,
  type WorkspaceOperation
} from '@/app/workspace'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene,
  workspaceDocumentId
} from '@/app/workspace-ui/persistence'

import { liveWorkspaceLifecycle, workspaceItemPatches, type LiveWorkspaceItem } from './workspace'

const RENDERER_ID = 'smylr-workflow-state-v1'
const ARTIFACT_SCHEMA_VERSION = 1
const PROJECTION_SYNC_VERSION = 2
const REVIEW_OBJECT_SCHEMA_VERSION = 2

export type LiveWorkspaceExperienceProjection = {
  basePageId: string
  rootSurface: WorkspaceObjectRevisionRef
  workspace: KnowledgeWorkspace
}

function objectId(itemId: string, suffix: string) {
  return `${itemId}__${suffix}`
}

function lifecycleReviewObjectId(itemId: string, receiptId: string) {
  return objectId(itemId, `transition-v${REVIEW_OBJECT_SCHEMA_VERSION}-${receiptId}`)
}

function legacyLifecycleReviewObjectId(itemId: string, receiptId: string) {
  return objectId(itemId, `transition-${receiptId}`)
}

function currentFrameOnPage(store: EditorStore, pageId: string, route: string): SceneNode | null {
  return (
    store.graph
      .getChildren(pageId)
      .find(
        (node) =>
          isSmylrLiveAppFrameNode(node) &&
          smylrLiveAppFrameState(node) === 'current' &&
          node.pluginData.some(
            (entry) =>
              entry.pluginId === 'smylr-production' &&
              entry.key === 'route' &&
              entry.value === route
          )
      ) ?? null
  )
}

function surfaceStatus(status: WorkLifecycleStatus): SurfaceRun['status'] {
  if (status === 'historical') return 'failed'
  if (status === 'approved' || status === 'implementing' || status === 'verified') {
    return 'decided'
  }
  return 'in-review'
}

function recommendationStatus(
  status: WorkLifecycleStatus
): SurfaceRun['recommendations'][number]['status'] {
  if (
    status === 'preferred' ||
    status === 'approved' ||
    status === 'implementing' ||
    status === 'verified'
  ) {
    return 'preferred'
  }
  if (status === 'historical') return 'rejected'
  return 'active'
}

function interactionAction(action: WorkLifecycleAction): SurfaceInteraction['action'] {
  if (action === 'mark-preferred') return 'prefer'
  if (action === 'request-review') return 'compare'
  if (action === 'request-changes') return 'reject'
  if (action === 'approve' || action === 'start-implementation' || action === 'verify') {
    return 'approve'
  }
  return 'revise'
}

function surfaceInteractions(item: LiveWorkspaceItem): SurfaceInteraction[] {
  return liveWorkspaceLifecycle(item).history.map((receipt) => ({
    action: interactionAction(receipt.action),
    actorId: receipt.actorId,
    basis: {
      artifactRevision: receipt.revision,
      surfaceRevision: receipt.revision
    },
    id: receipt.id,
    note: receipt.label,
    occurredAt: receipt.occurredAt,
    recommendationId: item.id
  }))
}

function reviewKind(action: WorkLifecycleAction): ReviewObjectKind {
  if (action === 'approve') return 'approval'
  if (action === 'create-change-set') return 'change-set-reference'
  if (action === 'request-changes') return 'comment'
  if (action === 'mark-preferred') return 'decision'
  return 'status-marker'
}

function reviewStatus(status: WorkLifecycleStatus): ReviewStatus {
  if (status === 'preferred') return 'preferred'
  if (status === 'approved' || status === 'implementing') return 'approved'
  if (status === 'verified') return 'verified'
  if (status === 'historical') return 'applied'
  return 'open'
}

function artifact(frameId: string, itemId: string, revision: number) {
  return {
    artifactId: itemId,
    boardId: frameId,
    boardRevision: revision,
    boardSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    kind: 'html-board' as const,
    sourceHash: `live-workspace:${itemId}@r${revision}`
  }
}

function surfaceRationale(item: LiveWorkspaceItem) {
  return `Project ${item.name} as one stable work identity across Focus, Compare, Knowledge, and Review at lifecycle revision ${liveWorkspaceLifecycle(item).revision}.`
}

function surfacePatch(item: LiveWorkspaceItem, frameId: string): Partial<SurfaceRun> {
  const lifecycle = liveWorkspaceLifecycle(item)
  return {
    artifact: artifact(frameId, item.id, lifecycle.revision),
    form: {
      alternativesConsidered: ['detached-board-copy', 'status-only-tab', 'shared-exact-projection'],
      kind: 'workflow-state',
      rationale: surfaceRationale(item)
    },
    formChoice: {
      consideredRendererIds: [RENDERER_ID],
      rationale: surfaceRationale(item),
      selectedRendererId: RENDERER_ID,
      selection: 'suggestion'
    },
    interactions: surfaceInteractions(item),
    recommendations: [
      {
        evidenceItemIds: [objectId(item.id, 'evidence-item')],
        id: item.id,
        rank: 1,
        rationale: `Keep ${item.name} attached to its exact lifecycle and source evidence.`,
        status: recommendationStatus(lifecycle.status),
        title: item.name,
        tradeoff: 'Views may differ spatially, but identity and receipts remain shared.',
        uncertainty:
          item.preview?.status === 'ready'
            ? 'Captured product evidence'
            : 'Last-known product evidence'
      }
    ],
    status: surfaceStatus(lifecycle.status)
  }
}

function liveEvidenceItem(item: LiveWorkspaceItem) {
  const source = workspaceItemPatches(item)[0]?.source
  return {
    access: 'allowed' as const,
    facts: {
      lifecycleRevision: liveWorkspaceLifecycle(item).revision,
      lifecycleStatus: liveWorkspaceLifecycle(item).status,
      route: item.route,
      sourceFile: source?.filePath ?? 'unresolved'
    },
    freshness: item.preview?.status === 'ready' ? ('current' as const) : ('unknown' as const),
    id: objectId(item.id, 'evidence-item'),
    observedAt: item.preview?.capturedAt,
    permissionScopes: ['workspace:read'],
    retrievedAt: item.updatedAt,
    sourceRef: source?.filePath ?? `route:${item.route}`,
    summary: `${item.name} at ${liveWorkspaceLifecycle(item).status} r${liveWorkspaceLifecycle(item).revision}.`,
    title: `${item.name} source and captured state`,
    truthScope: item.preview?.status === 'ready' ? ('captured' as const) : ('last-known' as const)
  }
}

function createInitialExperience(
  workspace: KnowledgeWorkspace,
  item: LiveWorkspaceItem,
  alternateFrame: SceneNode,
  currentFrame: SceneNode
): WorkspaceOperation[] {
  const lifecycle = liveWorkspaceLifecycle(item)
  const context = createWorkspaceContext(workspace, {
    now: item.updatedAt,
    provenance: { actorId: 'openpencil-flow-state', kind: 'agent' }
  })
  const intent = createIntentRecord(context, {
    capturedAt: item.createdAt,
    constraints: [
      'Preserve one stable work identity across views',
      'Keep production source writes separately authorized',
      'Retain exact lifecycle and movement receipts'
    ],
    desiredOutcome:
      'Move from exploration through verified implementation without losing context or control.',
    id: objectId(item.id, 'intent'),
    statement:
      item.note?.trim() || `Advance ${item.name} through a reviewable software-team workflow.`,
    tags: ['flow-state', 'live-workspace']
  })
  const evidence = createEvidenceManifest(context, {
    id: objectId(item.id, 'evidence'),
    intent: { objectId: intent.id, revision: 1 },
    items: [liveEvidenceItem(item)],
    snapshotAt: item.updatedAt,
    status: 'ready',
    tags: ['flow-state', 'live-workspace']
  })
  const change = createDesignArtifact(context, {
    artifactKind: 'responsive-state',
    data: {
      acceptanceCriteria: [...(item.changeSet?.acceptanceCriteria ?? [])],
      lifecycleRevision: lifecycle.revision,
      lifecycleStatus: lifecycle.status,
      workspaceItemId: item.id
    },
    id: objectId(item.id, 'change'),
    label: `${item.name} change`,
    ownership: item.changeSet ? 'proposed-source-change' : 'preview-branch',
    sourceRef: workspaceItemPatches(item)[0]?.source?.filePath,
    tags: ['flow-state', 'live-workspace']
  })
  const root = createSurfaceRun(context, {
    ...surfacePatch(item, alternateFrame.id),
    artifact: artifact(alternateFrame.id, item.id, lifecycle.revision),
    bindings: {
      evidenceItemIds: [objectId(item.id, 'evidence-item')],
      objectRefs: [
        { objectId: intent.id, revision: 1 },
        { objectId: evidence.id, revision: 1 },
        { objectId: change.id, revision: 1 }
      ],
      viewIds: []
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formKind: 'workflow-state',
    formRationale: surfaceRationale(item),
    id: item.id,
    intent: { objectId: intent.id, revision: 1 },
    jobKind: 'compare',
    modes: [
      { id: 'mode-focus', kind: 'focus', label: 'Focus', rendererViewId: 'focus' },
      { id: 'mode-compare', kind: 'compare', label: 'Compare', rendererViewId: 'compare' },
      { id: 'mode-knowledge', kind: 'overview', label: 'Knowledge', rendererViewId: 'knowledge' },
      { id: 'mode-review', kind: 'review', label: 'Review', rendererViewId: 'review' }
    ],
    name: item.name,
    recommendations: surfacePatch(item, alternateFrame.id).recommendations ?? [],
    rendererId: RENDERER_ID,
    status: surfaceStatus(lifecycle.status),
    tags: ['flow-state', 'live-workspace']
  })
  const production = createSurfaceRun(context, {
    artifact: artifact(currentFrame.id, objectId(item.id, 'production'), 1),
    bindings: {
      evidenceItemIds: [objectId(item.id, 'evidence-item')],
      objectRefs: [
        { objectId: intent.id, revision: 1 },
        { objectId: evidence.id, revision: 1 }
      ],
      viewIds: []
    },
    evidenceManifest: { objectId: evidence.id, revision: 1 },
    formKind: 'workflow-state',
    formRationale: 'Production Current is the exact comparison companion for this alternate.',
    id: objectId(item.id, 'production'),
    intent: { objectId: intent.id, revision: 1 },
    jobKind: 'compare',
    modes: [
      { id: 'mode-focus', kind: 'focus', label: 'Focus', rendererViewId: 'focus' },
      { id: 'mode-review', kind: 'review', label: 'Review', rendererViewId: 'review' }
    ],
    name: `${item.name} · Production Current`,
    recommendations: [],
    rendererId: RENDERER_ID,
    status: 'decided',
    tags: ['flow-state', 'production-reference']
  })
  const relation = createWorkspaceRelation({
    id: objectId(item.id, 'production-relation'),
    label: 'Compare with production Current',
    relationType: 'companion-view-of',
    sourceId: production.id,
    targetId: root.id,
    workspaceId: workspace.id
  })
  const reviews = lifecycle.history.map((receipt) => {
    const receiptContext = createWorkspaceContext(workspace, {
      now: receipt.occurredAt,
      provenance: {
        actorId: receipt.actorId,
        kind: receipt.actorKind === 'agent' ? 'agent' : 'user'
      }
    })
    return createReviewObject(receiptContext, {
      attachedObjectIds: [root.id],
      attachedRevisions: { [root.id]: 1 },
      body: `${receipt.label} · ${receipt.from} → ${receipt.to} · lifecycle r${receipt.revision}`,
      id: lifecycleReviewObjectId(item.id, receipt.id),
      reviewKind: reviewKind(receipt.action),
      reviewStatus: reviewStatus(receipt.to),
      tags: ['flow-state', 'lifecycle-receipt']
    })
  })
  return [
    { object: intent, type: 'create-object' },
    { object: evidence, type: 'create-object' },
    { object: change, type: 'create-object' },
    { object: root, type: 'create-object' },
    { object: production, type: 'create-object' },
    ...reviews.map((object) => ({ object, type: 'create-object' as const })),
    { relation, type: 'connect-relation' }
  ]
}

function updateExistingExperience(
  workspace: KnowledgeWorkspace,
  item: LiveWorkspaceItem,
  alternateFrame: SceneNode,
  currentFrame: SceneNode
): WorkspaceOperation[] {
  const root = workspace.objects[item.id]
  if (!root || root.type !== 'surface-run') {
    throw new Error(`flow_state_projection_identity_conflict: ${item.id}`)
  }
  const lifecycle = liveWorkspaceLifecycle(item)
  const next = surfacePatch(item, alternateFrame.id)
  const needsRootUpdate =
    root.artifact.boardId !== alternateFrame.id ||
    root.artifact.boardRevision !== lifecycle.revision ||
    root.status !== next.status ||
    JSON.stringify(root.interactions) !== JSON.stringify(next.interactions)
  const rootRevision = root.revision + (needsRootUpdate ? 1 : 0)
  const operations: WorkspaceOperation[] = needsRootUpdate
    ? [
        {
          expectedObjectRevision: root.revision,
          objectId: root.id,
          objectType: 'surface-run',
          patch: next,
          type: 'update-object'
        }
      ]
    : []

  const productionId = objectId(item.id, 'production')
  const production = workspace.objects[productionId]
  if (production?.type === 'surface-run' && production.artifact.boardId !== currentFrame.id) {
    operations.push({
      expectedObjectRevision: production.revision,
      objectId: production.id,
      objectType: 'surface-run',
      patch: { artifact: artifact(currentFrame.id, production.id, 1) },
      type: 'update-object'
    })
  }

  for (const receipt of lifecycle.history) {
    const legacyId = legacyLifecycleReviewObjectId(item.id, receipt.id)
    const legacy = workspace.objects[legacyId]
    if (legacy?.lifecycle === 'active') {
      operations.push({
        expectedObjectRevision: legacy.revision,
        objectId: legacy.id,
        type: 'archive-object'
      })
    }
    const id = lifecycleReviewObjectId(item.id, receipt.id)
    if (Object.hasOwn(workspace.objects, id)) continue
    const context = createWorkspaceContext(workspace, {
      now: receipt.occurredAt,
      provenance: {
        actorId: receipt.actorId,
        kind: receipt.actorKind === 'agent' ? 'agent' : 'user'
      }
    })
    operations.push({
      object: createReviewObject(context, {
        attachedObjectIds: [root.id],
        attachedRevisions: { [root.id]: rootRevision },
        body: `${receipt.label} · ${receipt.from} → ${receipt.to} · lifecycle r${receipt.revision}`,
        id,
        reviewKind: reviewKind(receipt.action),
        reviewStatus: reviewStatus(receipt.to),
        tags: ['flow-state', 'lifecycle-receipt']
      }),
      type: 'create-object'
    })
  }
  return operations
}

export function syncLiveWorkspaceExperienceProjection(
  store: EditorStore,
  item: LiveWorkspaceItem
): LiveWorkspaceExperienceProjection {
  ensureKnowledgeWorkspacesHydrated(store.graph)
  const basePage = findSmylrAppViewPage(store, item.route, 'current')
  if (!basePage) throw new Error(`flow_state_projection_base_page_not_found: ${item.route}`)
  const alternateFrame = ensureSmylrAlternateLiveAppFrameOnPage(store, item, basePage.id)
  const currentFrame = currentFrameOnPage(store, basePage.id, item.route)
  if (!alternateFrame || !currentFrame) {
    throw new Error(`flow_state_projection_artifact_not_found: ${item.id}`)
  }

  let workspace = resolveKnowledgeWorkspace({
    documentId: workspaceDocumentId(store.graph),
    name: `${basePage.name} Knowledge Workspace`,
    pageId: basePage.id
  })
  const operations = Object.hasOwn(workspace.objects, item.id)
    ? updateExistingExperience(workspace, item, alternateFrame, currentFrame)
    : createInitialExperience(workspace, item, alternateFrame, currentFrame)
  if (operations.length > 0) {
    workspace = mutateKnowledgeWorkspace(workspace.documentId, workspace.pageId, {
      dryRun: false,
      expectedRevision: workspace.revision,
      idempotencyKey: `flow-state-projection-v${PROJECTION_SYNC_VERSION}-${item.id}-r${liveWorkspaceLifecycle(item).revision}`,
      operations
    }).workspace
  }
  persistKnowledgeWorkspacesToScene(store.graph)
  store.requestRender()
  const root = workspace.objects[item.id]
  if (!root || root.type !== 'surface-run') {
    throw new Error(`flow_state_projection_root_not_found: ${item.id}`)
  }
  return {
    basePageId: basePage.id,
    rootSurface: { objectId: root.id, revision: root.revision },
    workspace
  }
}
