import { ALL_TOOLS } from '@open-pencil/core/tools'

import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'

const EXACT_BOARD_TARGET_FIELDS = [
  'runtime_instance_id',
  'workspace_id',
  'document_id',
  'content_document_id',
  'page_id'
]
const EXACT_DOCUMENT_TARGET_FIELDS = [
  'runtime_instance_id',
  'document_id',
  'content_document_id',
  'page_id'
]

const BUILD_BASE_FIELDS = [
  ...EXACT_BOARD_TARGET_FIELDS,
  'context_token',
  'contract',
  'expected_revision'
]
const CONNECTION_BASE_FIELDS = [...EXACT_BOARD_TARGET_FIELDS, 'context_token', 'expected_revision']

const CONTEXT_BOUND_BOARD_COMMANDS = new Set([
  'board_change',
  'board_fixture',
  'board_present',
  'board_read',
  'board_verify',
  'connect_objects'
])

export const LIVE_APP_EVAL_DISABLED_MESSAGE =
  'Live-app eval is disabled because arbitrary code cannot provide a guarded durable mutation receipt. Use a guarded tool or board_build instead.'

function hasString(args: UnknownRecord, field: string): boolean {
  const value = args[field]
  return typeof value === 'string' && value.trim().length > 0
}

export function normalizeGuardedAutomationArgs(
  command: string,
  args: UnknownRecord
): UnknownRecord {
  let baseFields: string[] | null = null
  if (command === 'board_build') baseFields = BUILD_BASE_FIELDS
  if (command === 'connect_objects') baseFields = CONNECTION_BASE_FIELDS
  if (!baseFields || !('base' in args)) return args
  if (!isUnknownRecord(args.base)) {
    throw new Error(`${command} base must be the copy-ready object returned by Board context.`)
  }
  const conflicts = baseFields.filter((field) => field in args)
  if (conflicts.length > 0) {
    throw new Error(
      `${command} base cannot be combined with flattened fields: ${conflicts.join(', ')}.`
    )
  }
  const { base, ...logicalArgs } = args
  return { ...base, ...logicalArgs }
}

function requireFields(command: string, args: UnknownRecord, fields: string[]): void {
  const missing = fields.filter((field) => !hasString(args, field))
  if (missing.length === 0) return
  throw new Error(`${command} requires exact target fields: ${missing.join(', ')}.`)
}

function requireDurableDocument(command: string, args: UnknownRecord): void {
  if (hasString(args, 'workspace_id') || hasString(args, 'document_id')) return
  throw new Error(
    `${command} requires workspace_id or document_id; active-document fallback is disabled.`
  )
}

function isCurrentVisibleContext(args: UnknownRecord): boolean {
  return args.target === 'current_visible'
}

function requireCurrentVisibleContextShape(args: UnknownRecord): void {
  const conflicting = ['workspace_id', 'document_id', 'content_document_id', 'page_id'].filter(
    (field) => hasString(args, field)
  )
  if (conflicting.length === 0) return
  throw new Error(
    `board_context target current_visible cannot be combined with: ${conflicting.join(', ')}.`
  )
}

function isMutatingToolRequest(args: UnknownRecord): boolean {
  const name = args.name
  return (
    typeof name === 'string' &&
    ALL_TOOLS.some((tool) => tool.name === name && tool.mutates === true)
  )
}

function requireGuardedMutation(command: string, args: UnknownRecord): void {
  const mutation = args.mutation
  if (!isUnknownRecord(mutation)) {
    throw new Error(
      `${command} requires guarded mutation fields: mutation.expectedRevision, mutation.requestId.`
    )
  }
  const expectedRevision = mutation.expectedRevision
  const requestId = mutation.requestId
  const missing = [
    ...(typeof expectedRevision === 'number' &&
    Number.isInteger(expectedRevision) &&
    expectedRevision >= 0
      ? []
      : ['mutation.expectedRevision']),
    ...(typeof requestId === 'string' && requestId.trim().length > 0 ? [] : ['mutation.requestId'])
  ]
  if (missing.length === 0) return
  throw new Error(`${command} requires guarded mutation fields: ${missing.join(', ')}.`)
}

export function assertGuardedAutomationTarget(command: string, args: UnknownRecord): void {
  if (command === 'eval') {
    throw new Error(LIVE_APP_EVAL_DISABLED_MESSAGE)
  }
  if (command === 'board_context' || command === 'board_prepare_edit') {
    if (isCurrentVisibleContext(args)) {
      if (command === 'board_prepare_edit') {
        throw new Error('board_prepare_edit requires the recorded Trace Board origin.')
      }
      requireCurrentVisibleContextShape(args)
      return
    }
    requireFields(command, args, ['page_id'])
    requireDurableDocument(command, args)
    return
  }
  if (command === 'board_build' || command === 'board_fixture') {
    requireFields(command, args, EXACT_BOARD_TARGET_FIELDS)
    return
  }
  if (command === 'board_open') {
    // Ordinary local documents have no workspace ID, but the remaining four IDs still pin them.
    requireFields(command, args, EXACT_DOCUMENT_TARGET_FIELDS)
    return
  }
  if (command === 'insert_mermaid_diagram') {
    requireFields(command, args, EXACT_BOARD_TARGET_FIELDS)
    requireGuardedMutation(command, args)
    return
  }
  if (command === 'upsert_code_object') {
    requireFields(command, args, EXACT_BOARD_TARGET_FIELDS)
    requireGuardedMutation(command, args)
    return
  }
  if (command === 'tool' && isMutatingToolRequest(args)) {
    requireFields(command, args, EXACT_DOCUMENT_TARGET_FIELDS)
    requireGuardedMutation(command, args)
    return
  }
  if (CONTEXT_BOUND_BOARD_COMMANDS.has(command)) {
    requireFields(command, args, ['runtime_instance_id', 'page_id'])
    requireDurableDocument(command, args)
  }
}
