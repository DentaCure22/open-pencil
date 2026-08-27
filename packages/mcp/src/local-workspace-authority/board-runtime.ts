import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  CODE_OBJECT_BOARD_PERMISSIONS,
  codeObjectAgentPreset,
  createUserCodeObjectDocument,
  isCodeObjectAgentPresetId,
  isCodeObjectKind,
  isCodeObjectModality,
  normalizeCodeObjectAppearance,
  normalizeCodeObjectSurface,
  parseCodeObjectDocument,
  preflightCodeObjectSource,
  serializeCodeObjectPluginData,
  type CodeObjectAgentPreset,
  type CodeObjectBoardPermission,
  type CodeObjectModality
} from '@open-pencil/core/code-object'
import {
  isMermaidDiagramContainer,
  type MermaidAppearance,
  type MermaidSceneSpec
} from '@open-pencil/core/diagram'
import {
  createMermaidDiagramInGraph,
  isBoardNativeCreateType,
  replaceMermaidDiagramInGraph,
  type BoardNativeCreateType
} from '@open-pencil/core/editor'
import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import { searchBoardMemory } from '@open-pencil/core/tools'
import {
  TransformMatrix,
  type ImageScaleMode,
  type Rect,
  type SceneNode
} from '@open-pencil/scene-graph'
import { TRANSPARENT } from '@open-pencil/scene-graph/constants'
import { getAuthoritativeWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import { assetReference, computeImageHash } from '@open-pencil/scene-graph/images'
import { hydrateSceneNodeDefaults } from '@open-pencil/scene-graph/node-defaults'

import { pageOwnedTraceAncestor } from './agent-context'
import {
  authorityBoardReadProjection,
  authorityBoardReadSort,
  authorityBoardReadTokenBudget,
  buildAuthorityBoardQueryIndex,
  parseAuthorityBoardReadQuery,
  queryAuthorityBoard,
  type AuthorityBoardQueryIndex
} from './board-query'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument,
  type AuthorityBoardDocument
} from './document'
import { compileHeadlessMermaidScenes } from './mermaid-compiler'
import { readAuthorityMermaidSource } from './mermaid-readback'
import { authorityNodeSummary } from './node-summary'
import { normalizeAuthorityRpcArgs } from './rpc-args'
import { renderAuthorityBoardScreenshot } from './screenshot'
import type { LocalWorkspaceAuthorityStore } from './store'
import type { LocalWorkspaceTraceGestureRead } from './trace'
import {
  queryPersistedTraceHistory,
  resolvePersistedTraceRequest,
  searchPersistedTrace
} from './trace-query'
import { LOCAL_AUTHORITY_BOARD_CAPABILITIES, type LocalWorkspaceAuthorityHead } from './types'

const EXECUTION_SURFACE = 'local_workspace_authority'
const RUNTIME_PREFIX = 'local-authority:'
const CONTEXT_LIMIT = 48
const DEFAULT_CONTEXT_LIMIT = 25
const DEFAULT_PAGE_LIMIT = 50
const QUERY_INDEX_LIMIT = 8
const BOARD_APPLY_OPERATION_LIMIT = 100
const BOARD_APPLY_IMAGE_LIMIT_BYTES = 32 * 1024 * 1024
const BOARD_APPLY_PROTECTED_FIELDS = new Set(['childIds', 'id', 'parentId', 'type'])

type JsonRecord = Record<string, unknown>

type BoardContext = {
  authorityId: string
  contentHash: string
  contentDocumentId: string
  documentId: string
  pageId: string
  revision: number
  runtimeInstanceId: string
  token: string
  workspaceId: string
}
type BoardQueryIndexCacheEntry = {
  contentHash: string
  index: AuthorityBoardQueryIndex
  revision: number
}
type BoardQueryIndexStatus = 'built' | 'rebuilt' | 'reused'

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredString(value: JsonRecord, field: string): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) throw new Error(`${field} is required.`)
  return result.trim()
}

function optionalString(value: JsonRecord, field: string): string | undefined {
  const result = value[field]
  return typeof result === 'string' && result.trim() ? result.trim() : undefined
}

function optionalStringArray(value: JsonRecord, field: string): string[] {
  const result = value[field]
  if (!Array.isArray(result)) return []
  return result
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}

function navigationRegionFrom(args: JsonRecord): Rect | undefined {
  const raw = args.region
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Partial<Rect>
  const finite = (candidate: unknown): candidate is number =>
    typeof candidate === 'number' && Number.isFinite(candidate)
  if (
    !finite(record.x) ||
    !finite(record.y) ||
    !finite(record.width) ||
    record.width <= 0 ||
    !finite(record.height) ||
    record.height <= 0
  ) {
    throw new Error('A navigation region requires finite x, y and positive width, height.')
  }
  return { height: record.height, width: record.width, x: record.x, y: record.y }
}

function requestedObjectIds(args: JsonRecord): string[] {
  if (!Array.isArray(args.object_ids)) {
    throw new TypeError('board_read objects scope requires an object_ids array.')
  }
  const ids = args.object_ids.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (ids.length === 0 || ids.length > 25 || ids.some((id) => !id)) {
    throw new Error('board_read object_ids must contain from 1 to 25 non-empty strings.')
  }
  if (new Set(ids).size !== ids.length) throw new Error('board_read object_ids must be unique.')
  return ids
}

function screenshotObjectIds(args: JsonRecord): string[] {
  if (!Array.isArray(args.object_ids)) {
    throw new TypeError('board_screenshot requires an object_ids array.')
  }
  const ids = args.object_ids.map((value) => (typeof value === 'string' ? value.trim() : ''))
  if (ids.length === 0 || ids.length > 8 || ids.some((id) => !id)) {
    throw new Error('board_screenshot object_ids must contain from 1 to 8 non-empty strings.')
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error('board_screenshot object_ids must be unique.')
  }
  return ids
}

function boardApplyOperations(args: JsonRecord): JsonRecord[] {
  if (!Array.isArray(args.operations)) {
    throw new TypeError('board_apply requires an operations array.')
  }
  if (args.operations.length === 0 || args.operations.length > BOARD_APPLY_OPERATION_LIMIT) {
    throw new Error(
      `board_apply operations must contain from 1 to ${String(BOARD_APPLY_OPERATION_LIMIT)} entries.`
    )
  }
  return args.operations.map((operation, index) => {
    if (!isRecord(operation)) {
      throw new TypeError(`board_apply operation ${String(index + 1)} must be an object.`)
    }
    return operation
  })
}

function boardApplyNodeType(value: unknown): BoardNativeCreateType {
  if (!isBoardNativeCreateType(value)) {
    throw new Error(`board_apply create requires a supported non-page node type.`)
  }
  return value
}

function boardApplyIndex(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error('board_apply index must be a non-negative integer.')
  }
  return value as number
}

function boardApplyTarget(
  document: AuthorityBoardDocument,
  pageId: string,
  objectId: string
): SceneNode {
  const node = document.graph.getNode(objectId)
  if (!node || node.type === 'CANVAS' || !document.graph.isDescendant(objectId, pageId)) {
    throw new Error(`board_apply object_id "${objectId}" is missing or outside the target page.`)
  }
  return node
}

