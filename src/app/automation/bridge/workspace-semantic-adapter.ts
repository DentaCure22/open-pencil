import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  getKnowledgeWorkspace,
  getWorkspaceBacklinks,
  mutateKnowledgeWorkspace,
  queryWorkspaceItems,
  resolveKnowledgeWorkspace,
  type WorkspaceMutationEnvelope,
  type WorkspaceObject,
  type WorkspaceObjectRevisionRef,
  type WorkspaceOperation,
  type WorkspaceQuery,
  type ExperienceProjectionPurpose
} from '@/app/workspace'
import {
  resolveExperienceProjections,
  type ExperienceProjectionMember
} from '@/app/workspace-ui/experience-projections'
import { baseScope } from '@/app/workspace-ui/helpers'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene,
  workspaceDocumentId
} from '@/app/workspace-ui/persistence'
import { workspacePluginValue } from '@/app/workspace-ui/projection'

type UnknownRecord = Record<string, unknown>

const SELECTED_NEIGHBORHOOD_LIMIT = 50
const EXPERIENCE_PURPOSES: ExperienceProjectionPurpose[] = [
  'focus',
  'compare',
  'knowledge',
  'review'
]

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const strings: string[] = []
  for (const item of value) {
    const string = readString(item)
    if (string) strings.push(string)
  }
  return strings
}

function objectMatchesSceneSelection(object: WorkspaceObject, selectedIds: Set<string>) {
  if (selectedIds.has(object.id)) return true
  if (object.type === 'surface-run' && selectedIds.has(object.artifact.boardId)) return true
  return (
    object.type === 'canvas-object' &&
    Boolean(object.sceneNodeId && selectedIds.has(object.sceneNodeId))
  )
}

function rootSurfaceReference(value: unknown): WorkspaceObjectRevisionRef {
  if (!isRecord(value)) throw new Error('root_surface is required')
  const objectId = readString(value.object_id)
  const revision = Number(value.revision)
  if (!objectId) throw new Error('root_surface.object_id is required')
  if (!Number.isInteger(revision) || revision <= 0) {
    throw new Error('root_surface.revision must be a positive integer')
  }
  return { objectId, revision }
}

function workspaceTarget(target: AutomationTarget) {
  const scope = baseScope(target.store)
  return {
    documentId: workspaceDocumentId(target.store.graph),
    pageId: scope.basePageId,
    name: `${target.documentName} / ${scope.basePageName}`
  }
}

export async function getKnowledgeWorkspaceContext(target: AutomationTarget) {
  ensureKnowledgeWorkspacesHydrated(target.store.graph)
  const workspace = resolveKnowledgeWorkspace(workspaceTarget(target))
  const objects = Object.values(workspace.objects).filter((object) => object.permissions.canView)
  const views = Object.values(workspace.views)
  const selectedIds = target.store.state.selectedIds
  const selectedItems = objects
    .filter((object) => objectMatchesSceneSelection(object, selectedIds))
    .slice(0, SELECTED_NEIGHBORHOOD_LIMIT)
  const primaryView = views.find((view) => view.primary && view.lifecycle === 'active') ?? null
  const orderedDocumentRoots = objects
    .filter(
      (object) =>
        object.type === 'document-block' && object.lifecycle === 'active' && !object.parentId
    )
    .sort((left, right) => {
      const leftOrder = left.type === 'document-block' ? left.order : 0
      const rightOrder = right.type === 'document-block' ? right.order : 0
      return leftOrder - rightOrder || left.id.localeCompare(right.id)
    })
    .map((object) => object.id)
  const liveBlocks = objects.filter((object) => object.type === 'live-app-block')
  const sourceRevisions = [
    ...new Set(liveBlocks.map((block) => block.sourceRevision).filter(Boolean))
  ]

  return {
    id: workspace.id,
    schemaVersion: workspace.schemaVersion,
    revision: workspace.revision,
    objectSchemas: [
      'document-block',
      'collection',
      'collection-record',
      'saved-view',
      'canvas-object',
      'graph-node',
      'graph-edge',
      'design-artifact',
      'live-app-block',
      'review-object',
      'intent-record',
      'evidence-manifest',
      'surface-run',
      'decision-receipt',
      'learning-receipt',
      'action-proposal',
      'action-execution-receipt',
      'action-verification-receipt',
      'action-rollback-receipt'
    ],
    orderedDocumentRoots,
    currentView: primaryView,
    selectedItems,
    selectedNeighborhoodTruncated:
      objects.filter((object) => objectMatchesSceneSelection(object, selectedIds)).length >
      SELECTED_NEIGHBORHOOD_LIMIT,
    activeRuntimeOwner: workspace.activeRuntimeBlockId ?? null,
    previewHealth: liveBlocks.reduce<Record<string, number>>((counts, block) => {
      counts[block.runtime.status] = (counts[block.runtime.status] ?? 0) + 1
      return counts
    }, {}),
    sourceRevision: sourceRevisions.length === 1 ? sourceRevisions[0] : sourceRevisions,
    baseRevision: null
  }
}

