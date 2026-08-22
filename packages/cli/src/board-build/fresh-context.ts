import { readFile } from 'node:fs/promises'

import { rpcEnvelopeExact, type AppRpcEnvelope } from '#cli/app-client'
import {
  assertFreshContextTarget as assertExactTarget,
  type BoardJsonObject,
  type ExactFreshContextTarget,
  type FreshContextTarget,
  freshContextElapsed as elapsed,
  type FreshContextMetrics,
  isBoardJsonObject,
  type PersistedBoardTarget
} from '#cli/fresh-context/shared'

export type {
  ExactFreshContextTarget,
  FreshContextTarget,
  PersistedBoardTarget
} from '#cli/fresh-context/shared'

export const BOARD_BUILD_REQUEST_CONTRACT = 'board-build-request/v1' as const

export type BoardBuildRequest = {
  contract: typeof BOARD_BUILD_REQUEST_CONTRACT
  intent: string
  plan: BoardJsonObject
  request_id: string
  target: PersistedBoardTarget
}

export type FreshContextCliArgs = {
  'anchor-id'?: string
  base?: string
  'base-file'?: string
  'content-document-id'?: string
  'context-token'?: string
  'document-id'?: string
  'expected-revision'?: string
  'page-id'?: string
  'runtime-instance-id'?: string
  'target-file'?: string
  'workspace-id'?: string
}

type FreshBoardBuildLogicalCommon = {
  intent: string
  request_id: string
  task_id?: string
  trace_id?: string
}

export type FreshBoardBuildLogicalArgs = FreshBoardBuildLogicalCommon &
  (
    | { anchor_id?: string; extension?: BoardJsonObject; recipe: BoardJsonObject }
    | { plan: BoardJsonObject }
  )

export type BoardBuildRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<BoardJsonObject>>

export type FreshContextHandshake = {
  contract: 'board-build-fresh-context/v2'
  handshake_elapsed_ms: FreshContextMetrics<'board_build'>
  resolved_relative_object_id?: string
  semantic_rpc_calls: FreshContextMetrics<'board_build'>
  stale_recovery_count: 0 | 1 | 2
}

export type FreshBoardBuildExecution = {
  handshake: FreshContextHandshake
  response: AppRpcEnvelope<BoardJsonObject>
}

type MonotonicClock = () => number

export type FreshBoardBuildOptions = {
  autoPlace?: boolean
  now?: MonotonicClock
  onSemanticCall?: (command: 'board_build' | 'board_context') => void
  relativeToName?: string
  send?: BoardBuildRpcSender
}

type FreshBoardBuildBase = {
  base: BoardJsonObject
  expectedRevision: number
}

const TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'runtime_instance_id',
  'workspace_id'
] as const
const PERSISTED_TARGET_FIELDS = [
  'content_document_id',
  'document_id',
  'page_id',
  'workspace_id'
] as const
const TARGET_FIELD_SET = new Set<string>(TARGET_FIELDS)
const PERSISTED_TARGET_FIELD_SET = new Set<string>(PERSISTED_TARGET_FIELDS)
const TARGET_ENVELOPE_FIELDS = new Set(['target'])
const TARGET_RPC_FIELDS = new Set([
  'contentDocumentId',
  'documentId',
  'pageId',
  'runtimeInstanceId',
  'workspaceId'
])
const BOARD_BUILD_REQUEST_FIELDS = new Set(['contract', 'intent', 'plan', 'request_id', 'target'])
const LOGICAL_FIELDS = new Set([
  'anchor_id',
  'extension',
  'intent',
  'plan',
  'recipe',
  'request_id',
  'task_id',
  'trace_id'
])
const NATIVE_CARD_FIELDS = new Set([
  'body',
  'clearance',
  'kind',
  'name',
  'placement',
  'preferred_directions',
  'size',
  'title',
  'width'
])
const NATIVE_TEXT_FIELDS = new Set(['font_size', 'kind', 'max_width', 'name', 'placement', 'text'])
const NATIVE_DIAGRAM_FIELDS = new Set([
  'allow_additional_owner',
  'kind',
  'owner_id',
  'source',
  'source_format',
  'zoom_to_selection'
])
const NATIVE_TEXT_PLACEMENT_FIELDS = new Set(['clearance', 'preferred_directions', 'target'])
const CODE_OBJECT_CREATE_FIELDS = new Set([
  'height',
  'initial_state',
  'kind',
  'name',
  'object_key',
  'operation',
  'placement',
  'ports',
  'props',
  'source',
  'source_format',
  'width'
])
const CODE_OBJECT_REFINE_FIELDS = new Set([
  'expected_source_hash',
  'kind',
  'name',
  'object_key',
  'operation',
  'owner_id',
  'props',
  'source',
  'source_format'
])
const CARD_PLACEMENT_FIELDS = new Set(['clearance', 'preferred_directions', 'target'])
const TARGET_DIRECTIONS = new Set(['above', 'below', 'left', 'right'])
const AUTO_TARGET_FIELDS = new Set(['kind'])
const POINT_TARGET_FIELDS = new Set(['kind', 'x', 'y'])
const RELATIVE_TARGET_FIELDS = new Set(['kind', 'object_id'])
const REGION_TARGET_FIELDS = new Set(['height', 'kind', 'width', 'x', 'y'])
const DEFAULT_DIRECTIONS = ['right', 'below', 'left', 'above'] as const

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${flag} is required with --fresh-context.`)
  return trimmed
}

export function exactFreshContextTarget(args: FreshContextCliArgs): ExactFreshContextTarget {
  const conflicting = [
    ['--base', args.base],
    ['--base-file', args['base-file']],
    ['--context-token', args['context-token']],
    ['--expected-revision', args['expected-revision']]
  ].filter((entry) => Boolean(entry[1]?.trim()))
  if (conflicting.length > 0) {
    throw new Error(
      `--fresh-context cannot be combined with ${conflicting.map((entry) => entry[0]).join(', ')}.`
    )
  }
  return {
    content_document_id: required(args['content-document-id'], '--content-document-id'),
    document_id: required(args['document-id'], '--document-id'),
    page_id: required(args['page-id'], '--page-id'),
    runtime_instance_id: required(args['runtime-instance-id'], '--runtime-instance-id'),
    workspace_id: required(args['workspace-id'], '--workspace-id')
  }
}

function exactTargetFileObject(value: unknown, label: string): ExactFreshContextTarget {
  if (!isBoardJsonObject(value)) {
    throw new Error(`${label} must be a JSON object containing only the five exact target IDs.`)
  }
  const keys = Object.keys(value)
  if (keys.length === TARGET_FIELDS.length && keys.every((key) => TARGET_FIELD_SET.has(key))) {
    assertSupportedFields(value, TARGET_FIELD_SET, label)
    return {
      content_document_id: requiredRuntimeString(
        value.content_document_id,
        'target-file content_document_id'
      ),
      document_id: requiredRuntimeString(value.document_id, 'target-file document_id'),
      page_id: requiredRuntimeString(value.page_id, 'target-file page_id'),
      runtime_instance_id: requiredRuntimeString(
        value.runtime_instance_id,
        'target-file runtime_instance_id'
      ),
      workspace_id: requiredRuntimeString(value.workspace_id, 'target-file workspace_id')
    }
  }
  if (keys.length === TARGET_FIELDS.length && keys.every((key) => TARGET_RPC_FIELDS.has(key))) {
    assertSupportedFields(value, TARGET_RPC_FIELDS, label)
    return {
      content_document_id: requiredRuntimeString(
        value.contentDocumentId,
        'target-file target.contentDocumentId'
      ),
      document_id: requiredRuntimeString(value.documentId, 'target-file target.documentId'),
      page_id: requiredRuntimeString(value.pageId, 'target-file target.pageId'),
      runtime_instance_id: requiredRuntimeString(
        value.runtimeInstanceId,
        'target-file target.runtimeInstanceId'
      ),
      workspace_id: requiredRuntimeString(value.workspaceId, 'target-file target.workspaceId')
    }
  }
  throw new Error(
    `${label} must contain exactly runtime_instance_id, workspace_id, document_id, content_document_id, and page_id without revision or authority fields.`
  )
}

function persistedBoardTarget(value: unknown, label: string): PersistedBoardTarget {
  if (!isBoardJsonObject(value)) {
    throw new Error(`${label} must be an object containing the four exact persisted target IDs.`)
  }
  assertSupportedFields(value, PERSISTED_TARGET_FIELD_SET, label)
  const missing = PERSISTED_TARGET_FIELDS.filter((field) => value[field] === undefined)
  if (missing.length > 0) {
    throw new Error(`${label} is missing: ${missing.join(', ')}.`)
  }
  return {
    content_document_id: requiredRuntimeString(
      value.content_document_id,
      `${label} content_document_id`
    ),
    document_id: requiredRuntimeString(value.document_id, `${label} document_id`),
    page_id: requiredRuntimeString(value.page_id, `${label} page_id`),
    workspace_id: requiredRuntimeString(value.workspace_id, `${label} workspace_id`)
  }
}

export function parseBoardBuildRequest(value: unknown): BoardBuildRequest {
  if (!isBoardJsonObject(value)) {
    throw new Error(`${BOARD_BUILD_REQUEST_CONTRACT} request must be a JSON object.`)
  }
  assertSupportedFields(value, BOARD_BUILD_REQUEST_FIELDS, BOARD_BUILD_REQUEST_CONTRACT)
  if (value.contract !== BOARD_BUILD_REQUEST_CONTRACT) {
    throw new Error(`request.contract must be ${BOARD_BUILD_REQUEST_CONTRACT}.`)
  }
  if (!isBoardJsonObject(value.plan)) {
    throw new Error('request.plan must be one board-build-plan/v1 JSON object.')
  }
  return {
    contract: BOARD_BUILD_REQUEST_CONTRACT,
    intent: requiredRuntimeString(value.intent, 'request intent'),
    plan: structuredClone(value.plan),
    request_id: requiredRuntimeString(value.request_id, 'request request_id'),
    target: persistedBoardTarget(value.target, 'request.target')
  }
}

function assertMatchingFlattenedTarget(
  args: FreshContextCliArgs,
  target: ExactFreshContextTarget
): void {
  const flattenedFields = [
    ['--content-document-id', args['content-document-id'], target.content_document_id],
    ['--document-id', args['document-id'], target.document_id],
    ['--page-id', args['page-id'], target.page_id],
    ['--runtime-instance-id', args['runtime-instance-id'], target.runtime_instance_id],
    ['--workspace-id', args['workspace-id'], target.workspace_id]
  ] as const
  const mismatches = flattenedFields.filter(
    ([, supplied, expected]) => supplied !== undefined && supplied.trim() !== expected
  )
  if (mismatches.length > 0) {
    throw new Error(
      `--target-file target does not match ${mismatches.map(([flag]) => flag).join(', ')}.`
    )
  }
}

export async function exactFreshContextTargetSource(
  args: FreshContextCliArgs
): Promise<ExactFreshContextTarget> {
  const path = args['target-file']?.trim()
  if (!path) return exactFreshContextTarget(args)
  const conflicts = [
    ['--base', args.base],
    ['--base-file', args['base-file']],
    ['--context-token', args['context-token']],
    ['--expected-revision', args['expected-revision']]
  ].filter((entry) => Boolean(entry[1]?.trim()))
  if (conflicts.length > 0) {
    throw new Error(
      `--target-file cannot be combined with ${conflicts.map((entry) => entry[0]).join(', ')}.`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not read --target-file as JSON: ${message}`)
  }
  if (!isBoardJsonObject(parsed)) {
    throw new Error('--target-file must contain a JSON object.')
  }
  let target: ExactFreshContextTarget
  if (Object.hasOwn(parsed, 'target')) {
    assertSupportedFields(parsed, TARGET_ENVELOPE_FIELDS, '--target-file envelope')
    target = exactTargetFileObject(parsed.target, '--target-file target')
  } else {
    target = exactTargetFileObject(parsed, '--target-file')
  }
  assertMatchingFlattenedTarget(args, target)
  return target
}