function hydrateBoardApplyTarget(
  document: AuthorityBoardDocument,
  pageId: string,
  objectId: string
): SceneNode {
  const node = boardApplyTarget(document, pageId, objectId)
  const hydrated = hydrateSceneNodeDefaults(node)
  if (hydrated !== node) document.graph.nodes.set(objectId, hydrated)
  return hydrated
}

function boardApplyParent(
  document: AuthorityBoardDocument,
  pageId: string,
  parentId: string
): SceneNode {
  const parent = document.graph.getNode(parentId)
  if (
    !parent ||
    (parent.id !== pageId && !document.graph.isDescendant(parent.id, pageId)) ||
    !Array.isArray(parent.childIds)
  ) {
    throw new Error(`board_apply parent_id "${parentId}" is missing or outside the target page.`)
  }
  return parent
}

function boardApplyChanges(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new TypeError('board_apply update requires a changes object.')
  for (const field of BOARD_APPLY_PROTECTED_FIELDS) {
    if (field in value) {
      throw new Error(
        `board_apply update cannot change protected field "${field}"; use create, reparent, reorder, or delete.`
      )
    }
  }
  return structuredClone(value)
}

function boardApplyUnset(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new TypeError('board_apply unset must be an array.')
  const fields = value.map((field) => (typeof field === 'string' ? field.trim() : ''))
  if (fields.some((field) => !field) || new Set(fields).size !== fields.length) {
    throw new Error('board_apply unset must contain unique non-empty field names.')
  }
  for (const field of fields) {
    if (BOARD_APPLY_PROTECTED_FIELDS.has(field)) {
      throw new Error(`board_apply cannot unset protected field "${field}".`)
    }
  }
  return fields
}

type BoardApplyMutationState = {
  changedIds: Set<string>
  createdIds: Set<string>
  deletedIds: Set<string>
  document: AuthorityBoardDocument
  mermaidPreflight: JsonRecord[]
  pageId: string
  preflightIds: Set<string>
}

type BoardApplyImage = {
  bytes: Uint8Array
  fileName: string
  format: string
  mimeType: string
}

function boardApplyImageScaleMode(value: unknown): ImageScaleMode {
  if (value === undefined) return 'FIT'
  if (value === 'FILL' || value === 'FIT' || value === 'CROP' || value === 'TILE') {
    return value
  }
  throw new Error('Board image_scale_mode must be FILL, FIT, CROP, or TILE.')
}

function boardApplyImageMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
  }
  if (bytes.length >= 6) {
    const signature = String.fromCharCode(...bytes.slice(0, 6))
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif'
  }
  return null
}

async function readBoardApplyImage(sourcePath: string): Promise<BoardApplyImage> {
  if (!path.isAbsolute(sourcePath)) {
    throw new Error('board_apply create_image source_path must be absolute.')
  }
  const bytes = new Uint8Array(await readFile(sourcePath))
  if (bytes.length === 0 || bytes.length > BOARD_APPLY_IMAGE_LIMIT_BYTES) {
    throw new Error('board_apply create_image requires a non-empty image no larger than 32 MB.')
  }
  const mimeType = boardApplyImageMimeType(bytes)
  if (!mimeType) {
    throw new Error('board_apply create_image supports PNG, JPEG, WebP, or GIF files.')
  }
  const fileName = path.basename(sourcePath)
  return {
    bytes,
    fileName,
    format: path.extname(fileName).slice(1).toLowerCase() || mimeType.slice('image/'.length),
    mimeType
  }
}

function boardApplyBounds(
  value: unknown,
  options: { label: string; partial: false }
): Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>
function boardApplyBounds(
  value: unknown,
  options: { label: string; partial: true }
): Partial<Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>>
function boardApplyBounds(
  value: unknown,
  options: { label: string; partial: boolean }
): Partial<Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>> {
  if (!isRecord(value)) throw new TypeError(`${options.label} bounds must be an object.`)
  const result: Partial<Pick<SceneNode, 'height' | 'width' | 'x' | 'y'>> = {}
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    const candidate = value[field]
    if (candidate === undefined && options.partial) continue
    if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
      throw new TypeError(`${options.label} bounds.${field} must be a finite number.`)
    }
    if ((field === 'width' || field === 'height') && candidate <= 0) {
      throw new Error(`${options.label} bounds.${field} must be positive.`)
    }
    result[field] = candidate
  }
  if (Object.keys(result).length === 0) throw new Error(`${options.label} bounds has no changes.`)
  return result
}

function boardApplyTypedCreateBounds(
  state: BoardApplyMutationState,
  parentId: string,
  operation: JsonRecord
): Pick<SceneNode, 'height' | 'width' | 'x' | 'y'> {
  const bounds = boardApplyBounds(operation.bounds, { label: 'Typed object', partial: false })
  const coordinateSpace = operation.coordinate_space
  if (coordinateSpace !== undefined && coordinateSpace !== 'page' && coordinateSpace !== 'parent') {
    throw new Error('board_apply coordinate_space must be "page" or "parent".')
  }
  if (coordinateSpace === 'parent' || parentId === state.pageId) return bounds

  const parent = boardApplyParent(state.document, state.pageId, parentId)
  const matrix = getAuthoritativeWorldMatrix(parent, state.document.graph)
  const epsilon = 1e-9
  if (Math.abs(matrix[1] ?? 0) > epsilon || Math.abs(matrix[3] ?? 0) > epsilon) {
    throw new Error(
      `board_apply ${String(operation.op)} cannot convert page-space bounds through a rotated parent; pass coordinate_space: "parent" with parent-local bounds.`
    )
  }
  const inverse = TransformMatrix.invert(matrix)
  if (!inverse) throw new Error(`board_apply parent "${parentId}" has a non-invertible transform.`)
  const points = TransformMatrix.mapPoints(inverse, [
    bounds.x,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y,
    bounds.x + bounds.width,
    bounds.y + bounds.height,
    bounds.x,
    bounds.y + bounds.height
  ])
  const xs = [points[0], points[2], points[4], points[6]]
  const ys = [points[1], points[3], points[5], points[7]]
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    height: Math.max(...ys) - y,
    width: Math.max(...xs) - x,
    x,
    y
  }
}

function boardApplyCodeObjectRecord(value: unknown, field: string): JsonRecord {
  if (!isRecord(value)) throw new TypeError(`Code Object ${field} must be an object.`)
  return structuredClone(value)
}

function boardApplyCodeObjectPermissions(value: unknown): CodeObjectBoardPermission[] {
  if (!Array.isArray(value)) throw new TypeError('Code Object board_permissions must be an array.')
  if (value.length > 64)
    throw new Error('Code Object board_permissions must contain at most 64 entries.')
  return value.map((permission) => {
    if (
      typeof permission !== 'string' ||
      !CODE_OBJECT_BOARD_PERMISSIONS.includes(permission as CodeObjectBoardPermission)
    ) {
      throw new Error(`Unsupported Code Object board permission "${String(permission)}".`)
    }
    return permission as CodeObjectBoardPermission
  })
}

