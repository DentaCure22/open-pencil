import { readFile } from 'node:fs/promises'

import { defineCommand } from 'citty'

import {
  BOARD_BUILD_INTENT_REQUEST_CONTRACT,
  BOARD_BUILD_RECIPE_REQUEST_CONTRACT,
  boardBuildTraceContext,
  compileBoardBuildIntentRequest,
  compileBoardBuildRecipeRequest,
  materializeBoardBuildTrace,
  parseBoardBuildPlan,
  type BoardBuildTraceContext,
  type BoardBuildIntentCompilerMetadata,
  type BoardBuildRecipeCompilerMetadata
} from '@open-pencil/core/rpc'

import { rpcEnvelopeExact, type AppRpcTarget } from '#cli/app-client'
import { appTargetOptions, appTargetRpcArgs, type AppTargetCliArgs } from '#cli/app-target'
import {
  BOARD_BUILD_REQUEST_CONTRACT,
  buildWithFreshContext,
  exactFreshContextTarget,
  normalizeFreshContextRecipe,
  parseBoardBuildRequest,
  type BoardBuildRequest,
  type FreshBoardBuildLogicalArgs,
  type PersistedBoardTarget
} from '#cli/board-build/fresh-context'
import { boardBuildReleaseEnvelope, withBoardBuildReleaseSummary } from '#cli/board-build/release'
import { tryTerminalBoardBuildRelease } from '#cli/board-build/terminal-release'
import {
  connectWithFreshContext,
  type FreshBoardConnectLogicalArgs
} from '#cli/board-connect/fresh-context'
import { editWithFreshContext, type FreshBoardEditLogicalArgs } from '#cli/board-edit/fresh-context'
import { boardFixtureCommand } from '#cli/board-fixture'
import { prepareTraceEdit, type TraceEditPreparation } from '#cli/board-prepare-edit'
import {
  presentWithFreshContext,
  type FreshBoardPresentLogicalArgs
} from '#cli/board-present/fresh-context'
import { parseBoardReadCliArgs, type BoardReadCliArgs } from '#cli/board-read/arguments'
import { readWithFreshContext, type FreshBoardReadLogicalArgs } from '#cli/board-read/fresh-context'
import {
  create as createBoard,
  list as listBoards,
  open as openBoard,
  search as searchBoards
} from '#cli/commands/boards'
import { bold, entity, fmtList, printError } from '#cli/format'

type BoardTargetArgs = AppTargetCliArgs & { json?: boolean }
type BoardJsonObject = { [key: string]: unknown }
type BoardPlanInput = AsyncIterable<string | Uint8Array>

export type ResolvedBoardBuildPlanSource = {
  compilation?: BoardBuildRecipeCompilerMetadata
  intentCompilation?: BoardBuildIntentCompilerMetadata
  source: string
}

type ContextArgs = BoardTargetArgs & { current?: boolean }

type ReadArgs = BoardTargetArgs &
  BoardReadCliArgs & {
    'context-token'?: string
  }

type ChangeArgs = BoardTargetArgs & {
  'anchor-id'?: string
  clearance?: string
  'context-token'?: string
  'expected-revision'?: string
  'font-size'?: string
  'max-width'?: string
  name?: string
  'request-id'?: string
  'task-id'?: string
  text?: string
  'trace-id'?: string
  'visual-profile'?: string
}

type EditArgs = BoardTargetArgs & {
  'context-token'?: string
  'expected-revision'?: string
  'fresh-context'?: boolean
  height?: string
  'object-id'?: string
  'offset-x'?: string
  'offset-y'?: string
  operation?: string
  patch?: string
  'request-id'?: string
  'task-id'?: string
  'trace-id'?: string
  width?: string
  x?: string
  y?: string
}

export type BuildArgs = BoardTargetArgs & {
  'anchor-id'?: string
  'auto-place'?: boolean
  base?: string
  'base-file'?: string
  'context-token'?: string
  'expected-revision'?: string
  extension?: string
  'fresh-context'?: boolean
  'gesture-id'?: string
  height?: string
  'initial-state'?: string
  intent?: string
  'object-key'?: string
  'object-name'?: string
  placement?: string
  plan?: string
  'plan-file'?: string
  props?: string
  recipe?: string
  'recipe-file'?: string
  'release-summary'?: boolean
  request?: string
  'request-file'?: string
  'relative-to-name'?: string
  'request-id'?: string
  'source-file'?: string
  'task-id'?: string
  'target-file'?: string
  'trace-id'?: string
  'latest-gesture'?: boolean
  width?: string
}

type ConnectArgs = BoardTargetArgs & {
  automatic?: boolean
  base?: string
  'base-file'?: string
  'context-token'?: string
  'expected-revision'?: string
  'fresh-context'?: boolean
  kind?: string
  label?: string
  'request-id'?: string
  'source-id'?: string
  'source-name'?: string
  'source-port'?: string
  'target-id'?: string
  'target-name'?: string
  'target-port'?: string
  'task-id'?: string
  'trace-id'?: string
}

type BoardConnectionKind = 'action' | 'data' | 'visual'
type BoardConnectionPort = string

type PresentArgs = BoardTargetArgs & {
  'context-token'?: string
  'fresh-context'?: boolean
  'object-ids'?: string
}

type VerifyArgs = BoardTargetArgs & {
  'context-token'?: string
  'request-id'?: string
}

const boardTargetOptions = {
  'content-document-id': appTargetOptions['content-document-id'],
  'document-id': appTargetOptions['document-id'],
  'page-id': appTargetOptions['page-id'],
  'runtime-instance-id': appTargetOptions['runtime-instance-id'],
  'workspace-id': appTargetOptions['workspace-id']
} as const

const contextBoardTargetOptions = {
  ...boardTargetOptions,
  current: {
    type: 'boolean',
    description: 'Use the one current visible Board and return its exact identity'
  }
} as const

const exactBoardTargetOptions = {
  'content-document-id': { ...boardTargetOptions['content-document-id'], required: true },
  'document-id': { ...boardTargetOptions['document-id'], required: true },
  'page-id': { ...boardTargetOptions['page-id'], required: true },
  'runtime-instance-id': { ...boardTargetOptions['runtime-instance-id'], required: true },
  'workspace-id': { ...boardTargetOptions['workspace-id'], required: true }
} as const