function assertSupportedFields(
  value: BoardJsonObject,
  supported: Set<string>,
  label: string
): void {
  const unexpected = Object.keys(value).filter((field) => !supported.has(field))
  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains unexpected or authority fields: ${unexpected.sort().join(', ')}.`
    )
  }
}

function requiredRuntimeString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Fresh-context ${field} must be a non-empty string.`)
  }
  return value.trim()
}

function optionalRuntimeString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  return requiredRuntimeString(value, field)
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`Fresh-context ${field} must be a finite number.`)
  }
  return value
}

function normalizedPreferredDirections(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 4 ||
    value.some((direction) =>
      typeof direction === 'string' ? !TARGET_DIRECTIONS.has(direction) : true
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error(
      'Fresh-context placement preferred_directions must contain one to four unique valid directions.'
    )
  }
  return [
    ...(value as string[]),
    ...DEFAULT_DIRECTIONS.filter((direction) => !value.includes(direction))
  ]
}

function assertPlacementTarget(value: unknown, recipeKind: string): void {
  if (!isBoardJsonObject(value)) {
    throw new Error(
      `Fresh-context ${recipeKind} requires explicit recipe.placement.target kind auto, point, relative, or region.`
    )
  }
  if (value.kind === 'auto') {
    assertSupportedFields(value, AUTO_TARGET_FIELDS, 'Fresh-context auto target')
    return
  }
  if (value.kind === 'point') {
    assertSupportedFields(value, POINT_TARGET_FIELDS, 'Fresh-context point target')
    finiteNumber(value.x, 'point target x')
    finiteNumber(value.y, 'point target y')
    return
  }
  if (value.kind === 'relative') {
    assertSupportedFields(value, RELATIVE_TARGET_FIELDS, 'Fresh-context relative target')
    requiredRuntimeString(value.object_id, 'placement target object_id')
    return
  }
  if (value.kind === 'region') {
    assertSupportedFields(value, REGION_TARGET_FIELDS, 'Fresh-context region target')
    finiteNumber(value.x, 'region target x')
    finiteNumber(value.y, 'region target y')
    const width = finiteNumber(value.width, 'region target width')
    const height = finiteNumber(value.height, 'region target height')
    if (width <= 0 || height <= 0) {
      throw new Error('Fresh-context region target width and height must be positive.')
    }
    return
  }
  throw new Error(
    `Fresh-context ${recipeKind} requires explicit recipe.placement.target kind auto, point, relative, or region.`
  )
}