function boardApplyCodeObjectSource(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('Code Object source must be a non-empty string.')
  }
  return value
}

function boardApplyMermaidSource(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('Mermaid source must be a non-empty string.')
  }
  if (value.length > 100_000)
    throw new Error('Mermaid source must contain at most 100,000 characters.')
  return value
}

function boardApplyPluginValue(node: SceneNode, key: string): string | null {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

function boardApplyMermaidAppearance(
  value: unknown,
  fallback: MermaidAppearance = 'auto'
): MermaidAppearance {
  if (value === undefined) return fallback
  if (value === 'auto' || value === 'light' || value === 'dark') return value
  throw new Error('Mermaid appearance must be auto, light, or dark.')
}

async function boardApplyMermaidScene(
  source: string,
  appearance: MermaidAppearance,
  size: Pick<SceneNode, 'height' | 'width'>
): Promise<MermaidSceneSpec> {
  const scene = (await compileHeadlessMermaidScenes([source])).at(0)
  if (!scene) throw new Error('Mermaid compilation returned no diagram.')
  return { ...scene, appearance, height: size.height, source, width: size.width }
}

function recordBoardApplyMermaidPreflight(
  state: BoardApplyMutationState,
  objectId: string,
  scene: MermaidSceneSpec
): void {
  state.mermaidPreflight.push({
    contract: 'native_diagram',
    object_id: objectId,
    parser: scene.parser,
    source_hash: createHash('sha256').update(scene.source).digest('hex'),
    source_length: scene.source.length,
    syntax: 'mermaid'
  })
}

async function applyBoardCreateMermaid(
  state: BoardApplyMutationState,
  operation: JsonRecord
): Promise<void> {
  const id = requiredString(operation, 'object_id')
  const parentId = requiredString(operation, 'parent_id')
  if (parentId !== state.pageId) {
    throw new Error('board_apply create_mermaid parent_id must equal the target page_id.')
  }
  const parent = boardApplyParent(state.document, state.pageId, parentId)
  const source = boardApplyMermaidSource(operation.source)
  const bounds = boardApplyBounds(operation.bounds, {
    label: 'Mermaid diagram',
    partial: false
  })
  const appearance = boardApplyMermaidAppearance(operation.appearance)
  const scene = await boardApplyMermaidScene(source, appearance, bounds)
  recordBoardApplyMermaidPreflight(state, id, scene)

  const existing = state.document.graph.getNode(id)
  if (existing) {
    const suppliedName = optionalString(operation, 'name')
    const matches =
      isMermaidDiagramContainer(existing) &&
      existing.parentId === parentId &&
      parent.childIds.includes(id) &&
      existing.x === bounds.x &&
      existing.y === bounds.y &&
      existing.width === bounds.width &&
      existing.height === bounds.height &&
      boardApplyPluginValue(existing, 'mermaid/source') === scene.source &&
      boardApplyPluginValue(existing, 'mermaid/appearance') === appearance &&
      (!suppliedName || existing.name === suppliedName)
    if (!matches) {
      throw new Error(
        `board_apply create_mermaid object_id "${id}" already exists with different content.`
      )
    }
    return
  }

  createMermaidDiagramInGraph(
    state.document.graph,
    parentId,
    scene,
    { x: bounds.x, y: bounds.y },
    { diagramId: id, ownerId: id }
  )
  const name = optionalString(operation, 'name')
  if (name) state.document.graph.updateNode(id, { name })
  const insertIndex = boardApplyIndex(operation.index)
  if (insertIndex !== undefined) state.document.graph.insertChildAt(id, parentId, insertIndex)
  state.createdIds.add(id)
  state.changedIds.add(id)
}

async function applyBoardUpdateMermaid(
  state: BoardApplyMutationState,
  operation: JsonRecord
): Promise<void> {
  const id = requiredString(operation, 'object_id')
  const owner = boardApplyTarget(state.document, state.pageId, id)
  if (!isMermaidDiagramContainer(owner) || owner.parentId !== state.pageId) {
    throw new Error(`board_apply update_mermaid requires a page-owned Mermaid diagram.`)
  }
  const source = boardApplyMermaidSource(operation.source)
  const currentAppearance = boardApplyPluginValue(owner, 'mermaid/appearance')
  const appearance = boardApplyMermaidAppearance(
    operation.appearance,
    boardApplyMermaidAppearance(currentAppearance ?? undefined)
  )
  const scene = await boardApplyMermaidScene(source, appearance, owner)
  recordBoardApplyMermaidPreflight(state, id, scene)

  replaceMermaidDiagramInGraph(state.document.graph, state.pageId, id, scene)
  const changes: JsonRecord = { name: optionalString(operation, 'name') ?? owner.name }
  if (operation.bounds !== undefined) {
    Object.assign(
      changes,
      boardApplyBounds(operation.bounds, { label: 'Mermaid diagram', partial: true })
    )
  }
  state.document.graph.updateNode(id, changes)
  state.changedIds.add(id)
}

function boardApplyCodeObjectPreset(operation: JsonRecord): CodeObjectAgentPreset | undefined {
  const presetId = optionalString(operation, 'preset_id')
  if (!presetId) return undefined
  if (!isCodeObjectAgentPresetId(presetId)) {
    throw new Error(`Unknown Code Object preset_id "${presetId}".`)
  }
  const preset = codeObjectAgentPreset(presetId)
  if (operation.source !== undefined) {
    throw new Error(
      `Code Object preset "${preset.id}" owns its renderer; omit source and update props or state.`
    )
  }
  if (operation.definition_id !== undefined) {
    throw new Error(`Code Object preset "${preset.id}" owns definition_id.`)
  }
  return preset
}

function boardApplyCodeObjectModality(
  operation: JsonRecord,
  preset: CodeObjectAgentPreset | undefined
): CodeObjectModality {
  const supplied = optionalString(operation, 'modality')
  if (supplied && !isCodeObjectModality(supplied)) {
    throw new Error(`Unknown Code Object modality "${supplied}".`)
  }
  if (preset && supplied && supplied !== preset.modality) {
    throw new Error(
      `Code Object preset "${preset.id}" uses modality "${preset.modality}", not "${supplied}".`
    )
  }
  if (preset) return preset.modality
  if (supplied && isCodeObjectModality(supplied)) return supplied
  return 'custom'
}

function boardApplyCodeObjectSurface(
  operation: JsonRecord,
  preset: CodeObjectAgentPreset | undefined
) {
  if (operation.surface !== undefined) {
    return normalizeCodeObjectSurface(boardApplyCodeObjectRecord(operation.surface, 'surface'))
  }
  return preset ? { ...preset.surface } : undefined
}

function applyBoardCreateCodeObject(
  state: BoardApplyMutationState,
  operation: JsonRecord,
  operationIndex: number
): void {
  const id = requiredString(operation, 'object_id')
  const parentId = requiredString(operation, 'parent_id')
  const preset = boardApplyCodeObjectPreset(operation)
  const modality = boardApplyCodeObjectModality(operation, preset)
  const name = optionalString(operation, 'name') ?? preset?.name
  if (!name) throw new Error('name is required when preset_id is omitted.')
  const source = preset?.source ?? boardApplyCodeObjectSource(operation.source, true)
  if (!source) throw new TypeError('Code Object source is required when preset_id is omitted.')
  const bounds = boardApplyTypedCreateBounds(state, parentId, operation)
  const surface = boardApplyCodeObjectSurface(operation, preset)
  const suppliedProps =
    operation.props === undefined ? {} : boardApplyCodeObjectRecord(operation.props, 'props')
  const suppliedState =
    operation.state === undefined ? {} : boardApplyCodeObjectRecord(operation.state, 'state')
  const codeObject = createUserCodeObjectDocument({
    ...(operation.appearance !== undefined
      ? {
          appearance: normalizeCodeObjectAppearance(
            boardApplyCodeObjectRecord(operation.appearance, 'appearance')
          )
        }
      : {}),
    boardPermissions:
      operation.board_permissions !== undefined
        ? boardApplyCodeObjectPermissions(operation.board_permissions)
        : [...(preset?.boardPermissions ?? [])],
    definitionId: preset?.definitionId ?? optionalString(operation, 'definition_id') ?? id,
    modality,
    name,
    ...(preset ? { presetId: preset.id } : {}),
    props: { ...(preset ? structuredClone(preset.props) : {}), ...suppliedProps },
    source,
    state: { ...(preset ? structuredClone(preset.state) : {}), ...suppliedState },
    ...(surface ? { surface } : {})
  })
  applyBoardCreate(
    state,
    {
      index: operation.index,
      node: {
        ...bounds,
        id,
        name,
        pluginData: serializeCodeObjectPluginData({ pluginData: [] }, codeObject),
        type: 'FRAME'
      },
      op: 'create',
      parent_id: parentId
    },
    operationIndex
  )
}

async function applyBoardCreateImage(
  state: BoardApplyMutationState,
  operation: JsonRecord,
  operationIndex: number
): Promise<void> {
  const id = requiredString(operation, 'object_id')
  const name = requiredString(operation, 'name')
  const parentId = requiredString(operation, 'parent_id')
  const sourcePath = requiredString(operation, 'source_path')
  const bounds = boardApplyTypedCreateBounds(state, parentId, operation)
  const image = await readBoardApplyImage(sourcePath)
  const imageHash = computeImageHash(image.bytes)
  state.document.graph.images.set(imageHash, image.bytes)
  applyBoardCreate(
    state,
    {
      index: operation.index,
      node: {
        ...bounds,
        fills: [
          {
            color: TRANSPARENT,
            imageHash,
            imageScaleMode: boardApplyImageScaleMode(operation.image_scale_mode),
            opacity: 1,
            type: 'IMAGE',
            visible: true
          }
        ],
        id,
        name,
        pluginData: contentSourcePluginData({
          fileName: image.fileName,
          format: image.format,
          mimeType: image.mimeType,
          revision: CONTENT_SOURCE_REVISION,
          source: assetReference(imageHash)
        }),
        type: 'RECTANGLE'
      },
      op: 'create',
      parent_id: parentId
    },
    operationIndex
  )
}

function applyBoardUpdateCodeObject(state: BoardApplyMutationState, operation: JsonRecord): void {
  const id = requiredString(operation, 'object_id')
  const node = hydrateBoardApplyTarget(state.document, state.pageId, id)
  const current = parseCodeObjectDocument(node)
  if (current?.component !== 'user-code') {
    throw new Error(`board_apply update_code_object requires an authored Code Object.`)
  }
  const next = structuredClone(current)
  const changes: JsonRecord = {}
  let changed = false
  if (operation.name !== undefined) {
    const name = requiredString(operation, 'name')
    next.name = name
    changes.name = name
    changed = true
  }
  const source = boardApplyCodeObjectSource(operation.source, false)
  if (source !== undefined) {
    if (isCodeObjectAgentPresetId(current.presetId)) {
      throw new Error(
        `Code Object preset "${current.presetId}" owns its renderer; update props or state instead.`
      )
    }
    next.source = source
    state.preflightIds.add(id)
    changed = true
  }
  if (operation.props !== undefined) {
    next.props = boardApplyCodeObjectRecord(operation.props, 'props')
    changed = true
  }
  if (operation.state !== undefined) {
    next.state = boardApplyCodeObjectRecord(operation.state, 'state')
    changed = true
  }
  if (operation.board_permissions !== undefined) {
    next.boardPermissions = boardApplyCodeObjectPermissions(operation.board_permissions)
    changed = true
  }
  if (operation.appearance !== undefined) {
    next.appearance = normalizeCodeObjectAppearance(
      boardApplyCodeObjectRecord(operation.appearance, 'appearance')
    )
    changed = true
  }
  if (operation.surface !== undefined) {
    next.surface = normalizeCodeObjectSurface(
      boardApplyCodeObjectRecord(operation.surface, 'surface')
    )
    changed = true
  }
  if (operation.bounds !== undefined) {
    Object.assign(
      changes,
      boardApplyBounds(operation.bounds, { label: 'Code Object', partial: true })
    )
    changed = true
  }
  if (!changed) throw new Error('board_apply update_code_object has no changes.')
  changes.pluginData = serializeCodeObjectPluginData(node, next)
  state.document.graph.updateNode(id, changes)
  state.changedIds.add(id)
}

function applyBoardCreate(
  state: BoardApplyMutationState,
  operation: JsonRecord,
  operationIndex: number
): void {
  const nodeValue = operation.node
  if (!isRecord(nodeValue)) {
    throw new TypeError(`board_apply create operation ${String(operationIndex + 1)} requires node.`)
  }
  const id = requiredString(nodeValue, 'id')
  const type = boardApplyNodeType(nodeValue.type)
  const parentId = requiredString(operation, 'parent_id')
  const parent = boardApplyParent(state.document, state.pageId, parentId)
  const existing = state.document.graph.getNode(id)
  if (existing) {
    const supplied = Object.entries(nodeValue).filter(
      ([field]) => !BOARD_APPLY_PROTECTED_FIELDS.has(field)
    )
    const matches =
      existing.type === type &&
      existing.parentId === parentId &&
      supplied.every(
        ([field, value]) =>
          JSON.stringify(existing[field as keyof SceneNode]) === JSON.stringify(value)
      )
    if (!matches || !parent.childIds.includes(id)) {
      throw new Error(`board_apply create object_id "${id}" already exists with different content.`)
    }
    return
  }
  const {
    childIds: _childIds,
    id: _id,
    parentId: _parentId,
    type: _type,
    ...overrides
  } = structuredClone(nodeValue)
  state.document.graph.createNodeWithId(id, type, parentId, overrides)
  const insertIndex = boardApplyIndex(operation.index)
  if (insertIndex !== undefined) state.document.graph.insertChildAt(id, parentId, insertIndex)
  state.createdIds.add(id)
  state.changedIds.add(id)
  const created = state.document.graph.getNode(id)
  if (created && isCodeObjectKind(created)) state.preflightIds.add(id)
}

function applyBoardUpdate(
  state: BoardApplyMutationState,
  operation: JsonRecord,
  index: number
): void {
  const id = requiredString(operation, 'object_id')
  const node = hydrateBoardApplyTarget(state.document, state.pageId, id)
  const changes = boardApplyChanges(operation.changes)
  const unset = boardApplyUnset(operation.unset)
  if (Object.keys(changes).length === 0 && unset.length === 0) {
    throw new Error(`board_apply update operation ${String(index + 1)} has no changes.`)
  }
  state.document.graph.updateNode(id, changes)
  for (const field of unset) Reflect.deleteProperty(node, field)
  state.changedIds.add(id)
  if (
    (Object.hasOwn(changes, 'pluginData') || unset.includes('pluginData')) &&
    isCodeObjectKind(node)
  ) {
    state.preflightIds.add(id)
  }
}

function applyBoardReparent(state: BoardApplyMutationState, operation: JsonRecord): void {
  const id = requiredString(operation, 'object_id')
  const parentId = requiredString(operation, 'parent_id')
  const node = hydrateBoardApplyTarget(state.document, state.pageId, id)
  const parent = boardApplyParent(state.document, state.pageId, parentId)
  const hydratedParent = hydrateSceneNodeDefaults(parent)
  if (hydratedParent !== parent) state.document.graph.nodes.set(parentId, hydratedParent)
  if (node.parentId) {
    const oldParent = state.document.graph.getNode(node.parentId)
    if (oldParent) {
      const hydratedOldParent = hydrateSceneNodeDefaults(oldParent)
      if (hydratedOldParent !== oldParent) {
        state.document.graph.nodes.set(oldParent.id, hydratedOldParent)
      }
    }
  }
  if (parentId === id || state.document.graph.isDescendant(parentId, id)) {
    throw new Error(`board_apply cannot reparent "${id}" into itself or its descendant.`)
  }
  if (node.parentId !== parentId) state.document.graph.reparentNode(id, parentId)
  const insertIndex = boardApplyIndex(operation.index)
  if (insertIndex !== undefined) state.document.graph.insertChildAt(id, parentId, insertIndex)
  state.changedIds.add(id)
}

function applyBoardDelete(state: BoardApplyMutationState, operation: JsonRecord): void {
  const id = requiredString(operation, 'object_id')
  const node = boardApplyTarget(state.document, state.pageId, id)
  if (node.childIds.length > 0 && operation.recursive !== true) {
    throw new Error(
      `board_apply delete "${id}" has descendants; pass recursive: true to delete the subtree.`
    )
  }
  const subtree = [
    id,
    ...[...state.document.graph.getDescendants(id)].map(({ id: childId }) => childId)
  ]
  state.document.graph.deleteNode(id)
  for (const deletedId of subtree) {
    state.changedIds.delete(deletedId)
    state.createdIds.delete(deletedId)
    state.deletedIds.add(deletedId)
  }
}

async function applyBoardOperation(
  state: BoardApplyMutationState,
  operation: JsonRecord,
  index: number
): Promise<void> {
  const op = requiredString(operation, 'op')
  if (op === 'create_mermaid') return applyBoardCreateMermaid(state, operation)
  if (op === 'update_mermaid') return applyBoardUpdateMermaid(state, operation)
  if (op === 'create_image') return applyBoardCreateImage(state, operation, index)
  if (op === 'create_code_object') return applyBoardCreateCodeObject(state, operation, index)
  if (op === 'update_code_object') return applyBoardUpdateCodeObject(state, operation)
  if (op === 'create') return applyBoardCreate(state, operation, index)
  if (op === 'update') return applyBoardUpdate(state, operation, index)
  if (op === 'reparent') return applyBoardReparent(state, operation)
  if (op === 'delete') return applyBoardDelete(state, operation)
  throw new Error(`board_apply operation ${String(index + 1)} has unsupported op "${op}".`)
}

async function preflightBoardCodeObjects(
  document: AuthorityBoardDocument,
  changedIds: ReadonlySet<string>
) {
  const receipts = []
  for (const id of changedIds) {
    const node = document.graph.getNode(id)
    if (!node || !isCodeObjectKind(node)) continue
    const codeObject = parseCodeObjectDocument(node)
    if (!codeObject) throw new Error(`Code Object "${id}" has an invalid document envelope.`)
    if (codeObject.component !== 'user-code') continue
    if (typeof codeObject.source !== 'string') {
      throw new TypeError(`Code Object "${id}" requires authored TSX source.`)
    }
    const result = await preflightCodeObjectSource(codeObject.source)
    receipts.push({
      contract: result.contract,
      object_id: id,
      source_hash: result.sourceHash,
      source_length: result.sourceLength,
      syntax: result.syntax
    })
  }
  return receipts
}

function objectReadCandidates(
  document: AuthorityBoardDocument,
  pageId: string,
  ids: string[]
): SceneNode[] {
  return ids.map((id) => {
    const node = document.graph.getNode(id)
    if (!node || node.type === 'CANVAS' || !document.graph.isDescendant(id, pageId)) {
      throw new Error(`board_read object_id "${id}" is missing or outside the target page.`)
    }
    return node
  })
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number.`)
  }
  return value
}

function boundedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string
): number {
  if (value === undefined) return fallback
  const result = finiteNumber(value, field)
  if (result < minimum || result > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`)
  }
  return result
}

