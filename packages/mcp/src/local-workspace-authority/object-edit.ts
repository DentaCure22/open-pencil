import {
  CODE_OBJECT_KIND,
  CODE_OBJECT_PLUGIN_ID,
  codeObjectViewportPluginData,
  isCodeObjectViewportPresetId,
  type CodeObjectViewportPresetId
} from '@open-pencil/core/code-object'
import { colorToFill } from '@open-pencil/core/color'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import type { AuthorityBoardDocument } from './document'
import { authorityMutationInputDigest } from './request-digest'

const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const RECEIPT_PLUGIN_PREFIX = 'object-edit-request:'
const MAX_COORDINATE = 1_000_000
const MAX_SIZE = 100_000

type JsonRecord = Record<string, unknown>

type ObjectPatch = {
  cornerRadius?: number
  fill?: string
  locked?: boolean
  name?: string
  opacity?: number
  text?: string
  visible?: boolean
}

export type AuthorityObjectEditOperation =
  | { kind: 'object.delete'; objectId: string }
  | { kind: 'object.duplicate'; objectId: string; offsetX: number; offsetY: number }
  | { kind: 'object.move'; objectId: string; x: number; y: number }
  | {
      height: number
      kind: 'object.resize'
      objectId: string
      viewportPreset?: CodeObjectViewportPresetId
      width: number
    }
  | { kind: 'object.update'; objectId: string; patch: ObjectPatch }

export type AuthorityObjectEditIntent = {
  inputDigest: string
  operation: AuthorityObjectEditOperation
}

export type AuthorityObjectEditReceipt = {
  after: JsonRecord
  appliedRevision: number
  baseRevision: number
  inputDigest: string
  objectId: string
  operation: AuthorityObjectEditOperation['kind']
  requestId: string
  resultObjectId: string | null
  route: 'board_change'
  version: 1
}

type AuthorityObjectEditApplyResult = {
  outcome: 'applied' | 'no_change'
  receipt?: AuthorityObjectEditReceipt
}

const OPERATION_KEYS = {
  'object.delete': new Set(['kind', 'object_id']),
  'object.duplicate': new Set(['kind', 'object_id', 'offset_x', 'offset_y']),
  'object.move': new Set(['kind', 'object_id', 'x', 'y']),
  'object.resize': new Set(['height', 'kind', 'object_id', 'viewport_preset', 'width']),
  'object.update': new Set(['kind', 'object_id', 'patch'])
} as const
const PATCH_KEYS = new Set(['cornerRadius', 'fill', 'locked', 'name', 'opacity', 'text', 'visible'])

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredString(value: JsonRecord, field: string, maximum = 240): string {
  const candidate = value[field]
  if (typeof candidate !== 'string' || !candidate.trim()) throw new Error(`${field} is required.`)
  const trimmed = candidate.trim()
  if (trimmed.length > maximum)
    throw new Error(`${field} must contain at most ${maximum} characters.`)
  return trimmed
}

