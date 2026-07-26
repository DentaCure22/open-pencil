import {
  actionLifecycleSearchableText,
  actionLifecycleSourceTargets,
  actionLifecycleStatuses,
  actionLifecycleTitle,
  isActionLifecycleObject
} from './action-query'
import { WorkspaceDomainError } from './errors'
import {
  experienceSearchableText,
  experienceSourceTargets,
  experienceStatuses,
  experienceTitle,
  isExperienceObject
} from './experience-query'
import type {
  CollectionRecord,
  GraphEdge,
  KnowledgeWorkspace,
  SavedView,
  SavedViewFilter,
  WorkspaceObject,
  WorkspaceObjectType,
  WorkspacePropertyValue
} from './types'

export type WorkspaceRelationQuery = {
  direction: 'incoming' | 'outgoing' | 'either'
  objectId: string
  relationTypes?: string[]
}

export type WorkspaceQuery = {
  changedSinceRevision?: number
  collectionId?: string
  cursor?: string
  documentId?: string
  includeArchived?: boolean
  limit?: number
  pageId?: string
  relation?: WorkspaceRelationQuery
  sourceTarget?: string
  statuses?: string[]
  tags?: string[]
  text?: string
  types?: WorkspaceObjectType[]
  viewId?: string
}

export type WorkspaceQueryHit = {
  excerpt: string
  id: string
  object: WorkspaceObject
  revision: number
  title: string
  type: WorkspaceObjectType
}

export type WorkspaceQueryResult = {
  items: WorkspaceQueryHit[]
  nextCursor?: string
  totalMatched: number
}

export type CollectionRecordQuery = {
  cursor?: string
  includeArchived?: boolean
  limit?: number
  savedViewId: string
}

export type CollectionRecordQueryResult = {
  nextCursor?: string
  records: CollectionRecord[]
  totalMatched: number
}

export type WorkspaceBacklink = {
  kind: 'relation' | 'graph-edge'
  label?: string
  relationId: string
  relationType: string
  sourceId: string
  targetId: string
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function unreachable(value: never): never {
  throw new WorkspaceDomainError(
    'validation_failed',
    `unsupported workspace value: ${String(value)}`
  )
}

function readLimit(value?: number): number {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || value < 1) {
    throw new WorkspaceDomainError('validation_failed', 'query limit must be a positive integer')
  }
  return Math.min(value, MAX_LIMIT)
}

function encodeCursor(offset: number): string {
  return `workspace_v1_${offset.toString(36)}`
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0
  if (!cursor.startsWith('workspace_v1_')) {
    throw new WorkspaceDomainError('validation_failed', 'invalid workspace query cursor')
  }
  const offset = Number.parseInt(cursor.slice('workspace_v1_'.length), 36)
  if (!Number.isInteger(offset) || offset < 0) {
    throw new WorkspaceDomainError('validation_failed', 'invalid workspace query cursor')
  }
  return offset
}

function propertyText(value: WorkspacePropertyValue): string {
  if (Array.isArray(value)) return value.map(String).join(' ')
  return value === null ? '' : String(value)
}

function titleFor(object: WorkspaceObject): string {
  if (isActionLifecycleObject(object)) return actionLifecycleTitle(object)
  if (isExperienceObject(object)) return experienceTitle(object)
  switch (object.type) {
    case 'document-block':
      return object.text.slice(0, 120) || object.blockKind
    case 'collection':
    case 'saved-view':
      return object.name
    case 'collection-record':
      return object.title
    case 'canvas-object':
      return object.label ?? object.canvasKind
    case 'graph-node':
      return object.label
    case 'graph-edge':
      return object.label ?? object.relationshipType
    case 'design-artifact':
      return object.label
    case 'review-object':
      return object.body.slice(0, 120) || object.reviewKind
  }
  return unreachable(object)
}

