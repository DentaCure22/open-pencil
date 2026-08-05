import type { MermaidDiagram } from '@open-pencil/core/diagram'
import type { Vector } from '@open-pencil/scene-graph'

import { mutationRequestLedgerState } from '@/app/automation/bridge/request-receipts'
import {
  isUnknownRecord,
  type AutomationTarget,
  type UnknownRecord
} from '@/app/automation/bridge/target'
import {
  automationElapsedMs,
  automationNowMs,
  type AutomationStageTimings,
  withAutomationStageTiming
} from '@/app/automation/bridge/timing'
import { canWriteSmylrProductionDocument } from '@/app/smylr-production/document-state'

import {
  buildPersistentCodeObject,
  type BoardBuildCodeObjectCreateHandler,
  type BoardBuildCodeObjectRefineHandler
} from './code-object'
import { withConnectObjectsBase } from './connect-objects-base'
import { assertCurrentBuildContext } from './context'
import { buildMetadata } from './metadata'
import { nativeArtifactChangeArgs } from './native-args'
import { normalizeNativeChangeResult, sameRequestVerifyAction } from './native-result'
import {
  optionalBuildString as optionalString,
  parseBoardBuildInput,
  requiredBuildString as requiredString
} from './parse'
import { withBoardBuildPersistence, type BoardBuildPersistence } from './persistence'
import { buildBoardPlan } from './plan'
import {
  type BoardBuildInput,
  type BoardBuildPlanInput,
  type NativeCardBuildRecipe,
  type NativeDiagramBuildRecipe,
  type NativeTextBuildRecipe,
  type BoardBuildRecipeInput
} from './types'

type BoardHandlers = {
  change: (target: AutomationTarget, args: unknown) => Promise<unknown>
  context: (target: AutomationTarget) => Promise<unknown>
  present: (target: AutomationTarget, args: unknown) => Promise<unknown>
  read: (target: AutomationTarget, args: unknown) => Promise<unknown>
}

type EnvelopeHandler = (target: AutomationTarget, args: unknown) => Promise<unknown>

const EMPTY_BOARD_DIAGRAM_POSITION: Vector = { x: 320, y: 180 }

type BoardBuildHandlerOptions = {
  board: BoardHandlers
  canWrite?: (target: AutomationTarget) => boolean
  codeObjectCreate?: BoardBuildCodeObjectCreateHandler
  codeObjectRead?: EnvelopeHandler
  codeObjectRefine?: BoardBuildCodeObjectRefineHandler
  mermaid: EnvelopeHandler
  mermaidSource: EnvelopeHandler
  parseMermaid?: (source: string) => Promise<MermaidDiagram>
  persist?: BoardBuildPersistence
}

function record(value: unknown, label: string): UnknownRecord {
  if (!isUnknownRecord(value)) throw new Error(`${label} returned an invalid response.`)
  return value
}

function unwrapEnvelope(value: unknown, label: string): UnknownRecord {
  const envelope = record(value, label)
  if (envelope.ok === false) {
    throw new Error(
      typeof envelope.error === 'string' ? envelope.error : `${label} failed without an error.`
    )
  }
  return record(envelope.result, `${label} result`)
}

function isUnanchoredDiagramCreation(input: BoardBuildInput): boolean {
  const recipe = input.recipe
  return recipe?.kind === 'native_diagram' && !recipe.ownerId && !input.anchorId
}

function isBoardBuildPlanInput(input: BoardBuildInput): input is BoardBuildPlanInput {
  return input.plan !== undefined
}

function pageNodes(readback: UnknownRecord): unknown[] {
  if (readback.scope !== 'page' || !Array.isArray(readback.nodes)) {
    throw new Error('board_read did not return the required page-scoped node list.')
  }
  return readback.nodes
}