function assertTargetPlacement(value: unknown, recipeKind: string): void {
  if (value === undefined) {
    throw new Error(
      `Fresh-context ${recipeKind} requires explicit recipe.placement.target kind auto, point, relative, or region.`
    )
  }
  if (!isBoardJsonObject(value)) {
    throw new Error(`Fresh-context ${recipeKind} recipe.placement must be an object.`)
  }
  assertSupportedFields(value, CARD_PLACEMENT_FIELDS, `Fresh-context ${recipeKind} placement`)
  if (value.clearance !== undefined) {
    const clearance = finiteNumber(value.clearance, 'placement clearance')
    if (clearance < 0 || clearance > 512) {
      throw new Error('Fresh-context placement clearance must be between 0 and 512.')
    }
  }
  if (value.preferred_directions !== undefined) {
    const directions = value.preferred_directions
    if (
      !Array.isArray(directions) ||
      directions.length !== 4 ||
      directions.some((direction) =>
        typeof direction === 'string' ? !TARGET_DIRECTIONS.has(direction) : true
      ) ||
      new Set(directions).size !== 4
    ) {
      throw new Error(
        'Fresh-context placement preferred_directions must contain all four directions once.'
      )
    }
  }
  assertPlacementTarget(value.target, recipeKind)
}

function assertJsonValue(value: unknown, field: string): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${field}[${index}]`))
    return
  }
  if (isBoardJsonObject(value)) {
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${field}.${key}`)
    return
  }
  throw new Error(`Fresh-context ${field} must contain only plain JSON values.`)
}

function withAutoPlacement(value: BoardJsonObject, autoPlace: boolean): BoardJsonObject {
  if (!autoPlace) return value
  if (!Object.hasOwn(value, 'placement')) {
    return { ...value, placement: { target: { kind: 'auto' } } }
  }
  const placement = value.placement
  if (
    isBoardJsonObject(placement) &&
    isBoardJsonObject(placement.target) &&
    placement.target.kind === 'auto'
  ) {
    return value
  }
  throw new Error('--auto-place cannot be combined with a non-auto recipe.placement target.')
}

function normalizeCodeObjectRefineRecipe(
  value: BoardJsonObject,
  autoPlace: boolean
): BoardJsonObject {
  assertSupportedFields(value, CODE_OBJECT_REFINE_FIELDS, 'Fresh-context code_object recipe')
  if (autoPlace) throw new Error('--auto-place cannot be used with code_object refine.')
  if (value.source_format !== 'tsx') {
    throw new Error('Fresh-context code_object recipe.source_format must be tsx.')
  }
  const expectedSourceHash = requiredRuntimeString(
    value.expected_source_hash,
    'recipe expected_source_hash'
  )
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedSourceHash)) {
    throw new Error('Fresh-context recipe expected_source_hash must be a lowercase SHA-256 digest.')
  }
  const ownerId = requiredRuntimeString(value.owner_id, 'recipe owner_id')
  const objectKey = requiredRuntimeString(value.object_key, 'recipe object_key')
  const source = requiredRuntimeString(value.source, 'recipe source')
  const name = optionalRuntimeString(value.name, 'recipe name')
  if (ownerId.length > 240) throw new Error('Fresh-context recipe owner_id exceeds 240 characters.')
  if (objectKey.length > 160) {
    throw new Error('Fresh-context recipe object_key exceeds 160 characters.')
  }
  if (name && name.length > 120) {
    throw new Error('Fresh-context recipe name exceeds 120 characters.')
  }
  if (source.length > 100_000) {
    throw new Error('Fresh-context recipe source exceeds 100000 characters.')
  }
  if (value.props !== undefined) assertJsonValue(value.props, 'recipe props')
  return value
}

function normalizeCodeObjectCreateRecipe(
  value: BoardJsonObject,
  autoPlace: boolean
): BoardJsonObject {
  assertSupportedFields(value, CODE_OBJECT_CREATE_FIELDS, 'Fresh-context code_object recipe')
  if (value.operation !== 'create') {
    throw new Error('Fresh-context code_object operation must be create or refine.')
  }
  if (value.source_format !== 'tsx') {
    throw new Error('Fresh-context code_object recipe.source_format must be tsx.')
  }
  const recipe = withAutoPlacement(value, autoPlace)
  const name = requiredRuntimeString(recipe.name, 'recipe name')
  const objectKey = requiredRuntimeString(recipe.object_key, 'recipe object_key')
  const source = requiredRuntimeString(recipe.source, 'recipe source')
  if (name.length > 120) throw new Error('Fresh-context recipe name exceeds 120 characters.')
  if (objectKey.length > 160) {
    throw new Error('Fresh-context recipe object_key exceeds 160 characters.')
  }
  if (source.length > 100_000) {
    throw new Error('Fresh-context recipe source exceeds 100000 characters.')
  }
  if (recipe.width !== undefined) {
    const width = finiteNumber(recipe.width, 'recipe width')
    if (width < 240 || width > 1_600) {
      throw new Error('Fresh-context recipe width must be between 240 and 1600.')
    }
  }
  if (recipe.height !== undefined) {
    const height = finiteNumber(recipe.height, 'recipe height')
    if (height < 160 || height > 1_200) {
      throw new Error('Fresh-context recipe height must be between 160 and 1200.')
    }
  }
  if (recipe.props !== undefined) assertJsonValue(recipe.props, 'recipe props')
  if (recipe.ports !== undefined) assertJsonValue(recipe.ports, 'recipe ports')
  if (recipe.initial_state !== undefined) {
    assertJsonValue(recipe.initial_state, 'recipe initial_state')
  }
  assertTargetPlacement(recipe.placement, 'code_object')
  return recipe
}