function searchableText(object: WorkspaceObject): string {
  if (isActionLifecycleObject(object)) return actionLifecycleSearchableText(object)
  if (isExperienceObject(object)) return experienceSearchableText(object)
  const common = [object.id, object.type, object.tags.join(' ')]
  switch (object.type) {
    case 'document-block':
      return [
        ...common,
        object.blockKind,
        object.text,
        ...Object.values(object.attributes).map(propertyText)
      ].join(' ')
    case 'collection':
      return [
        ...common,
        object.name,
        object.description ?? '',
        ...object.properties.flatMap((item) => [item.id, item.label])
      ].join(' ')
    case 'collection-record':
      return [...common, object.title, ...Object.values(object.properties).map(propertyText)].join(
        ' '
      )
    case 'saved-view':
      return [...common, object.name, object.viewKind].join(' ')
    case 'canvas-object':
      return [
        ...common,
        object.canvasKind,
        object.label ?? '',
        ...Object.values(object.data).map(propertyText)
      ].join(' ')
    case 'graph-node':
      return [
        ...common,
        object.graphKind,
        object.label,
        ...Object.values(object.data).map(propertyText)
      ].join(' ')
    case 'graph-edge':
      return [
        ...common,
        object.graphKind,
        object.relationshipType,
        object.label ?? '',
        object.condition ?? ''
      ].join(' ')
    case 'design-artifact':
      return [
        ...common,
        object.artifactKind,
        object.label,
        object.sourceRef ?? '',
        ...Object.values(object.data).map(propertyText)
      ].join(' ')
    case 'review-object':
      return [...common, object.reviewKind, object.reviewStatus, object.body].join(' ')
  }
  return unreachable(object)
}

function statusesFor(object: WorkspaceObject): string[] {
  const statuses: string[] = [object.lifecycle]
  if (isActionLifecycleObject(object)) return [...statuses, ...actionLifecycleStatuses(object)]
  if (isExperienceObject(object)) return [...statuses, ...experienceStatuses(object)]
  if (object.type === 'review-object') statuses.push(object.reviewStatus)
  if (object.type === 'design-artifact') statuses.push(object.ownership)
  return statuses
}

function sourceTargetsFor(object: WorkspaceObject): string[] {
  const targets = [object.provenance.sourceRef]
  if (isActionLifecycleObject(object)) {
    targets.push(...actionLifecycleSourceTargets(object))
    return targets.filter((target): target is string => target !== undefined)
  }
  if (isExperienceObject(object)) {
    targets.push(...experienceSourceTargets(object))
    return targets.filter((target): target is string => target !== undefined)
  }
  if (object.type === 'design-artifact') targets.push(object.sourceRef)
  return targets.filter((target): target is string => target !== undefined)
}

function relationMatchesType(relationType: string, allowed?: string[]): boolean {
  return !allowed || allowed.includes(relationType)
}

function isRelated(
  workspace: KnowledgeWorkspace,
  candidateId: string,
  query: WorkspaceRelationQuery
): boolean {
  const relationships = [
    ...Object.values(workspace.relations)
      .filter((relation) => relation.lifecycle === 'active')
      .map((relation) => ({
        relationType: relation.relationType,
        sourceId: relation.sourceId,
        targetId: relation.targetId
      })),
    ...Object.values(workspace.objects)
      .filter(
        (object): object is GraphEdge =>
          object.type === 'graph-edge' && object.lifecycle === 'active'
      )
      .map((edge) => ({
        relationType: edge.relationshipType,
        sourceId: edge.sourceId,
        targetId: edge.targetId
      }))
  ]
  return relationships.some((relation) => {
    if (!relationMatchesType(relation.relationType, query.relationTypes)) return false
    const incoming = relation.targetId === query.objectId && relation.sourceId === candidateId
    const outgoing = relation.sourceId === query.objectId && relation.targetId === candidateId
    if (query.direction === 'incoming') return incoming
    if (query.direction === 'outgoing') return outgoing
    return incoming || outgoing
  })
}

