import type { SpatialNavigationDirection } from '@/app/editor/spatial-navigation'

import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerRect
} from '../smylr-live-container/types'
import type { LiveInspectorTokenPatch } from './patch'

export const SMYLR_OPENPENCIL_INSPECTOR_MESSAGE = 'SMYLR_OPENPENCIL_INSPECTOR_V1'

export type SmylrOpenPencilInspectorAction =
  | 'board-navigate'
  | 'exit-interact'
  | 'focus-frame'
  | 'hover'
  | 'interaction-start'
  | 'mode'
  | 'ready'
  | 'select'
  | 'snapshot'
  | 'tree'

export type LiveInspectorInteractionMode = 'frame' | 'select' | 'interact'

export type LiveInspectorAuthStatus = 'unknown' | 'authenticated' | 'unavailable'

export type SmylrOpenPencilInspectorMessage = {
  action?: SmylrOpenPencilInspectorAction
  auth?: {
    href?: string
    status?: LiveInspectorAuthStatus
  }
  document?: SmylrLiveContainerDocument
  direction?: SpatialNavigationDirection
  hoveredId?: string
  kind?: string
  mode?: LiveInspectorInteractionMode
  pageFace?: {
    dataUrl: string
    height: number
    mimeType?: string
    width: number
  }
  route?: string
  runtimeInstanceId?: string
  selectedId?: string
  selectedRect?: SmylrLiveContainerRect
}

export type SmylrOpenPencilInspectorCommand = {
  action:
    | 'apply-preview-style'
    | 'clear-preview-style'
    | 'hover-at-point'
    | 'request-tree'
    | 'select-at-point'
    | 'select-node'
    | 'set-runtime-activity'
    | 'set-interaction-mode'
  kind: typeof SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
  mode?: LiveInspectorInteractionMode
  nodeId?: string
  runtimeActivity?: 'active' | 'passive'
  x?: number
  y?: number
  styles?: Record<string, string>
  tokenPatch?: LiveInspectorTokenPatch
}

// Must match the production bridge capture contract. Rejecting a valid deeper
// packet left Layers displaying the last accepted tree (often NoPatientState)
// while the live canvas showed the populated application.
const MAX_INSPECTOR_TREE_DEPTH = 64
const MAX_INSPECTOR_TREE_NODES = 1200
const MAX_INSPECTOR_TREE_CHILDREN = 1200
const MAX_INSPECTOR_STRING_LENGTH = 32_768
const MAX_INSPECTOR_PAGE_FACE_DATA_URL_LENGTH = 5_000_000
const MAX_INSPECTOR_PAGES = 32

const INSPECTOR_MESSAGE_KEYS = {
  'board-navigate': new Set(['action', 'direction', 'kind', 'runtimeInstanceId']),
  'exit-interact': new Set(['action', 'kind', 'runtimeInstanceId']),
  'focus-frame': new Set(['action', 'kind', 'runtimeInstanceId']),
  hover: new Set([
    'action',
    'document',
    'hoveredId',
    'kind',
    'runtimeInstanceId',
    'selectedId',
    'selectedRect'
  ]),
  'interaction-start': new Set(['action', 'kind', 'runtimeInstanceId']),
  mode: new Set(['action', 'kind', 'mode', 'runtimeInstanceId']),
  ready: new Set(['action', 'auth', 'document', 'kind', 'mode', 'route', 'runtimeInstanceId']),
  select: new Set([
    'action',
    'document',
    'hoveredId',
    'kind',
    'runtimeInstanceId',
    'selectedId',
    'selectedRect'
  ]),
  snapshot: new Set(['action', 'kind', 'pageFace', 'runtimeInstanceId']),
  tree: new Set([
    'action',
    'document',
    'hoveredId',
    'kind',
    'runtimeInstanceId',
    'selectedId',
    'selectedRect'
  ])
} satisfies Record<SmylrOpenPencilInspectorAction, Set<string>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key))
}