function normalizeCodeObjectRecipe(value: BoardJsonObject, autoPlace: boolean): BoardJsonObject {
  if (value.operation === 'refine') return normalizeCodeObjectRefineRecipe(value, autoPlace)
  return normalizeCodeObjectCreateRecipe(value, autoPlace)
}

function normalizeNativeTextRecipe(value: BoardJsonObject, autoPlace: boolean): BoardJsonObject {
  assertSupportedFields(value, NATIVE_TEXT_FIELDS, 'Fresh-context native_text recipe')
  const recipe = withAutoPlacement(value, autoPlace)
  const text = requiredRuntimeString(recipe.text, 'recipe text')
  if (text.length > 10_000) throw new Error('Fresh-context recipe text exceeds 10000 characters.')
  optionalRuntimeString(recipe.name, 'recipe name')
  if (recipe.font_size !== undefined) {
    const fontSize = finiteNumber(recipe.font_size, 'recipe font_size')
    if (fontSize < 8 || fontSize > 256) {
      throw new Error('Fresh-context recipe font_size must be between 8 and 256.')
    }
  }
  if (recipe.max_width !== undefined) {
    const maxWidth = finiteNumber(recipe.max_width, 'recipe max_width')
    if (maxWidth < 48 || maxWidth > 2_000) {
      throw new Error('Fresh-context recipe max_width must be between 48 and 2000.')
    }
  }
  if (recipe.placement !== undefined) {
    if (!isBoardJsonObject(recipe.placement)) {
      throw new Error('Fresh-context native_text recipe.placement must be an object.')
    }
    assertSupportedFields(
      recipe.placement,
      NATIVE_TEXT_PLACEMENT_FIELDS,
      'Fresh-context native_text placement'
    )
    if (recipe.placement.clearance !== undefined) {
      const clearance = finiteNumber(recipe.placement.clearance, 'placement clearance')
      if (clearance < 0 || clearance > 512) {
        throw new Error('Fresh-context placement clearance must be between 0 and 512.')
      }
    }
    if (recipe.placement.target !== undefined) {
      assertPlacementTarget(recipe.placement.target, 'native_text')
    }
    const preferredDirections = normalizedPreferredDirections(recipe.placement.preferred_directions)
    return {
      ...recipe,
      placement: {
        ...recipe.placement,
        ...(preferredDirections ? { preferred_directions: preferredDirections } : {})
      }
    }
  }
  return recipe
}

function normalizeNativeDiagramRecipe(value: BoardJsonObject, autoPlace: boolean): BoardJsonObject {
  assertSupportedFields(value, NATIVE_DIAGRAM_FIELDS, 'Fresh-context native_diagram recipe')
  if (autoPlace) {
    throw new Error('--auto-place is not used for native_diagram; provide anchor_id when creating.')
  }
  if (value.source_format !== 'mermaid') {
    throw new Error('Fresh-context native_diagram recipe.source_format must be mermaid.')
  }
  const source = requiredRuntimeString(value.source, 'recipe source')
  if (source.length > 50_000) {
    throw new Error('Fresh-context recipe source exceeds 50000 characters.')
  }
  optionalRuntimeString(value.owner_id, 'recipe owner_id')
  if (
    value.allow_additional_owner !== undefined &&
    typeof value.allow_additional_owner !== 'boolean'
  ) {
    throw new Error('Fresh-context recipe allow_additional_owner must be a boolean.')
  }
  if (value.zoom_to_selection !== undefined && typeof value.zoom_to_selection !== 'boolean') {
    throw new Error('Fresh-context recipe zoom_to_selection must be a boolean.')
  }
  return value
}

