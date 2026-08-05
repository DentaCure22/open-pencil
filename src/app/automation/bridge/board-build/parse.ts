import { parseBoardBuildPlan } from '@open-pencil/core/rpc'
import { parseObjectGraphPorts } from '@open-pencil/scene-graph'

import { MAX_CODE_OBJECT_SOURCE_LENGTH } from '@/app/automation/bridge/code-object/source'
import { isUnknownRecord, type UnknownRecord } from '@/app/automation/bridge/target'

import {
  BOARD_BUILD_CONTRACT,
  BOARD_BUILD_EXTENSION_CONTRACT,
  type BoardBuildExtension,
  type BoardBuildInput,
  type BoardBuildCardPlacement,
  type BoardBuildPlacement,
  type BoardBuildPlacementTarget,
  type BoardBuildRecipe,
  type CodeObjectBuildRecipe,
  type CodeObjectCreateBuildRecipe,
  type CodeObjectRefineBuildRecipe,
  type NativeCardBuildRecipe,
  type NativeDiagramBuildRecipe,
  type NativeTextBuildRecipe
} from './types'

export function requiredBuildString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`board_build requires ${field}.`)
  }
  return value.trim()
}

export function optionalBuildString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalBuildText(value: unknown, field: string): string {
  if (value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`board_build ${field} must be a string.`)
  return value.trim()
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`board_build ${field} must be a finite number.`)
  }
  return value
}

function requiredFiniteNumber(value: unknown, field: string): number {
  const parsed = optionalFiniteNumber(value, field)
  if (parsed === undefined) throw new Error(`board_build ${field} is required.`)
  return parsed
}

function assertSupportedFields(
  value: UnknownRecord,
  supported: ReadonlySet<string>,
  scope: string
): void {
  const unsupported = Object.keys(value).filter((key) => !supported.has(key))
  if (unsupported.length > 0) {
    throw new Error(
      `board_build ${scope} contains unsupported fields: ${unsupported.sort().join(', ')}.`
    )
  }
}

const PLACEMENT_KEYS = new Set(['clearance', 'preferred_directions'])
const CARD_PLACEMENT_KEYS = new Set([...PLACEMENT_KEYS, 'target'])
const AUTO_TARGET_KEYS = new Set(['kind'])
const POINT_TARGET_KEYS = new Set(['kind', 'x', 'y'])
const RELATIVE_TARGET_KEYS = new Set(['kind', 'object_id'])
const REGION_TARGET_KEYS = new Set(['height', 'kind', 'width', 'x', 'y'])
const NATIVE_CARD_RECIPE_KEYS = new Set([
  'body',
  'height',
  'kind',
  'name',
  'placement',
  'title',
  'width'
])
const NATIVE_DIAGRAM_RECIPE_KEYS = new Set([
  'allow_additional_owner',
  'kind',
  'owner_id',
  'source',
  'source_format',
  'zoom_to_selection'
])
const NATIVE_TEXT_RECIPE_KEYS = new Set([
  'font_size',
  'height',
  'kind',
  'max_width',
  'name',
  'placement',
  'text'
])
const BOARD_BUILD_EXTENSION_KEYS = new Set([
  'contract',
  'output_digest',
  'profile_id',
  'skill_id',
  'skill_version'
])
const BOARD_BUILD_INPUT_KEYS = new Set([
  'anchor_id',
  'content_document_id',
  'context_token',
  'contract',
  'document_id',
  'expected_revision',
  'extension',
  'intent',
  'page_id',
  'plan',
  'recipe',
  'request_id',
  'runtime_instance_id',
  'task_id',
  'trace_id',
  'workspace_id'
])

