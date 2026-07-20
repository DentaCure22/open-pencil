import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'
import { htmlBoardDocument, isHtmlBoardFrame } from '@/app/html-board/workspace'
import {
  WorkspaceDomainError,
  createCollection,
  createCollectionRecord,
  createSavedView,
  createWorkspaceRelation,
  queryCollectionRecords,
  type Collection,
  type DecisionReceipt,
  type DecisionRecommendation,
  type KnowledgeWorkspace,
  type SavedView,
  type SurfaceRun,
  type WorkspaceObjectRevisionRef
} from '@/app/workspace'

import { canonicalWorkspace } from './context'
import {
  recordExplorerRecordId,
  recordExplorerSavedViewId,
  recordExplorerStablePart,
  validateRecordExplorerSpec
} from './model'
import type { RecordExplorerRenderState, RecordExplorerSpec } from './types'

type UnknownRecord = { [key: string]: unknown }

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function explorerIds(spec: RecordExplorerSpec) {
  const id = recordExplorerStablePart(spec.id)
  return {
    board: `html-board_${id}`,
    collection: `collection_${id}`,
    evidenceManifest: `evidence-manifest_${id}`,
    intent: `intent-record_${id}`,
    surface: `surface-run_${id}`
  }
}

export function recordIdsFor(spec: RecordExplorerSpec): string[] {
  return spec.records.map((record) => recordExplorerRecordId(spec.id, record.id))
}

export function savedViewIdsFor(spec: RecordExplorerSpec): string[] {
  return spec.views.map((view) => recordExplorerSavedViewId(spec.id, view.id))
}