export function normalizeFreshContextRecipe(value: unknown, autoPlace = false): BoardJsonObject {
  if (!isBoardJsonObject(value)) {
    throw new Error(
      'Fresh-context supports native_text, native_card, native_diagram, and code_object create/refine recipes.'
    )
  }
  if (value.kind === 'code_object') return normalizeCodeObjectRecipe(value, autoPlace)
  if (value.kind === 'native_text') return normalizeNativeTextRecipe(value, autoPlace)
  if (value.kind === 'native_diagram') return normalizeNativeDiagramRecipe(value, autoPlace)
  if (value.kind !== 'native_card') {
    throw new Error(
      'Fresh-context supports native_text, native_card, native_diagram, and code_object create/refine recipes.'
    )
  }
  assertSupportedFields(value, NATIVE_CARD_FIELDS, 'Fresh-context native_card recipe')
  const {
    clearance,
    preferred_directions: preferredDirections,
    size: sizeValue,
    ...cardFields
  } = value
  const hasPlacementAliases = clearance !== undefined || preferredDirections !== undefined
  if (hasPlacementAliases && cardFields.placement !== undefined) {
    if (!isBoardJsonObject(cardFields.placement)) {
      throw new Error('Fresh-context native_card recipe.placement must be an object.')
    }
    if (
      (clearance !== undefined && cardFields.placement.clearance !== undefined) ||
      (preferredDirections !== undefined && cardFields.placement.preferred_directions !== undefined)
    ) {
      throw new Error(
        'Fresh-context native_card placement hints cannot be specified both at recipe top level and inside recipe.placement.'
      )
    }
  }
  const placement = hasPlacementAliases
    ? {
        ...(isBoardJsonObject(cardFields.placement) ? cardFields.placement : {}),
        ...(clearance !== undefined ? { clearance } : {}),
        ...(preferredDirections !== undefined ? { preferred_directions: preferredDirections } : {})
      }
    : cardFields.placement
  const cardWithPlacement: BoardJsonObject = {
    ...cardFields,
    ...(placement !== undefined ? { placement } : {})
  }
  const sizeWidths = { compact: 240, standard: 320, wide: 480 } as const
  const size = optionalRuntimeString(sizeValue, 'recipe size')
  if (size && !(size in sizeWidths)) {
    throw new Error('Fresh-context recipe size must be compact, standard, or wide.')
  }
  const sizeWidth = size ? sizeWidths[size as keyof typeof sizeWidths] : undefined
  if (sizeWidth !== undefined && value.width !== undefined && value.width !== sizeWidth) {
    throw new Error(`Fresh-context recipe size ${size} conflicts with width ${value.width}.`)
  }
  const sizedRecipe: BoardJsonObject =
    sizeWidth === undefined ? cardWithPlacement : { ...cardWithPlacement, width: sizeWidth }
  const recipe = withAutoPlacement(sizedRecipe, autoPlace)
  const title = requiredRuntimeString(recipe.title, 'recipe title')
  const body = requiredRuntimeString(recipe.body, 'recipe body')
  if (title.length > 120) throw new Error('Fresh-context recipe title exceeds 120 characters.')
  if (body.length > 1_200) throw new Error('Fresh-context recipe body exceeds 1200 characters.')
  optionalRuntimeString(recipe.name, 'recipe name')
  if (recipe.width !== undefined) {
    const width = finiteNumber(recipe.width, 'recipe width')
    if (width < 240 || width > 640) {
      throw new Error('Fresh-context recipe width must be between 240 and 640.')
    }
  }
  assertTargetPlacement(recipe.placement, 'native_card')
  return recipe
}

function normalizeFreshBoardBuildLogical(
  value: unknown,
  autoPlace: boolean
): FreshBoardBuildLogicalArgs {
  if (!isBoardJsonObject(value)) {
    throw new Error('Fresh-context logical build payload must be an object.')
  }
  assertSupportedFields(value, LOGICAL_FIELDS, 'Fresh-context logical build payload')
  const extension = value.extension
  if (extension !== undefined && !isBoardJsonObject(extension)) {
    throw new Error('Fresh-context extension must be an object.')
  }
  const taskId = optionalRuntimeString(value.task_id, 'task_id')
  const traceId = optionalRuntimeString(value.trace_id, 'trace_id')
  const hasPlan = isBoardJsonObject(value.plan)
  const hasRecipe = isBoardJsonObject(value.recipe)
  if (hasPlan === hasRecipe) {
    throw new Error('Fresh-context Board build requires exactly one of plan or recipe.')
  }
  if (hasPlan && (value.anchor_id !== undefined || value.extension !== undefined || autoPlace)) {
    throw new Error(
      'Fresh-context Board build plan cannot use anchor_id, extension, or --auto-place.'
    )
  }
  const recipe = hasRecipe ? normalizeFreshContextRecipe(value.recipe, autoPlace) : undefined
  if (
    recipe?.kind === 'code_object' &&
    recipe.operation === 'refine' &&
    value.anchor_id !== undefined
  ) {
    throw new Error('Fresh-context code_object refine cannot use anchor_id.')
  }
  return {
    ...(value.anchor_id ? { anchor_id: requiredRuntimeString(value.anchor_id, 'anchor_id') } : {}),
    ...(extension ? { extension } : {}),
    intent: requiredRuntimeString(value.intent, 'intent'),
    ...(hasPlan
      ? { plan: structuredClone(value.plan as BoardJsonObject) }
      : { recipe: recipe as BoardJsonObject }),
    request_id: requiredRuntimeString(value.request_id, 'request_id'),
    ...(taskId ? { task_id: taskId } : {}),
    ...(traceId ? { trace_id: traceId } : {})
  }
}

function relativeNameLogical(
  logical: FreshBoardBuildLogicalArgs,
  relativeToName: string | undefined
): FreshBoardBuildLogicalArgs {
  const name = relativeToName?.trim()
  if (!name) return logical
  if (!('recipe' in logical)) {
    throw new Error('--relative-to-name cannot be combined with a Board build plan.')
  }
  if (logical.recipe.kind === 'code_object' && logical.recipe.operation === 'refine') {
    throw new Error('--relative-to-name cannot be used with code_object refine.')
  }
  if (logical.recipe.kind === 'native_text') {
    if (logical.anchor_id) {
      throw new Error('--relative-to-name cannot be combined with anchor_id.')
    }
    return { ...logical, anchor_id: 'pending-context-resolution' }
  }
  if (Object.hasOwn(logical.recipe, 'placement')) {
    const placement = logical.recipe.placement
    if (!isBoardJsonObject(placement)) {
      throw new Error('Fresh-context recipe.placement must be an object.')
    }
    if (Object.hasOwn(placement, 'target')) {
      throw new Error('--relative-to-name cannot be combined with recipe.placement.target.')
    }
    return {
      ...logical,
      recipe: {
        ...logical.recipe,
        placement: {
          ...placement,
          target: { kind: 'relative', object_id: 'pending-context-resolution' }
        }
      }
    }
  }
  return {
    ...logical,
    recipe: {
      ...logical.recipe,
      placement: { target: { kind: 'relative', object_id: 'pending-context-resolution' } }
    }
  }
}

