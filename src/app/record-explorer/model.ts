import { WorkspaceDomainError, type WorkspacePropertyValue } from '@/app/workspace'

import type {
  RecordExplorerDefinition,
  RecordExplorerRecordDefinition,
  RecordExplorerSpec,
  RecordExplorerViewDefinition
} from './types'

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/
const FIELD_TYPES = new Set(['checkbox', 'date', 'number', 'select', 'status', 'text'])
const FILTER_OPERATORS = new Set([
  'contains',
  'equals',
  'greater-than-or-equal',
  'in',
  'is-empty',
  'is-not-empty',
  'less-than-or-equal',
  'not-equals'
])
const VIEW_KINDS = new Set(['board', 'list', 'table'])

function invalid(message: string): never {
  throw new WorkspaceDomainError('validation_failed', message)
}

function requireId(id: string, label: string): void {
  if (!ID_PATTERN.test(id)) invalid(`${label} must be a stable id`)
}

export function recordExplorerStablePart(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!result) invalid('record explorer id is required')
  return result.slice(0, 80)
}

export function recordExplorerRecordId(specId: string, recordId: string): string {
  return `collection-record_${recordExplorerStablePart(specId)}-${recordExplorerStablePart(recordId)}`
}

export function recordExplorerSavedViewId(specId: string, viewId: string): string {
  return `saved-view_${recordExplorerStablePart(specId)}-${recordExplorerStablePart(viewId)}`
}

function requireText(value: string, label: string, maximum: number): void {
  const length = value.trim().length
  if (length === 0 || length > maximum) invalid(`${label} must contain 1-${maximum} characters`)
}

function scalarMatches(value: WorkspacePropertyValue, type: string): boolean {
  if (Array.isArray(value)) return false
  if (value === null) return true
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'checkbox') return typeof value === 'boolean'
  return typeof value === 'string'
}

function validateFields(
  definition: RecordExplorerDefinition
): Map<string, (typeof definition.fields)[number]> {
  if (definition.fields.length < 2 || definition.fields.length > 12) {
    invalid('record explorer requires between 2 and 12 fields')
  }
  const fields = new Map<string, (typeof definition.fields)[number]>()
  for (const field of definition.fields) {
    requireId(field.id, 'record explorer field id')
    requireText(field.label, `field ${field.id} label`, 100)
    if (!FIELD_TYPES.has(field.type))
      invalid(`field ${field.id} has unsupported type ${field.type}`)
    if (fields.has(field.id)) invalid(`record explorer field ${field.id} is duplicated`)
    if (field.type === 'select' || field.type === 'status') {
      if (!field.options || field.options.length < 2 || field.options.length > 12) {
        invalid(`field ${field.id} requires between 2 and 12 options`)
      }
      const optionIds = new Set<string>()
      for (const option of field.options) {
        requireId(option.id, `field ${field.id} option id`)
        requireText(option.label, `field ${field.id} option ${option.id} label`, 80)
        if (optionIds.has(option.id)) invalid(`field ${field.id} option ${option.id} is duplicated`)
        optionIds.add(option.id)
      }
    } else if (field.options?.length) {
      invalid(`field ${field.id} cannot declare options for type ${field.type}`)
    }
    fields.set(field.id, field)
  }
  return fields
}

function validateRecord(
  record: RecordExplorerRecordDefinition,
  fields: Map<string, CollectionField>
): void {
  requireId(record.id, 'record explorer record id')
  requireText(record.title, `record ${record.id} title`, 160)
  for (const [propertyId, value] of Object.entries(record.properties)) {
    const field = fields.get(propertyId)
    if (!field) invalid(`record ${record.id} uses unknown field ${propertyId}`)
    if (!scalarMatches(value, field.type)) {
      invalid(`record ${record.id} field ${propertyId} does not match ${field.type}`)
    }
    if ((field.type === 'select' || field.type === 'status') && value !== null) {
      const options = new Set(field.options?.map((option) => option.id))
      if (!options.has(String(value)))
        invalid(`record ${record.id} field ${propertyId} has unknown option`)
    }
    if (field.type === 'date' && value !== null && Number.isNaN(Date.parse(String(value)))) {
      invalid(`record ${record.id} field ${propertyId} must be an ISO date`)
    }
  }
  for (const field of fields.values()) {
    if (field.required && !Object.hasOwn(record.properties, field.id)) {
      invalid(`record ${record.id} is missing required field ${field.id}`)
    }
  }
}

