import type {
  AutomationCodeObjectCreateArgs,
  AutomationCodeObjectRefineArgs
} from '@/app/automation/bridge/code-object-handler'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'

import { buildMetadata } from './metadata'
import { withBoardBuildPersistence, type BoardBuildPersistence } from './persistence'
import type {
  BoardBuildInput,
  CodeObjectBuildRecipe,
  CodeObjectCreateBuildRecipe,
  CodeObjectRefineBuildRecipe
} from './types'

type SemanticHandler = (target: AutomationTarget, args: unknown) => Promise<unknown>
export type BoardBuildCodeObjectCreateHandler = (
  target: AutomationTarget,
  args: AutomationCodeObjectCreateArgs
) => Promise<unknown>
export type BoardBuildCodeObjectRefineHandler = (
  target: AutomationTarget,
  args: AutomationCodeObjectRefineArgs
) => Promise<unknown>

type CodeObjectBuildOptions = {
  context: (target: AutomationTarget) => Promise<unknown>
  create?: BoardBuildCodeObjectCreateHandler
  persist?: BoardBuildPersistence
  present: (target: AutomationTarget, args: unknown) => Promise<unknown>
  read?: SemanticHandler
  refine?: BoardBuildCodeObjectRefineHandler
}

const DEFAULT_CODE_OBJECT_PLACEMENT = {
  clearance: 48,
  preferred_directions: ['right', 'below', 'left', 'above'] as const
}
const DEFAULT_CODE_OBJECT_SIZE = { height: 520, width: 720 } as const

function record(value: unknown, label: string): UnknownRecord {
  if (!isUnknownRecord(value)) throw new Error(`${label} returned an invalid response.`)
  return value
}

function requiredHandler(handler: SemanticHandler | undefined, label: string): SemanticHandler {
  if (!handler) throw new Error(`board_build ${label} semantic owner is unavailable.`)
  return handler
}

function requiredCreateHandler(
  handler: BoardBuildCodeObjectCreateHandler | undefined
): BoardBuildCodeObjectCreateHandler {
  if (!handler) throw new Error('board_build upsert_code_object semantic owner is unavailable.')
  return handler
}

function requiredRefineHandler(
  handler: BoardBuildCodeObjectRefineHandler | undefined
): BoardBuildCodeObjectRefineHandler {
  if (!handler) throw new Error('board_build refine_code_object semantic owner is unavailable.')
  return handler
}

function sameRequestRecovery(input: BoardBuildInput) {
  return {
    command: 'board_verify',
    instruction:
      'Reacquire Board context, then verify this same Code Object request ID. Do not retry the mutation with a new request ID.',
    request_id: input.requestId,
    requires_fresh_context: true,
    retry_mutation: false
  }
}

function normalizedPlacement(recipe: CodeObjectCreateBuildRecipe) {
  return {
    clearance: recipe.placement?.clearance ?? DEFAULT_CODE_OBJECT_PLACEMENT.clearance,
    preferred_directions: [
      ...(recipe.placement?.preferredDirections ??
        DEFAULT_CODE_OBJECT_PLACEMENT.preferred_directions)
    ],
    ...(recipe.placement?.target ? { target: recipe.placement.target } : {})
  }
}

function ownerMutation(input: BoardBuildInput) {
  return {
    expected_revision: input.expectedRevision,
    request_id: input.requestId,
    ...(input.taskId ? { task_id: input.taskId } : {}),
    ...(input.traceId ? { trace_id: input.traceId } : {})
  }
}

function ownerArgs(
  input: BoardBuildInput,
  recipe: CodeObjectCreateBuildRecipe
): AutomationCodeObjectCreateArgs {
  return {
    ...(input.anchorId ? { anchor_id: input.anchorId } : {}),
    height: recipe.height ?? DEFAULT_CODE_OBJECT_SIZE.height,
    mutation: ownerMutation(input),
    name: recipe.name,
    object_key: recipe.objectKey,
    persist: false,
    placement: normalizedPlacement(recipe),
    ...(recipe.ports ? { ports: recipe.ports } : {}),
    props: recipe.props,
    source: recipe.source,
    state: recipe.initialState,
    width: recipe.width ?? DEFAULT_CODE_OBJECT_SIZE.width,
    zoom: false
  }
}