function needsDiagramAnchorResult(input: BoardBuildInput, nodeCount: number) {
  return {
    build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
    next_action: {
      command: 'board_context',
      instruction:
        'Select exactly one existing Board object as the diagram anchor, reacquire Board context, then call board_build again with anchor_id and this same request ID.',
      request_id: input.requestId,
      required_input: 'anchor_id',
      requires_fresh_context: true
    },
    page_check: { empty: false, observed_node_count: nodeCount, scope: 'page' },
    status: {
      attention_required: true,
      command: 'needs_input',
      mutation: 'not_applied',
      reason: 'non_empty_page_requires_anchor'
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function mutationState(receipt: UnknownRecord): 'applied' | 'replayed' {
  return receipt.idempotentReplay === true ? 'replayed' : 'applied'
}

function historicalReplayReason(
  childStatus: UnknownRecord | null,
  liveStatus: string | undefined
): string | undefined {
  const childReason = optionalString(childStatus?.reason)
  if (childReason) return childReason
  if (liveStatus === 'missing') return 'historical_receipt_only'
  if (liveStatus === 'diverged') return 'historical_receipt_diverged'
  return undefined
}

function historicalReplayResult(
  input: BoardBuildInput,
  mutation: UnknownRecord
): UnknownRecord | null {
  const receipt = isUnknownRecord(mutation.mutation_receipt) ? mutation.mutation_receipt : null
  const childStatus = isUnknownRecord(mutation.status) ? mutation.status : null
  if (receipt?.idempotentReplay !== true && childStatus?.mutation !== 'replayed') return null

  const liveStatus = optionalString(receipt?.liveStatus)
  const reason = historicalReplayReason(childStatus, liveStatus)
  return {
    ...mutation,
    build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
    next_action: sameRequestVerifyAction(input),
    receipt: mutation.mutation_receipt,
    status: {
      ...childStatus,
      attention_required: true,
      command: optionalString(childStatus?.command) ?? 'unavailable',
      mutation: 'replayed',
      ...(reason ? { reason } : {})
    }
  }
}

function postApplyProofFailure(
  input: BoardBuildInput,
  mutation: UnknownRecord,
  receipt: UnknownRecord,
  stage: 'context' | 'owner' | 'presentation' | 'source_readback',
  error: unknown
) {
  const ownerId = optionalString(mutation.owner_id)
  const semanticReadback = isUnknownRecord(mutation.readback) ? mutation.readback : null
  const mutationReplay = isUnknownRecord(mutation.mutation_replay) ? mutation.mutation_replay : null
  return {
    build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
    ...(ownerId ? { owner_id: ownerId } : {}),
    ...(semanticReadback ? { readback: { mermaid: semanticReadback } } : {}),
    ...(mutationReplay ? { mutation_replay: mutationReplay } : {}),
    next_action: sameRequestVerifyAction(input),
    proof: {
      error: errorMessage(error),
      stage,
      status: 'error'
    },
    receipt: mutation.mutation_receipt,
    status: {
      attention_required: true,
      command: 'unavailable',
      mutation: mutationState(receipt),
      reason: 'post_apply_proof_failed'
    }
  }
}

function diagramPartialProof(
  reconciliation: UnknownRecord,
  presentation: UnknownRecord
): { reason: string; stage: 'presentation' | 'source_readback' } | null {
  if (reconciliation.status !== 'current') {
    return { reason: 'source_reconciliation_not_current', stage: 'source_readback' }
  }
  if (presentation.acknowledged !== true) {
    return { reason: 'presentation_not_acknowledged', stage: 'presentation' }
  }
  return null
}

function noChangeDiagramResult(
  input: BoardBuildInput,
  mutation: UnknownRecord
): UnknownRecord | null {
  const status = isUnknownRecord(mutation.status) ? mutation.status : null
  const receipt = isUnknownRecord(mutation.mutation_receipt) ? mutation.mutation_receipt : null
  if (mutation.operation !== 'no_change' || status?.mutation !== 'no_change' || !receipt)
    return null
  return {
    ...mutation,
    build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
    receipt: mutation.mutation_receipt,
    status
  }
}

async function withCompletedNoChangeContext(
  options: BoardBuildHandlerOptions,
  target: AutomationTarget,
  result: UnknownRecord
): Promise<UnknownRecord> {
  const status = isUnknownRecord(result.status) ? result.status : null
  if (
    status?.command !== 'completed' ||
    status.mutation !== 'no_change' ||
    isUnknownRecord(result.context)
  ) {
    return result
  }
  try {
    return {
      ...result,
      context: record(await options.board.context(target), 'board_context')
    }
  } catch {
    return result
  }
}

function childDiagramProofFailureResult(
  input: BoardBuildInput,
  mutation: UnknownRecord
): UnknownRecord | null {
  const receipt = isUnknownRecord(mutation.mutation_receipt) ? mutation.mutation_receipt : null
  const proof = isUnknownRecord(mutation.proof) ? mutation.proof : null
  const status = isUnknownRecord(mutation.status) ? mutation.status : null
  if (
    mutation.applied !== true ||
    !receipt ||
    !proof ||
    status?.attention_required !== true ||
    status.command === 'completed'
  ) {
    return null
  }
  return {
    ...mutation,
    build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
    next_action: isUnknownRecord(mutation.next_action)
      ? mutation.next_action
      : sameRequestVerifyAction(input),
    receipt: mutation.mutation_receipt,
    status
  }
}

async function buildNativeText(
  options: BoardBuildHandlerOptions,
  target: AutomationTarget,
  input: BoardBuildRecipeInput,
  recipe: NativeTextBuildRecipe
) {
  const changed = record(
    await options.board.change(
      target,
      nativeArtifactChangeArgs(
        input,
        {
          kind: 'native_text',
          text: recipe.text,
          ...(recipe.name ? { name: recipe.name } : {}),
          ...(recipe.fontSize === undefined ? {} : { font_size: recipe.fontSize }),
          ...(recipe.maxWidth === undefined ? {} : { max_width: recipe.maxWidth })
        },
        recipe.placement,
        'local-legible-text-v1'
      )
    ),
    'board_change'
  )
  return normalizeNativeChangeResult(target, input, changed, 'native-text/v1')
}

async function buildNativeCard(
  options: BoardBuildHandlerOptions,
  target: AutomationTarget,
  input: BoardBuildRecipeInput,
  recipe: NativeCardBuildRecipe
) {
  const changed = record(
    await options.board.change(
      target,
      nativeArtifactChangeArgs(
        input,
        {
          body: recipe.body,
          kind: 'native_card',
          ...(recipe.name ? { name: recipe.name } : {}),
          title: recipe.title,
          ...(recipe.width === undefined ? {} : { width: recipe.width })
        },
        recipe.placement,
        'local-legible-card-v1'
      )
    ),
    'board_change'
  )
  return normalizeNativeChangeResult(target, input, changed, 'native-card/v1')
}

async function proveDiagramResult(
  options: BoardBuildHandlerOptions,
  target: AutomationTarget,
  input: BoardBuildInput,
  mutation: UnknownRecord,
  receipt: UnknownRecord
) {
  let proofStage: 'context' | 'owner' | 'presentation' | 'source_readback' = 'owner'
  try {
    const ownerId = requiredString(mutation.owner_id, 'Mermaid owner_id')
    proofStage = 'source_readback'
    const readback = unwrapEnvelope(
      await options.mermaidSource(target, { owner_id: ownerId }),
      'get_mermaid_source'
    )
    const reconciliation = record(readback.reconciliation, 'Mermaid reconciliation')
    proofStage = 'context'
    const freshContext = record(await options.board.context(target), 'board_context')
    proofStage = 'presentation'
    const presented = record(
      await options.board.present(target, {
        context_token: freshContext.context_token,
        object_ids: [ownerId]
      }),
      'board_present'
    )
    const presentation = record(presented.presentation, 'board_present presentation')
    const result = {
      build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
      context: freshContext,
      owner_id: ownerId,
      presentation,
      readback: { mermaid: readback },
      receipt: mutation.mutation_receipt
    }
    const partial = diagramPartialProof(reconciliation, presentation)
    if (partial) {
      return {
        ...result,
        next_action: sameRequestVerifyAction(input),
        proof: { reason: partial.reason, stage: partial.stage, status: 'partial' },
        status: {
          attention_required: true,
          command: 'unavailable',
          mutation: mutationState(receipt),
          reason: partial.reason
        }
      }
    }
    return {
      ...result,
      status: {
        attention_required: false,
        command: 'completed',
        mutation: mutationState(receipt)
      }
    }
  } catch (error) {
    return postApplyProofFailure(input, mutation, receipt, proofStage, error)
  }
}

async function buildNativeDiagram(
  options: BoardBuildHandlerOptions,
  target: AutomationTarget,
  input: BoardBuildInput,
  recipe: NativeDiagramBuildRecipe,
  position?: Vector
) {
  const mutation = unwrapEnvelope(
    await options.mermaid(target, {
      ...(input.anchorId ? { anchor_id: input.anchorId } : {}),
      ...(recipe.allowAdditionalOwner === undefined
        ? {}
        : { allow_additional_owner: recipe.allowAdditionalOwner }),
      mutation: {
        expectedRevision: input.expectedRevision,
        requestId: input.requestId,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.traceId ? { traceId: input.traceId } : {})
      },
      ...(recipe.ownerId ? { owner_id: recipe.ownerId } : {}),
      source: recipe.source,
      ...(position ? { x: position.x, y: position.y } : {}),
      zoom_to_selection: recipe.zoomToSelection ?? true
    }),
    'insert_mermaid_diagram'
  )
  if (mutation.applied === false) {
    const noChange = noChangeDiagramResult(input, mutation)
    if (noChange) return noChange
    const replay = historicalReplayResult(input, mutation)
    if (replay) return replay
    return {
      build: buildMetadata(input, 'native-diagram/mermaid/v1', 'insert_mermaid_diagram'),
      receipt: mutation.mutation_receipt,
      status: {
        attention_required: true,
        command: 'refused',
        mutation: 'not_applied'
      }
    }
  }

  const childProofFailure = childDiagramProofFailureResult(input, mutation)
  if (childProofFailure) return childProofFailure

  const receipt = record(mutation.mutation_receipt, 'Mermaid mutation receipt')
  return proveDiagramResult(options, target, input, mutation, receipt)
}

export function createAutomationBoardBuildHandler(options: BoardBuildHandlerOptions) {
  const canWrite =
    options.canWrite ??
    ((target: AutomationTarget) => canWriteSmylrProductionDocument(target.store))

  return async function boardBuild(target: AutomationTarget, rawArgs: unknown) {
    const startedAt = automationNowMs()
    const stages: AutomationStageTimings = {}
    const input = parseBoardBuildInput(rawArgs)
    const unanchoredDiagramCreation = isUnanchoredDiagramCreation(input)
    const requestState = mutationRequestLedgerState(target, input.requestId)
    const storedReplay = requestState.status === 'stored'
    const contextReadStartedAt = automationNowMs()
    const current = record(
      await options.board.read(target, {
        context_token: input.contextToken,
        scope: unanchoredDiagramCreation ? 'page' : 'selection'
      }),
      'board_read'
    )
    stages.context_read_ms = automationElapsedMs(contextReadStartedAt)
    assertCurrentBuildContext(input, current, storedReplay)

    const runOperation = async (operation: () => Promise<UnknownRecord>) => {
      const operationStartedAt = automationNowMs()
      const result = await operation()
      stages.operation_ms = automationElapsedMs(operationStartedAt)
      return withAutomationStageTiming(result, startedAt, stages)
    }

    const withContinuation = async (result: UnknownRecord) =>
      withConnectObjectsBase(await withCompletedNoChangeContext(options, target, result))

    if (isBoardBuildPlanInput(input)) {
      if (!canWrite(target)) {
        throw new Error(
          'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
        )
      }
      return runOperation(async () =>
        withContinuation(
          await withBoardBuildPersistence({
            input,
            persist: options.persist,
            result: await buildBoardPlan(
              {
                context: options.board.context,
                ...(options.parseMermaid ? { parseMermaid: options.parseMermaid } : {})
              },
              target,
              input
            ),
            target,
            transaction: {
              pageId: target.pageId,
              requestId: input.requestId,
              route: 'board_build:plan/v1'
            }
          })
        )
      )
    }

    const recipeInput: BoardBuildRecipeInput = input
    const { recipe } = recipeInput

    let diagramPosition: Vector | undefined
    if (unanchoredDiagramCreation) {
      const nodes = pageNodes(current)
      if (nodes.length > 0 && requestState.status !== 'stored') {
        return withAutomationStageTiming(
          needsDiagramAnchorResult(recipeInput, nodes.length),
          startedAt,
          stages
        )
      }
      diagramPosition = EMPTY_BOARD_DIAGRAM_POSITION
    }

    if (recipe.kind === 'native_text') {
      return runOperation(async () =>
        withContinuation(
          await withBoardBuildPersistence({
            input: recipeInput,
            persist: options.persist,
            result: record(
              await buildNativeText(options, target, recipeInput, recipe),
              'board_build semantic owner'
            ),
            target
          })
        )
      )
    }
    if (recipe.kind === 'native_card') {
      return runOperation(async () =>
        withContinuation(
          await withBoardBuildPersistence({
            input: recipeInput,
            persist: options.persist,
            result: record(
              await buildNativeCard(options, target, recipeInput, recipe),
              'board_build semantic owner'
            ),
            target
          })
        )
      )
    }
    if (recipe.kind === 'code_object') {
      return runOperation(async () =>
        withContinuation(
          await buildPersistentCodeObject(
            {
              context: options.board.context,
              create: options.codeObjectCreate,
              persist: options.persist,
              present: options.board.present,
              read: options.codeObjectRead,
              refine: options.codeObjectRefine
            },
            target,
            recipeInput,
            recipe
          )
        )
      )
    }

    if (!canWrite(target)) {
      throw new Error(
        'This OpenPencil workspace is view-only in the connected runtime. Use its writer tab, then reacquire Board context.'
      )
    }
    return runOperation(async () =>
      withContinuation(
        await withBoardBuildPersistence({
          input: recipeInput,
          persist: options.persist,
          result: record(
            await buildNativeDiagram(options, target, recipeInput, recipe, diagramPosition),
            'board_build semantic owner'
          ),
          target
        })
      )
    )
  }
}

export type { BoardBuildExtension, BoardBuildInput, BoardBuildRecipe } from './types'