function runtimeInstanceId(head: LocalWorkspaceAuthorityHead): string {
  return `${RUNTIME_PREFIX}${head.authorityId}`
}

function pageFrom(document: AuthorityBoardDocument, pageId: string): SceneNode {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS' || page.parentId !== document.graph.rootId) {
    throw new Error(`Board page "${pageId}" does not exist in the local workspace authority.`)
  }
  return page
}

function targetResult(head: LocalWorkspaceAuthorityHead, page: SceneNode) {
  return {
    boardRevision: head.revision,
    contentDocumentId: head.identity.documentId,
    documentId: head.identity.documentId,
    documentName: head.identity.documentName,
    pageId: page.id,
    pageName: page.name,
    runtimeInstanceId: runtimeInstanceId(head),
    workspaceId: head.identity.workspaceId
  }
}

function traceCandidateSummary(document: AuthorityBoardDocument, node: SceneNode) {
  return {
    bounds: document.graph.getAbsoluteBounds(node.id),
    name: node.name,
    stableId: node.id,
    type: node.type,
    visible: node.visible
  }
}

function compactTraceGesture(
  gesture: LocalWorkspaceTraceGestureRead,
  head: LocalWorkspaceAuthorityHead | null
) {
  const recordedIds = gesture.candidates.items.map(({ stableId }) => stableId)
  const requestedIds = [
    ...new Set([
      ...(gesture.candidates.primaryTargetId ? [gesture.candidates.primaryTargetId] : []),
      ...recordedIds
    ])
  ]
  let document: AuthorityBoardDocument | null = null
  let page: SceneNode | null = null
  let resolutionStatus: 'document_unavailable' | 'page_missing' | 'resolved' =
    'document_unavailable'
  if (head) {
    try {
      document = readAuthorityBoardDocument(head.document)
      const candidatePage = document.graph.getNode(gesture.boardOrigin.pageId)
      if (candidatePage?.type === 'CANVAS' && candidatePage.parentId === document.graph.rootId) {
        page = candidatePage
        resolutionStatus = 'resolved'
      } else {
        resolutionStatus = 'page_missing'
      }
    } catch {
      document = null
    }
  }

  const resolvedGraph = document?.graph
  const resolved =
    resolvedGraph && page
      ? requestedIds.flatMap((id) => {
          const node = resolvedGraph.getNode(id)
          return node && node.type !== 'CANVAS' && resolvedGraph.isDescendant(node.id, page.id)
            ? [node]
            : []
        })
      : []
  const resolvedIds = new Set(resolved.map(({ id }) => id))
  const ownerIds = new Set<string>()
  // Recorded hits inside a container (e.g. Code Object internals) are grouped under their owner
  // instead of being discarded, so the compact view keeps the precise pointing evidence.
  const internalIdsByOwner = new Map<string, string[]>()
  const owners =
    document && page
      ? resolved.flatMap((node) => {
          const owner = pageOwnedTraceAncestor(document, page.id, node.id)
          if (!owner) return []
          if (node.id !== owner.id) {
            internalIdsByOwner.set(owner.id, [...(internalIdsByOwner.get(owner.id) ?? []), node.id])
          }
          if (ownerIds.has(owner.id)) return []
          ownerIds.add(owner.id)
          return [owner]
        })
      : []
  const primaryOwner =
    document && page && gesture.candidates.primaryTargetId
      ? pageOwnedTraceAncestor(document, page.id, gesture.candidates.primaryTargetId)
      : undefined
  const region = gesture.geometry.pageRegion
  const knownOmittedCount = Math.max(0, gesture.candidates.count - gesture.candidates.items.length)

  return {
    boardOrigin: gesture.boardOrigin,
    candidates: {
      collapsedCount: Math.max(0, resolved.length - owners.length),
      count: owners.length,
      items: document
        ? owners.map((owner) => {
            const recordedInternalIds = internalIdsByOwner.get(owner.id)
            return {
              ...traceCandidateSummary(document, owner),
              ...(recordedInternalIds?.length ? { recordedInternalIds } : {})
            }
          })
        : [],
      knownOmittedCount,
      missingCount: requestedIds.filter((id) => !resolvedIds.has(id)).length,
      ...(primaryOwner ? { primaryTargetId: primaryOwner.id } : {}),
      recordedCount: gesture.candidates.count,
      recordedItemCount: gesture.candidates.items.length,
      truncated: gesture.candidates.truncated
    },
    capturedAt: gesture.capturedAt,
    contract: 'trace_context/v1' as const,
    ...(gesture.evidence ? { evidence: gesture.evidence } : {}),
    geometry: { kind: gesture.geometry.kind, pageRegion: region },
    gestureId: gesture.gestureId,
    imageStatus: gesture.imageStatus,
    resolution: { status: resolutionStatus },
    sessionId: gesture.sessionId
  }
}