function matchesScope(object: WorkspaceObject, query: WorkspaceQuery): boolean {
  if (!object.permissions.canView) return false
  if (!query.includeArchived && object.lifecycle === 'archived') return false
  if (query.documentId && object.documentId !== query.documentId) return false
  if (query.pageId && object.pageId !== query.pageId) return false
  if (query.types && !query.types.includes(object.type)) return false
  if (
    query.collectionId &&
    object.collectionId !== query.collectionId &&
    object.id !== query.collectionId
  ) {
    return false
  }
  return true
}

function matchesMetadata(object: WorkspaceObject, query: WorkspaceQuery): boolean {
  if (query.tags && !query.tags.every((tag) => object.tags.includes(tag))) return false
  if (query.viewId && !Object.hasOwn(object.projections, query.viewId)) return false
  if (
    query.changedSinceRevision !== undefined &&
    object.lastWorkspaceRevision <= query.changedSinceRevision
  ) {
    return false
  }
  if (query.statuses && !query.statuses.some((status) => statusesFor(object).includes(status)))
    return false
  return true
}

function matchesSpecializedFields(object: WorkspaceObject, query: WorkspaceQuery): boolean {
  if (query.sourceTarget && !sourceTargetsFor(object).includes(query.sourceTarget)) return false
  if (
    query.text &&
    !searchableText(object).toLocaleLowerCase().includes(query.text.toLocaleLowerCase())
  )
    return false
  return true
}

function matchesWorkspaceQuery(
  workspace: KnowledgeWorkspace,
  object: WorkspaceObject,
  query: WorkspaceQuery
): boolean {
  if (!matchesScope(object, query)) return false
  if (!matchesMetadata(object, query)) return false
  if (!matchesSpecializedFields(object, query)) return false
  if (query.relation && !isRelated(workspace, object.id, query.relation)) return false
  return true
}

function excerptFor(object: WorkspaceObject, text?: string): string {
  const source = searchableText(object).replace(/\s+/g, ' ').trim()
  if (!text) return source.slice(0, 180)
  const index = source.toLocaleLowerCase().indexOf(text.toLocaleLowerCase())
  const start = Math.max(0, index - 50)
  return source.slice(start, start + 180)
}

export function queryWorkspaceItems(
  workspace: KnowledgeWorkspace,
  query: WorkspaceQuery = {}
): WorkspaceQueryResult {
  const matches = Object.values(workspace.objects)
    .filter((object) => matchesWorkspaceQuery(workspace, object, query))
    .sort((left, right) => {
      const revisionDifference = right.lastWorkspaceRevision - left.lastWorkspaceRevision
      return revisionDifference || left.id.localeCompare(right.id)
    })
  const offset = decodeCursor(query.cursor)
  const limit = readLimit(query.limit)
  const page = matches.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    items: page.map((object) => ({
      excerpt: excerptFor(object, query.text),
      id: object.id,
      object,
      revision: object.revision,
      title: titleFor(object),
      type: object.type
    })),
    nextCursor: nextOffset < matches.length ? encodeCursor(nextOffset) : undefined,
    totalMatched: matches.length
  }
}