function parsePlacement(value: unknown): BoardBuildPlacement | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) throw new Error('board_build recipe placement must be an object.')
  assertSupportedFields(value, PLACEMENT_KEYS, 'recipe.placement')
  const clearance = optionalFiniteNumber(value.clearance, 'placement.clearance')
  if (clearance !== undefined && (clearance < 0 || clearance > 1_024)) {
    throw new Error('board_build placement.clearance must be between 0 and 1024.')
  }
  let preferredDirections: BoardBuildPlacement['preferredDirections']
  if (value.preferred_directions !== undefined) {
    if (
      !Array.isArray(value.preferred_directions) ||
      value.preferred_directions.length !== 4 ||
      value.preferred_directions.some(
        (direction) => !['above', 'below', 'left', 'right'].includes(String(direction))
      ) ||
      new Set(value.preferred_directions).size !== 4
    ) {
      throw new Error(
        'board_build placement.preferred_directions must contain four valid directions.'
      )
    }
    preferredDirections = value.preferred_directions as BoardBuildPlacement['preferredDirections']
  }
  return {
    ...(clearance === undefined ? {} : { clearance }),
    ...(preferredDirections ? { preferredDirections } : {})
  }
}

function parsePlacementTarget(value: unknown): BoardBuildPlacementTarget {
  if (!isUnknownRecord(value)) {
    throw new Error('board_build recipe.placement.target must be an object.')
  }
  if (value.kind === 'auto') {
    assertSupportedFields(value, AUTO_TARGET_KEYS, 'recipe.placement.target')
    return { kind: 'auto' }
  }
  if (value.kind === 'point') {
    assertSupportedFields(value, POINT_TARGET_KEYS, 'recipe.placement.target')
    return {
      kind: 'point',
      x: requiredFiniteNumber(value.x, 'placement.target.x'),
      y: requiredFiniteNumber(value.y, 'placement.target.y')
    }
  }
  if (value.kind === 'relative') {
    assertSupportedFields(value, RELATIVE_TARGET_KEYS, 'recipe.placement.target')
    return {
      kind: 'relative',
      objectId: requiredBuildString(value.object_id, 'placement.target.object_id')
    }
  }
  if (value.kind === 'region') {
    assertSupportedFields(value, REGION_TARGET_KEYS, 'recipe.placement.target')
    const width = optionalFiniteNumber(value.width, 'placement.target.width')
    const height = optionalFiniteNumber(value.height, 'placement.target.height')
    if (width === undefined || width <= 0 || height === undefined || height <= 0) {
      throw new Error('board_build placement.target region width and height must be positive.')
    }
    return {
      height,
      kind: 'region',
      width,
      x: requiredFiniteNumber(value.x, 'placement.target.x'),
      y: requiredFiniteNumber(value.y, 'placement.target.y')
    }
  }
  throw new Error(
    'board_build recipe.placement.target.kind must be auto, point, relative, or region.'
  )
}

function parseCardPlacement(value: unknown): BoardBuildCardPlacement | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) throw new Error('board_build recipe placement must be an object.')
  assertSupportedFields(value, CARD_PLACEMENT_KEYS, 'recipe.placement')
  const placement = parsePlacement({
    ...(value.clearance === undefined ? {} : { clearance: value.clearance }),
    ...(value.preferred_directions === undefined
      ? {}
      : { preferred_directions: value.preferred_directions })
  })
  return {
    ...placement,
    ...(value.target === undefined ? {} : { target: parsePlacementTarget(value.target) })
  }
}

function parseNativeCardRecipe(value: UnknownRecord): NativeCardBuildRecipe {
  assertSupportedFields(value, NATIVE_CARD_RECIPE_KEYS, 'native_card recipe')
  const title = requiredBuildString(value.title, 'recipe.title')
  const body = optionalBuildText(value.body, 'recipe.body')
  if (title.length > 120) {
    throw new Error('board_build recipe.title must contain at most 120 characters.')
  }
  if (body.length > 1_200) {
    throw new Error('board_build recipe.body must contain at most 1200 characters.')
  }
  const width = optionalFiniteNumber(value.width, 'recipe.width')
  if (width !== undefined && (width < 240 || width > 640)) {
    throw new Error('board_build recipe.width must be between 240 and 640.')
  }
  const height = optionalFiniteNumber(value.height, 'recipe.height')
  if (height !== undefined && (height < 80 || height > 720)) {
    throw new Error('board_build recipe.height must be between 80 and 720.')
  }
  const name = optionalBuildString(value.name)
  return {
    body,
    ...(height === undefined ? {} : { height }),
    kind: 'native_card',
    ...(name ? { name } : {}),
    ...(value.placement === undefined ? {} : { placement: parseCardPlacement(value.placement) }),
    title,
    ...(width === undefined ? {} : { width })
  }
}