export class LocalWorkspaceBoardRuntime {
  private readonly contexts = new Map<string, BoardContext>()
  private readonly queryIndexes = new Map<string, BoardQueryIndexCacheEntry>()

  constructor(private readonly store: LocalWorkspaceAuthorityStore) {}

  private queryIndexFor(
    head: LocalWorkspaceAuthorityHead,
    document: AuthorityBoardDocument,
    pageId: string
  ): { index: AuthorityBoardQueryIndex; status: BoardQueryIndexStatus } {
    const key = `${head.authorityId}:${head.identity.documentId}:${pageId}`
    const existing = this.queryIndexes.get(key)
    if (existing?.contentHash === head.contentHash && existing.revision === head.revision) {
      this.queryIndexes.delete(key)
      this.queryIndexes.set(key, existing)
      return { index: existing.index, status: 'reused' }
    }
    const index = buildAuthorityBoardQueryIndex(document.graph, pageId)
    this.queryIndexes.set(key, {
      contentHash: head.contentHash,
      index,
      revision: head.revision
    })
    while (this.queryIndexes.size > QUERY_INDEX_LIMIT) {
      const oldest = this.queryIndexes.keys().next().value
      if (typeof oldest !== 'string') break
      this.queryIndexes.delete(oldest)
    }
    return { index, status: existing ? 'rebuilt' : 'built' }
  }