type CollectionField = RecordExplorerDefinition['fields'][number]

function validateView(
  view: RecordExplorerViewDefinition,
  fields: Map<string, CollectionField>
): void {
  requireId(view.id, 'record explorer view id')
  requireText(view.label, `view ${view.id} label`, 100)
  if (!VIEW_KINDS.has(view.kind)) invalid(`view ${view.id} has unsupported kind ${view.kind}`)
  if (view.visiblePropertyIds.length < 1 || view.visiblePropertyIds.length > 8) {
    invalid(`view ${view.id} must show between 1 and 8 fields`)
  }
  for (const propertyId of view.visiblePropertyIds) {
    if (!fields.has(propertyId)) invalid(`view ${view.id} shows unknown field ${propertyId}`)
  }
  if (view.groupByPropertyId && !fields.has(view.groupByPropertyId)) {
    invalid(`view ${view.id} groups by unknown field ${view.groupByPropertyId}`)
  }
  for (const sort of view.sorts) {
    if (!fields.has(sort.propertyId))
      invalid(`view ${view.id} sorts unknown field ${sort.propertyId}`)
  }
  for (const filter of view.filters) {
    if (!fields.has(filter.propertyId)) {
      invalid(`view ${view.id} filters unknown field ${filter.propertyId}`)
    }
    if (!FILTER_OPERATORS.has(filter.operator)) {
      invalid(`view ${view.id} has unsupported filter ${filter.operator}`)
    }
    const needsValue = filter.operator !== 'is-empty' && filter.operator !== 'is-not-empty'
    if (needsValue && filter.value === undefined) {
      invalid(`view ${view.id} filter ${filter.propertyId} requires a value`)
    }
  }
}

export function validateRecordExplorerDefinition(definition: RecordExplorerDefinition): void {
  requireText(definition.subtitle, 'record explorer subtitle', 500)
  const fields = validateFields(definition)
  if (definition.records.length < 2 || definition.records.length > 50) {
    invalid('record explorer requires between 2 and 50 records')
  }
  const recordIds = new Set<string>()
  for (const record of definition.records) {
    validateRecord(record, fields)
    if (recordIds.has(record.id)) invalid(`record explorer record ${record.id} is duplicated`)
    recordIds.add(record.id)
  }
  if (definition.views.length < 1 || definition.views.length > 6) {
    invalid('record explorer requires between 1 and 6 saved views')
  }
  const viewIds = new Set<string>()
  for (const view of definition.views) {
    validateView(view, fields)
    if (viewIds.has(view.id)) invalid(`record explorer view ${view.id} is duplicated`)
    viewIds.add(view.id)
  }
  if (!viewIds.has(definition.defaultViewId)) {
    invalid(`record explorer default view ${definition.defaultViewId} is unavailable`)
  }
}

function isRecordExplorerSpecShape(value: unknown): value is RecordExplorerSpec {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<RecordExplorerSpec>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.capturedAt === 'string' &&
    Boolean(candidate.intent) &&
    Array.isArray(candidate.fields) &&
    Array.isArray(candidate.records) &&
    Array.isArray(candidate.views) &&
    Array.isArray(candidate.evidence)
  )
}

export function validateRecordExplorerSpec(spec: unknown): asserts spec is RecordExplorerSpec {
  if (!isRecordExplorerSpecShape(spec)) invalid('record explorer spec is invalid')
  validateRecordExplorerDefinition(spec)
  requireId(spec.id, 'record explorer id')
  requireText(spec.title, 'record explorer title', 160)
  requireText(spec.intent.statement, 'record explorer intent', 500)
  requireText(spec.intent.desiredOutcome, 'record explorer desired outcome', 500)
  const evidenceIds = new Set(spec.evidence.map((item) => item.id))
  if (evidenceIds.size !== spec.evidence.length)
    invalid('record explorer evidence ids must be unique')
  for (const record of spec.records) {
    if (!record.evidenceItemIds?.length) invalid(`record ${record.id} requires evidence`)
    if (record.evidenceItemIds.some((id) => !evidenceIds.has(id))) {
      invalid(`record ${record.id} cites evidence outside its manifest`)
    }
  }
}