function isEmpty(value: WorkspacePropertyValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function normalizedValues(value: WorkspacePropertyValue | undefined): WorkspaceScalarComparable[] {
  if (value === undefined) return []
  return (Array.isArray(value) ? value : [value]).map((item) => item)
}

type WorkspaceScalarComparable = string | number | boolean | null

function valuesEqual(
  left: WorkspacePropertyValue | undefined,
  right: WorkspacePropertyValue | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function compareScalar(
  left: WorkspaceScalarComparable | undefined,
  right: WorkspaceScalarComparable | undefined
): number {
  if (left === right) return 0
  if (left === undefined || left === null) return -1
  if (right === undefined || right === null) return 1
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

function matchesSavedViewFilter(record: CollectionRecord, filter: SavedViewFilter): boolean {
  const current = record.properties[filter.propertyId]
  switch (filter.operator) {
    case 'equals':
      return valuesEqual(current, filter.value)
    case 'not-equals':
      return !valuesEqual(current, filter.value)
    case 'contains':
      return normalizedValues(current).some((value) =>
        normalizedValues(filter.value).some((expected) =>
          String(value).toLocaleLowerCase().includes(String(expected).toLocaleLowerCase())
        )
      )
    case 'is-empty':
      return isEmpty(current)
    case 'is-not-empty':
      return !isEmpty(current)
    case 'in':
      return normalizedValues(current).some((value) =>
        normalizedValues(filter.value).includes(value)
      )
    case 'greater-than-or-equal':
      return compareScalar(normalizedValues(current)[0], normalizedValues(filter.value)[0]) >= 0
    case 'less-than-or-equal':
      return compareScalar(normalizedValues(current)[0], normalizedValues(filter.value)[0]) <= 0
  }
  return unreachable(filter.operator)
}

function requireSavedView(workspace: KnowledgeWorkspace, savedViewId: string): SavedView {
  if (!Object.hasOwn(workspace.objects, savedViewId)) {
    throw new WorkspaceDomainError('not_found', `saved view ${savedViewId}`)
  }
  const savedView = workspace.objects[savedViewId]
  if (savedView.type !== 'saved-view') {
    throw new WorkspaceDomainError('not_found', `saved view ${savedViewId}`)
  }
  return savedView
}

export function queryCollectionRecords(
  workspace: KnowledgeWorkspace,
  query: CollectionRecordQuery
): CollectionRecordQueryResult {
  const savedView = requireSavedView(workspace, query.savedViewId)
  const records = Object.values(workspace.objects)
    .filter(
      (object): object is CollectionRecord =>
        object.type === 'collection-record' &&
        object.permissions.canView &&
        object.collectionId === savedView.collectionId &&
        (query.includeArchived || object.lifecycle === 'active') &&
        savedView.filters.every((filter) => matchesSavedViewFilter(object, filter))
    )
    .sort((left, right) => {
      for (const sort of savedView.sorts) {
        const comparison = compareScalar(
          normalizedValues(left.properties[sort.propertyId])[0],
          normalizedValues(right.properties[sort.propertyId])[0]
        )
        if (comparison) return sort.direction === 'ascending' ? comparison : -comparison
      }
      return left.id.localeCompare(right.id)
    })
  const offset = decodeCursor(query.cursor)
  const limit = readLimit(query.limit)
  const page = records.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    nextCursor: nextOffset < records.length ? encodeCursor(nextOffset) : undefined,
    records: page,
    totalMatched: records.length
  }
}

export function getWorkspaceBacklinks(
  workspace: KnowledgeWorkspace,
  objectId: string,
  includeArchived = false
): WorkspaceBacklink[] {
  if (!Object.hasOwn(workspace.objects, objectId)) return []
  const target = workspace.objects[objectId]
  if (!target.permissions.canView) return []
  const relationBacklinks = Object.values(workspace.relations)
    .filter(
      (relation) =>
        relation.targetId === objectId &&
        Boolean(workspace.objects[relation.sourceId]?.permissions.canView) &&
        (includeArchived || relation.lifecycle === 'active')
    )
    .map(
      (relation): WorkspaceBacklink => ({
        kind: 'relation',
        label: relation.label,
        relationId: relation.id,
        relationType: relation.relationType,
        sourceId: relation.sourceId,
        targetId: relation.targetId
      })
    )
  const edgeBacklinks = Object.values(workspace.objects)
    .filter(
      (object): object is GraphEdge =>
        object.type === 'graph-edge' &&
        object.permissions.canView &&
        Boolean(workspace.objects[object.sourceId]?.permissions.canView) &&
        object.targetId === objectId &&
        (includeArchived || object.lifecycle === 'active')
    )
    .map(
      (edge): WorkspaceBacklink => ({
        kind: 'graph-edge',
        label: edge.label,
        relationId: edge.id,
        relationType: edge.relationshipType,
        sourceId: edge.sourceId,
        targetId: edge.targetId
      })
    )
  return [...relationBacklinks, ...edgeBacklinks].sort((left, right) =>
    left.relationId.localeCompare(right.relationId)
  )
}