function parseNativeTextRecipe(value: UnknownRecord): NativeTextBuildRecipe {
  assertSupportedFields(value, NATIVE_TEXT_RECIPE_KEYS, 'native_text recipe')
  const text = requiredBuildString(value.text, 'recipe.text')
  if (text.length > 10_000) {
    throw new Error('board_build recipe.text must contain at most 10000 characters.')
  }
  const fontSize = optionalFiniteNumber(value.font_size, 'recipe.font_size')
  const height = optionalFiniteNumber(value.height, 'recipe.height')
  const maxWidth = optionalFiniteNumber(value.max_width, 'recipe.max_width')
  if (fontSize !== undefined && (fontSize < 8 || fontSize > 256)) {
    throw new Error('board_build recipe.font_size must be between 8 and 256.')
  }
  if (height !== undefined && (height < 16 || height > 720)) {
    throw new Error('board_build recipe.height must be between 16 and 720.')
  }
  if (maxWidth !== undefined && (maxWidth < 48 || maxWidth > 2_000)) {
    throw new Error('board_build recipe.max_width must be between 48 and 2000.')
  }
  const name = optionalBuildString(value.name)
  return {
    ...(fontSize === undefined ? {} : { fontSize }),
    ...(height === undefined ? {} : { height }),
    kind: 'native_text',
    ...(maxWidth === undefined ? {} : { maxWidth }),
    ...(name ? { name } : {}),
    ...(value.placement === undefined ? {} : { placement: parsePlacement(value.placement) }),
    text
  }
}

function parseNativeDiagramRecipe(value: UnknownRecord): NativeDiagramBuildRecipe {
  assertSupportedFields(value, NATIVE_DIAGRAM_RECIPE_KEYS, 'native_diagram recipe')
  if (value.source_format !== 'mermaid') {
    throw new Error('board_build currently supports Mermaid native diagrams only.')
  }
  if (
    value.allow_additional_owner !== undefined &&
    typeof value.allow_additional_owner !== 'boolean'
  ) {
    throw new Error('board_build recipe.allow_additional_owner must be a boolean.')
  }
  if (value.zoom_to_selection !== undefined && typeof value.zoom_to_selection !== 'boolean') {
    throw new Error('board_build recipe.zoom_to_selection must be a boolean.')
  }
  const source = requiredBuildString(value.source, 'recipe.source')
  if (source.length > 50_000) {
    throw new Error('board_build recipe.source must contain at most 50000 characters.')
  }
  const ownerId = optionalBuildString(value.owner_id)
  return {
    ...(typeof value.allow_additional_owner === 'boolean'
      ? { allowAdditionalOwner: value.allow_additional_owner }
      : {}),
    kind: 'native_diagram',
    ...(ownerId ? { ownerId } : {}),
    source,
    sourceFormat: 'mermaid',
    ...(typeof value.zoom_to_selection === 'boolean'
      ? { zoomToSelection: value.zoom_to_selection }
      : {})
  }
}