function finiteNumber(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  if (value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function optionalFiniteNumber(
  value: unknown,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number
): number {
  return value === undefined ? fallback : finiteNumber(value, field, minimum, maximum)
}

function assertOnlyKeys(value: JsonRecord, allowed: ReadonlySet<string>, label: string): void {
  const unsupported = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort()
  if (unsupported.length > 0) {
    throw new Error(`${label} contains unsupported fields: ${unsupported.join(', ')}.`)
  }
}

function parsePatch(value: unknown): ObjectPatch {
  if (!isRecord(value)) throw new Error('object.update patch must be an object.')
  assertOnlyKeys(value, PATCH_KEYS, 'object.update patch')
  if (Object.keys(value).length === 0) throw new Error('object.update patch cannot be empty.')
  const patch: ObjectPatch = {}
  if (value.cornerRadius !== undefined) {
    patch.cornerRadius = finiteNumber(value.cornerRadius, 'patch.cornerRadius', 0, MAX_SIZE)
  }
  if (value.fill !== undefined) patch.fill = requiredString(value, 'fill', 32)
  if (value.name !== undefined) patch.name = requiredString(value, 'name', 240)
  if (value.text !== undefined) patch.text = requiredString(value, 'text', 10_000)
  if (value.locked !== undefined) {
    if (typeof value.locked !== 'boolean') throw new TypeError('patch.locked must be boolean.')
    patch.locked = value.locked
  }
  if (value.visible !== undefined) {
    if (typeof value.visible !== 'boolean') throw new TypeError('patch.visible must be boolean.')
    patch.visible = value.visible
  }
  if (value.opacity !== undefined) {
    patch.opacity = finiteNumber(value.opacity, 'patch.opacity', 0, 1)
  }
  return patch
}

export function isAuthorityObjectEditOperation(value: unknown): boolean {
  return isRecord(value) && typeof value.kind === 'string' && value.kind in OPERATION_KEYS
}

export function parseAuthorityObjectEditIntent(
  rawOperation: unknown,
  taskId?: string,
  traceId?: string
): AuthorityObjectEditIntent {
  if (!isRecord(rawOperation) || typeof rawOperation.kind !== 'string') {
    throw new Error('board edit operation must be an object with a supported kind.')
  }
  if (!(rawOperation.kind in OPERATION_KEYS)) {
    throw new Error(`Unsupported board edit operation "${rawOperation.kind}".`)
  }
  const kind = rawOperation.kind as keyof typeof OPERATION_KEYS
  assertOnlyKeys(rawOperation, OPERATION_KEYS[kind], kind)
  const objectId = requiredString(rawOperation, 'object_id')
  let operation: AuthorityObjectEditOperation
  if (kind === 'object.update') {
    operation = { kind, objectId, patch: parsePatch(rawOperation.patch) }
  } else if (kind === 'object.move') {
    operation = {
      kind,
      objectId,
      x: finiteNumber(rawOperation.x, 'x', -MAX_COORDINATE, MAX_COORDINATE),
      y: finiteNumber(rawOperation.y, 'y', -MAX_COORDINATE, MAX_COORDINATE)
    }
  } else if (kind === 'object.resize') {
    if (
      rawOperation.viewport_preset !== undefined &&
      !isCodeObjectViewportPresetId(rawOperation.viewport_preset)
    ) {
      throw new Error('viewport_preset must be desktop, laptop, tablet, or phone.')
    }
    operation = {
      height: finiteNumber(rawOperation.height, 'height', 1, MAX_SIZE),
      kind,
      objectId,
      ...(isCodeObjectViewportPresetId(rawOperation.viewport_preset)
        ? { viewportPreset: rawOperation.viewport_preset }
        : {}),
      width: finiteNumber(rawOperation.width, 'width', 1, MAX_SIZE)
    }
  } else if (kind === 'object.duplicate') {
    operation = {
      kind,
      objectId,
      offsetX: optionalFiniteNumber(rawOperation.offset_x, 20, 'offset_x', -10_000, 10_000),
      offsetY: optionalFiniteNumber(rawOperation.offset_y, 20, 'offset_y', -10_000, 10_000)
    }
  } else {
    operation = { kind, objectId }
  }
  return {
    inputDigest: authorityMutationInputDigest('board_change', {
      operation,
      ...(taskId ? { taskId } : {}),
      ...(traceId ? { traceId } : {})
    }),
    operation
  }
}

function receiptKey(requestId: string): string {
  return `${RECEIPT_PLUGIN_PREFIX}${requestId}`
}

function parseReceipt(value: string, pageId: string): AuthorityObjectEditReceipt {
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.route !== 'board_change' ||
      !isRecord(parsed.after) ||
      !Number.isInteger(parsed.baseRevision) ||
      !Number.isInteger(parsed.appliedRevision) ||
      typeof parsed.inputDigest !== 'string' ||
      typeof parsed.objectId !== 'string' ||
      typeof parsed.operation !== 'string' ||
      !parsed.operation.startsWith('object.') ||
      typeof parsed.requestId !== 'string' ||
      (parsed.resultObjectId !== null && typeof parsed.resultObjectId !== 'string')
    ) {
      throw new Error('invalid fields')
    }
    return parsed as AuthorityObjectEditReceipt
  } catch {
    throw new Error(`Object edit receipt on Board "${pageId}" is unreadable.`)
  }
}

