import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'

type ConnectObjectsBase = {
  content_document_id: string
  context_token: string
  document_id: string
  expected_revision: number
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

function connectObjectsBase(context: UnknownRecord): ConnectObjectsBase | null {
  const buildBase = isUnknownRecord(context.board_build_base) ? context.board_build_base : null
  if (
    !buildBase ||
    typeof buildBase.content_document_id !== 'string' ||
    typeof buildBase.context_token !== 'string' ||
    typeof buildBase.document_id !== 'string' ||
    typeof buildBase.expected_revision !== 'number' ||
    typeof buildBase.page_id !== 'string' ||
    typeof buildBase.runtime_instance_id !== 'string' ||
    typeof buildBase.workspace_id !== 'string'
  ) {
    return null
  }
  return {
    content_document_id: buildBase.content_document_id,
    context_token: buildBase.context_token,
    document_id: buildBase.document_id,
    expected_revision: buildBase.expected_revision,
    page_id: buildBase.page_id,
    runtime_instance_id: buildBase.runtime_instance_id,
    workspace_id: buildBase.workspace_id
  }
}

function operationAppliedRevision(result: UnknownRecord): number | null {
  const receipt = isUnknownRecord(result.receipt) ? result.receipt : null
  const appliedRevision = receipt?.appliedRevision
  return typeof appliedRevision === 'number' &&
    Number.isInteger(appliedRevision) &&
    appliedRevision >= 0
    ? appliedRevision
    : null
}

export function withConnectObjectsBase(result: UnknownRecord): UnknownRecord {
  const status = isUnknownRecord(result.status) ? result.status : null
  if (
    status?.command !== 'completed' ||
    (status.mutation !== 'applied' &&
      status.mutation !== 'replayed' &&
      status.mutation !== 'no_change')
  ) {
    return result
  }
  const context = isUnknownRecord(result.context) ? result.context : null
  const base = context ? connectObjectsBase(context) : null
  const appliedRevision = operationAppliedRevision(result)
  return base && appliedRevision === base.expected_revision
    ? { ...result, connect_objects_base: base }
    : result
}