const CODE_OBJECT_CREATE_RECIPE_KEYS = new Set([
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

const CODE_OBJECT_REFINE_RECIPE_KEYS = new Set([
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

function isPlainJsonValue(value: unknown, ancestors: Set<object>): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => isPlainJsonValue(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((item) => isPlainJsonValue(item, ancestors))
  ancestors.delete(value)
  return valid
}

function plainJsonObject(value: unknown, field: string): UnknownRecord {
  if (
    !isUnknownRecord(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    !isPlainJsonValue(value, new Set())
  ) {
    throw new Error(`board_build recipe.${field} must be a plain JSON object.`)
  }
  return structuredClone(value)
}

function codeObjectSource(value: UnknownRecord): string {
  if (value.source_format !== 'tsx') {
    throw new Error('board_build code_object recipe.source_format must be tsx.')
  }
  const source = requiredBuildString(value.source, 'recipe.source')
  if (source.length > MAX_CODE_OBJECT_SOURCE_LENGTH) {
    throw new Error(
      `board_build recipe.source must contain at most ${MAX_CODE_OBJECT_SOURCE_LENGTH} characters.`
    )
  }
  return source
}

function codeObjectIdentity(value: UnknownRecord): { name?: string; objectKey: string } {
  const objectKey = requiredBuildString(value.object_key, 'recipe.object_key')
  if (objectKey.length > 160) {
    throw new Error('board_build recipe.object_key must contain at most 160 characters.')
  }
  const name = optionalBuildString(value.name)
  if (name && name.length > 120) {
    throw new Error('board_build recipe.name must contain at most 120 characters.')
  }
  return { ...(name ? { name } : {}), objectKey }
}

function parseCodeObjectCreateRecipe(value: UnknownRecord): CodeObjectCreateBuildRecipe {
  assertSupportedFields(value, CODE_OBJECT_CREATE_RECIPE_KEYS, 'code_object recipe')
  const source = codeObjectSource(value)
  const identity = codeObjectIdentity(value)
  if (!identity.name) throw new Error('board_build requires recipe.name.')
  const width = optionalFiniteNumber(value.width, 'recipe.width')
  const height = optionalFiniteNumber(value.height, 'recipe.height')
  const ports = value.ports === undefined ? undefined : parseObjectGraphPorts(value.ports)
  if (value.ports !== undefined && !ports) {
    throw new Error('board_build recipe.ports must contain valid unique named Object Graph ports.')
  }
  if (width !== undefined && (width < 240 || width > 1_600)) {
    throw new Error('board_build recipe.width must be between 240 and 1600.')
  }
  if (height !== undefined && (height < 160 || height > 1_200)) {
    throw new Error('board_build recipe.height must be between 160 and 1200.')
  }
  return {
    ...(height === undefined ? {} : { height }),
    initialState: plainJsonObject(value.initial_state ?? {}, 'initial_state'),
    kind: 'code_object',
    name: identity.name,
    objectKey: identity.objectKey,
    operation: 'create',
    ...(value.placement === undefined ? {} : { placement: parseCardPlacement(value.placement) }),
    ...(ports ? { ports } : {}),
    props: plainJsonObject(value.props ?? {}, 'props'),
    source,
    sourceFormat: 'tsx',
    ...(width === undefined ? {} : { width })
  }
}

function parseCodeObjectRefineRecipe(value: UnknownRecord): CodeObjectRefineBuildRecipe {
  assertSupportedFields(value, CODE_OBJECT_REFINE_RECIPE_KEYS, 'code_object recipe')
  const source = codeObjectSource(value)
  const identity = codeObjectIdentity(value)
  const ownerId = requiredBuildString(value.owner_id, 'recipe.owner_id')
  const expectedSourceHash = requiredBuildString(
    value.expected_source_hash,
    'recipe.expected_source_hash'
  )
  if (!/^sha256:[0-9a-f]{64}$/u.test(expectedSourceHash)) {
    throw new Error('board_build recipe.expected_source_hash must be a lowercase SHA-256 digest.')
  }
  return {
    expectedSourceHash,
    kind: 'code_object',
    ...(identity.name ? { name: identity.name } : {}),
    objectKey: identity.objectKey,
    operation: 'refine',
    ownerId,
    ...(value.props === undefined ? {} : { props: plainJsonObject(value.props, 'props') }),
    source,
    sourceFormat: 'tsx'
  }
}

function parseCodeObjectRecipe(value: UnknownRecord): CodeObjectBuildRecipe {
  if (value.operation === 'create') return parseCodeObjectCreateRecipe(value)
  if (value.operation === 'refine') return parseCodeObjectRefineRecipe(value)
  throw new Error('board_build code_object recipe.operation must be create or refine.')
}

function parseRecipe(value: unknown): BoardBuildRecipe {
  if (!isUnknownRecord(value)) throw new Error('board_build recipe must be an object.')
  if (value.kind === 'native_text') return parseNativeTextRecipe(value)
  if (value.kind === 'native_card') return parseNativeCardRecipe(value)
  if (value.kind === 'native_diagram') return parseNativeDiagramRecipe(value)
  if (value.kind === 'code_object') return parseCodeObjectRecipe(value)
  throw new Error(
    'board_build recipe.kind must be native_text, native_card, native_diagram, or code_object.'
  )
}

function parseExtension(value: unknown): BoardBuildExtension | undefined {
  if (value === undefined) return undefined
  if (!isUnknownRecord(value)) throw new Error('board_build extension must be an object.')
  assertSupportedFields(value, BOARD_BUILD_EXTENSION_KEYS, 'extension')
  if (value.contract !== BOARD_BUILD_EXTENSION_CONTRACT) {
    throw new Error(`board_build extension.contract must be ${BOARD_BUILD_EXTENSION_CONTRACT}.`)
  }
  return {
    contract: BOARD_BUILD_EXTENSION_CONTRACT,
    ...(optionalBuildString(value.output_digest)
      ? { outputDigest: optionalBuildString(value.output_digest) }
      : {}),
    ...(optionalBuildString(value.profile_id)
      ? { profileId: optionalBuildString(value.profile_id) }
      : {}),
    skillId: requiredBuildString(value.skill_id, 'extension.skill_id'),
    ...(optionalBuildString(value.skill_version)
      ? { skillVersion: optionalBuildString(value.skill_version) }
      : {})
  }
}

function assertRecipeAnchor(recipe: BoardBuildRecipe, anchorId: string | undefined): void {
  const requiresAnchor = recipe.kind === 'native_text'
  if (requiresAnchor && !anchorId) {
    throw new Error(`board_build ${recipe.kind} requires anchor_id.`)
  }
  if (recipe.kind === 'native_card') {
    const hasTarget = recipe.placement?.target !== undefined
    if (Boolean(anchorId) === hasTarget) {
      throw new Error(
        'board_build native_card requires exactly one of anchor_id or placement.target.'
      )
    }
  }
  if (recipe.kind === 'code_object' && recipe.operation === 'create') {
    const hasTarget = recipe.placement?.target !== undefined
    if (Boolean(anchorId) === hasTarget) {
      throw new Error(
        'board_build code_object create requires exactly one of anchor_id or placement.target.'
      )
    }
  }
  if (recipe.kind === 'native_diagram' && recipe.ownerId && anchorId) {
    throw new Error('board_build diagram refinement cannot combine owner_id with anchor_id.')
  }
  if (recipe.kind === 'code_object' && recipe.operation === 'refine' && anchorId) {
    throw new Error('board_build Code Object refinement uses recipe.owner_id, not anchor_id.')
  }
}

export function parseBoardBuildInput(value: unknown): BoardBuildInput {
  if (!isUnknownRecord(value)) throw new Error('board_build arguments must be an object.')
  assertSupportedFields(value, BOARD_BUILD_INPUT_KEYS, 'arguments object')
  if (value.contract !== BOARD_BUILD_CONTRACT) {
    throw new Error(`board_build contract must be ${BOARD_BUILD_CONTRACT}.`)
  }
  if (
    typeof value.expected_revision !== 'number' ||
    !Number.isInteger(value.expected_revision) ||
    value.expected_revision < 0
  ) {
    throw new Error('board_build requires a non-negative expected_revision.')
  }
  const hasRecipe = value.recipe !== undefined
  const hasPlan = value.plan !== undefined
  if (hasRecipe === hasPlan) {
    throw new Error('board_build requires exactly one of recipe or plan.')
  }
  const intent = requiredBuildString(value.intent, 'intent')
  if (intent.length > 1_000) {
    throw new Error('board_build intent must contain at most 1000 characters.')
  }
  const anchorId = optionalBuildString(value.anchor_id)
  if (hasPlan && anchorId) {
    throw new Error('board_build plan uses artifact anchors and cannot include anchor_id.')
  }
  const recipe = hasRecipe ? parseRecipe(value.recipe) : undefined
  if (recipe) assertRecipeAnchor(recipe, anchorId)
  return {
    ...(anchorId ? { anchorId } : {}),
    contextToken: requiredBuildString(value.context_token, 'context_token'),
    expectedRevision: value.expected_revision,
    ...(value.extension === undefined ? {} : { extension: parseExtension(value.extension) }),
    intent,
    ...(recipe ? { recipe } : { plan: parseBoardBuildPlan(value.plan) }),
    requestId: requiredBuildString(value.request_id, 'request_id'),
    ...(optionalBuildString(value.task_id) ? { taskId: optionalBuildString(value.task_id) } : {}),
    ...(optionalBuildString(value.trace_id) ? { traceId: optionalBuildString(value.trace_id) } : {})
  }
}