function refineOwnerArgs(
  input: BoardBuildInput,
  recipe: CodeObjectRefineBuildRecipe
): AutomationCodeObjectRefineArgs {
  return {
    expected_source_hash: recipe.expectedSourceHash,
    mutation: ownerMutation(input),
    ...(recipe.name ? { name: recipe.name } : {}),
    object_key: recipe.objectKey,
    owner_id: recipe.ownerId,
    persist: false,
    ...(recipe.props ? { props: recipe.props } : {}),
    source: recipe.source,
    zoom: false
  }
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function codeObjectSourceLength(component: UnknownRecord): number | undefined {
  if (typeof component.source_length === 'number') return component.source_length
  return typeof component.source === 'string' ? component.source.length : undefined
}

function boundedCodeObjectMutationReadback(readback: UnknownRecord): UnknownRecord {
  const component = isUnknownRecord(readback.component) ? readback.component : null
  const frame = isUnknownRecord(readback.frame) ? readback.frame : null
  const sourceLength = component ? codeObjectSourceLength(component) : undefined
  return {
    ...(component
      ? {
          component: {
            ...(typeof component.definition_id === 'string'
              ? { definition_id: component.definition_id }
              : {}),
            ...(typeof component.name === 'string' ? { name: component.name } : {}),
            ...(typeof component.source_hash === 'string'
              ? { source_hash: component.source_hash }
              : {}),
            ...(sourceLength === undefined ? {} : { source_length: sourceLength })
          }
        }
      : {}),
    ...(frame ? { frame: structuredClone(frame) } : {})
  }
}

function readbackMismatch(
  readback: UnknownRecord,
  ownerId: string,
  recipe: CodeObjectCreateBuildRecipe
): string | null {
  const component = isUnknownRecord(readback.component) ? readback.component : null
  const frame = isUnknownRecord(readback.frame) ? readback.frame : null
  if (!component || !frame) return 'Code Object readback omitted the component or frame.'
  if (frame.id !== ownerId || frame.type !== 'FRAME') {
    return 'Code Object readback did not match the created owner frame.'
  }
  if (
    component.definition_id !== recipe.objectKey ||
    component.name !== recipe.name ||
    component.source !== recipe.source ||
    !jsonEquals(component.props, recipe.props) ||
    !jsonEquals(component.state, recipe.initialState)
  ) {
    return 'Code Object readback did not match the requested source or serializable data.'
  }
  if (!jsonEquals(readback.ports ?? [], recipe.ports ?? [])) {
    return 'Code Object readback did not match the requested named ports.'
  }
  if (
    frame.width !== (recipe.width ?? DEFAULT_CODE_OBJECT_SIZE.width) ||
    frame.height !== (recipe.height ?? DEFAULT_CODE_OBJECT_SIZE.height)
  ) {
    return 'Code Object readback did not match the requested dimensions.'
  }
  return null
}

function partialResult(options: {
  base: UnknownRecord
  input: BoardBuildInput
  mutation: 'applied' | 'replayed'
  reason: string
  stage: 'presentation' | 'readback'
}) {
  return {
    ...options.base,
    next_action: sameRequestRecovery(options.input),
    proof: { reason: options.reason, stage: options.stage, status: 'partial' },
    status: {
      attention_required: true,
      command: 'unavailable',
      mutation: options.mutation,
      reason: options.reason
    }
  }
}

function errorResult(options: {
  base: UnknownRecord
  error: unknown
  input: BoardBuildInput
  mutation: 'applied' | 'replayed'
  stage: 'context' | 'presentation' | 'readback'
}) {
  const message = options.error instanceof Error ? options.error.message : String(options.error)
  return {
    ...options.base,
    next_action: sameRequestRecovery(options.input),
    proof: { error: message, stage: options.stage, status: 'error' },
    status: {
      attention_required: true,
      command: 'unavailable',
      mutation: options.mutation,
      reason: 'post_apply_proof_failed'
    }
  }
}

async function provePresentation(options: {
  base: UnknownRecord
  buildOptions: CodeObjectBuildOptions
  input: BoardBuildInput
  mutation: 'applied' | 'replayed'
  ownerId: string
  target: AutomationTarget
}): Promise<UnknownRecord> {
  let stage: 'context' | 'presentation' = 'context'
  try {
    const context = record(await options.buildOptions.context(options.target), 'board_context')
    stage = 'presentation'
    const presented = record(
      await options.buildOptions.present(options.target, {
        context_token: context.context_token,
        object_ids: [options.ownerId]
      }),
      'board_present'
    )
    const presentation = record(presented.presentation, 'board_present presentation')
    const result = { ...options.base, context, presentation }
    if (presentation.acknowledged !== true) {
      return partialResult({
        base: result,
        input: options.input,
        mutation: options.mutation,
        reason: 'presentation_not_acknowledged',
        stage: 'presentation'
      })
    }
    return {
      ...result,
      status: { attention_required: false, command: 'completed', mutation: options.mutation }
    }
  } catch (error) {
    return errorResult({
      base: options.base,
      error,
      input: options.input,
      mutation: options.mutation,
      stage
    })
  }
}

type PreparedCodeObjectMutation = {
  base: UnknownRecord
  mutation: 'applied' | 'replayed'
  ownerId: string
}

function prepareCodeObjectMutation(options: {
  build: UnknownRecord
  expectedOwnerId?: string
  input: BoardBuildInput
  mutation: UnknownRecord
}): PreparedCodeObjectMutation | { result: UnknownRecord } {
  const status = isUnknownRecord(options.mutation.status) ? options.mutation.status : null
  const mutationState =
    status?.mutation === 'applied' || status?.mutation === 'replayed' ? status.mutation : null
  if (!mutationState) return { result: { ...options.mutation, build: options.build } }

  const receipt = isUnknownRecord(options.mutation.receipt) ? options.mutation.receipt : null
  const ownerId = typeof options.mutation.owner_id === 'string' ? options.mutation.owner_id : null
  if (!receipt || !ownerId || (options.expectedOwnerId && ownerId !== options.expectedOwnerId)) {
    return {
      result: {
        ...options.mutation,
        build: options.build,
        next_action: sameRequestRecovery(options.input),
        proof: { reason: 'semantic_owner_receipt_missing', stage: 'readback', status: 'error' },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: 'unknown',
          reason: 'semantic_owner_receipt_missing'
        }
      }
    }
  }

  const base = {
    ...options.mutation,
    build: options.build,
    owner_id: ownerId,
    receipt
  }
  if (status?.attention_required === true || status?.command !== 'completed') {
    return {
      result: {
        ...base,
        next_action: isUnknownRecord(options.mutation.next_action)
          ? options.mutation.next_action
          : sameRequestRecovery(options.input)
      }
    }
  }
  return { base, mutation: mutationState, ownerId }
}