function exactExistingExperienceView(
  workspace: NonNullable<ReturnType<typeof getKnowledgeWorkspace>>,
  purpose: ExperienceProjectionPurpose,
  rootSurface: WorkspaceObjectRevisionRef
) {
  return (
    Object.values(workspace.views)
      .sort((left, right) => left.id.localeCompare(right.id))
      .find(
        (view) =>
          view.lifecycle === 'active' &&
          view.experienceProjection?.purpose === purpose &&
          view.experienceProjection.rootSurface.objectId === rootSurface.objectId &&
          view.experienceProjection.rootSurface.revision === rootSurface.revision
      ) ?? null
  )
}

function exactProjectionPageIds(
  target: AutomationTarget,
  workspaceId: string,
  basePageId: string,
  purpose: ExperienceProjectionPurpose,
  viewId: string
) {
  return target.store.graph
    .getPages()
    .filter(
      (page) =>
        workspacePluginValue(page, 'kind') === 'workspace-projection-page' &&
        workspacePluginValue(page, 'workspaceId') === workspaceId &&
        workspacePluginValue(page, 'basePageId') === basePageId &&
        workspacePluginValue(page, 'experiencePurpose') === purpose &&
        workspacePluginValue(page, 'viewId') === viewId
    )
    .map((page) => page.id)
    .sort((left, right) => left.localeCompare(right))
}

function assertProjectionMembersViewable(
  workspace: NonNullable<ReturnType<typeof getKnowledgeWorkspace>>,
  members: Record<ExperienceProjectionPurpose, ExperienceProjectionMember[]>
) {
  const denied = EXPERIENCE_PURPOSES.flatMap((purpose) => members[purpose]).find((member) => {
    const object = workspace.objects[member.objectId]
    return !object.permissions.canView
  })
  if (denied) {
    throw new Error(`projection_permission_denied: ${denied.objectId}@${denied.revision}`)
  }
}

export function getExperienceProjectionsContext(target: AutomationTarget, args: UnknownRecord) {
  if (target.store.state.currentPageId !== target.pageId) {
    throw new Error(
      `target_page_not_active: ${target.pageId}; activate the explicitly targeted page before reading experience projections`
    )
  }
  const rootSurface = rootSurfaceReference(args.root_surface)
  ensureKnowledgeWorkspacesHydrated(target.store.graph)
  const canonicalTarget = workspaceTarget(target)
  const workspace = getKnowledgeWorkspace(canonicalTarget.documentId, canonicalTarget.pageId)
  if (!workspace) {
    throw new Error(
      `knowledge_workspace_not_found: ${canonicalTarget.documentId}/${canonicalTarget.pageId}`
    )
  }
  const resolved = resolveExperienceProjections(workspace, rootSurface)
  assertProjectionMembersViewable(workspace, resolved.members)

  return {
    availablePurposes: [...resolved.availablePurposes],
    comparison: {
      basis: resolved.comparison.basis,
      companionSurfaces: [...resolved.comparison.companionSurfaces],
      modeId:
        resolved.comparison.status === 'available' ? (resolved.comparison.modeId ?? null) : null,
      reason: resolved.comparison.status === 'unavailable' ? resolved.comparison.reason : null,
      status: resolved.comparison.status
    },
    documentId: target.documentId,
    projections: EXPERIENCE_PURPOSES.map((purpose) => {
      const view = exactExistingExperienceView(workspace, purpose, rootSurface)
      const pageIds = view
        ? exactProjectionPageIds(target, workspace.id, canonicalTarget.pageId, purpose, view.id)
        : []
      return {
        available: resolved.availablePurposes.includes(purpose),
        existingView: view
          ? {
              activeOnTargetPage: pageIds.includes(target.pageId),
              pageIds,
              rendererViewId: view.experienceProjection?.rendererViewId ?? null,
              viewId: view.id,
              viewKind: view.kind,
              viewRevision: view.revision
            }
          : null,
        members: resolved.members[purpose].map((member, order) => ({ ...member, order })),
        purpose
      }
    }),
    rootSurface: { ...resolved.rootSurface },
    sceneRevision: target.store.state.sceneVersion,
    targetPageId: target.pageId,
    workspaceDocumentId: workspace.documentId,
    workspacePageId: workspace.pageId,
    workspaceRevision: workspace.revision
  }
}

