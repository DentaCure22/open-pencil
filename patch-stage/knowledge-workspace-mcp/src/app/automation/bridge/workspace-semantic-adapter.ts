import type { AutomationTarget } from '@/app/automation/bridge/target'
import {
  getWorkspaceBacklinks,
  mutateKnowledgeWorkspace,
  queryWorkspaceItems,
  resolveKnowledgeWorkspace,
  type WorkspaceMutationEnvelope,
  type WorkspaceObject,
  type WorkspaceOperation,
  type WorkspaceQuery
} from '@/app/workspace'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene
} from '@/app/workspace-ui/persistence'

type UnknownRecord = Record<string, unknown>

const SELECTED_NEIGHBORHOOD_LIMIT = 50

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
  return (
    object.type === 'canvas-object' &&
    Boolean(object.sceneNodeId && selectedIds.has(object.sceneNodeId))
  )
}

function workspaceTarget(target: AutomationTarget) {
  return {
    documentId: target.documentId,
    pageId: target.pageId,
    name: `${target.documentName} / ${target.pageName}`
  }
}

export async function getKnowledgeWorkspaceContext(target: AutomationTarget) {
  ensureKnowledgeWorkspacesHydrated(target.store.graph)
  const workspace = resolveKnowledgeWorkspace(workspaceTarget(target))
  const objects = Object.values(workspace.objects)
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
      'review-object'
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
  resolveKnowledgeWorkspace(workspaceTarget(target))
  const outcome = mutateKnowledgeWorkspace(target.documentId, target.pageId, envelope)
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