async function proveBuiltCodeObject(options: {
  buildOptions: CodeObjectBuildOptions
  input: BoardBuildInput
  mismatch: (readback: UnknownRecord) => string | null
  prepared: PreparedCodeObjectMutation
  readArgs: UnknownRecord
  target: AutomationTarget
}): Promise<UnknownRecord> {
  try {
    const read = requiredHandler(options.buildOptions.read, 'get_code_object')
    const readback = record(await read(options.target, options.readArgs), 'get_code_object')
    const withReadback = {
      ...options.prepared.base,
      readback: { code_object: boundedCodeObjectMutationReadback(readback) }
    }
    if (options.mismatch(readback)) {
      return partialResult({
        base: withReadback,
        input: options.input,
        mutation: options.prepared.mutation,
        reason: 'code_object_readback_mismatch',
        stage: 'readback'
      })
    }
    return provePresentation({
      base: withReadback,
      buildOptions: options.buildOptions,
      input: options.input,
      mutation: options.prepared.mutation,
      ownerId: options.prepared.ownerId,
      target: options.target
    })
  } catch (error) {
    return errorResult({
      base: options.prepared.base,
      error,
      input: options.input,
      mutation: options.prepared.mutation,
      stage: 'readback'
    })
  }
}

async function buildCreatedCodeObject(
  options: CodeObjectBuildOptions,
  target: AutomationTarget,
  input: BoardBuildInput,
  recipe: CodeObjectCreateBuildRecipe
): Promise<UnknownRecord> {
  const create = requiredCreateHandler(options.create)
  const mutation = record(await create(target, ownerArgs(input, recipe)), 'upsert_code_object')
  const prepared = prepareCodeObjectMutation({
    build: buildMetadata(input, 'code-object/tsx-create/v1', 'upsert_code_object'),
    input,
    mutation
  })
  if ('result' in prepared) return prepared.result
  return proveBuiltCodeObject({
    buildOptions: options,
    input,
    mismatch: (readback) => readbackMismatch(readback, prepared.ownerId, recipe),
    prepared,
    readArgs: { object_key: recipe.objectKey },
    target
  })
}