export function referencedObject<ObjectType extends 'intent-record' | 'evidence-manifest'>(
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

function collectionFor(workspace: KnowledgeWorkspace, id: string): Collection {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('reconstruction_conflict', `collection ${id} is unavailable`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'collection') {
    throw new WorkspaceDomainError('reconstruction_conflict', `collection ${id} is unavailable`)
  }
  return object
}

function savedViewFor(workspace: KnowledgeWorkspace, id: string): SavedView {
  if (!Object.hasOwn(workspace.objects, id)) {
    throw new WorkspaceDomainError('reconstruction_conflict', `saved view ${id} is unavailable`)
  }
  const object = workspace.objects[id]
  if (object.type !== 'saved-view') {
    throw new WorkspaceDomainError('reconstruction_conflict', `saved view ${id} is unavailable`)
  }
  return object
}

export function receiptFor(
  workspace: KnowledgeWorkspace,
  surfaceId: string
): DecisionReceipt | undefined {
  return Object.values(workspace.objects).find(
    (object): object is DecisionReceipt =>
      object.type === 'decision-receipt' && object.surfaceRun.objectId === surfaceId
  )
}

export function specForBoard(board: SceneNode): RecordExplorerSpec {
  const source = htmlBoardDocument(board).artifact?.source
  if (!source) {
    throw new WorkspaceDomainError('reconstruction_conflict', 'record explorer source is missing')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new WorkspaceDomainError('reconstruction_conflict', 'record explorer source is invalid')
  }
  const spec = isRecord(parsed) ? parsed.spec : null
  if (!isRecord(spec)) {
    throw new WorkspaceDomainError('reconstruction_conflict', 'record explorer spec is unavailable')
  }
  validateRecordExplorerSpec(spec)
  return spec
}

function latestInputValue(surface: SurfaceRun, inputId: string): string | undefined {
  return [...surface.interactions]
    .reverse()
    .find((interaction) => interaction.action === 'adjust' && interaction.inputId === inputId)
    ?.value?.toString()
}

function activeViewId(surface: SurfaceRun, spec: RecordExplorerSpec): string {
  return (
    latestInputValue(surface, 'active-view') ??
    recordExplorerSavedViewId(spec.id, spec.defaultViewId)
  )
}

export function focusedRecordId(surface: SurfaceRun): string | undefined {
  return latestInputValue(surface, 'focused-record')
}

export function explorerState(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  spec: RecordExplorerSpec,
  receipt = receiptFor(workspace, surface.id)
): RecordExplorerRenderState {
  const ids = explorerIds(spec)
  collectionFor(workspace, ids.collection)
  const activeView = savedViewFor(workspace, activeViewId(surface, spec))
  const query = queryCollectionRecords(workspace, { limit: 50, savedViewId: activeView.id })
  const candidate = focusedRecordId(surface)
  return {
    activeView,
    artifactRevision: surface.artifact.boardRevision,
    collectionId: ids.collection,
    evidence: referencedObject(workspace, surface.evidenceManifest, 'evidence-manifest'),
    focusedRecordId: query.records.some((record) => record.id === candidate)
      ? candidate
      : undefined,
    intent: referencedObject(workspace, surface.intent, 'intent-record'),
    receipt,
    records: query.records,
    spec,
    surface,
    workspaceRevision: workspace.revision
  }
}

export function recordExplorerStateForBoard(
  store: EditorStore,
  board: SceneNode
): RecordExplorerRenderState | null {
  const artifact = isHtmlBoardFrame(board) ? htmlBoardDocument(board).artifact : null
  if (artifact?.kind !== 'record-explorer-surface') return null
  const workspace = canonicalWorkspace(store)
  if (!Object.hasOwn(workspace.objects, artifact.artifactId)) return null
  const object = workspace.objects[artifact.artifactId]
  if (object.type !== 'surface-run') return null
  return explorerState(workspace, object, specForBoard(board))
}

export function recommendationsFor(spec: RecordExplorerSpec): DecisionRecommendation[] {
  return spec.records.map((record, index) => ({
    evidenceItemIds: [...(record.evidenceItemIds ?? [])],
    id: `recommendation_${recordExplorerRecordId(spec.id, record.id)}`,
    rank: index + 1,
    rationale: 'This record can be selected as the explicit focus of the triage checkpoint.',
    status: 'active',
    title: record.title,
    tradeoff: 'Recording focus does not mutate the record or its source status.',
    uncertainty: 'Only the captured evidence manifest is claimed.'
  }))
}

export function supportingObjects(
  spec: RecordExplorerSpec,
  context: Parameters<typeof createCollection>[0]
) {
  const ids = explorerIds(spec)
  const recordIds = recordIdsFor(spec)
  const savedViewIds = savedViewIdsFor(spec)
  const collection = createCollection(context, {
    description: spec.subtitle,
    id: ids.collection,
    name: spec.title,
    properties: spec.fields,
    recordIds,
    savedViewIds,
    tags: ['record-explorer', 'shared-model']
  })
  const records = spec.records.map((record, index) =>
    createCollectionRecord(context, {
      collectionId: collection.id,
      id: recordIds[index],
      properties: record.properties,
      tags: ['record-explorer', 'triage-record'],
      title: record.title
    })
  )
  const savedViews = spec.views.map((view, index) =>
    createSavedView(context, {
      collectionId: collection.id,
      filters: view.filters,
      groupByPropertyId: view.groupByPropertyId,
      id: savedViewIds[index],
      name: view.label,
      sorts: view.sorts,
      tags: ['record-explorer', 'saved-view'],
      viewKind: view.kind,
      visiblePropertyIds: view.visiblePropertyIds
    })
  )
  return { collection, records, savedViews }
}

export function workspaceWith(
  workspace: KnowledgeWorkspace,
  objects: Array<KnowledgeWorkspace['objects'][string]>
): KnowledgeWorkspace {
  return {
    ...workspace,
    objects: Object.fromEntries([
      ...Object.entries(workspace.objects),
      ...objects.map((object) => [object.id, { ...object, revision: 1 }])
    ])
  }
}

export function relationsFor(spec: RecordExplorerSpec, workspaceId: string) {
  const ids = explorerIds(spec)
  const relations = [
    [ids.surface, ids.intent, 'fulfills-intent', 'intent'],
    [ids.surface, ids.evidenceManifest, 'uses-evidence', 'evidence'],
    [ids.surface, ids.collection, 'projects-collection', 'collection'],
    ...recordIdsFor(spec).map((recordId, index) => [
      ids.collection,
      recordId,
      'contains-record',
      `record-${index + 1}`
    ]),
    ...savedViewIdsFor(spec).map((viewId, index) => [
      ids.collection,
      viewId,
      'has-saved-view',
      `view-${index + 1}`
    ])
  ]
  return relations.map(([sourceId, targetId, relationType, suffix]) =>
    createWorkspaceRelation({
      id: `relation_${recordExplorerStablePart(spec.id)}-${suffix}`,
      relationType,
      sourceId,
      targetId,
      workspaceId
    })
  )
}