function hasCompleteTopLevelNameCoverage(neighborhood: BoardJsonObject): boolean {
  if (neighborhood.truncated !== true) return true
  if (
    !Array.isArray(neighborhood.nodes) ||
    !isBoardJsonObject(neighborhood.omitted) ||
    !isBoardJsonObject(neighborhood.page_root_scan)
  ) {
    return false
  }
  const candidateCount = neighborhood.page_owned_candidate_count
  const returned = neighborhood.returned
  if (
    neighborhood.page_owned_candidate_count_exact !== true ||
    typeof candidateCount !== 'number' ||
    !Number.isInteger(candidateCount) ||
    candidateCount < 0 ||
    typeof returned !== 'number' ||
    !Number.isInteger(returned) ||
    returned !== candidateCount ||
    neighborhood.omitted.nodes !== 0 ||
    neighborhood.omitted.unscanned_page_root_children !== 0 ||
    neighborhood.omitted.name_code_units !== 0 ||
    neighborhood.page_root_scan.unscanned !== 0
  ) {
    return false
  }
  return neighborhood.nodes.every(
    (node) =>
      isBoardJsonObject(node) && node.name_truncated !== true && node.name_scan_truncated !== true
  )
}

export function resolveExactVisibleTopLevelObjectId(
  context: unknown,
  pageId: string,
  requestedName: string,
  optionName = '--relative-to-name'
): string {
  if (!isBoardJsonObject(context) || !isBoardJsonObject(context.neighborhood)) {
    throw new Error('Fresh Board context did not return a bounded neighborhood.')
  }
  const neighborhood = context.neighborhood
  if (!Array.isArray(neighborhood.nodes)) {
    throw new TypeError('Fresh Board context neighborhood did not return nodes.')
  }
  if (!hasCompleteTopLevelNameCoverage(neighborhood)) {
    throw new Error(
      `${optionName} cannot prove a unique match for "${requestedName}" from incomplete top-level name coverage; use an exact object ID.`
    )
  }
  const matches = neighborhood.nodes.filter(
    (node) =>
      isBoardJsonObject(node) &&
      node.name === requestedName &&
      node.parent_id === pageId &&
      node.visible !== false &&
      typeof node.id === 'string' &&
      node.id.trim()
  ) as BoardJsonObject[]
  if (matches.length === 0) {
    throw new Error(
      `${optionName} did not find the exact visible top-level object "${requestedName}"; use an exact object ID.`
    )
  }
  if (matches.length > 1) {
    const ids = matches.map((node) => String(node.id)).sort()
    throw new Error(
      `${optionName} is ambiguous for "${requestedName}": ${ids.join(', ')}. Use an exact object ID.`
    )
  }
  return String(matches[0]?.id)
}

function withResolvedRelativeObject(
  logical: FreshBoardBuildLogicalArgs,
  context: unknown,
  target: FreshContextTarget,
  relativeToName: string | undefined
): { logical: FreshBoardBuildLogicalArgs; resolvedObjectId?: string } {
  const requestedName = relativeToName?.trim()
  if (!requestedName) return { logical }
  if (!('recipe' in logical)) {
    throw new Error('--relative-to-name cannot be combined with a Board build plan.')
  }
  const resolvedObjectId = resolveExactVisibleTopLevelObjectId(
    context,
    target.page_id,
    requestedName
  )
  const recipe = structuredClone(logical.recipe)
  if (recipe.kind === 'native_text') {
    return {
      logical: { ...logical, anchor_id: resolvedObjectId, recipe },
      resolvedObjectId
    }
  }
  if (
    recipe.kind === 'code_object' &&
    isBoardJsonObject(context) &&
    context.execution_surface === 'local_workspace_authority'
  ) {
    delete recipe.placement
    return {
      logical: { ...logical, anchor_id: resolvedObjectId, recipe },
      resolvedObjectId
    }
  }
  const placement = recipe.placement
  if (!isBoardJsonObject(placement) || !isBoardJsonObject(placement.target)) {
    throw new Error('Fresh-context relative-name recipe lost its placement target.')
  }
  placement.target.object_id = resolvedObjectId
  return { logical: { ...logical, recipe }, resolvedObjectId }
}

function isConclusiveStaleContext(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Board context is stale. Reacquire context; do not retarget the operation.') ||
    /^Expected revision \d+, current revision is \d+$/.test(message)
  )
}