export function authorityObjectEditRequestMatches(
  document: AuthorityBoardDocument,
  pageId: string,
  requestId: string
): AuthorityObjectEditReceipt[] {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  return page.pluginData
    .filter((entry) => entry.pluginId === RECEIPT_PLUGIN_ID && entry.key === receiptKey(requestId))
    .map((entry) => parseReceipt(entry.value, pageId))
}

export function assertAuthorityObjectEditReplay(
  receipt: AuthorityObjectEditReceipt,
  intent: AuthorityObjectEditIntent,
  requestId: string
): void {
  if (receipt.inputDigest !== intent.inputDigest) {
    throw new Error(`Request "${requestId}" was already used for a different mutation.`)
  }
}

function isCodeObject(node: SceneNode): boolean {
  return node.pluginData.some(
    (entry) =>
      entry.pluginId === CODE_OBJECT_PLUGIN_ID &&
      entry.key === 'kind' &&
      entry.value === CODE_OBJECT_KIND
  )
}

function requireEditableTopLevelNode(
  graph: SceneGraph,
  pageId: string,
  operation: AuthorityObjectEditOperation
): SceneNode {
  const objectId = operation.objectId
  const node = graph.getNode(objectId)
  if (!node || node.parentId !== pageId || node.type === 'CANVAS') {
    throw new Error(`Native object "${objectId}" is not a top-level object on Board "${pageId}".`)
  }
  if (
    isCodeObject(node) &&
    (operation.kind === 'object.update' || operation.kind === 'object.duplicate')
  ) {
    throw new Error(
      `Object "${objectId}" is a Code Object; use the Code Object contract for content or identity changes.`
    )
  }
  if (!isCodeObject(node) && operation.kind === 'object.resize' && operation.viewportPreset) {
    throw new Error(`Object "${objectId}" is not a Code Object; viewport_preset is unsupported.`)
  }
  return node
}

function objectReadback(graph: SceneGraph, node: SceneNode): JsonRecord {
  return {
    bounds: graph.getAbsoluteBounds(node.id),
    child_ids: [...node.childIds],
    cornerRadius: node.cornerRadius,
    fills: node.fills,
    id: node.id,
    locked: node.locked,
    name: node.name,
    opacity: node.opacity,
    parent_id: node.parentId,
    ...(node.type === 'TEXT' ? { text: node.text } : {}),
    type: node.type,
    visible: node.visible
  }
}

function objectEditAfter(
  operation: AuthorityObjectEditOperation['kind'],
  originalId: string,
  resultNode: SceneNode | null,
  resultObjectId: string | null,
  graph: SceneGraph
): JsonRecord {
  if (operation === 'object.delete') return { deleted: true, id: originalId }
  if (resultNode) return objectReadback(graph, resultNode)
  return { id: resultObjectId, missing: true }
}

function stripCopiedReceipts(graph: SceneGraph, ownerId: string): void {
  const nodes = [graph.getNode(ownerId), ...graph.getDescendants(ownerId)]
  for (const node of nodes) {
    if (!node) continue
    graph.updateNode(node.id, {
      pluginData: node.pluginData.filter((entry) => entry.pluginId !== RECEIPT_PLUGIN_ID)
    })
  }
}

function updateChanges(node: SceneNode, patch: ObjectPatch): Partial<SceneNode> {
  if (patch.text !== undefined && node.type !== 'TEXT') {
    throw new Error('patch.text is supported only for a native TEXT object.')
  }
  return {
    ...(patch.cornerRadius === undefined ? {} : { cornerRadius: patch.cornerRadius }),
    ...(patch.fill === undefined ? {} : { fills: [colorToFill(patch.fill)] }),
    ...(patch.locked === undefined ? {} : { locked: patch.locked }),
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
    ...(patch.text === undefined ? {} : { text: patch.text }),
    ...(patch.visible === undefined ? {} : { visible: patch.visible })
  }
}