function refinementReconciliationIsCurrent(mutation: UnknownRecord): boolean {
  const ownerReadback = isUnknownRecord(mutation.readback) ? mutation.readback : null
  const codeObject = isUnknownRecord(ownerReadback?.code_object) ? ownerReadback.code_object : null
  const reconciliation = isUnknownRecord(codeObject?.reconciliation)
    ? codeObject.reconciliation
    : null
  return reconciliation?.status === 'current'
}

function refinementIdentityMatches(
  component: UnknownRecord,
  frame: UnknownRecord,
  recipe: CodeObjectRefineBuildRecipe
): boolean {
  return (
    frame.id === recipe.ownerId &&
    component.definition_id === recipe.objectKey &&
    component.source === recipe.source
  )
}

function refinementPreservationIsProven(mutation: UnknownRecord): boolean {
  const preservation = isUnknownRecord(mutation.preservation) ? mutation.preservation : null
  return Boolean(preservation && Object.values(preservation).every((value) => value === true))
}

function refinementReadbackMismatch(
  mutation: UnknownRecord,
  readback: UnknownRecord,
  recipe: CodeObjectRefineBuildRecipe
): string | null {
  const component = isUnknownRecord(readback.component) ? readback.component : null
  const frame = isUnknownRecord(readback.frame) ? readback.frame : null
  if (!component || !frame || !refinementReconciliationIsCurrent(mutation)) {
    return 'Code Object refinement readback is incomplete or diverged.'
  }
  if (!refinementIdentityMatches(component, frame, recipe)) {
    return 'Code Object refinement readback did not match the exact owner, key, or source.'
  }
  if (recipe.name && component.name !== recipe.name) {
    return 'Code Object refinement readback did not match the requested name.'
  }
  if (recipe.props && !jsonEquals(component.props, recipe.props)) {
    return 'Code Object refinement readback did not match the requested props.'
  }
  if (!refinementPreservationIsProven(mutation)) {
    return 'Code Object refinement did not prove protected state preservation.'
  }
  return null
}

async function buildRefinedCodeObject(
  options: CodeObjectBuildOptions,
  target: AutomationTarget,
  input: BoardBuildInput,
  recipe: CodeObjectRefineBuildRecipe
): Promise<UnknownRecord> {
  const refine = requiredRefineHandler(options.refine)
  const mutation = record(
    await refine(target, refineOwnerArgs(input, recipe)),
    'refine_code_object'
  )
  const prepared = prepareCodeObjectMutation({
    build: buildMetadata(input, 'code-object/tsx-refine/v1', 'refine_code_object'),
    expectedOwnerId: recipe.ownerId,
    input,
    mutation
  })
  if ('result' in prepared) return prepared.result
  return proveBuiltCodeObject({
    buildOptions: options,
    input,
    mismatch: (readback) => refinementReadbackMismatch(mutation, readback, recipe),
    prepared,
    readArgs: { owner_id: recipe.ownerId },
    target
  })
}

export async function buildPersistentCodeObject(
  options: CodeObjectBuildOptions,
  target: AutomationTarget,
  input: BoardBuildInput,
  recipe: CodeObjectBuildRecipe
) {
  return withBoardBuildPersistence({
    input,
    persist: options.persist,
    result:
      recipe.operation === 'create'
        ? await buildCreatedCodeObject(options, target, input, recipe)
        : await buildRefinedCodeObject(options, target, input, recipe),
    target
  })
}