function isBoundedString(value: unknown, maxLength = MAX_INSPECTOR_STRING_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isOptionalBoundedString(value: unknown, maxLength?: number) {
  return value === undefined || isBoundedString(value, maxLength)
}

function isStringArray(value: unknown, maxItems: number) {
  return (
    Array.isArray(value) &&
    value.length <= maxItems &&
    value.every((item) => isBoundedString(item, 512))
  )
}

function isStringRecord(value: unknown) {
  return (
    isRecord(value) &&
    Object.keys(value).length <= 96 &&
    Object.entries(value).every(
      ([key, item]) => isBoundedString(key, 256) && isBoundedString(item, 4096)
    )
  )
}

function isLiveInspectorInteractionMode(value: unknown): value is LiveInspectorInteractionMode {
  return value === 'frame' || value === 'select' || value === 'interact'
}

function isLiveInspectorAuthStatus(value: unknown): value is LiveInspectorAuthStatus {
  return value === 'unknown' || value === 'authenticated' || value === 'unavailable'
}

function isLiveInspectorAuth(value: unknown) {
  if (value === undefined) return true
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(['href', 'status']))) return false
  return isOptionalBoundedString(value.href, 4096) && isLiveInspectorAuthStatus(value.status)
}

function isLiveContainerRect(value: unknown): value is SmylrLiveContainerRect {
  if (!isRecord(value) || !hasOnlyKeys(value, new Set(['height', 'width', 'x', 'y']))) {
    return false
  }

  return (
    typeof value.height === 'number' &&
    Number.isFinite(value.height) &&
    value.height > 0 &&
    typeof value.width === 'number' &&
    Number.isFinite(value.width) &&
    value.width > 0 &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y)
  )
}

function isLiveContainerOwner(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasOnlyKeys(value, new Set(['componentName', 'filePath', 'lineNumber', 'sourceKind']))) {
    return false
  }

  return (
    isOptionalBoundedString(value.componentName, 256) &&
    isOptionalBoundedString(value.filePath, 2048) &&
    (value.lineNumber === undefined ||
      (typeof value.lineNumber === 'number' &&
        Number.isInteger(value.lineNumber) &&
        value.lineNumber > 0)) &&
    (value.sourceKind === undefined ||
      value.sourceKind === 'debug-source' ||
      value.sourceKind === 'jsx-callsite')
  )
}

function isLiveContainerSource(value: unknown) {
  if (!isRecord(value)) return false
  if (
    !hasOnlyKeys(
      value,
      new Set(['componentName', 'filePath', 'lineNumber', 'ownerPath', 'sourceKind'])
    )
  ) {
    return false
  }

  const { ownerPath, ...owner } = value
  return (
    isLiveContainerOwner(owner) &&
    (ownerPath === undefined ||
      (Array.isArray(ownerPath) && ownerPath.length <= 32 && ownerPath.every(isLiveContainerOwner)))
  )
}

function isLiveTokenProvenance(value: unknown) {
  if (!isRecord(value)) return false
  if (
    !hasOnlyKeys(
      value,
      new Set(['cssProperty', 'cssVariable', 'declaredValue', 'evidence', 'styleValue', 'utility'])
    )
  ) {
    return false
  }

  return (
    isBoundedString(value.cssProperty, 256) &&
    isBoundedString(value.cssVariable, 256) &&
    value.cssVariable.startsWith('--') &&
    isOptionalBoundedString(value.declaredValue, 4096) &&
    (value.evidence === 'class-token' || value.evidence === 'inline-declaration') &&
    isOptionalBoundedString(value.styleValue, 4096) &&
    isOptionalBoundedString(value.utility, 512)
  )
}

function isLiveSemanticToken(value: unknown) {
  if (!isRecord(value)) return false
  if (
    !hasOnlyKeys(
      value,
      new Set([
        'category',
        'cssProperty',
        'cssVariable',
        'label',
        'resolvedValue',
        'sourceFile',
        'styleValue',
        'utilities'
      ])
    )
  ) {
    return false
  }

  return (
    (value.category === 'border' ||
      value.category === 'chart' ||
      value.category === 'radius' ||
      value.category === 'shadow' ||
      value.category === 'spacing' ||
      value.category === 'status' ||
      value.category === 'surface' ||
      value.category === 'text') &&
    isBoundedString(value.cssProperty, 256) &&
    isBoundedString(value.cssVariable, 256) &&
    value.cssVariable.startsWith('--') &&
    isBoundedString(value.label, 512) &&
    isBoundedString(value.resolvedValue, 4096) &&
    isBoundedString(value.sourceFile, 2048) &&
    isOptionalBoundedString(value.styleValue, 4096) &&
    (value.utilities === undefined || isStringArray(value.utilities, 64))
  )
}