export async function applyKnowledgeWorkspaceMutations(
  target: AutomationTarget,
  args: UnknownRecord
) {
  ensureKnowledgeWorkspacesHydrated(target.store.graph)
  const expectedRevision = Number(args.expected_revision)
  const idempotencyKey = readString(args.idempotency_key)
  const operations = Array.isArray(args.operations) ? (args.operations as WorkspaceOperation[]) : []
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('expected_revision is required for knowledge mutations')
  }
  if (!idempotencyKey) throw new Error('idempotency_key is required for knowledge mutations')
  if (operations.length === 0) throw new Error('operations must contain at least one mutation')

  const envelope: WorkspaceMutationEnvelope = {
    dryRun: args.dry_run === true,
    expectedRevision,
    idempotencyKey,
    operations
  }
  const canonicalTarget = workspaceTarget(target)
  resolveKnowledgeWorkspace(canonicalTarget)
  const outcome = mutateKnowledgeWorkspace(
    canonicalTarget.documentId,
    canonicalTarget.pageId,
    envelope
  )
  const mutationResult = outcome.result
  if (!mutationResult.dryRun) persistKnowledgeWorkspacesToScene(target.store.graph)
  return {
    ...mutationResult,
    newRevision: mutationResult.revision,
    historyEntryId: mutationResult.mutationId ?? null,
    conflicts: [],
    scopes: [mutationResult.scope]
  }
}

export async function queryKnowledgeWorkspaceItems(target: AutomationTarget, args: UnknownRecord) {
  ensureKnowledgeWorkspacesHydrated(target.store.graph)
  const workspace = resolveKnowledgeWorkspace(workspaceTarget(target))
  const relation: WorkspaceQuery['relation'] = isRecord(args.relation)
    ? {
        objectId: readString(args.relation.object_id) ?? '',
        direction:
          args.relation.direction === 'incoming' || args.relation.direction === 'outgoing'
            ? args.relation.direction
            : 'either',
        relationTypes: readStringArray(args.relation.relation_types)
      }
    : undefined
  const query: WorkspaceQuery = {
    text: readString(args.text),
    types: readStringArray(args.object_types) as WorkspaceQuery['types'],
    collectionId: readString(args.collection_id),
    tags: readStringArray(args.tags),
    route: readString(args.route),
    sourceTarget: readString(args.source_target),
    statuses: readStringArray(args.statuses),
    changedSinceRevision:
      args.changed_since_revision === undefined ? undefined : Number(args.changed_since_revision),
    relation,
    documentId: readString(args.document_id_filter) ?? target.documentId,
    pageId: readString(args.page_id_filter) ?? target.pageId,
    viewId: readString(args.view_id),
    includeArchived: args.include_archived === true,
    cursor: readString(args.cursor),
    limit: args.limit === undefined ? undefined : Number(args.limit)
  }
  const queryResult = queryWorkspaceItems(workspace, query)
  const includeBacklinks = args.include_backlinks === true
  return {
    items: queryResult.items.map(({ object: _object, ...hit }) => ({
      ...hit,
      ...(includeBacklinks ? { backlinks: getWorkspaceBacklinks(workspace, hit.id) } : {})
    })),
    nextCursor: queryResult.nextCursor,
    totalMatched: queryResult.totalMatched,
    scope: 'workspace-metadata' as const,
    workspaceRevision: workspace.revision
  }
}