function hasChange(node: SceneNode, changes: Partial<SceneNode>): boolean {
  return Object.entries(changes).some(([key, value]) => node[key as keyof SceneNode] !== value)
}

export function applyAuthorityObjectEdit(
  document: AuthorityBoardDocument,
  pageId: string,
  intent: AuthorityObjectEditIntent,
  requestId: string,
  baseRevision: number
): AuthorityObjectEditApplyResult {
  const operation = intent.operation
  const node = requireEditableTopLevelNode(document.graph, pageId, operation)
  if (node.locked && !(operation.kind === 'object.update' && operation.patch.locked === false)) {
    throw new Error(`Object "${node.id}" is locked.`)
  }
  let resultObjectId: string | null = node.id
  if (operation.kind === 'object.update') {
    const changes = updateChanges(node, operation.patch)
    if (!hasChange(node, changes)) return { outcome: 'no_change' }
    document.graph.updateNode(node.id, changes)
  } else if (operation.kind === 'object.move') {
    if (node.x === operation.x && node.y === operation.y) return { outcome: 'no_change' }
    document.graph.updateNode(node.id, { x: operation.x, y: operation.y })
  } else if (operation.kind === 'object.resize') {
    const pluginData = isCodeObject(node)
      ? codeObjectViewportPluginData(node, operation.viewportPreset ?? null)
      : null
    const changes = {
      height: operation.height,
      ...(pluginData ? { pluginData } : {}),
      width: operation.width
    }
    if (!hasChange(node, changes)) {
      return { outcome: 'no_change' }
    }
    document.graph.updateNode(node.id, changes)
  } else if (operation.kind === 'object.duplicate') {
    const duplicate = document.graph.cloneTree(node.id, pageId, {
      name: `${node.name} copy`,
      x: node.x + operation.offsetX,
      y: node.y + operation.offsetY
    })
    if (!duplicate) throw new Error(`Object "${node.id}" could not be duplicated.`)
    resultObjectId = duplicate.id
    stripCopiedReceipts(document.graph, duplicate.id)
  } else {
    document.graph.deleteNode(node.id)
    resultObjectId = null
  }
  const resultNode = resultObjectId ? document.graph.getNode(resultObjectId) : null
  const receipt: AuthorityObjectEditReceipt = {
    after: objectEditAfter(operation.kind, node.id, resultNode, resultObjectId, document.graph),
    appliedRevision: baseRevision + 1,
    baseRevision,
    inputDigest: intent.inputDigest,
    objectId: node.id,
    operation: operation.kind,
    requestId,
    resultObjectId,
    route: 'board_change',
    version: 1
  }
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error(`Board page "${pageId}" does not exist.`)
  document.graph.updateNode(page.id, {
    pluginData: [
      ...page.pluginData,
      { key: receiptKey(requestId), pluginId: RECEIPT_PLUGIN_ID, value: JSON.stringify(receipt) }
    ]
  })
  return { outcome: 'applied', receipt }
}

export function authorityObjectEditReadback(
  document: AuthorityBoardDocument,
  pageId: string,
  receipt: AuthorityObjectEditReceipt
): JsonRecord {
  const resultNode = receipt.resultObjectId
    ? document.graph.getNode(receipt.resultObjectId)
    : document.graph.getNode(receipt.objectId)
  if (receipt.operation === 'object.delete') {
    return {
      expected: receipt.after,
      reconciliation: {
        reasons: resultNode ? ['deleted_object_present'] : [],
        status: resultNode ? 'diverged' : 'current'
      }
    }
  }
  if (!resultNode || !document.graph.isDescendant(resultNode.id, pageId)) {
    return {
      expected: receipt.after,
      object: { id: receipt.resultObjectId },
      reconciliation: { reasons: ['result_object_missing'], status: 'missing' }
    }
  }
  const current = objectReadback(document.graph, resultNode)
  const reasons =
    JSON.stringify(current) === JSON.stringify(receipt.after) ? [] : ['object_changed']
  return {
    expected: receipt.after,
    object: current,
    reconciliation: { reasons, status: reasons.length === 0 ? 'current' : 'diverged' }
  }
}