  isPinnedRequest(body: Record<string, unknown>): boolean {
    const args = normalizeAuthorityRpcArgs(body)
    return optionalString(args, 'runtime_instance_id')?.startsWith(RUNTIME_PREFIX) === true
  }

  private async head(): Promise<LocalWorkspaceAuthorityHead> {
    const head = await this.store.head()
    if (!head) throw new Error('Local workspace authority has no saved Board document.')
    return head
  }

  private validatedTarget(
    head: LocalWorkspaceAuthorityHead,
    args: JsonRecord,
    options?: { hydrate?: boolean }
  ) {
    const workspaceId = optionalString(args, 'workspace_id')
    if (workspaceId && workspaceId !== head.identity.workspaceId) {
      throw new Error(
        `Local authority owns workspace "${head.identity.workspaceId}", received "${workspaceId}".`
      )
    }
    const contentDocumentId = optionalString(args, 'content_document_id')
    if (contentDocumentId && contentDocumentId !== head.identity.documentId) {
      throw new Error(`Content document "${contentDocumentId}" is not owned by this authority.`)
    }
    const documentId = optionalString(args, 'document_id')
    if (documentId && documentId !== head.identity.documentId) {
      throw new Error(`Document "${documentId}" is not owned by this authority.`)
    }
    const requestedRuntime = optionalString(args, 'runtime_instance_id')
    if (requestedRuntime && requestedRuntime !== runtimeInstanceId(head)) {
      throw new Error(
        `Runtime "${requestedRuntime}" is unavailable; no live request was retargeted.`
      )
    }
    const document = readAuthorityBoardDocument(head.document, options)
    const page = pageFrom(document, requiredString(args, 'page_id'))
    return { document, page }
  }

  private contextFor(
    head: LocalWorkspaceAuthorityHead,
    page: SceneNode,
    document: AuthorityBoardDocument
  ) {
    const token = `board-context:${randomUUID()}`
    const context: BoardContext = {
      authorityId: head.authorityId,
      contentDocumentId: head.identity.documentId,
      contentHash: head.contentHash,
      documentId: head.identity.documentId,
      pageId: page.id,
      revision: head.revision,
      runtimeInstanceId: runtimeInstanceId(head),
      token,
      workspaceId: head.identity.workspaceId
    }
    this.contexts.set(token, context)
    while (this.contexts.size > CONTEXT_LIMIT) {
      const oldest = this.contexts.keys().next().value
      if (typeof oldest !== 'string') break
      this.contexts.delete(oldest)
    }
    const children = page.childIds
      .map((id) => document.graph.getNode(id))
      .filter((node): node is SceneNode => node !== undefined)
    const neighborhood = children
      .slice(0, DEFAULT_CONTEXT_LIMIT)
      .map((node) => authorityNodeSummary(document.graph, node))
    return {
      appearance: { status: 'unavailable', reason: 'no_live_runtime' },
      capabilities: [...LOCAL_AUTHORITY_BOARD_CAPABILITIES],
      context_token: token,
      execution_surface: EXECUTION_SURFACE,
      neighborhood: {
        count: children.length,
        nodes: neighborhood,
        returned: neighborhood.length,
        truncated: neighborhood.length < children.length
      },
      revisions: { authority: head.revision, board: head.revision },
      runtime: {
        instance_id: runtimeInstanceId(head),
        visibility: 'headless',
        write_authority: 'writer'
      },
      selection: [],
      selection_summary: {
        count: 0,
        nodes: [],
        reason: 'no_live_runtime',
        status: 'unavailable'
      },
      target: {
        content_document_id: head.identity.documentId,
        document_id: head.identity.documentId,
        page_id: page.id,
        page_name: page.name,
        workspace_id: head.identity.workspaceId
      },
      viewport: { status: 'unavailable', reason: 'no_live_runtime' }
    }
  }