function freshBoardBuildBase(context: unknown, target: FreshContextTarget): FreshBoardBuildBase {
  if (!isBoardJsonObject(context)) {
    throw new Error('Fresh Board context did not return an object.')
  }
  const value = context.board_build_base
  if (!isBoardJsonObject(value)) {
    throw new Error(
      'Fresh Board context did not return board_build_base; the exact target lacks writer board_build capability.'
    )
  }
  const base = value
  if (base.contract !== 'board-build/v1') {
    throw new Error('Fresh Board context returned an unsupported board_build_base contract.')
  }
  const fields = target.runtime_instance_id ? TARGET_FIELDS : PERSISTED_TARGET_FIELDS
  const mismatches = fields.filter((field) => base[field] !== target[field])
  if (mismatches.length > 0) {
    throw new Error(
      `Fresh Board context returned board_build_base for the wrong exact target: ${mismatches.join(', ')}.`
    )
  }
  if (typeof base.context_token !== 'string' || !base.context_token.trim()) {
    throw new Error('Fresh Board context returned board_build_base without a context token.')
  }
  if (
    typeof base.expected_revision !== 'number' ||
    !Number.isInteger(base.expected_revision) ||
    base.expected_revision < 0
  ) {
    throw new Error('Fresh Board context returned board_build_base without a valid revision.')
  }
  return { base, expectedRevision: base.expected_revision }
}

export async function buildWithFreshContext(
  target: FreshContextTarget,
  logical: FreshBoardBuildLogicalArgs,
  options: FreshBoardBuildOptions = {}
): Promise<FreshBoardBuildExecution> {
  if (options.autoPlace && options.relativeToName?.trim()) {
    throw new Error('--auto-place cannot be combined with --relative-to-name.')
  }
  if ('recipe' in logical && logical.recipe.kind === 'native_text') {
    const placement = logical.recipe.placement
    const hasPlacementTarget = isBoardJsonObject(placement) && Object.hasOwn(placement, 'target')
    if (
      !logical.anchor_id &&
      !options.autoPlace &&
      !options.relativeToName?.trim() &&
      !hasPlacementTarget
    ) {
      throw new Error(
        'Fresh-context native_text requires --auto-place, --relative-to-name, anchor_id, or recipe.placement.target.'
      )
    }
  }
  const normalizedLogical = normalizeFreshBoardBuildLogical(
    relativeNameLogical(logical, options.relativeToName),
    options.autoPlace === true
  )
  const send = options.send ?? rpcEnvelopeExact<BoardJsonObject>
  const now = options.now ?? (() => performance.now())
  const started = now()
  let boardBuildElapsed = 0
  let boardContextElapsed = 0
  let boardBuildCalls = 0
  let boardContextCalls = 0
  let phaseStarted = started
  let resolvedRelativeObjectId: string | undefined

  for (const attempt of [0, 1, 2] as const) {
    const contextStarted = phaseStarted
    options.onSemanticCall?.('board_context')
    const context = await send('board_context', target)
    const contextFinished = now()
    boardContextCalls += 1
    boardContextElapsed += elapsed(contextStarted, contextFinished)
    assertExactTarget(context.target, target, 'Fresh Board context')
    const { base, expectedRevision } = freshBoardBuildBase(context.result, target)
    if (
      'plan' in normalizedLogical &&
      (!Array.isArray(context.result.capabilities) ||
        !context.result.capabilities.includes('board.build.plan.v1'))
    ) {
      throw new Error('Fresh Board context lacks writer board.build.plan.v1 capability.')
    }
    if (context.target.boardRevision !== expectedRevision) {
      throw new Error(
        'Fresh Board context target revision does not match board_build_base.expected_revision.'
      )
    }
    const resolved = withResolvedRelativeObject(
      normalizedLogical,
      context.result,
      target,
      options.relativeToName
    )
    resolvedRelativeObjectId = resolved.resolvedObjectId ?? resolvedRelativeObjectId
    const buildStarted = contextFinished
    try {
      boardBuildCalls += 1
      options.onSemanticCall?.('board_build')
      const response = await send('board_build', { ...resolved.logical, base })
      const buildFinished = now()
      boardBuildElapsed += elapsed(buildStarted, buildFinished)
      assertExactTarget(response.target, target, 'Fresh Board build')
      return {
        handshake: {
          contract: 'board-build-fresh-context/v2',
          handshake_elapsed_ms: {
            board_build: Math.round(boardBuildElapsed * 100) / 100,
            board_context: Math.round(boardContextElapsed * 100) / 100,
            total: elapsed(started, buildFinished)
          },
          ...(resolvedRelativeObjectId
            ? { resolved_relative_object_id: resolvedRelativeObjectId }
            : {}),
          semantic_rpc_calls: {
            board_build: boardBuildCalls,
            board_context: boardContextCalls,
            total: boardBuildCalls + boardContextCalls
          },
          stale_recovery_count: attempt
        },
        response
      }
    } catch (error) {
      const buildFinished = now()
      boardBuildElapsed += elapsed(buildStarted, buildFinished)
      phaseStarted = buildFinished
      if (attempt < 2 && isConclusiveStaleContext(error)) continue
      throw error
    }
  }

  throw new Error('Fresh Board build exhausted its bounded stale-context recovery.')
}