const presentBoardTargetOptions = {
  'content-document-id': { ...boardTargetOptions['content-document-id'], required: true },
  'document-id': { ...boardTargetOptions['document-id'], required: true },
  'page-id': { ...boardTargetOptions['page-id'], required: true },
  'runtime-instance-id': boardTargetOptions['runtime-instance-id'],
  'workspace-id': { ...boardTargetOptions['workspace-id'], required: true }
} as const

const jsonOption = { type: 'boolean', description: 'Output as JSON' } as const
const BOARD_CONNECTION_PORT_PATTERN = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/u

function requiredStringOption(description: string) {
  return { type: 'string' as const, description, required: true as const }
}

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${flag} is required.`)
  return trimmed
}

function numberFlag(
  value: string | undefined,
  flag: string,
  options: { integer?: boolean; maximum?: number; minimum: number }
): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (
    !Number.isFinite(parsed) ||
    (options.integer && !Number.isInteger(parsed)) ||
    parsed < options.minimum ||
    (options.maximum !== undefined && parsed > options.maximum)
  ) {
    const maximum = options.maximum ?? 'infinity'
    throw new Error(`${flag} must be between ${options.minimum} and ${maximum}.`)
  }
  return parsed
}

function exactTarget(args: BoardTargetArgs, requireRuntime: boolean): Record<string, unknown> {
  const pageId = required(args['page-id'], '--page-id')
  const workspaceId = args['workspace-id']?.trim()
  const documentId = args['document-id']?.trim()
  if (!requireRuntime && !workspaceId && !documentId) {
    throw new Error('Provide --workspace-id or --document-id.')
  }
  if (requireRuntime && !workspaceId) {
    throw new Error('--workspace-id is required after board context.')
  }
  if (requireRuntime && !documentId) {
    throw new Error('--document-id is required after board context.')
  }
  const runtimeInstanceId = args['runtime-instance-id']?.trim()
  if (requireRuntime && !runtimeInstanceId) {
    throw new Error('--runtime-instance-id is required after board context.')
  }
  const contentDocumentId = args['content-document-id']?.trim()
  if (requireRuntime && !contentDocumentId) {
    throw new Error('--content-document-id is required after board context.')
  }
  return {
    ...appTargetRpcArgs(args),
    page_id: pageId,
    ...(runtimeInstanceId ? { runtime_instance_id: runtimeInstanceId } : {})
  }
}

function isBoardJsonObject(value: unknown): value is BoardJsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function jsonObject(value: string | undefined, flag: string): BoardJsonObject {
  const source = required(value, flag)
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error(`${flag} must be a JSON object.`)
  }
  if (!isBoardJsonObject(parsed)) throw new Error(`${flag} must be a JSON object.`)
  return parsed
}

function boardConnectionKind(value: string | undefined): BoardConnectionKind {
  const kind = required(value, '--kind')
  if (kind !== 'visual' && kind !== 'data' && kind !== 'action') {
    throw new Error('--kind must be visual, data, or action.')
  }
  return kind
}

function assertBoardConnectionActivation(
  kind: BoardConnectionKind,
  automatic: boolean | undefined
): void {
  if (kind === 'visual' && automatic === true) {
    throw new Error('Visual connections cannot use --automatic; omit it or use --no-automatic.')
  }
  if (kind !== 'visual' && typeof automatic !== 'boolean') {
    throw new Error('Data and action connections require --automatic or --no-automatic explicitly.')
  }
}

function boardConnectionPort(
  value: string | undefined,
  flag: string
): BoardConnectionPort | undefined {
  const port = value?.trim()
  if (port && !BOARD_CONNECTION_PORT_PATTERN.test(port)) {
    throw new Error(`${flag} must be a side or stable named port ID.`)
  }
  return port
}

function hasFlattenedBoardBase(args: BuildArgs | ConnectArgs): boolean {
  const values = [
    args['content-document-id'],
    args['context-token'],
    args['document-id'],
    args['expected-revision'],
    args['page-id'],
    args['runtime-instance-id'],
    args['workspace-id']
  ]
  return values.some((value) => Boolean(value?.trim()))
}

function printBoardResult(
  title: string,
  result: Record<string, unknown>,
  target: AppRpcTarget | undefined,
  json: boolean
) {
  if (json) {
    console.log(JSON.stringify({ ...result, ...(target ? { target } : {}) }, null, 2))
    return
  }
  let status = 'completed'
  if (typeof result.status === 'string') status = result.status
  else if (typeof result.status === 'object') status = JSON.stringify(result.status)
  console.log('')
  console.log(bold(`  ${title}`))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: entity('status', status),
          details: {
            ...(target
              ? {
                  board: `${target.documentName} / ${target.pageName}`,
                  content_document: target.contentDocumentId ?? 'unreported',
                  document_tab: target.documentId,
                  revision: target.boardRevision,
                  runtime: target.runtimeInstanceId ?? 'unreported'
                }
              : {}),
            result: JSON.stringify(result)
          }
        }
      ],
      { compact: true }
    )
  )
  console.log('')
}

async function releaseOrPrintBoardBuildResult(
  result: BoardJsonObject,
  target: AppRpcTarget | undefined,
  args: Pick<BuildArgs, 'json' | 'release-summary'>
): Promise<void> {
  const release = boardBuildReleaseEnvelope(result, target)
  await tryTerminalBoardBuildRelease(release)
  printBoardResult(
    'Board build',
    args['release-summary'] ? release : withBoardBuildReleaseSummary(result, target),
    args['release-summary'] ? undefined : target,
    Boolean(args.json)
  )
}

export function boardCommandErrorResult(
  error: unknown,
  args: BoardTargetArgs & { 'request-id'?: string }
): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  const needsChoice = message.includes('No collision-free placement')
  const requestId = args['request-id']?.trim()
  return {
    error: {
      code: needsChoice ? 'no_collision_free_placement' : 'board_command_failed',
      message
    },
    ...(requestId
      ? {
          next_action: {
            request_id: requestId,
            retry_mutation: false
          }
        }
      : {}),
    status: {
      attention_required: true,
      command: needsChoice ? 'needs_choice' : 'unavailable',
      mutation: 'not_applied',
      reason: needsChoice ? 'no_collision_free_placement' : 'board_command_failed'
    },
    target: appTargetRpcArgs(args)
  }
}

function printBoardCommandError(
  error: unknown,
  args: BoardTargetArgs & { 'request-id'?: string }
): void {
  if (args.json) {
    console.log(JSON.stringify(boardCommandErrorResult(error, args), null, 2))
    return
  }
  printError(error)
}

export function boardBuildCommandErrorResult(
  error: unknown,
  args: BuildArgs,
  mutationRequestStarted: boolean
): Record<string, unknown> {
  const transportedResult =
    error && typeof error === 'object' && 'result' in error && isBoardJsonObject(error.result)
      ? error.result
      : undefined
  const transportedTarget =
    error && typeof error === 'object' && 'target' in error && isBoardJsonObject(error.target)
      ? (error.target as AppRpcTarget)
      : undefined
  if (transportedResult) {
    return withBoardBuildReleaseSummary(transportedResult, transportedTarget)
  }
  const result = {
    ...boardCommandErrorResult(error, args),
    ...(mutationRequestStarted ? {} : { failure_scope: 'pre_mutation' })
  }
  return withBoardBuildReleaseSummary(result, undefined)
}

function printBoardBuildCommandError(
  error: unknown,
  args: BuildArgs,
  mutationRequestStarted: boolean
): void {
  const withRelease = boardBuildCommandErrorResult(error, args, mutationRequestStarted)
  const output = args['release-summary']
    ? boardBuildReleaseEnvelope(withRelease, undefined)
    : withRelease
  if (args.json) {
    console.log(JSON.stringify(output, null, 2))
    return
  }
  printBoardResult('Board build', output, undefined, false)
}

export function boardContextRpcArgs(args: ContextArgs): Record<string, unknown> {
  if (args.current) {
    const conflicting = [
      args['content-document-id'],
      args['document-id'],
      args['page-id'],
      args['workspace-id']
    ].some((value) => Boolean(value?.trim()))
    if (conflicting) {
      throw new Error(
        '--current cannot be combined with workspace, document, content, or page IDs.'
      )
    }
    return {
      target: 'current_visible',
      ...(args['runtime-instance-id']?.trim()
        ? { runtime_instance_id: args['runtime-instance-id'].trim() }
        : {})
    }
  }
  return exactTarget(args, false)
}

export function boardReadRpcArgs(args: ReadArgs): Record<string, unknown> {
  return {
    ...exactTarget(args, true),
    context_token: required(args['context-token'], '--context-token'),
    ...boardReadLogicalRpcArgs(args)
  }
}

export function boardReadLogicalRpcArgs(args: ReadArgs): FreshBoardReadLogicalArgs {
  return parseBoardReadCliArgs(args)
}

export function boardChangeRpcArgs(args: ChangeArgs): Record<string, unknown> {
  const expectedRevision = numberFlag(args['expected-revision'], '--expected-revision', {
    integer: true,
    minimum: 0
  })
  if (expectedRevision === undefined) throw new Error('--expected-revision is required.')
  const visualProfile = args['visual-profile']?.trim()
  if (visualProfile && visualProfile !== 'local-legible-text-v1') {
    throw new Error('--visual-profile currently supports only local-legible-text-v1.')
  }
  return {
    ...exactTarget(args, true),
    context_token: required(args['context-token'], '--context-token'),
    expected_revision: expectedRevision,
    operation: {
      kind: 'artifact.create',
      anchor_id: required(args['anchor-id'], '--anchor-id'),
      artifact: {
        kind: 'native_text',
        text: required(args.text, '--text'),
        ...(args.name?.trim() ? { name: args.name.trim() } : {}),
        ...(args['font-size'] !== undefined
          ? {
              font_size: numberFlag(args['font-size'], '--font-size', {
                maximum: 256,
                minimum: 8
              })
            }
          : {}),
        ...(args['max-width'] !== undefined
          ? {
              max_width: numberFlag(args['max-width'], '--max-width', {
                maximum: 2_000,
                minimum: 48
              })
            }
          : {})
      },
      placement:
        args.clearance === undefined
          ? {}
          : {
              clearance: numberFlag(args.clearance, '--clearance', {
                maximum: 512,
                minimum: 0
              })
            }
    },
    request_id: required(args['request-id'], '--request-id'),
    ...(args['task-id']?.trim() ? { task_id: args['task-id'].trim() } : {}),
    ...(args['trace-id']?.trim() ? { trace_id: args['trace-id'].trim() } : {}),
    ...(visualProfile ? { visual: { profile: visualProfile } } : {})
  }
}

function boardEditOperation(args: EditArgs): Record<string, unknown> {
  const operationName = required(args.operation, '--operation')
  const objectId = required(args['object-id'], '--object-id')
  let operation: Record<string, unknown>
  if (operationName === 'update') {
    operation = {
      kind: 'object.update',
      object_id: objectId,
      patch: jsonObject(args.patch, '--patch')
    }
  } else if (operationName === 'move') {
    const x = numberFlag(args.x, '--x', { minimum: -1_000_000, maximum: 1_000_000 })
    const y = numberFlag(args.y, '--y', { minimum: -1_000_000, maximum: 1_000_000 })
    if (x === undefined || y === undefined) throw new Error('move requires --x and --y.')
    operation = { kind: 'object.move', object_id: objectId, x, y }
  } else if (operationName === 'resize') {
    const width = numberFlag(args.width, '--width', { minimum: 1, maximum: 100_000 })
    const height = numberFlag(args.height, '--height', { minimum: 1, maximum: 100_000 })
    if (width === undefined || height === undefined) {
      throw new Error('resize requires --width and --height.')
    }
    operation = { height, kind: 'object.resize', object_id: objectId, width }
  } else if (operationName === 'duplicate') {
    operation = {
      kind: 'object.duplicate',
      object_id: objectId,
      ...(args['offset-x'] === undefined
        ? {}
        : {
            offset_x: numberFlag(args['offset-x'], '--offset-x', {
              minimum: -10_000,
              maximum: 10_000
            })
          }),
      ...(args['offset-y'] === undefined
        ? {}
        : {
            offset_y: numberFlag(args['offset-y'], '--offset-y', {
              minimum: -10_000,
              maximum: 10_000
            })
          })
    }
  } else if (operationName === 'delete') {
    operation = { kind: 'object.delete', object_id: objectId }
  } else {
    throw new Error('--operation must be update, move, resize, duplicate, or delete.')
  }
  return operation
}

export function boardEditLogicalRpcArgs(args: EditArgs): FreshBoardEditLogicalArgs {
  return {
    operation: boardEditOperation(args),
    request_id: required(args['request-id'], '--request-id'),
    ...(args['task-id']?.trim() ? { task_id: args['task-id'].trim() } : {}),
    ...(args['trace-id']?.trim() ? { trace_id: args['trace-id'].trim() } : {})
  }
}

export function boardEditRpcArgs(args: EditArgs): Record<string, unknown> {
  const expectedRevision = numberFlag(args['expected-revision'], '--expected-revision', {
    integer: true,
    minimum: 0
  })
  if (expectedRevision === undefined) throw new Error('--expected-revision is required.')
  return {
    ...exactTarget(args, true),
    context_token: required(args['context-token'], '--context-token'),
    expected_revision: expectedRevision,
    ...boardEditLogicalRpcArgs(args)
  }
}

export function boardBuildRpcArgs(args: BuildArgs): Record<string, unknown> {
  const base = args.base?.trim() ? jsonObject(args.base, '--base or --base-file') : undefined
  const hasFlatBase = hasFlattenedBoardBase(args)
  if (base && hasFlatBase) {
    throw new Error('--base cannot be combined with flattened Board context fields.')
  }
  const expectedRevision = numberFlag(args['expected-revision'], '--expected-revision', {
    integer: true,
    minimum: 0
  })
  if (!base && expectedRevision === undefined) throw new Error('--expected-revision is required.')
  return {
    ...(base ? { base } : exactTarget(args, true)),
    ...(base
      ? {}
      : {
          context_token: required(args['context-token'], '--context-token'),
          contract: 'board-build/v1',
          expected_revision: expectedRevision
        }),
    ...boardBuildLogicalRpcArgs(args)
  }
}

export function boardBuildLogicalRpcArgs(
  args: BuildArgs
): FreshBoardBuildLogicalArgs & { anchor_id?: string } {
  const plan = args.plan
    ? parseBoardBuildPlan(jsonObject(args.plan, '--plan or --plan-file'))
    : undefined
  if (plan && args['anchor-id']?.trim()) {
    throw new Error('--plan/--plan-file cannot be combined with --anchor-id.')
  }
  return {
    ...(args['anchor-id']?.trim() ? { anchor_id: args['anchor-id'].trim() } : {}),
    ...(args.extension ? { extension: jsonObject(args.extension, '--extension') } : {}),
    intent: required(args.intent, '--intent'),
    ...(plan ? { plan } : { recipe: jsonObject(args.recipe, '--recipe or --recipe-file') }),
    request_id: required(args['request-id'], '--request-id'),
    ...(args['task-id']?.trim() ? { task_id: args['task-id'].trim() } : {}),
    ...(args['trace-id']?.trim() ? { trace_id: args['trace-id'].trim() } : {})
  }
}

export async function boardBuildRecipeSource(args: BuildArgs): Promise<string> {
  const inline = args.recipe?.trim()
  const path = args['recipe-file']?.trim()
  const sourcePath = args['source-file']?.trim()
  const sources = [inline, path, sourcePath].filter(Boolean)
  if (sources.length !== 1) {
    throw new Error('Provide exactly one of --recipe, --recipe-file, or --source-file.')
  }
  if (!sourcePath) return inline ?? readFile(path ?? '', 'utf8')
  const placementModes = [
    Boolean(args['auto-place']),
    Boolean(args.placement?.trim()),
    Boolean(args['relative-to-name']?.trim())
  ].filter(Boolean).length
  if (placementModes !== 1) {
    throw new Error(
      '--source-file requires exactly one of --auto-place, --placement, or --relative-to-name.'
    )
  }
  const width = numberFlag(args.width, '--width', { maximum: 1_600, minimum: 240 })
  const height = numberFlag(args.height, '--height', { maximum: 1_200, minimum: 160 })
  const props = args.props ? jsonObject(args.props, '--props') : {}
  const initialState = args['initial-state']
    ? jsonObject(args['initial-state'], '--initial-state')
    : {}
  const recipe = {
    ...(height === undefined ? {} : { height }),
    initial_state: initialState,
    kind: 'code_object',
    name: required(args['object-name'], '--object-name'),
    object_key: required(args['object-key'], '--object-key'),
    operation: 'create',
    ...(args['auto-place']
      ? {}
      : args.placement
        ? { placement: { target: jsonObject(args.placement, '--placement') } }
        : {}),
    props,
    source: await readFile(sourcePath, 'utf8'),
    source_format: 'tsx',
    ...(width === undefined ? {} : { width })
  }
  return JSON.stringify(
    args['auto-place'] || args['relative-to-name']
      ? recipe
      : normalizeFreshContextRecipe(recipe, false)
  )
}

export async function boardBuildPlanSource(
  args: BuildArgs,
  input?: BoardPlanInput
): Promise<string | undefined> {
  const inline = args.plan?.trim()
  const path = args['plan-file']?.trim()
  if (inline && path) throw new Error('Provide only one of --plan or --plan-file.')
  if (!inline && !path) return undefined
  const conflicting = [
    ['--anchor-id', args['anchor-id']],
    ['--extension', args.extension],
    ['--height', args.height],
    ['--initial-state', args['initial-state']],
    ['--object-key', args['object-key']],
    ['--object-name', args['object-name']],
    ['--placement', args.placement],
    ['--props', args.props],
    ['--recipe', args.recipe],
    ['--recipe-file', args['recipe-file']],
    ['--relative-to-name', args['relative-to-name']],
    ['--source-file', args['source-file']],
    ['--width', args.width]
  ].filter(([, value]) => (typeof value === 'string' ? Boolean(value.trim()) : value === true))
  if (conflicting.length > 0) {
    throw new Error(
      `--plan/--plan-file is exclusive and cannot be combined with recipe-only flags: ${conflicting.map(([flag]) => flag).join(', ')}.`
    )
  }
  if (inline) return inline
  if (path !== '-') return readFile(path, 'utf8')
  let source: string
  if (input) {
    const chunks: Buffer[] = []
    for await (const chunk of input) chunks.push(Buffer.from(chunk))
    source = Buffer.concat(chunks).toString('utf8')
  } else {
    source = await Bun.stdin.text()
  }
  if (!source.trim()) {
    throw new Error(
      '--plan-file - requires a non-empty board-build-plan/v1, board-build-recipe-request/v1, or board-build-intent-request/v1 JSON value on stdin.'
    )
  }
  return source
}

export async function boardBuildRequestSource(
  args: Pick<BuildArgs, 'request' | 'request-file'>,
  input?: BoardPlanInput
): Promise<string> {
  const inline = args.request?.trim()
  const path = args['request-file']?.trim()
  if (Boolean(inline) === Boolean(path)) {
    throw new Error('Provide exactly one of --request or --request-file.')
  }
  if (inline) return inline
  if (path !== '-') return readFile(path ?? '', 'utf8')
  const chunks: Buffer[] = []
  if (input) {
    for await (const chunk of input) chunks.push(Buffer.from(chunk))
  } else {
    chunks.push(Buffer.from(await Bun.stdin.text()))
  }
  const source = Buffer.concat(chunks).toString('utf8')
  if (!source.trim()) {
    throw new Error(`--request-file - requires one non-empty ${BOARD_BUILD_REQUEST_CONTRACT}.`)
  }
  return source
}

export async function resolveBoardBuildRequest(
  args: Pick<BuildArgs, 'request' | 'request-file'>,
  input?: BoardPlanInput
): Promise<BoardBuildRequest> {
  const source = await boardBuildRequestSource(args, input)
  return parseBoardBuildRequest(jsonObject(source, '--request or --request-file'))
}

export async function resolveBoardBuildPlanSource(
  source: string
): Promise<ResolvedBoardBuildPlanSource> {
  const value = jsonObject(source, '--plan-file')
  if (value.contract === BOARD_BUILD_INTENT_REQUEST_CONTRACT) {
    const compilation = await compileBoardBuildIntentRequest(value)
    return {
      compilation: compilation.metadata.recipe_compilation,
      intentCompilation: compilation.metadata,
      source: JSON.stringify(compilation.plan)
    }
  }
  if (value.contract === BOARD_BUILD_RECIPE_REQUEST_CONTRACT) {
    const compilation = await compileBoardBuildRecipeRequest(value)
    return { compilation: compilation.metadata, source: JSON.stringify(compilation.plan) }
  }
  return { source: JSON.stringify(parseBoardBuildPlan(value)) }
}

type TraceBuildMaterializationCounts = {
  objectReferenceCount: number
  regionReferenceCount: number
}

function traceBuildRequested(args: BuildArgs): boolean {
  return args['latest-gesture'] === true || Boolean(args['gesture-id']?.trim())
}

export function boardBuildUsesAutomaticContext(args: BuildArgs): boolean {
  if (traceBuildRequested(args)) return false
  const hasPreparedAuthority = Boolean(
    args.base?.trim() ||
    args['base-file']?.trim() ||
    args['context-token']?.trim() ||
    args['expected-revision']?.trim()
  )
  return (
    Boolean(args['fresh-context']) ||
    Boolean(args['auto-place']) ||
    Boolean(args['relative-to-name']?.trim()) ||
    Boolean(args['target-file']?.trim()) ||
    !hasPreparedAuthority
  )
}

function materializeTraceBuildSource(
  source: string,
  context: BoardBuildTraceContext,
  label: string
): { counts: TraceBuildMaterializationCounts; source: string } {
  const materialized = materializeBoardBuildTrace(jsonObject(source, label), context)
  if (!isBoardJsonObject(materialized.value)) {
    throw new Error(`${label} must materialize to a JSON object.`)
  }
  return {
    counts: {
      objectReferenceCount: materialized.objectReferenceCount,
      regionReferenceCount: materialized.regionReferenceCount
    },
    source: JSON.stringify(materialized.value)
  }
}

function traceBuildHandshake(
  preparation: TraceEditPreparation,
  context: BoardBuildTraceContext,
  counts: TraceBuildMaterializationCounts
): BoardJsonObject {
  return {
    contract: 'board-build-trace/v1',
    gesture_id: context.gestureId,
    resolved_placeholders: {
      object_references: counts.objectReferenceCount,
      region_references: counts.regionReferenceCount
    },
    ...(context.selectedObjectId ? { selected_object_id: context.selectedObjectId } : {}),
    semantic_rpc_calls: {
      ...preparation.semanticRpcCalls,
      board_build: 1,
      total: 3
    }
  }
}

function assertTraceBuildTarget(request: BoardBuildRequest, context: BoardBuildTraceContext): void {
  const fields = ['content_document_id', 'document_id', 'page_id', 'workspace_id'] as const
  const mismatches = fields.filter((field) => context.base[field] !== request.target[field])
  if (mismatches.length > 0) {
    throw new Error(
      `Trace gesture belongs to a different persisted Board target: ${mismatches.join(', ')}.`
    )
  }
}

export function withBoardBuildRecipeCompilation(
  result: BoardJsonObject,
  compilation: BoardBuildRecipeCompilerMetadata | undefined,
  intentCompilation?: BoardBuildIntentCompilerMetadata
): BoardJsonObject {
  if (!compilation && !intentCompilation) return result
  const receipt = isBoardJsonObject(result.receipt)
    ? {
        ...result.receipt,
        ...(compilation ? { recipe_compilation: compilation } : {}),
        ...(intentCompilation ? { intent_compilation: intentCompilation } : {})
      }
    : result.receipt
  return {
    ...result,
    ...(compilation ? { recipe_compilation: compilation } : {}),
    ...(intentCompilation ? { intent_compilation: intentCompilation } : {}),
    ...(receipt === undefined ? {} : { receipt })
  }
}

async function optionalJsonSource(
  inline: string | undefined,
  path: string | undefined,
  label: string
): Promise<string | undefined> {
  const inlineValue = inline?.trim()
  const filePath = path?.trim()
  if (inlineValue && filePath) throw new Error(`Provide only one of --${label} or --${label}-file.`)
  return inlineValue ?? (filePath ? readFile(filePath, 'utf8') : undefined)
}

export function boardPresentRpcArgs(args: PresentArgs): Record<string, unknown> {
  return {
    ...exactTarget(args, true),
    context_token: required(args['context-token'], '--context-token'),
    ...boardPresentLogicalRpcArgs(args)
  }
}

export function boardPresentLogicalRpcArgs(args: PresentArgs): FreshBoardPresentLogicalArgs {
  const objectIds = required(args['object-ids'], '--object-ids')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (objectIds.length === 0 || objectIds.length > 100) {
    throw new Error('--object-ids must contain from 1 to 100 comma-separated IDs.')
  }
  if (new Set(objectIds).size !== objectIds.length) {
    throw new Error('--object-ids must contain unique IDs.')
  }
  return { object_ids: objectIds }
}

export function boardPresentFreshTarget(args: PresentArgs): PersistedBoardTarget {
  return {
    content_document_id: required(args['content-document-id'], '--content-document-id'),
    document_id: required(args['document-id'], '--document-id'),
    page_id: required(args['page-id'], '--page-id'),
    workspace_id: required(args['workspace-id'], '--workspace-id')
  }
}

export function boardConnectRpcArgs(args: ConnectArgs): Record<string, unknown> {
  const base = args.base?.trim() ? jsonObject(args.base, '--base or --base-file') : undefined
  const hasFlatBase = hasFlattenedBoardBase(args)
  if (base && hasFlatBase) {
    throw new Error('--base cannot be combined with flattened Board context fields.')
  }
  const expectedRevision = numberFlag(args['expected-revision'], '--expected-revision', {
    integer: true,
    minimum: 0
  })
  if (!base && expectedRevision === undefined) throw new Error('--expected-revision is required.')
  const logical = boardConnectLogicalRpcArgs(args)
  return {
    ...(base ? { base } : exactTarget(args, true)),
    ...(base
      ? {}
      : {
          context_token: required(args['context-token'], '--context-token'),
          expected_revision: expectedRevision
        }),
    ...logical
  }
}

export function boardConnectLogicalRpcArgs(args: ConnectArgs): FreshBoardConnectLogicalArgs {
  const kind = boardConnectionKind(args.kind)
  assertBoardConnectionActivation(kind, args.automatic)
  const sourcePort = boardConnectionPort(args['source-port'], '--source-port')
  const targetPort = boardConnectionPort(args['target-port'], '--target-port')
  return {
    kind,
    ...(typeof args.automatic === 'boolean' ? { automatic: args.automatic } : {}),
    ...(args.label?.trim() ? { label: args.label.trim() } : {}),
    request_id: required(args['request-id'], '--request-id'),
    source_id: args['source-id']?.trim() || 'pending-context-source-name-resolution',
    ...(sourcePort ? { source_port: sourcePort } : {}),
    target_id: args['target-id']?.trim() || 'pending-context-target-name-resolution',
    ...(targetPort ? { target_port: targetPort } : {}),
    ...(args['task-id']?.trim() ? { task_id: args['task-id'].trim() } : {}),
    ...(args['trace-id']?.trim() ? { trace_id: args['trace-id'].trim() } : {})
  }
}

function assertConnectorEndpointArgs(args: ConnectArgs, freshContext: boolean): void {
  for (const [idFlag, idValue, nameFlag, nameValue] of [
    ['--source-id', args['source-id'], '--source-name', args['source-name']],
    ['--target-id', args['target-id'], '--target-name', args['target-name']]
  ] as const) {
    const count = [idValue?.trim(), nameValue?.trim()].filter(Boolean).length
    if (count !== 1) {
      throw new Error(`Provide exactly one of ${idFlag} or ${nameFlag}.`)
    }
    if (nameValue?.trim() && !freshContext) {
      throw new Error(`${nameFlag} requires --fresh-context.`)
    }
  }
}

export function boardVerifyRpcArgs(args: VerifyArgs): Record<string, unknown> {
  return {
    ...exactTarget(args, true),
    context_token: required(args['context-token'], '--context-token'),
    request_id: required(args['request-id'], '--request-id')
  }
}

async function runBoardCommand(
  command: string,
  title: string,
  args: BoardTargetArgs,
  rpcArgs: Record<string, unknown>
) {
  const response = await rpcEnvelopeExact<Record<string, unknown>>(command, rpcArgs)
  printBoardResult(title, response.result, response.target, Boolean(args.json))
}

const context = defineCommand({
  meta: {
    name: 'context',
    description:
      'Acquire exact Board identity; use --current for the visible Board or provide --page-id plus --workspace-id/--document-id'
  },
  args: { ...contextBoardTargetOptions, json: jsonOption },
  run: async ({ args }) => {
    try {
      await runBoardCommand('board_context', 'Board context', args, boardContextRpcArgs(args))
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const read = defineCommand({
  meta: {
    name: 'read',
    description:
      'Read bounded semantic Board state; known IDs use --object-ids, while --query searches hierarchy, type, text/name, or spatial bounds under a token budget'
  },
  args: {
    ...exactBoardTargetOptions,
    'context-token': {
      type: 'string',
      description:
        'Optional token returned by board context; omitted acquires one read-only context'
    },
    'object-ids': {
      type: 'string',
      description: 'One to 25 comma-separated object IDs; reads each object and its descendants'
    },
    query: {
      type: 'string',
      description:
        'Strict JSON filter with one or more of parent_id, types, name, text, or region; implies query scope'
    },
    projection: {
      type: 'string',
      description: 'Query projection: id_only, summary (default), geometry, or detail'
    },
    sort: { type: 'string', description: 'Query order: document (default), name, x, or y' },
    'token-budget': {
      type: 'string',
      description: 'Query payload budget from 256 to 6000 estimated tokens; defaults to 1500'
    },
    scope: {
      type: 'string',
      description: 'selection, page, objects, or query; object IDs and query JSON imply scope'
    },
    limit: { type: 'string', description: 'Page read limit from 1 to 100' },
    json: jsonOption
  },
  run: async ({ args }) => {
    try {
      if (!args['context-token']?.trim()) {
        const execution = await readWithFreshContext(
          exactFreshContextTarget(args),
          boardReadLogicalRpcArgs(args)
        )
        printBoardResult(
          'Board read',
          { ...execution.response.result, fresh_context_handshake: execution.handshake },
          execution.response.target,
          Boolean(args.json)
        )
        return
      }
      await runBoardCommand('board_read', 'Board read', args, boardReadRpcArgs(args))
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const edit = defineCommand({
  meta: {
    name: 'edit',
    description:
      'Update, move, resize, duplicate, or delete one exact top-level native object through guarded revision and replay receipts'
  },
  args: {
    ...exactBoardTargetOptions,
    'context-token': { type: 'string', description: 'Token returned by board context' },
    'expected-revision': { type: 'string', description: 'Board revision from context' },
    'fresh-context': {
      type: 'boolean',
      description:
        'Acquire exact context internally, then edit in one CLI process; requires every exact target ID and is exclusive with context token and revision'
    },
    'request-id': requiredStringOption('Stable idempotency ID'),
    operation: requiredStringOption('update, move, resize, duplicate, or delete'),
    'object-id': requiredStringOption('Exact top-level native object ID'),
    patch: { type: 'string', description: 'Strict JSON patch for update' },
    x: { type: 'string', description: 'Absolute Board x for move' },
    y: { type: 'string', description: 'Absolute Board y for move' },
    width: { type: 'string', description: 'Width for resize' },
    height: { type: 'string', description: 'Height for resize' },
    'offset-x': { type: 'string', description: 'Duplicate x offset; defaults to 20' },
    'offset-y': { type: 'string', description: 'Duplicate y offset; defaults to 20' },
    'task-id': { type: 'string', description: 'Optional delegated task attribution' },
    'trace-id': { type: 'string', description: 'Optional Narrated Trace attribution' },
    json: jsonOption
  },
  run: async ({ args }) => {
    try {
      if (args['fresh-context']) {
        const execution = await editWithFreshContext(
          exactFreshContextTarget(args),
          boardEditLogicalRpcArgs(args)
        )
        const { response, handshake } = execution
        printBoardResult(
          'Board edit',
          { ...response.result, fresh_context_handshake: handshake },
          response.target,
          Boolean(args.json)
        )
        return
      }
      await runBoardCommand('board_change', 'Board edit', args, boardEditRpcArgs(args))
    } catch (error) {
      printBoardCommandError(error, args)
      process.exit(1)
    }
  }
})

const boardEditArgs = {
  ...exactBoardTargetOptions,
  'context-token': requiredStringOption('Token returned by board context'),
  'expected-revision': requiredStringOption('Board revision from context'),
  'request-id': requiredStringOption('Stable idempotency ID'),
  'anchor-id': requiredStringOption('Exact singleton selected native object ID'),
  text: requiredStringOption('Text to create'),
  name: { type: 'string', description: 'Optional native layer name' },
  'font-size': { type: 'string', description: 'Font size from 8 to 256' },
  'max-width': { type: 'string', description: 'Maximum text width from 48 to 2000' },
  clearance: { type: 'string', description: 'Collision clearance from 0 to 512' },
  'task-id': { type: 'string', description: 'Optional delegated task attribution' },
  'trace-id': { type: 'string', description: 'Optional Narrated Trace attribution' },
  'visual-profile': {
    type: 'string',
    description: 'Optional local-legible-text-v1 appearance and verification profile'
  },
  json: jsonOption
} as const

function boardChangeCompatibilityCommand() {
  return defineCommand({
    meta: {
      name: 'change',
      description:
        'Deprecated compatibility command for native text; use board build with a native_text recipe'
    },
    args: boardEditArgs,
    run: async ({ args }) => {
      try {
        await runBoardCommand('board_change', 'Board edit', args, boardChangeRpcArgs(args))
      } catch (error) {
        printBoardCommandError(error, args)
        process.exit(1)
      }
    }
  })
}

export const boardChangeCommand = boardChangeCompatibilityCommand()

const build = defineCommand({
  meta: {
    name: 'build',
    description: `Apply one guarded Board transaction from one ${BOARD_BUILD_REQUEST_CONTRACT}. Authority, revisions, retries, and persistence preparation stay internal.`
  },
  args: {
    request: {
      type: 'string',
      description: `Inline ${BOARD_BUILD_REQUEST_CONTRACT} with exact persisted target, request_id, intent, and one board-build-plan/v1`
    },
    'request-file': {
      type: 'string',
      description: `Path to one ${BOARD_BUILD_REQUEST_CONTRACT}, or - for stdin; use only when the JSON exceeds practical shell size`
    },
    'latest-gesture': {
      type: 'boolean',
      description:
        'Use the latest immutable Trace gesture as read-only context for $trace and trace_region placeholders'
    },
    'gesture-id': {
      type: 'string',
      description:
        'Use one exact immutable Trace gesture as read-only context; exclusive with --latest-gesture'
    },
    'release-summary': {
      type: 'boolean',
      description:
        'With --json, emit only the compact authoritative release envelope after the full receipt, readback, and persistence checks complete, including a durable next_build_target when available; use for ordinary straight-through agent completion'
    },
    json: jsonOption
  },
  run: async ({ args }) => {
    let mutationRequestStarted = false
    let errorArgs: BuildArgs = args
    try {
      if (args['release-summary'] && !args.json) {
        throw new Error('--release-summary requires --json.')
      }
      if (args['latest-gesture'] && args['gesture-id']?.trim()) {
        throw new Error('--latest-gesture cannot be combined with --gesture-id.')
      }
      const request = await resolveBoardBuildRequest(args)
      errorArgs = {
        ...args,
        'content-document-id': request.target.content_document_id,
        'document-id': request.target.document_id,
        'page-id': request.target.page_id,
        'request-id': request.request_id,
        'workspace-id': request.target.workspace_id
      }
      const traceRequested = traceBuildRequested(args)
      const tracePreparation = traceRequested
        ? await prepareTraceEdit({
            ...(args['gesture-id']?.trim() ? { 'gesture-id': args['gesture-id'].trim() } : {}),
            intent: request.intent,
            'latest-gesture': args['latest-gesture']
          })
        : undefined
      const traceContext = tracePreparation
        ? boardBuildTraceContext(tracePreparation.response.result)
        : undefined
      if (traceContext) assertTraceBuildTarget(request, traceContext)
      const tracedPlan = traceContext
        ? materializeTraceBuildSource(JSON.stringify(request.plan), traceContext, 'request.plan')
        : undefined
      const plan = parseBoardBuildPlan(
        tracedPlan ? jsonObject(tracedPlan.source, 'request.plan') : request.plan
      )
      const execution = await buildWithFreshContext(
        request.target,
        {
          intent: request.intent,
          plan,
          request_id: request.request_id,
          ...(traceContext ? { trace_id: traceContext.gestureId } : {})
        },
        {
          onSemanticCall: (command) => {
            if (command === 'board_build') mutationRequestStarted = true
          }
        }
      )
      const result =
        tracePreparation && traceContext
          ? {
              ...execution.response.result,
              trace_build_handshake: traceBuildHandshake(
                tracePreparation,
                traceContext,
                tracedPlan?.counts ?? { objectReferenceCount: 0, regionReferenceCount: 0 }
              )
            }
          : execution.response.result
      await releaseOrPrintBoardBuildResult(result, execution.response.target, args)
    } catch (error) {
      printBoardBuildCommandError(error, errorArgs, mutationRequestStarted)
      process.exit(1)
    }
  }
})

const present = defineCommand({
  meta: {
    name: 'present',
    description: 'Select and reveal exact native Board objects through the connected live editor'
  },
  args: {
    ...presentBoardTargetOptions,
    'context-token': { type: 'string', description: 'Token returned by board context' },
    'fresh-context': {
      type: 'boolean',
      description:
        'Compatibility flag; live Board context is acquired automatically when no context token is supplied'
    },
    'object-ids': requiredStringOption('Comma-separated native object IDs'),
    json: jsonOption
  },
  run: async ({ args }) => {
    try {
      if (args['fresh-context'] && args['context-token']?.trim()) {
        throw new Error('--fresh-context cannot be combined with --context-token.')
      }
      if (!args['context-token']?.trim()) {
        const execution = await presentWithFreshContext(
          boardPresentFreshTarget(args),
          boardPresentLogicalRpcArgs(args)
        )
        printBoardResult(
          'Board presentation',
          { ...execution.response.result, fresh_context_handshake: execution.handshake },
          execution.response.target,
          Boolean(args.json)
        )
        return
      }
      await runBoardCommand('board_present', 'Board presentation', args, boardPresentRpcArgs(args))
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const connect = defineCommand({
  meta: {
    name: 'connect',
    description:
      'Connect meaningfully related objects; use --fresh-context with exact IDs or unique visible top-level names for one atomic context-to-connector path'
  },
  args: {
    ...boardTargetOptions,
    base: {
      type: 'string',
      description: 'Complete connect_objects_base JSON returned by board_build'
    },
    'base-file': {
      type: 'string',
      description: 'Path to connect_objects_base JSON; exclusive with --base and flattened fields'
    },
    'context-token': { type: 'string', description: 'Token returned by Board context' },
    'expected-revision': { type: 'string', description: 'Board revision from context' },
    'fresh-context': {
      type: 'boolean',
      description:
        'Acquire one exact context internally, resolve optional endpoint names, then connect from its atomic base; normally two semantic RPC calls, with one same-request stale retry only when required'
    },
    'request-id': requiredStringOption('Stable idempotency ID'),
    'source-id': { type: 'string', description: 'Exact source object ID' },
    'source-name': {
      type: 'string',
      description: 'Fresh-context exact visible top-level source name; exclusive with --source-id'
    },
    'target-id': { type: 'string', description: 'Exact target object ID' },
    'target-name': {
      type: 'string',
      description: 'Fresh-context exact visible top-level target name; exclusive with --target-id'
    },
    kind: requiredStringOption('visual, data, or action'),
    automatic: {
      type: 'boolean',
      description:
        'Required as --automatic or --no-automatic for data/action; visual may omit and cannot enable it'
    },
    label: { type: 'string', description: 'Optional connection label' },
    'source-port': { type: 'string', description: 'auto, bottom, left, right, or top' },
    'target-port': { type: 'string', description: 'auto, bottom, left, right, or top' },
    'task-id': { type: 'string', description: 'Optional delegated task attribution' },
    'trace-id': { type: 'string', description: 'Optional Narrated Trace attribution' },
    json: jsonOption
  },
  run: async ({ args }) => {
    try {
      const freshTarget = args['fresh-context'] ? exactFreshContextTarget(args) : undefined
      assertConnectorEndpointArgs(args, Boolean(freshTarget))
      if (freshTarget) {
        const execution = await connectWithFreshContext(
          freshTarget,
          boardConnectLogicalRpcArgs(args),
          { sourceName: args['source-name'], targetName: args['target-name'] }
        )
        printBoardResult(
          'Object Graph connection',
          {
            ...execution.response.result,
            fresh_context_handshake: execution.handshake
          },
          execution.response.target,
          Boolean(args.json)
        )
        return
      }
      const base = await optionalJsonSource(args.base, args['base-file'], 'base')
      await runBoardCommand(
        'connect_objects',
        'Object Graph connection',
        args,
        boardConnectRpcArgs({ ...args, ...(base ? { base } : {}) })
      )
    } catch (error) {
      printBoardCommandError(error, args)
      process.exit(1)
    }
  }
})

const verify = defineCommand({
  meta: {
    name: 'verify',
    description: 'Verify one stable request receipt on the exact Board'
  },
  args: {
    ...exactBoardTargetOptions,
    'context-token': requiredStringOption('Token returned by board context'),
    'request-id': requiredStringOption('Stable request ID to verify'),
    json: jsonOption
  },
  run: async ({ args }) => {
    try {
      await runBoardCommand('board_verify', 'Board verification', args, boardVerifyRpcArgs(args))
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const boardSubCommands = {
  search: searchBoards,
  open: openBoard,
  create: createBoard,
  build,
  present
}

export const boardDiagnosticCommand = defineCommand({
  meta: {
    name: 'board-diagnostics',
    description: 'Internal Board inspection and compatibility commands'
  },
  subCommands: {
    list: listBoards,
    context,
    fixture: boardFixtureCommand,
    read,
    verify
  }
})

const boardCompatibilitySubCommands = {
  ...boardSubCommands,
  change: boardChangeCommand,
  connect,
  edit
}

export const boardWithChangeCommand = defineCommand({
  meta: {
    name: 'board',
    description: 'Search, open, create, build, or present persisted Boards'
  },
  subCommands: boardCompatibilitySubCommands
})

export default defineCommand({
  meta: {
    name: 'board',
    description: 'Search, open, create, build, or present persisted Boards'
  },
  subCommands: boardSubCommands
})
