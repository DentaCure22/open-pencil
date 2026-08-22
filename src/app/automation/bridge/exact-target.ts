import { ALL_TOOLS } from '@open-pencil/core/tools'

import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'

const EXACT_DOCUMENT_TARGET_FIELDS = [
  'runtime_instance_id',
  'document_id',
  'content_document_id',
  'page_id'
]

export const LIVE_APP_EVAL_DISABLED_MESSAGE =
  'Live-app eval is disabled because arbitrary code cannot provide a guarded durable mutation receipt. Use a guarded tool instead.'

function hasString(args: UnknownRecord, field: string): boolean {
  const value = args[field]
  return typeof value === 'string' && value.trim().length > 0
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

function requireGuardedMutation(command: string, value: unknown): void {
  if (!isUnknownRecord(value)) {
    throw new Error(
      `${command} requires guarded mutation fields: mutation.expectedRevision, mutation.requestId.`
    )
  }
  const expectedRevision = value.expectedRevision
  const requestId = value.requestId
  const missing = [
    ...(typeof expectedRevision === 'number' &&
    Number.isInteger(expectedRevision) &&
    expectedRevision >= 0
      ? []
      : ['mutation.expectedRevision']),
    ...(typeof requestId === 'string' && requestId.trim().length > 0 ? [] : ['mutation.requestId'])
  ]
  if (missing.length > 0) {
    throw new Error(`${command} requires guarded mutation fields: ${missing.join(', ')}.`)
  }
}

export function assertGuardedAutomationTarget(command: string, args: UnknownRecord): void {
  if (command === 'eval') throw new Error(LIVE_APP_EVAL_DISABLED_MESSAGE)

  if (command === 'board_context') {
    if (args.target === 'current_visible') {
      requireCurrentVisibleContextShape(args)
      return
    }
    requireFields(command, args, ['page_id'])
    requireDurableDocument(command, args)
    return
  }

  if (command === 'board_present') {
    requireFields(command, args, ['runtime_instance_id', 'page_id'])
    requireDurableDocument(command, args)
    return
  }

  if (command === 'tool' && isMutatingToolRequest(args)) {
    requireFields(command, args, EXACT_DOCUMENT_TARGET_FIELDS)
    requireGuardedMutation(command, args.mutation)
  }
}