type InspectorTreeValidationState = {
  ids: Set<string>
  nodeCount: number
  seen: Set<object>
}

function hasValidLiveContainerNodeFields(value: Record<string, unknown>) {
  return (
    isBoundedString(value.label, 512) &&
    isLiveContainerRect(value.rect) &&
    isOptionalBoundedString(value.className, 4096) &&
    isOptionalBoundedString(value.role, 256) &&
    isOptionalBoundedString(value.tagName, 128) &&
    isOptionalBoundedString(value.text, 4096) &&
    (value.source === undefined || isLiveContainerSource(value.source))
  )
}

function hasValidLiveContainerNodeCollections(value: Record<string, unknown>) {
  const provenance = value.tokenProvenance
  return (
    (value.attrs === undefined || isStringRecord(value.attrs)) &&
    (value.computedStyle === undefined || isStringRecord(value.computedStyle)) &&
    (value.tokenHints === undefined || isStringArray(value.tokenHints, 128)) &&
    (provenance === undefined ||
      (Array.isArray(provenance) &&
        provenance.length <= 128 &&
        provenance.every(isLiveTokenProvenance)))
  )
}

function hasValidLiveContainerChildren(
  value: Record<string, unknown>,
  state: InspectorTreeValidationState,
  depth: number
) {
  if (value.children === undefined) return true
  return (
    Array.isArray(value.children) &&
    value.children.length <= MAX_INSPECTOR_TREE_CHILDREN &&
    value.children.every((child) => isLiveContainerNode(child, state, depth + 1))
  )
}

function isLiveContainerNode(
  value: unknown,
  state: InspectorTreeValidationState,
  depth = 0
): value is SmylrLiveContainerNode {
  if (!isRecord(value) || depth > MAX_INSPECTOR_TREE_DEPTH) return false
  if (state.seen.has(value) || state.nodeCount >= MAX_INSPECTOR_TREE_NODES) return false
  if (
    !hasOnlyKeys(
      value,
      new Set([
        'attrs',
        'children',
        'className',
        'computedStyle',
        'id',
        'label',
        'rect',
        'role',
        'source',
        'tagName',
        'text',
        'tokenHints',
        'tokenProvenance'
      ])
    )
  ) {
    return false
  }

  state.seen.add(value)
  state.nodeCount += 1
  if (!isBoundedString(value.id, 512) || state.ids.has(value.id)) return false
  state.ids.add(value.id)

  if (!hasValidLiveContainerNodeFields(value) || !hasValidLiveContainerNodeCollections(value)) {
    return false
  }
  return hasValidLiveContainerChildren(value, state, depth)
}

function isLiveContainerPageFace(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(['dataUrl', 'height', 'mimeType', 'width']))
  ) {
    return false
  }

  return (
    isBoundedString(value.dataUrl, MAX_INSPECTOR_PAGE_FACE_DATA_URL_LENGTH) &&
    value.dataUrl.startsWith('data:image/') &&
    Number.isFinite(value.height) &&
    Number(value.height) > 0 &&
    Number(value.height) <= 16_384 &&
    (value.mimeType === undefined ||
      value.mimeType === 'image/jpeg' ||
      value.mimeType === 'image/png' ||
      value.mimeType === 'image/webp') &&
    Number.isFinite(value.width) &&
    Number(value.width) > 0 &&
    Number(value.width) <= 16_384
  )
}

function isLiveContainerPage(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, new Set(['id', 'kind', 'pageFace', 'route', 'selectedId', 'title', 'tree']))
  ) {
    return false
  }

  if (
    !isBoundedString(value.id, 512) ||
    (value.kind !== 'production-app' &&
      value.kind !== 'component-assets' &&
      value.kind !== 'selection') ||
    (value.pageFace !== undefined && !isLiveContainerPageFace(value.pageFace)) ||
    !isOptionalBoundedString(value.route, 2048) ||
    !isOptionalBoundedString(value.selectedId, 512) ||
    !isBoundedString(value.title, 512)
  ) {
    return false
  }

  const state: InspectorTreeValidationState = {
    ids: new Set(),
    nodeCount: 0,
    seen: new Set()
  }
  return (
    isLiveContainerNode(value.tree, state) &&
    (value.selectedId === undefined || state.ids.has(value.selectedId))
  )
}

