import { mutationRequestSignature } from '@/app/automation/bridge/request-receipts'
import { isUnknownRecord } from '@/app/automation/bridge/target'

import {
  boundedCodeObjectString,
  normalizeCodeObjectMutation,
  optionalCodeObjectString,
  plainCodeObjectRecord,
  type CodeObjectMutationIdentity,
  type CodeObjectNextAction,
  type CodeObjectReadback,
  type CodeObjectResultStatus,
  type CodeObjectRuntimeProof,
  type CodeObjectSemanticOwner
} from '../contract'
import { codeObjectSourceHash, MAX_CODE_OBJECT_SOURCE_LENGTH } from '../source'

export const CODE_OBJECT_REFINE_ROUTE = 'refine_code_object' as const
export const CODE_OBJECT_PROPS_ROUTE = 'code-object-props/v1'

export type AutomationCodeObjectRefineArgs = {
  expected_source_hash: string
  mutation: CodeObjectMutationIdentity
  name?: string
  object_key: string
  owner_id: string
  persist: false
  props?: Record<string, unknown>
  source: string
  zoom: false
}

export type CodeObjectRefineIntent = {
  inputDigest: string
  requestId: string
  route: typeof CODE_OBJECT_REFINE_ROUTE
  taskId?: string
  traceId?: string
}

export type CodeObjectRefineExpectedReadback = {
  name: string
  objectKey: string
  ownerId: string
  propsHash: string
  sourceHash: string
}

type CodeObjectRefineComponent = {
  name: string
  object_key: string
  props: Record<string, unknown>
  props_hash: string
  source_hash: string
  source_length: number
  state: Record<string, unknown>
}

type CodeObjectRefineExpected = {
  name: string
  object_key: string
  owner_id: string
  props_hash: string
  source_hash: string
}

export type CodeObjectRefineReadback = CodeObjectReadback<
  CodeObjectRefineComponent,
  CodeObjectRefineExpected
>

export type CodeObjectRefinePreservation = {
  board_permissions: true
  geometry: true
  legacy_connections: true
  object_graph_connections: true
  other_plugin_data: true
  state: true
}

export type AutomationCodeObjectRefineResult = {
  next_action?: CodeObjectNextAction
  owner_id: string
  preservation?: CodeObjectRefinePreservation
  proof?: CodeObjectRuntimeProof
  readback: { code_object: CodeObjectRefineReadback }
  receipt?: Record<string, unknown>
  semantic_owner: CodeObjectSemanticOwner
  status: CodeObjectResultStatus<'applied' | 'no_change' | 'not_applied' | 'replayed'>
}

export function normalizeCodeObjectRefineArgs(rawArgs: unknown): AutomationCodeObjectRefineArgs {
  if (!isUnknownRecord(rawArgs)) throw new Error('Code Object refine arguments must be an object.')
  const mutation = normalizeCodeObjectMutation(rawArgs.mutation, 'refine')
  if (rawArgs.zoom !== false || rawArgs.persist !== false) {
    throw new Error(
      'Code Object refine requires zoom:false and persist:false; the facade owns presentation and persistence.'
    )
  }
  const name = optionalCodeObjectString(rawArgs.name, 'name', 120)
  const props =
    rawArgs.props === undefined ? undefined : plainCodeObjectRecord(rawArgs.props, 'props')
  const expectedSourceHash = boundedCodeObjectString(
    rawArgs.expected_source_hash,
    'expected_source_hash',
    71
  )
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedSourceHash)) {
    throw new Error('Code Object expected_source_hash must be a lowercase SHA-256 digest.')
  }
  return {
    expected_source_hash: expectedSourceHash,
    mutation,
    ...(name ? { name } : {}),
    object_key: boundedCodeObjectString(rawArgs.object_key, 'object_key', 160),
    owner_id: boundedCodeObjectString(rawArgs.owner_id, 'owner_id', 240),
    persist: false,
    ...(props ? { props } : {}),
    source: boundedCodeObjectString(rawArgs.source, 'source', MAX_CODE_OBJECT_SOURCE_LENGTH),
    zoom: false
  }
}

export async function createCodeObjectRefineIntent(
  args: AutomationCodeObjectRefineArgs
): Promise<CodeObjectRefineIntent> {
  const taskId = args.mutation.task_id
  const traceId = args.mutation.trace_id
  return {
    inputDigest: await mutationRequestSignature(CODE_OBJECT_REFINE_ROUTE, {
      expected_source_hash: args.expected_source_hash,
      ...(args.name ? { name: args.name } : {}),
      object_key: args.object_key,
      owner_id: args.owner_id,
      ...(args.props ? { props: args.props } : {}),
      source: args.source,
      ...(taskId ? { task_id: taskId } : {}),
      ...(traceId ? { trace_id: traceId } : {})
    }),
    requestId: args.mutation.request_id,
    route: CODE_OBJECT_REFINE_ROUTE,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {})
  }
}

export async function codeObjectRefineExpected(options: {
  name: string
  objectKey: string
  ownerId: string
  props: Record<string, unknown>
  source: string
}): Promise<CodeObjectRefineExpectedReadback> {
  const [propsHash, sourceHash] = await Promise.all([
    mutationRequestSignature(CODE_OBJECT_PROPS_ROUTE, options.props),
    codeObjectSourceHash(options.source)
  ])
  return {
    name: options.name,
    objectKey: options.objectKey,
    ownerId: options.ownerId,
    propsHash,
    sourceHash
  }
}
