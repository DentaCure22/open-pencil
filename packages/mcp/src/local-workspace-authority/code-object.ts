import {
  CODE_OBJECT_KIND,
  CODE_OBJECT_PLUGIN_ID,
  codeObjectSourceHash,
  createUserCodeObjectDocument,
  parseCodeObjectDocument,
  preflightCodeObjectSource,
  serializeCodeObjectPluginData,
  type CodeObjectStaticPreflight
} from '@open-pencil/core/code-object'
import {
  objectGraphPortsPluginData,
  parseObjectGraphPorts,
  readObjectGraphPorts,
  type ObjectGraphPortDefinition,
  type Rect,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'
import {
  AUTHORITY_PLACEMENT_ALGORITHM,
  parseAuthorityFreePlacementTarget,
  parseAuthorityPlacementDirections,
  parseAuthorityRelativePlacementOffset,
  requireAuthorityAnchor,
  resolveAuthorityAnchoredPlacement,
  resolveAuthorityFreePlacement,
  type AuthorityFreePlacementTarget,
  type AuthorityPlacementDirection,
  type AuthorityPlacementResult,
  type AuthorityRelativePlacementOffset
} from './placement'
import { authorityMutationInputDigest } from './request-digest'

const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const RECEIPT_PLUGIN_PREFIX = 'code-object-request:'
const DEFAULT_CLEARANCE = 48
const DEFAULT_WIDTH = 720
const DEFAULT_HEIGHT = 520
const BOUNDS_TOLERANCE = 0.01

type JsonRecord = Record<string, unknown>

export type AuthorityCodeObjectCreateOperation = {
  anchorId?: string
  clearance: number
  height: number
  initialState: JsonRecord
  name: string
  objectKey: string
  operation: 'create'
  placementTarget?: AuthorityFreePlacementTarget
  ports?: ObjectGraphPortDefinition[]
  preferredDirections: AuthorityPlacementDirection[]
  relativeOffset?: AuthorityRelativePlacementOffset
  props: JsonRecord
  source: string
  width: number
}

export type AuthorityCodeObjectRefineOperation = {
  expectedSourceHash: string
  name?: string
  objectKey: string
  operation: 'refine'
  ownerId: string
  props?: JsonRecord
  source: string
}

export type AuthorityCodeObjectOperation =
  | AuthorityCodeObjectCreateOperation
  | AuthorityCodeObjectRefineOperation

export type AuthorityCodeObjectIntent = {
  inputDigest: string
  kind: 'code_object'
  operation: AuthorityCodeObjectOperation
  preflight: CodeObjectStaticPreflight
}

type AuthorityCodeObjectReceiptBase = {
  appliedRevision: number
  baseRevision: number
  bounds: Rect
  contentHash: string
  inputDigest: string
  name: string
  objectKey: string
  ownerId: string
  propsHash: string
  requestId: string
  route: 'board_build'
  sourceHash: string
  stateHash: string
}

export type AuthorityCodeObjectCreateReceipt = AuthorityCodeObjectReceiptBase & {
  algorithm: typeof AUTHORITY_PLACEMENT_ALGORITHM
  version: 1
}

export type AuthorityCodeObjectRefineReceipt = AuthorityCodeObjectReceiptBase & {
  expectedSourceHash: string
  operation: 'refine'
  previousName: string
  previousPropsHash: string
  version: 2
}

export type AuthorityCodeObjectReceipt =
  | AuthorityCodeObjectCreateReceipt
  | AuthorityCodeObjectRefineReceipt

const CREATE_RECIPE_KEYS = new Set([
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
const REFINE_RECIPE_KEYS = new Set([
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
const PLACEMENT_KEYS = new Set(['clearance', 'preferred_directions', 'relative_offset', 'target'])
const SOURCE_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isPlainJson(value: unknown, ancestors = new Set<object>()): boolean {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (typeof value !== 'object' || ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((entry) => isPlainJson(entry, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null) &&
      Object.values(value).every((entry) => isPlainJson(entry, ancestors))
  ancestors.delete(value)
  return valid
}

function plainJsonObject(value: unknown, field: string): JsonRecord {
  if (!isRecord(value) || !isPlainJson(value)) {
    throw new Error(`code_object recipe.${field} must be a plain JSON object.`)
  }
  return structuredClone(value)
}

function assertSupportedFields(
  value: JsonRecord,
  supported: ReadonlySet<string>,
  label: string
): void {
  const unsupported = Object.keys(value).filter((key) => !supported.has(key))
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.sort().join(', ')}.`)
  }
}

function requiredString(value: JsonRecord, field: string, maximum: number): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) throw new Error(`${field} is required.`)
  const trimmed = result.trim()
  if (trimmed.length > maximum)
    throw new Error(`${field} must contain at most ${maximum} characters.`)
  return trimmed
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function codeObjectContentHash(options: {
  name: string
  objectKey: string
  ports: ObjectGraphPortDefinition[]
  props: JsonRecord
  source: string
  state: JsonRecord
}): string {
  return authorityMutationInputDigest('code-object-content/v1', {
    name: options.name,
    object_key: options.objectKey,
    ports: [...options.ports].sort((left, right) => left.id.localeCompare(right.id)),
    props: options.props,
    source: options.source,
    state: options.state
  })
}

function createContentHash(operation: AuthorityCodeObjectCreateOperation): string {
  return codeObjectContentHash({
    name: operation.name,
    objectKey: operation.objectKey,
    ports: operation.ports ?? [],
    props: operation.props,
    source: operation.source,
    state: operation.initialState
  })
}

function valueHash(route: string, value: JsonRecord): string {
  return authorityMutationInputDigest(route, { value })
}

async function authorityCodeObjectIntent(
  operation: AuthorityCodeObjectOperation,
  taskId?: string,
  traceId?: string
): Promise<AuthorityCodeObjectIntent> {
  const preflight = await preflightCodeObjectSource(operation.source)
  return {
    inputDigest: authorityMutationInputDigest('board_build', {
      operation,
      ...(taskId ? { taskId } : {}),
      ...(traceId ? { traceId } : {}),
      staticPreflightContract: preflight.contract
    }),
    kind: 'code_object',
    operation,
    preflight
  }
}

function parseRefineOperation(
  recipe: JsonRecord,
  anchorId: string | undefined
): AuthorityCodeObjectRefineOperation {
  assertSupportedFields(recipe, REFINE_RECIPE_KEYS, 'code_object refine recipe')
  if (anchorId?.trim()) {
    throw new Error('code_object refine uses recipe.owner_id and cannot include anchor_id.')
  }
  const expectedSourceHash = requiredString(recipe, 'expected_source_hash', 71)
  if (!SOURCE_HASH_PATTERN.test(expectedSourceHash)) {
    throw new Error('expected_source_hash must be a lowercase SHA-256 digest.')
  }
  const name = recipe.name === undefined ? undefined : requiredString(recipe, 'name', 120)
  const props = recipe.props === undefined ? undefined : plainJsonObject(recipe.props, 'props')
  return {
    expectedSourceHash,
    ...(name ? { name } : {}),
    objectKey: requiredString(recipe, 'object_key', 160),
    operation: 'refine',
    ownerId: requiredString(recipe, 'owner_id', 240),
    ...(props ? { props } : {}),
    source: requiredString(recipe, 'source', 100_000)
  }
}

function parseCreateOperation(
  recipe: JsonRecord,
  anchorId: string | undefined
): AuthorityCodeObjectCreateOperation {
  assertSupportedFields(recipe, CREATE_RECIPE_KEYS, 'code_object create recipe')
  const exactAnchorId = anchorId?.trim()
  const placement = recipe.placement ?? {}
  if (!isRecord(placement)) throw new Error('code_object placement must be an object.')
  assertSupportedFields(placement, PLACEMENT_KEYS, 'code_object placement')
  const placementTarget =
    placement.target === undefined ? undefined : parseAuthorityFreePlacementTarget(placement.target)
  if (Boolean(exactAnchorId) === Boolean(placementTarget)) {
    throw new Error('code_object create requires exactly one of anchor_id or placement.target.')
  }
  const relativeOffset = parseAuthorityRelativePlacementOffset(placement.relative_offset)
  if (relativeOffset && !exactAnchorId && placementTarget?.kind !== 'relative') {
    throw new Error('placement.relative_offset requires an anchor or relative placement.target.')
  }
  const ports = recipe.ports === undefined ? undefined : parseObjectGraphPorts(recipe.ports)
  if (recipe.ports !== undefined && !ports) {
    throw new Error('code_object recipe.ports must contain valid unique named Object Graph ports.')
  }
  return {
    ...(exactAnchorId ? { anchorId: exactAnchorId } : {}),
    clearance: boundedNumber(
      placement.clearance,
      DEFAULT_CLEARANCE,
      0,
      1_024,
      'placement.clearance'
    ),
    height: boundedNumber(recipe.height, DEFAULT_HEIGHT, 160, 1_200, 'height'),
    initialState: plainJsonObject(recipe.initial_state ?? {}, 'initial_state'),
    name: requiredString(recipe, 'name', 120),
    objectKey: requiredString(recipe, 'object_key', 160),
    operation: 'create',
    ...(placementTarget ? { placementTarget } : {}),
    preferredDirections: parseAuthorityPlacementDirections(placement.preferred_directions),
    ...(ports ? { ports } : {}),
    ...(relativeOffset ? { relativeOffset } : {}),
    props: plainJsonObject(recipe.props ?? {}, 'props'),
    source: requiredString(recipe, 'source', 100_000),
    width: boundedNumber(recipe.width, DEFAULT_WIDTH, 240, 1_600, 'width')
  }
}

export async function parseAuthorityCodeObjectIntent(
  recipe: JsonRecord,
  anchorId: string | undefined,
  taskId?: string,
  traceId?: string
): Promise<AuthorityCodeObjectIntent> {
  if (recipe.kind !== 'code_object') {
    throw new Error('Local authority Code Object requires recipe.kind "code_object".')
  }
  if (recipe.source_format !== 'tsx') {
    throw new Error('Local authority Code Object requires source_format "tsx".')
  }
  if (recipe.operation === 'refine') {
    return authorityCodeObjectIntent(parseRefineOperation(recipe, anchorId), taskId, traceId)
  }
  if (recipe.operation !== 'create') {
    throw new Error('Local authority Code Object supports operation "create" or "refine" only.')
  }
  return authorityCodeObjectIntent(parseCreateOperation(recipe, anchorId), taskId, traceId)
}

function receiptKey(requestId: string): string {
  return `${RECEIPT_PLUGIN_PREFIX}${requestId}`
}

function parsedBounds(value: unknown): Rect | null {
  if (!isRecord(value)) return null
  const { height, width, x, y } = value
  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null
  }
  return { height, width, x, y }
}

function parseReceipt(value: string, pageId: string): AuthorityCodeObjectReceipt {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) throw new Error('not an object')
    const bounds = parsedBounds(parsed.bounds)
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      parsed.route !== 'board_build' ||
      !bounds ||
      !Number.isInteger(parsed.baseRevision) ||
      !Number.isInteger(parsed.appliedRevision) ||
      typeof parsed.contentHash !== 'string' ||
      typeof parsed.inputDigest !== 'string' ||
      typeof parsed.name !== 'string' ||
      typeof parsed.objectKey !== 'string' ||
      typeof parsed.ownerId !== 'string' ||
      typeof parsed.propsHash !== 'string' ||
      typeof parsed.requestId !== 'string' ||
      typeof parsed.sourceHash !== 'string' ||
      typeof parsed.stateHash !== 'string'
    ) {
      throw new Error('invalid fields')
    }
    if (parsed.version === 1) {
      if (parsed.algorithm !== AUTHORITY_PLACEMENT_ALGORITHM) throw new Error('invalid algorithm')
      return {
        ...parsed,
        algorithm: AUTHORITY_PLACEMENT_ALGORITHM,
        bounds,
        route: 'board_build',
        version: 1
      } as AuthorityCodeObjectCreateReceipt
    }
    if (
      parsed.operation !== 'refine' ||
      typeof parsed.expectedSourceHash !== 'string' ||
      typeof parsed.previousName !== 'string' ||
      typeof parsed.previousPropsHash !== 'string'
    ) {
      throw new Error('invalid refine fields')
    }
    return {
      ...parsed,
      bounds,
      operation: 'refine',
      route: 'board_build',
      version: 2
    } as AuthorityCodeObjectRefineReceipt
  } catch {
    throw new Error(`Code Object receipt on Board "${pageId}" is unreadable.`)
  }
}

export function authorityCodeObjectRequestMatches(
  document: AuthorityBoardDocument,
  pageId: string,
  requestId: string
): AuthorityCodeObjectReceipt[] {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  return page.pluginData
    .filter((entry) => entry.pluginId === RECEIPT_PLUGIN_ID && entry.key === receiptKey(requestId))
    .map((entry) => parseReceipt(entry.value, pageId))
}

function codeObjectNodes(document: AuthorityBoardDocument, pageId: string): SceneNode[] {
  const matches: SceneNode[] = []
  for (const node of document.graph.getDescendants(pageId)) {
    const kind = node.pluginData.find(
      (entry) => entry.pluginId === CODE_OBJECT_PLUGIN_ID && entry.key === 'kind'
    )?.value
    if (kind !== CODE_OBJECT_KIND) continue
    if (!parseCodeObjectDocument(node)) {
      throw new Error(`Code Object document on "${node.id}" is unreadable.`)
    }
    matches.push(node)
  }
  return matches
}

export async function readAuthorityCodeObject(
  document: AuthorityBoardDocument,
  pageId: string,
  ownerId: string
) {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  const owner = document.graph.getNode(ownerId)
  if (!owner || !document.graph.isDescendant(owner.id, pageId)) {
    throw new Error(`Code Object owner "${ownerId}" was not found on Board "${page.name}".`)
  }
  const codeObject = parseCodeObjectDocument(owner)
  if (codeObject?.component !== 'user-code') {
    throw new Error(`Frame "${ownerId}" is not an authored Code Object.`)
  }
  return {
    component: {
      definition_id: codeObject.definitionId,
      name: codeObject.name,
      props: structuredClone(codeObject.props),
      source: codeObject.source,
      source_hash: await codeObjectSourceHash(codeObject.source),
      source_length: codeObject.source.length,
      state: structuredClone(codeObject.state)
    },
    frame: {
      height: owner.height,
      id: owner.id,
      name: owner.name,
      type: owner.type,
      width: owner.width,
      x: owner.x,
      y: owner.y
    },
    ports: readObjectGraphPorts(owner)
  }
}

export function assertAuthorityCodeObjectKeyAvailable(
  document: AuthorityBoardDocument,
  pageId: string,
  objectKey: string
): void {
  const duplicate = codeObjectNodes(document, pageId).find(
    (node) => parseCodeObjectDocument(node)?.definitionId === objectKey
  )
  if (duplicate) {
    throw new Error(`Code Object "${objectKey}" already exists; this guarded path is create-only.`)
  }
}

function resolveCodeObjectCreatePlacement(
  document: AuthorityBoardDocument,
  pageId: string,
  operation: AuthorityCodeObjectCreateOperation,
  placementAnchor?: Rect
): AuthorityPlacementResult {
  if (placementAnchor) {
    return resolveAuthorityAnchoredPlacement({
      anchor: placementAnchor,
      clearance: operation.clearance,
      footprint: { height: operation.height, width: operation.width },
      graph: document.graph,
      pageId,
      preferredDirections: operation.preferredDirections
    })
  }
  if (operation.anchorId) {
    const anchor = requireAuthorityAnchor(document.graph, pageId, operation.anchorId)
    if (anchor.parentId !== pageId) {
      throw new Error(
        `Code Object anchor "${anchor.id}" must be a top-level object on Board "${pageId}".`
      )
    }
    return resolveAuthorityAnchoredPlacement({
      anchor: document.graph.getAbsoluteBounds(anchor.id),
      clearance: operation.clearance,
      footprint: { height: operation.height, width: operation.width },
      graph: document.graph,
      pageId,
      preferredDirections: operation.preferredDirections,
      relativeOffset: operation.relativeOffset
    })
  }
  if (!operation.placementTarget) {
    throw new Error('Code Object placement mode disappeared after validation.')
  }
  return resolveAuthorityFreePlacement({
    clearance: operation.clearance,
    footprint: { height: operation.height, width: operation.width },
    graph: document.graph,
    pageId,
    preferredDirections: operation.preferredDirections,
    relativeOffset: operation.relativeOffset,
    target: operation.placementTarget
  })
}

export function createAuthorityCodeObject(
  document: AuthorityBoardDocument,
  pageId: string,
  intent: AuthorityCodeObjectIntent,
  requestId: string,
  baseRevision: number,
  placementAnchor?: Rect
): {
  owner: SceneNode
  placement: AuthorityPlacementResult
  receipt: AuthorityCodeObjectCreateReceipt
} {
  if (intent.operation.operation !== 'create') {
    throw new Error('createAuthorityCodeObject requires a create intent.')
  }
  assertAuthorityCodeObjectKeyAvailable(document, pageId, intent.operation.objectKey)
  const placement = resolveCodeObjectCreatePlacement(
    document,
    pageId,
    intent.operation,
    placementAnchor
  )
  const owner = document.graph.createNode('FRAME', pageId, {
    clipsContent: true,
    fills: [],
    height: placement.bounds.height,
    name: intent.operation.name,
    strokes: [],
    width: placement.bounds.width,
    x: placement.bounds.x,
    y: placement.bounds.y
  })
  const codeObjectDocument = createUserCodeObjectDocument({
    definitionId: intent.operation.objectKey,
    name: intent.operation.name,
    props: intent.operation.props,
    source: intent.operation.source,
    state: intent.operation.initialState
  })
  const codeObjectPluginData = serializeCodeObjectPluginData(owner, codeObjectDocument)
  document.graph.updateNode(owner.id, {
    pluginData: intent.operation.ports
      ? objectGraphPortsPluginData({ pluginData: codeObjectPluginData }, intent.operation.ports)
      : codeObjectPluginData
  })
  const receipt: AuthorityCodeObjectCreateReceipt = {
    algorithm: AUTHORITY_PLACEMENT_ALGORITHM,
    appliedRevision: baseRevision + 1,
    baseRevision,
    bounds: placement.bounds,
    contentHash: createContentHash(intent.operation),
    inputDigest: intent.inputDigest,
    name: intent.operation.name,
    objectKey: intent.operation.objectKey,
    ownerId: owner.id,
    propsHash: valueHash('code-object-props/v1', intent.operation.props),
    requestId,
    route: 'board_build',
    sourceHash: intent.preflight.sourceHash,
    stateHash: valueHash('code-object-state/v1', intent.operation.initialState),
    version: 1
  }
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  document.graph.updateNode(page.id, {
    pluginData: [
      ...page.pluginData,
      {
        key: receiptKey(requestId),
        pluginId: RECEIPT_PLUGIN_ID,
        value: JSON.stringify(receipt)
      }
    ]
  })
  return { owner: document.graph.getNode(owner.id) ?? owner, placement, receipt }
}

function authoredCodeObjectOnPage(
  document: AuthorityBoardDocument,
  pageId: string,
  ownerId: string
) {
  const owner = document.graph.getNode(ownerId)
  if (!owner || !document.graph.isDescendant(ownerId, pageId)) {
    throw new Error(`Code Object owner "${ownerId}" is missing from the exact Board.`)
  }
  const codeObject = parseCodeObjectDocument(owner)
  if (owner.type !== 'FRAME' || codeObject?.component !== 'user-code') {
    throw new Error(`Owner "${ownerId}" is not an authored Code Object frame.`)
  }
  if (
    typeof codeObject.definitionId !== 'string' ||
    typeof codeObject.name !== 'string' ||
    typeof codeObject.source !== 'string'
  ) {
    throw new Error(`Code Object document on "${ownerId}" is unreadable.`)
  }
  return { codeObject, owner }
}

export async function refineAuthorityCodeObject(
  document: AuthorityBoardDocument,
  pageId: string,
  intent: AuthorityCodeObjectIntent,
  requestId: string,
  baseRevision: number
): Promise<{ owner: SceneNode; receipt: AuthorityCodeObjectRefineReceipt }> {
  if (intent.operation.operation !== 'refine') {
    throw new Error('refineAuthorityCodeObject requires a refine intent.')
  }
  const { codeObject, owner } = authoredCodeObjectOnPage(document, pageId, intent.operation.ownerId)
  if (codeObject.definitionId !== intent.operation.objectKey) {
    throw new Error(
      `Code Object owner "${owner.id}" does not match immutable object key "${intent.operation.objectKey}".`
    )
  }
  const currentSourceHash = await codeObjectSourceHash(codeObject.source)
  if (currentSourceHash !== intent.operation.expectedSourceHash) {
    throw new Error(
      `Code Object source is stale. Expected ${intent.operation.expectedSourceHash}, current source is ${currentSourceHash}.`
    )
  }
  const currentProps = plainJsonObject(codeObject.props ?? {}, 'props')
  const currentState = plainJsonObject(codeObject.state, 'state')
  const previousPropsHash = valueHash('code-object-props/v1', currentProps)
  const bounds = document.graph.getAbsoluteBounds(owner.id)
  const nextName = intent.operation.name ?? codeObject.name
  const nextProps = intent.operation.props ?? currentProps
  const nextDocument = {
    ...structuredClone(codeObject),
    name: nextName,
    props: structuredClone(nextProps),
    source: intent.operation.source,
    state: structuredClone(currentState)
  }
  const otherPluginData = owner.pluginData.filter(
    (entry) => entry.pluginId !== CODE_OBJECT_PLUGIN_ID
  )
  document.graph.updateNode(owner.id, {
    name: nextName,
    pluginData: serializeCodeObjectPluginData(owner, nextDocument)
  })
  const updated = document.graph.getNode(owner.id)
  const updatedDocument = parseCodeObjectDocument(updated)
  if (!updated || updatedDocument?.component !== 'user-code') {
    throw new Error('Code Object disappeared during persisted refinement.')
  }
  if (!sameBounds(document.graph.getAbsoluteBounds(updated.id), bounds)) {
    throw new Error('Code Object refinement changed protected geometry.')
  }
  if (
    valueHash('code-object-state/v1', plainJsonObject(updatedDocument.state, 'state')) !==
    valueHash('code-object-state/v1', currentState)
  ) {
    throw new Error('Code Object refinement changed protected state.')
  }
  const updatedOtherPluginData = updated.pluginData.filter(
    (entry) => entry.pluginId !== CODE_OBJECT_PLUGIN_ID
  )
  if (JSON.stringify(updatedOtherPluginData) !== JSON.stringify(otherPluginData)) {
    throw new Error('Code Object refinement changed protected plugin data.')
  }
  const receipt: AuthorityCodeObjectRefineReceipt = {
    appliedRevision: baseRevision + 1,
    baseRevision,
    bounds,
    contentHash: codeObjectContentHash({
      name: nextName,
      objectKey: intent.operation.objectKey,
      ports: readObjectGraphPorts(owner),
      props: nextProps,
      source: intent.operation.source,
      state: currentState
    }),
    expectedSourceHash: intent.operation.expectedSourceHash,
    inputDigest: intent.inputDigest,
    name: nextName,
    objectKey: intent.operation.objectKey,
    operation: 'refine',
    ownerId: owner.id,
    previousName: codeObject.name,
    previousPropsHash,
    propsHash: valueHash('code-object-props/v1', nextProps),
    requestId,
    route: 'board_build',
    sourceHash: intent.preflight.sourceHash,
    stateHash: valueHash('code-object-state/v1', currentState),
    version: 2
  }
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  document.graph.updateNode(page.id, {
    pluginData: [
      ...page.pluginData,
      {
        key: receiptKey(requestId),
        pluginId: RECEIPT_PLUGIN_ID,
        value: JSON.stringify(receipt)
      }
    ]
  })
  return { owner: document.graph.getNode(owner.id) ?? updated, receipt }
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= BOUNDS_TOLERANCE
}

function sameBounds(left: Rect, right: Rect): boolean {
  return (
    close(left.x, right.x) &&
    close(left.y, right.y) &&
    close(left.width, right.width) &&
    close(left.height, right.height)
  )
}

export async function authorityCodeObjectReadback(
  document: AuthorityBoardDocument,
  pageId: string,
  receipt: AuthorityCodeObjectReceipt
) {
  const owner = document.graph.getNode(receipt.ownerId)
  const expected = {
    content_hash: receipt.contentHash,
    name: receipt.name,
    object_key: receipt.objectKey,
    owner_id: receipt.ownerId,
    props_hash: receipt.propsHash,
    source_hash: receipt.sourceHash,
    state_hash: receipt.stateHash
  }
  if (!owner || !document.graph.isDescendant(receipt.ownerId, pageId)) {
    return {
      expected,
      frame: { id: receipt.ownerId },
      reconciliation: { reasons: ['owner_missing'], status: 'missing' as const }
    }
  }
  const reasons: string[] = []
  const codeObject = parseCodeObjectDocument(owner)
  if (!codeObject) reasons.push('owner_is_not_authored_code_object')
  const source = typeof codeObject?.source === 'string' ? codeObject.source : null
  const name = typeof codeObject?.name === 'string' ? codeObject.name : null
  const definitionId = typeof codeObject?.definitionId === 'string' ? codeObject.definitionId : null
  const props =
    isRecord(codeObject?.props) && isPlainJson(codeObject.props) ? codeObject.props : null
  const state =
    isRecord(codeObject?.state) && isPlainJson(codeObject.state) ? codeObject.state : null
  const currentSourceHash = source ? await codeObjectSourceHash(source) : null
  const ports = readObjectGraphPorts(owner)
  const currentContentHash =
    source && name && definitionId && props && state
      ? codeObjectContentHash({
          name,
          objectKey: definitionId,
          ports,
          props,
          source,
          state
        })
      : null
  const currentPropsHash = props ? valueHash('code-object-props/v1', props) : null
  const currentStateHash = state ? valueHash('code-object-state/v1', state) : null
  if (definitionId !== receipt.objectKey) reasons.push('object_key_changed')
  if (name !== receipt.name || owner.name !== receipt.name) reasons.push('name_changed')
  if (currentSourceHash !== receipt.sourceHash) reasons.push('source_changed')
  if (currentContentHash !== receipt.contentHash) reasons.push('content_changed')
  if (!sameBounds(document.graph.getAbsoluteBounds(owner.id), receipt.bounds)) {
    reasons.push('bounds_changed')
  }
  if (!owner.visible) reasons.push('owner_hidden')
  if (owner.opacity <= 0) reasons.push('owner_transparent')
  return {
    component: {
      definition_id: definitionId,
      name,
      ports,
      props_hash: currentPropsHash,
      source_hash: currentSourceHash,
      source_length: source?.length ?? null,
      state_hash: currentStateHash
    },
    expected,
    frame: {
      bounds: document.graph.getAbsoluteBounds(owner.id),
      id: owner.id,
      name: owner.name,
      type: owner.type,
      visible: owner.visible
    },
    reconciliation: {
      reasons,
      status: reasons.length === 0 ? ('current' as const) : ('diverged' as const)
    }
  }
}

export function assertAuthorityCodeObjectReplay(
  receipt: AuthorityCodeObjectReceipt,
  intent: AuthorityCodeObjectIntent,
  requestId: string
): void {
  if (receipt.inputDigest !== intent.inputDigest) {
    throw new Error(`Request "${requestId}" was already used for a different mutation.`)
  }
}