// eslint-disable-next-line complexity -- Keep packet bounds auditable in one validator.
function isLiveContainerDocument(value: unknown): value is SmylrLiveContainerDocument {
  if (!isRecord(value)) return false
  if (
    !hasOnlyKeys(
      value,
      new Set([
        'capturedAt',
        'ownerMapText',
        'pageFace',
        'pages',
        'route',
        'semanticTokenCatalog',
        'selectedId',
        'title',
        'tree'
      ])
    )
  ) {
    return false
  }

  if (
    !isBoundedString(value.capturedAt, 128) ||
    !Number.isFinite(Date.parse(value.capturedAt)) ||
    !isOptionalBoundedString(value.ownerMapText) ||
    (value.pageFace !== undefined && !isLiveContainerPageFace(value.pageFace)) ||
    (value.pages !== undefined &&
      (!Array.isArray(value.pages) ||
        value.pages.length === 0 ||
        value.pages.length > MAX_INSPECTOR_PAGES ||
        !value.pages.every(isLiveContainerPage))) ||
    !isBoundedString(value.route, 2048) ||
    !isBoundedString(value.selectedId, 512) ||
    !isBoundedString(value.title, 512) ||
    (value.semanticTokenCatalog !== undefined &&
      (!Array.isArray(value.semanticTokenCatalog) ||
        value.semanticTokenCatalog.length > 512 ||
        !value.semanticTokenCatalog.every(isLiveSemanticToken)))
  ) {
    return false
  }

  const state: InspectorTreeValidationState = {
    ids: new Set(),
    nodeCount: 0,
    seen: new Set()
  }
  return isLiveContainerNode(value.tree, state) && state.ids.has(value.selectedId)
}

function isInspectorAction(value: unknown): value is SmylrOpenPencilInspectorAction {
  return (
    value === 'board-navigate' ||
    value === 'exit-interact' ||
    value === 'focus-frame' ||
    value === 'hover' ||
    value === 'interaction-start' ||
    value === 'mode' ||
    value === 'ready' ||
    value === 'select' ||
    value === 'snapshot' ||
    value === 'tree'
  )
}

// eslint-disable-next-line complexity -- Protocol actions deliberately validate distinct payloads.
export function isSmylrOpenPencilInspectorMessage(
  value: unknown
): value is SmylrOpenPencilInspectorMessage {
  if (
    !isRecord(value) ||
    value.kind !== SMYLR_OPENPENCIL_INSPECTOR_MESSAGE ||
    !isInspectorAction(value.action) ||
    !hasOnlyKeys(value, INSPECTOR_MESSAGE_KEYS[value.action])
  ) {
    return false
  }

  if (value.runtimeInstanceId !== undefined && !isBoundedString(value.runtimeInstanceId, 128)) {
    return false
  }
  if (value.action === 'board-navigate') {
    return (
      value.direction === 'up' ||
      value.direction === 'down' ||
      value.direction === 'left' ||
      value.direction === 'right'
    )
  }
  if (
    value.action === 'exit-interact' ||
    value.action === 'focus-frame' ||
    value.action === 'interaction-start'
  ) {
    return true
  }
  if (value.action === 'mode') return isLiveInspectorInteractionMode(value.mode)
  if (value.action === 'snapshot') return isLiveContainerPageFace(value.pageFace)
  if (value.action === 'ready') {
    return (
      isLiveInspectorInteractionMode(value.mode) &&
      isBoundedString(value.route, 2048) &&
      isLiveInspectorAuth(value.auth) &&
      (value.document === undefined || isLiveContainerDocument(value.document))
    )
  }

  if (value.action === 'hover') return isOptionalBoundedString(value.hoveredId, 512)

  if (!isLiveContainerDocument(value.document)) return false
  const optionalSelectionIsValid =
    isOptionalBoundedString(value.hoveredId, 512) &&
    isOptionalBoundedString(value.selectedId, 512) &&
    (value.selectedRect === undefined || isLiveContainerRect(value.selectedRect))
  if (!optionalSelectionIsValid) return false

  if (value.action === 'select') {
    return (
      isBoundedString(value.selectedId, 512) &&
      value.selectedId === value.document.selectedId &&
      isLiveContainerRect(value.selectedRect)
    )
  }
  return true
}