  private async resolveContext(args: JsonRecord, options?: { hydrate?: boolean }) {
    const token = requiredString(args, 'context_token')
    const context = this.contexts.get(token)
    if (!context) throw new Error('Board context is missing or expired. Call board_context again.')
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args, options)
    if (
      context.authorityId !== head.authorityId ||
      context.contentDocumentId !== head.identity.documentId ||
      context.documentId !== head.identity.documentId ||
      context.pageId !== page.id ||
      context.runtimeInstanceId !== runtimeInstanceId(head) ||
      context.workspaceId !== head.identity.workspaceId
    ) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    return {
      context,
      current: context.contentHash === head.contentHash && context.revision === head.revision,
      document,
      head,
      page
    }
  }

  private async requireContext(args: JsonRecord, options?: { hydrate?: boolean }) {
    const resolved = await this.resolveContext(args, options)
    if (!resolved.current) {
      throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
    }
    return resolved
  }

  private async listDocuments() {
    const head = await this.head()
    const document = readAuthorityBoardDocument(head.document)
    return {
      ok: true,
      result: {
        documents: [
          {
            active: false,
            content_document_id: head.identity.documentId,
            current_page_id: '',
            current_page_name: '',
            execution_surface: EXECUTION_SURFACE,
            id: head.identity.documentId,
            kind: 'workspace',
            name: head.identity.documentName,
            pages: document.graph.getPages().map((page) => ({ id: page.id, name: page.name })),
            workspace_id: head.identity.workspaceId
          }
        ],
        runtime_instance_id: runtimeInstanceId(head)
      }
    }
  }

  private async workspaceSearch(args: JsonRecord) {
    const query = requiredString(args, 'query')
    const limit = boundedNumber(args.limit, 20, 1, 100, 'limit')
    return { ok: true, result: await this.store.searchWorkspace(query, limit) }
  }

  private async context(args: JsonRecord) {
    if (args.target === 'current_visible') {
      throw new Error('no_live_runtime: current_visible requires an open OpenPencil Board.')
    }
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    return {
      ok: true,
      result: this.contextFor(head, page, document),
      target: targetResult(head, page)
    }
  }

  private async screenshot(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const objectIds = screenshotObjectIds(args)
    const requestedScale = boundedNumber(args.scale, 1, 0.1, 2, 'scale')
    let liveCaptureError = 'no_visible_editor_on_target_page'
    const presence = await this.store.readPresence()
    if (
      presence?.workspaceId === head.identity.workspaceId &&
      presence.contentDocumentId === head.identity.documentId &&
      presence.pageId === page.id
    ) {
      const intent = await this.store.queueScreenshotIntent({
        contentDocumentId: head.identity.documentId,
        objectIds,
        pageId: page.id,
        workspaceId: head.identity.workspaceId
      })
      const live = await this.store.waitForScreenshotResult(intent.requestId, 5_000)
      if (live?.status === 'completed' && live.base64 && live.bounds && live.mimeType) {
        return {
          ok: true,
          result: {
            base64: live.base64,
            bounds: live.bounds,
            byteLength: live.byteLength,
            capture_scope: 'live_board',
            live_runtime_captured: true,
            mimeType: live.mimeType,
            objectIds: live.objectIds,
            pixelHeight: live.pixelHeight,
            pixelWidth: live.pixelWidth,
            scale: Math.min(
              (live.pixelWidth ?? 1) / live.bounds.width,
              (live.pixelHeight ?? 1) / live.bounds.height
            )
          },
          target: targetResult(head, page)
        }
      }
      liveCaptureError = live?.error ?? 'visible_editor_did_not_answer'
    }
    const result = await renderAuthorityBoardScreenshot(
      document,
      page.id,
      objectIds,
      requestedScale
    )
    return {
      ok: true,
      result: { ...result, live_capture_error: liveCaptureError },
      target: targetResult(head, page)
    }
  }

  private async traceGesture(args: JsonRecord) {
    const persisted = await this.store.traceGesture({
      gestureId: optionalString(args, 'gesture_id'),
      includeImage: args.include_image === true,
      latest: args.latest === true
    })
    if (persisted.status !== 'matched' || args.raw === true) {
      return { ok: true, result: persisted }
    }
    const head = await this.store.head()
    return {
      ok: true,
      result: {
        gesture: compactTraceGesture(persisted.gesture, head),
        scanned: persisted.scanned,
        status: persisted.status
      }
    }
  }

  private async traceQuery(args: JsonRecord) {
    return { ok: true, result: await queryPersistedTraceHistory(this.store, args) }
  }

  private async traceResolve(args: JsonRecord) {
    return { ok: true, result: await resolvePersistedTraceRequest(this.store, args) }
  }

  private async traceSearch(args: JsonRecord) {
    return { ok: true, result: await searchPersistedTrace(this.store, args) }
  }

  private async open(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const objectIds = optionalStringArray(args, 'object_ids')
    if (objectIds.length > 0) {
      const missing = objectIds.filter((id) => {
        const node = document.graph.getNode(id)
        return !node || node.type === 'CANVAS' || !document.graph.isDescendant(id, page.id)
      })
      if (missing.length > 0) {
        throw new Error(`Objects are not on Board "${page.name}": ${missing.join(', ')}.`)
      }
    }
    const region = navigationRegionFrom(args)
    const intent = await this.store.queueNavigationIntent({
      contentDocumentId: head.identity.documentId,
      ...(objectIds.length > 0 ? { objectIds } : {}),
      pageId: page.id,
      ...(region ? { region } : {}),
      workspaceId: head.identity.workspaceId
    })
    return {
      ok: true,
      result: {
        action: 'queued',
        active: false,
        content_document_id: head.identity.documentId,
        expires_at: intent.expiresAt,
        intent_id: intent.intentId,
        ...(intent.objectIds ? { object_ids: intent.objectIds } : {}),
        page_id: page.id,
        page_name: page.name,
        ...(intent.region ? { region: intent.region } : {}),
        sequence: intent.sequence,
        status: 'queued_for_editor',
        workspace_id: head.identity.workspaceId
      },
      target: targetResult(head, page)
    }
  }

  private async apply(args: JsonRecord) {
    const { document, head, page } = await this.requireContext(args, { hydrate: false })
    const operations = boardApplyOperations(args)
    const changedIds = new Set<string>()
    const createdIds = new Set<string>()
    const deletedIds = new Set<string>()
    const mermaidPreflight: JsonRecord[] = []
    const preflightIds = new Set<string>()
    const state = {
      changedIds,
      createdIds,
      deletedIds,
      document,
      mermaidPreflight,
      pageId: page.id,
      preflightIds
    }
    for (const [index, operation] of operations.entries()) {
      await applyBoardOperation(state, operation, index)
    }
    const preflight = [
      ...mermaidPreflight,
      ...(await preflightBoardCodeObjects(document, preflightIds))
    ]

    const requestId = optionalString(args, 'request_id') ?? `board-apply:${randomUUID()}`
    const receipt = await this.store.commit({
      document: writeAuthorityBoardDocument(document),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId,
      workspaceId: head.identity.workspaceId
    })
    const nodes = [...changedIds].flatMap((id) => {
      const node = document.graph.getNode(id)
      return node ? [authorityNodeSummary(document.graph, node)] : []
    })
    return {
      ok: true,
      result: {
        applied_revision: receipt.appliedRevision,
        base_revision: receipt.baseRevision,
        changed_ids: [...changedIds],
        content_hash: receipt.contentHash,
        created_ids: [...createdIds],
        deleted_ids: [...deletedIds],
        execution_surface: EXECUTION_SURFACE,
        nodes,
        operations: operations.length,
        preflight,
        request_id: receipt.requestId,
        status: receipt.status,
        verified: preflight.length > 0 ? ['saved_state', 'static_preflight'] : ['saved_state'],
        not_verified: ['live_runtime', 'interaction']
      },
      target: {
        ...targetResult(head, page),
        boardRevision: receipt.appliedRevision
      }
    }
  }

  private async read(args: JsonRecord) {
    const { document, head, page } = await this.requireContext(args)
    const scope = optionalString(args, 'scope') ?? 'selection'
    if (scope === 'selection') {
      return {
        ok: true,
        result: {
          count: 0,
          execution_surface: EXECUTION_SURFACE,
          nodes: [],
          reason: 'no_live_runtime',
          scope,
          status: 'unavailable'
        },
        target: targetResult(head, page)
      }
    }
    if (scope === 'query') {
      const limit = boundedNumber(args.limit, DEFAULT_PAGE_LIMIT, 1, 100, 'limit')
      const projection = authorityBoardReadProjection(args.projection)
      const query = parseAuthorityBoardReadQuery(args.query)
      const sort = authorityBoardReadSort(args.sort)
      const tokenBudget = authorityBoardReadTokenBudget(args.token_budget)
      const queryIndex = this.queryIndexFor(head, document, page.id)
      const result = queryAuthorityBoard(
        queryIndex.index.graph,
        page.id,
        {
          limit,
          projection,
          query,
          sort,
          tokenBudget
        },
        queryIndex.index
      )
      return {
        ok: true,
        result: {
          completeness: result.truncated ? 'truncated' : 'complete',
          count: result.matchedCount,
          estimated_payload_tokens: result.estimatedPayloadTokens,
          execution_surface: EXECUTION_SURFACE,
          index_candidates: result.candidateCount,
          index_nodes: result.indexedNodeCount,
          index_revision: head.revision,
          index_scanned: result.scannedCount,
          index_status: queryIndex.status,
          limit,
          nodes: result.nodes,
          projection,
          query,
          returned: result.nodes.length,
          scope,
          sort,
          status: result.matchedCount === 0 ? 'empty' : 'matched',
          token_budget: result.tokenBudget,
          truncated: result.truncated,
          ...(result.truncationReason ? { truncation_reason: result.truncationReason } : {})
        },
        target: targetResult(head, page)
      }
    }
    if (scope !== 'page' && scope !== 'objects') {
      throw new Error('board_read scope must be selection, page, objects, or query.')
    }
    const limit = boundedNumber(args.limit, DEFAULT_PAGE_LIMIT, 1, 100, 'limit')
    const objectIds = scope === 'objects' ? requestedObjectIds(args) : undefined
    const candidates = objectIds
      ? objectReadCandidates(document, page.id, objectIds)
      : [...document.graph.getDescendants(page.id)]
    const detail = optionalString(args, 'detail') ?? 'summary'
    if (!['code_object', 'full', 'mermaid', 'summary'].includes(detail)) {
      throw new Error('board_read detail must be summary, full, mermaid, or code_object.')
    }
    const nodes = candidates.slice(0, limit).map((node) => {
      const summary = authorityNodeSummary(document.graph, node)
      if (detail === 'full') return { ...summary, node: structuredClone(node) }
      if (detail === 'code_object') {
        const codeObject = parseCodeObjectDocument(node)
        return { ...summary, ...(codeObject ? { code_object: codeObject } : {}) }
      }
      if (detail === 'mermaid') {
        return { ...summary, mermaid: readAuthorityMermaidSource(document, page.id, node.id) }
      }
      return summary
    })
    return {
      ok: true,
      result: {
        count: candidates.length,
        execution_surface: EXECUTION_SURFACE,
        limit,
        nodes,
        ...(objectIds ? { requested_object_ids: objectIds } : {}),
        returned: nodes.length,
        detail,
        scope,
        status: 'matched',
        truncated: nodes.length < candidates.length
      },
      target: targetResult(head, page)
    }
  }

  private async searchMemory(args: JsonRecord) {
    const head = await this.head()
    const { document, page } = this.validatedTarget(head, args)
    const toolArgs = isRecord(args.args) ? args.args : {}
    const query = requiredString(toolArgs, 'query')
    const limit = boundedNumber(
      toolArgs.limit,
      DEFAULT_CONTEXT_LIMIT,
      1,
      DEFAULT_CONTEXT_LIMIT,
      'limit'
    )
    return {
      ok: true,
      result: {
        ...searchBoardMemory(document.graph, query, {
          currentBoardId: page.id,
          limit
        }),
        execution_surface: EXECUTION_SURFACE,
        index_revision: head.revision,
        status: 'matched'
      },
      target: targetResult(head, page)
    }
  }

  async sendRpc(body: Record<string, unknown>): Promise<unknown> {
    const command = optionalString(body, 'command')
    if (!command) throw new Error('RPC command is required.')
    const args = normalizeAuthorityRpcArgs(body)
    if (command === 'list_documents') return this.listDocuments()
    if (command === 'workspace_search') return this.workspaceSearch(args)
    if (command === 'board_context') return this.context(args)
    if (command === 'board_screenshot') return this.screenshot(args)
    if (command === 'trace_get_gesture') return this.traceGesture(args)
    if (command === 'trace_query') return this.traceQuery(args)
    if (command === 'trace_resolve') return this.traceResolve(args)
    if (command === 'trace_search') return this.traceSearch(args)
    if (command === 'board_open') return this.open(args)
    if (command === 'board_apply') return this.apply(args)
    if (command === 'board_read') return this.read(args)
    if (command === 'tool' && optionalString(args, 'name') === 'search_board_memory') {
      return this.searchMemory(args)
    }
    throw new Error(
      `no_live_runtime: "${command}" requires a live OpenPencil runtime and was not applied.`
    )
  }
}
