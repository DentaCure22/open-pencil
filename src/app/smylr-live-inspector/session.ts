/* eslint-disable max-lines -- Security validation, session state, and preview history share one protocol boundary. */
import { computed, ref, shallowRef } from 'vue'

import { IS_BROWSER } from '@/constants'

import { readCacheJson, writeCacheJson } from '../cache'
import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerOwner,
  SmylrLiveContainerRect,
  SmylrLiveContainerSource
} from '../smylr-live-container/types'
import { type LiveInspectorPatchDraft, type LiveInspectorTokenPatch } from './patch'

export const SMYLR_OPENPENCIL_INSPECTOR_MESSAGE = 'SMYLR_OPENPENCIL_INSPECTOR_V1'

export type SmylrOpenPencilInspectorAction =
  | 'exit-interact'
  | 'hover'
  | 'interaction-start'
  | 'mode'
  | 'ready'
  | 'select'
  | 'snapshot'
  | 'tree'

export type LiveInspectorInteractionMode = 'frame' | 'select' | 'interact'
export type LiveInspectorStatus = 'idle' | 'loading' | 'connected' | 'unavailable'
export type LiveInspectorAuthStatus = 'unknown' | 'authenticated' | 'unavailable'

export type SmylrOpenPencilInspectorMessage = {
  action?: SmylrOpenPencilInspectorAction
  auth?: {
    href?: string
    status?: LiveInspectorAuthStatus
  }
  document?: SmylrLiveContainerDocument
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

export type SmylrLiveInspectorFlatNode = {
  childCount: number
  depth: number
  node: SmylrLiveContainerNode
}

export const liveInspectorDocument = ref<SmylrLiveContainerDocument | null>(null)
export const liveInspectorAuthHref = ref<string | null>(null)
export const liveInspectorAuthStatus = ref<LiveInspectorAuthStatus>('unknown')
export const liveInspectorFrameSrc = ref<string | null>(null)
export const liveInspectorHoveredId = ref<string | null>(null)
export const liveInspectorInteractionMode = ref<LiveInspectorInteractionMode>('frame')
export const liveInspectorPatchDrafts = shallowRef<Map<string, LiveInspectorPatchDraft>>(new Map())
type LiveInspectorDraftHistoryEntry = {
  label: string
  nodeId?: string
  snapshot: Map<string, LiveInspectorPatchDraft>
}
const liveInspectorDraftUndoStack = shallowRef<LiveInspectorDraftHistoryEntry[]>([])
const liveInspectorDraftRedoStack = shallowRef<LiveInspectorDraftHistoryEntry[]>([])
export const liveInspectorDraftHistoryEpoch = ref(0)
export const liveInspectorCanUndoDraft = computed(
  () => liveInspectorDraftUndoStack.value.length > 0
)
export const liveInspectorCanRedoDraft = computed(
  () => liveInspectorDraftRedoStack.value.length > 0
)
export const liveInspectorCanUndoSelectedDraft = computed(
  () => liveInspectorDraftUndoStack.value.at(-1)?.nodeId === liveInspectorSelectedId.value
)
export const liveInspectorCanRedoSelectedDraft = computed(
  () => liveInspectorDraftRedoStack.value.at(-1)?.nodeId === liveInspectorSelectedId.value
)
export const liveInspectorUndoDraftLabel = computed(
  () => liveInspectorDraftUndoStack.value.at(-1)?.label ?? 'live change'
)
export const liveInspectorRedoDraftLabel = computed(
  () => liveInspectorDraftRedoStack.value.at(-1)?.label ?? 'live change'
)
export const liveInspectorClipboardHtmlByNode = shallowRef<Map<string, string>>(new Map())
export const liveInspectorPreviewMode = ref(false)
export const liveInspectorActiveFrameId = ref<string | null>(null)
export const liveInspectorPendingSelectedId = ref<string | null>(null)
export const liveInspectorReloadTick = ref(0)
export const liveInspectorRoute = ref<string | null>(null)
export const liveInspectorSelectedId = ref<string | null>(null)
/** Bumps on every live-container claim so re-selecting the same id reclaims native ownership. */
export const liveInspectorSelectionEpoch = ref(0)
export const liveInspectorSelectedRect = ref<SmylrLiveContainerRect | null>(null)
export const liveInspectorStatus = ref<LiveInspectorStatus>('idle')
export const liveInspectorPatchDraft = computed(() => {
  const selectedId = liveInspectorSelectedId.value
  return selectedId ? (liveInspectorPatchDrafts.value.get(selectedId) ?? null) : null
})
export type LiveInspectorDirectCommandDispatcher = (
  command: Omit<SmylrOpenPencilInspectorCommand, 'kind'>
) => boolean
const liveInspectorDirectCommandTarget = shallowRef<{
  dispatch: LiveInspectorDirectCommandDispatcher
  frameId: string
} | null>(null)
const liveInspectorCommandTarget = shallowRef<{
  origin: string
  target: Window
} | null>(null)
let liveInspectorPreviewReturnMode: LiveInspectorInteractionMode = 'select'
let requestedLiveInspectorInteractionMode: LiveInspectorInteractionMode = 'frame'
let restoredDraftRoute: string | null = null
let pendingDraftReplay = false
let pendingRestoredDrafts: LiveInspectorPatchDraft[] = []
let liveInspectorDraftCoalescing: { key: string; updatedAt: number } | null = null
let liveInspectorDraftTransaction: { key: string; recorded: boolean } | null = null
const LAST_DRAFT_CACHE_KEY = 'smylr-live-overrides/current-route'

type CachedLiveInspectorDrafts = {
  entries: Array<[string, LiveInspectorPatchDraft]>
  route: string
}

function draftCacheKey(route: string) {
  return `smylr-live-overrides/${privacySafeRoute(route)}`
}

function setLiveInspectorRoute(route: string | null) {
  if (liveInspectorRoute.value !== route) {
    liveInspectorDraftUndoStack.value = []
    liveInspectorDraftRedoStack.value = []
    liveInspectorDraftCoalescing = null
    liveInspectorDraftTransaction = null
  }
  liveInspectorRoute.value = route
}

function postLiveInspectorPreview(draft: LiveInspectorPatchDraft) {
  return postLiveInspectorCommand({
    action: 'apply-preview-style',
    nodeId: draft.nodeId,
    styles: draft.styles,
    tokenPatch: {
      add: draft.add,
      remove: draft.remove
    }
  })
}

async function persistLiveInspectorDrafts() {
  const route = liveInspectorRoute.value
  if (!route) return
  const entries = [...liveInspectorPatchDrafts.value.entries()]
  // Fountible-style: every accepted draft is durable for the canvas session (no Save gate).
  await Promise.all([
    writeCacheJson(draftCacheKey(route), entries),
    writeCacheJson(LAST_DRAFT_CACHE_KEY, {
      entries,
      route: privacySafeRoute(route)
    } satisfies CachedLiveInspectorDrafts)
  ])
}

async function restoreLiveInspectorDrafts(route: string) {
  if (restoredDraftRoute === route || liveInspectorPatchDrafts.value.size > 0) return
  restoredDraftRoute = route
  let entries = await readCacheJson<Array<[string, LiveInspectorPatchDraft]>>(draftCacheKey(route))
  if (!entries) {
    const fallback = await readCacheJson<CachedLiveInspectorDrafts>(LAST_DRAFT_CACHE_KEY)
    if (fallback?.route === privacySafeRoute(route)) entries = fallback.entries
  }
  if (!entries || liveInspectorPatchDrafts.value.size > 0) return
  pendingRestoredDrafts = entries.map(([, draft]) => copyLiveInspectorPatchDraft(draft))
  const currentDocument = liveInspectorDocument.value
  if (currentDocument && privacySafeRoute(currentDocument.route) === privacySafeRoute(route)) {
    replayRestoredLiveInspectorDrafts(currentDocument)
    return
  }
  pendingDraftReplay = pendingRestoredDrafts.length > 0
  if (pendingDraftReplay) postLiveInspectorCommand({ action: 'request-tree' })
}

function sourceIdentity(source: SmylrLiveContainerSource | undefined) {
  if (!source) return ''
  const ownerPath = (source.ownerPath ?? [])
    .map((owner) =>
      [
        owner.componentName,
        owner.filePath ?? '',
        owner.lineNumber ?? '',
        owner.sourceKind ?? ''
      ].join(':')
    )
    .join('>')
  return [
    source.componentName,
    source.filePath ?? '',
    source.lineNumber ?? '',
    source.sourceKind ?? '',
    ownerPath
  ].join('|')
}

function remapRestoredDraft(draft: LiveInspectorPatchDraft, document: SmylrLiveContainerDocument) {
  if (findLiveInspectorNode(document.tree, draft.nodeId)) return copyLiveInspectorPatchDraft(draft)

  const sourceKey = sourceIdentity(draft.source)
  const sourceMatches: SmylrLiveContainerNode[] = []
  const labelMatches: SmylrLiveContainerNode[] = []
  walkNode(document.tree, (node) => {
    if (sourceKey && sourceIdentity(node.source) === sourceKey) sourceMatches.push(node)
    if (draft.note && node.label === draft.note) labelMatches.push(node)
  })
  let match: SmylrLiveContainerNode | null = null
  if (sourceMatches.length === 1) match = sourceMatches[0] ?? null
  else if (labelMatches.length === 1) match = labelMatches[0] ?? null
  return match
    ? copyLiveInspectorPatchDraft({
        ...draft,
        nodeId: match.id,
        note: match.label,
        source: match.source
      })
    : null
}

function replayRestoredLiveInspectorDrafts(document: SmylrLiveContainerDocument) {
  pendingDraftReplay = false
  const remappedDrafts = pendingRestoredDrafts
    .map((draft) => remapRestoredDraft(draft, document))
    .filter((draft): draft is LiveInspectorPatchDraft => draft !== null)
  pendingRestoredDrafts = []
  liveInspectorPatchDrafts.value = new Map(remappedDrafts.map((draft) => [draft.nodeId, draft]))
  if (remappedDrafts.length > 0) void persistLiveInspectorDrafts()
  for (const draft of remappedDrafts) postLiveInspectorPreview(draft)
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
  'exit-interact': new Set(['action', 'kind', 'runtimeInstanceId']),
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

type ClearLiveInspectorDocumentOptions = {
  preserveDrafts?: boolean
  preserveSelection?: boolean
}

function clearLiveInspectorDocumentState(options: ClearLiveInspectorDocumentOptions = {}) {
  const drafts = options.preserveDrafts
    ? [...liveInspectorPatchDrafts.value.values()].map(copyLiveInspectorPatchDraft)
    : []
  const selectedId = options.preserveSelection ? liveInspectorSelectedId.value : null

  liveInspectorDocument.value = null
  liveInspectorHoveredId.value = null
  if (!options.preserveDrafts) {
    liveInspectorPatchDrafts.value = new Map()
    liveInspectorClipboardHtmlByNode.value = new Map()
  }
  liveInspectorPreviewMode.value = false
  liveInspectorPendingSelectedId.value = selectedId
  liveInspectorSelectedId.value = selectedId
  liveInspectorSelectedRect.value = null
  if (options.preserveDrafts) {
    pendingRestoredDrafts = drafts
    pendingDraftReplay = drafts.length > 0
  } else {
    restoredDraftRoute = null
    pendingDraftReplay = false
    pendingRestoredDrafts = []
  }
}

function walkNode(
  node: SmylrLiveContainerNode,
  visit: (node: SmylrLiveContainerNode, depth: number) => void,
  depth = 0
) {
  visit(node, depth)
  for (const child of node.children ?? []) walkNode(child, visit, depth + 1)
}

export function findLiveInspectorNode(
  node: SmylrLiveContainerNode | undefined,
  id: string | null
): SmylrLiveContainerNode | null {
  if (!node || !id) return null
  if (node.id === id) return node

  for (const child of node.children ?? []) {
    const match = findLiveInspectorNode(child, id)
    if (match) return match
  }

  return null
}

/** Resolve a tree node's parent-relative measurements into frame-local bounds. */
export function findLiveInspectorNodeRect(
  node: SmylrLiveContainerNode | undefined,
  id: string | null,
  offsetX = 0,
  offsetY = 0
): SmylrLiveContainerRect | null {
  if (!node || !id) return null
  const x = offsetX + node.rect.x
  const y = offsetY + node.rect.y
  if (node.id === id) return { height: node.rect.height, width: node.rect.width, x, y }

  for (const child of node.children ?? []) {
    const match = findLiveInspectorNodeRect(child, id, x, y)
    if (match) return match
  }
  return null
}

export const selectedLiveInspectorNode = computed(() =>
  findLiveInspectorNode(liveInspectorDocument.value?.tree, liveInspectorSelectedId.value)
)

export const hoveredLiveInspectorNode = computed(() =>
  findLiveInspectorNode(liveInspectorDocument.value?.tree, liveInspectorHoveredId.value)
)

export const hoveredLiveInspectorRect = computed(() =>
  findLiveInspectorNodeRect(liveInspectorDocument.value?.tree, liveInspectorHoveredId.value)
)

export const liveInspectorFlatNodes = computed<SmylrLiveInspectorFlatNode[]>(() => {
  const root = liveInspectorDocument.value?.tree
  if (!root) return []

  const nodes: SmylrLiveInspectorFlatNode[] = []
  walkNode(root, (node, depth) => {
    nodes.push({
      childCount: node.children?.length ?? 0,
      depth,
      node
    })
  })
  return nodes
})

export type LiveInspectorNavigationDirection = 'child' | 'next' | 'parent' | 'previous'

function findParentLiveInspectorNode(
  node: SmylrLiveContainerNode | undefined,
  childId: string | null,
  parent: SmylrLiveContainerNode | null = null
): SmylrLiveContainerNode | null {
  if (!node || !childId) return null
  if (node.id === childId) return parent

  for (const child of node.children ?? []) {
    const match = findParentLiveInspectorNode(child, childId, node)
    if (match) return match
  }

  return null
}

function currentLiveInspectorSelectedId() {
  return liveInspectorSelectedId.value
}

export function selectAdjacentLiveInspectorNode(direction: LiveInspectorNavigationDirection) {
  const document = liveInspectorDocument.value
  const root = document?.tree
  if (!document || !root) return false

  const selectedId = currentLiveInspectorSelectedId()
  const flatNodes = liveInspectorFlatNodes.value
  if (!selectedId) {
    return selectLiveInspectorNode(root.id)
  }

  const selectedNode = findLiveInspectorNode(root, selectedId) ?? root
  let target: SmylrLiveContainerNode | undefined | null = null

  if (direction === 'child') {
    target = selectedNode.children?.[0] ?? null
  } else if (direction === 'parent') {
    target = findParentLiveInspectorNode(root, selectedId)
  } else {
    const index = flatNodes.findIndex((item) => item.node.id === selectedId)
    const fallbackIndex = flatNodes.findIndex((item) => item.node.id === document.selectedId)
    const currentIndex = index !== -1 ? index : fallbackIndex
    const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1
    target = flatNodes[nextIndex]?.node ?? null
  }

  if (!target || target.id === selectedId) return false
  return selectLiveInspectorNode(target.id)
}

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
      value.category === 'radius' ||
      value.category === 'shadow' ||
      value.category === 'spacing' ||
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
    value === 'exit-interact' ||
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
  if (value.action === 'exit-interact' || value.action === 'interaction-start') return true
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

  if (!isLiveContainerDocument(value.document)) return false
  const optionalSelectionIsValid =
    isOptionalBoundedString(value.hoveredId, 512) &&
    isOptionalBoundedString(value.selectedId, 512) &&
    (value.selectedRect === undefined || isLiveContainerRect(value.selectedRect))
  if (!optionalSelectionIsValid) return false

  // `hoveredId: undefined` is the explicit pointer-leave packet. Accept it so
  // temporary hover chrome clears without disturbing the clicked selection.
  if (value.action === 'hover') return isOptionalBoundedString(value.hoveredId, 512)
  if (value.action === 'select') {
    return (
      isBoundedString(value.selectedId, 512) &&
      value.selectedId === value.document.selectedId &&
      isLiveContainerRect(value.selectedRect)
    )
  }
  return true
}

function receiveLiveInspectorDocument(message: SmylrOpenPencilInspectorMessage) {
  const document = message.document
  if (!document) return
  const selectedId = liveInspectorSelectedId.value
  if (
    liveInspectorDocument.value &&
    message.action !== 'select' &&
    selectedId &&
    !findLiveInspectorNode(document.tree, selectedId)
  ) {
    // MutationObserver tree refreshes can race immediately after a click. Do
    // not replace the authoritative selected document with an unrelated root
    // packet, or the selected id remains set while Design and the overlay lose
    // the node they need to render.
    return
  }
  if (
    liveInspectorDocument.value &&
    message.action !== 'select' &&
    liveInspectorPatchDrafts.value.has(document.selectedId)
  ) {
    return
  }

  liveInspectorDocument.value = document
  liveInspectorStatus.value = 'connected'
  if (liveInspectorAuthStatus.value === 'unknown') {
    liveInspectorAuthStatus.value = 'authenticated'
  }
  setLiveInspectorRoute(document.route)
}

// eslint-disable-next-line complexity -- One reducer preserves ordering across packet action variants.
export function receiveLiveInspectorMessage(message: SmylrOpenPencilInspectorMessage) {
  if (message.auth?.href) liveInspectorAuthHref.value = message.auth.href
  if (message.auth?.status) liveInspectorAuthStatus.value = message.auth.status
  // The parent editor owns the active tool. Accept only the acknowledgement
  // for its latest request so a delayed iframe packet cannot reactivate an
  // earlier mode after the user has moved on.
  if (
    message.action === 'mode' &&
    message.mode &&
    message.mode === requestedLiveInspectorInteractionMode
  ) {
    liveInspectorInteractionMode.value = message.mode
  }
  if (message.route) setLiveInspectorRoute(message.route)
  if (message.route) void restoreLiveInspectorDrafts(message.route)
  if (message.action === 'ready') {
    liveInspectorStatus.value = 'connected'
    if (liveInspectorAuthStatus.value === 'unknown') {
      liveInspectorAuthStatus.value = 'authenticated'
    }
  }
  receiveLiveInspectorDocument(message)
  if (message.document && pendingDraftReplay) {
    replayRestoredLiveInspectorDrafts(message.document)
  }
  const pendingSelection = liveInspectorPendingSelectedId.value
  if (
    message.document &&
    message.action !== 'select' &&
    pendingSelection &&
    findLiveInspectorNode(message.document.tree, pendingSelection)
  ) {
    postLiveInspectorCommand({ action: 'select-node', nodeId: pendingSelection })
  }
  if (message.action === 'hover') {
    liveInspectorHoveredId.value = typeof message.hoveredId === 'string' ? message.hoveredId : null
  }
  if (message.action === 'select' && message.selectedId && message.selectedRect) {
    liveInspectorSelectedId.value = message.selectedId
    liveInspectorSelectedRect.value = message.selectedRect
    liveInspectorPendingSelectedId.value = null
    // Reclaim native Design ownership when iframe selects (including same id).
    liveInspectorSelectionEpoch.value += 1
  } else if (message.selectedId === liveInspectorSelectedId.value && message.selectedRect) {
    liveInspectorSelectedRect.value = message.selectedRect
  }
}

export function markLiveInspectorFrameLoading(src: string) {
  const routeChanged = liveInspectorFrameSrc.value !== src
  if (routeChanged) {
    liveInspectorAuthHref.value = null
    setLiveInspectorRoute(null)
  }
  clearLiveInspectorDocumentState({
    preserveDrafts: !routeChanged,
    preserveSelection: !routeChanged
  })
  liveInspectorFrameSrc.value = src
  liveInspectorStatus.value = 'loading'
  liveInspectorAuthStatus.value = 'unknown'
}

export function markLiveInspectorFrameUnavailable(src: string) {
  if (liveInspectorFrameSrc.value !== src || liveInspectorStatus.value === 'connected') return
  clearLiveInspectorDocumentState({ preserveDrafts: true, preserveSelection: true })
  liveInspectorCommandTarget.value = null
  liveInspectorStatus.value = 'unavailable'
  liveInspectorAuthStatus.value = 'unavailable'
}

export function reloadLiveInspectorFrame() {
  clearLiveInspectorDocumentState({ preserveDrafts: true, preserveSelection: true })
  liveInspectorStatus.value = 'loading'
  liveInspectorAuthStatus.value = 'unknown'
  liveInspectorReloadTick.value += 1
}

export function setLiveInspectorInteractionMode(mode: LiveInspectorInteractionMode) {
  requestedLiveInspectorInteractionMode = mode
  liveInspectorInteractionMode.value = mode
  postLiveInspectorCommand({ action: 'set-interaction-mode', mode })
}

export function setLiveInspectorActiveFrame(frameId: string | null) {
  if (liveInspectorActiveFrameId.value === frameId) return
  // Selection, hover and command routing are frame-local. Keeping these
  // transient values while switching runtimes leaves the previous frame's
  // invisible selection chrome over the new iframe and routes the first
  // command to the old window.
  liveInspectorHoveredId.value = null
  liveInspectorSelectedId.value = null
  liveInspectorSelectedRect.value = null
  liveInspectorPendingSelectedId.value = null
  liveInspectorCommandTarget.value = null
  liveInspectorActiveFrameId.value = frameId
}

export function enterLiveInspectorPreviewMode() {
  if (liveInspectorPreviewMode.value) return
  liveInspectorPreviewReturnMode = liveInspectorInteractionMode.value
  liveInspectorPreviewMode.value = true
  setLiveInspectorInteractionMode('interact')
}

export function exitLiveInspectorPreviewMode() {
  if (!liveInspectorPreviewMode.value) return
  liveInspectorPreviewMode.value = false
  setLiveInspectorInteractionMode(liveInspectorPreviewReturnMode)
}

export function selectLiveInspectorNode(id: string) {
  if (!findLiveInspectorNode(liveInspectorDocument.value?.tree, id)) return false
  if (liveInspectorInteractionMode.value !== 'select') {
    setLiveInspectorInteractionMode('select')
  }
  if (!postLiveInspectorCommand({ action: 'select-node', nodeId: id })) return false
  // Claim the known document node immediately. The iframe confirmation still
  // replaces these values with its authoritative live bounds, while pooled
  // canvases no longer leave Assets/Layers clicks looking unselected during
  // command-target handoff.
  liveInspectorSelectedId.value = id
  liveInspectorSelectedRect.value = findLiveInspectorNodeRect(liveInspectorDocument.value?.tree, id)
  liveInspectorPendingSelectedId.value = id
  // Always reclaim Design ownership even when the live id is unchanged
  // (e.g. user clicked a native copy, then the same live container again).
  liveInspectorSelectionEpoch.value += 1
  return true
}

export function clearLiveInspectorSelection() {
  postLiveInspectorCommand({ action: 'select-node' })
  liveInspectorSelectedId.value = null
  liveInspectorSelectedRect.value = null
  liveInspectorPendingSelectedId.value = null
  liveInspectorHoveredId.value = null
}

/** Force native store to select the live app frame after a live container claim. */
export function claimLiveInspectorNativeOwnership() {
  liveInspectorSelectionEpoch.value += 1
}

function copyLiveInspectorPatchDraft(draft: LiveInspectorPatchDraft): LiveInspectorPatchDraft {
  return {
    add: [...draft.add],
    nodeId: draft.nodeId,
    note: draft.note,
    remove: [...draft.remove],
    source: sanitizedSource(draft.source),
    styles: draft.styles ? { ...draft.styles } : undefined
  }
}

function copyLiveInspectorDraftMap(source = liveInspectorPatchDrafts.value) {
  return new Map([...source].map(([id, draft]) => [id, copyLiveInspectorPatchDraft(draft)]))
}

function draftMapsEqual(
  left: Map<string, LiveInspectorPatchDraft>,
  right: Map<string, LiveInspectorPatchDraft>
) {
  if (left.size !== right.size) return false
  for (const [id, draft] of left) {
    const other = right.get(id)
    if (!other || JSON.stringify(draft) !== JSON.stringify(other)) return false
  }
  return true
}

function recordLiveInspectorDraftMutation(
  next: Map<string, LiveInspectorPatchDraft>,
  coalesceKey?: string,
  label = 'Edit live layer',
  nodeId?: string
) {
  if (draftMapsEqual(liveInspectorPatchDrafts.value, next)) return false
  const now = Date.now()
  const coalescesWithPrevious = Boolean(
    coalesceKey &&
    ((liveInspectorDraftTransaction?.key === coalesceKey &&
      liveInspectorDraftTransaction.recorded) ||
      (liveInspectorDraftCoalescing?.key === coalesceKey &&
        now - liveInspectorDraftCoalescing.updatedAt < 500))
  )
  if (!coalescesWithPrevious) {
    liveInspectorDraftUndoStack.value = [
      ...liveInspectorDraftUndoStack.value.slice(-99),
      { label, nodeId, snapshot: copyLiveInspectorDraftMap() }
    ]
  }
  if (liveInspectorDraftTransaction && liveInspectorDraftTransaction.key === coalesceKey) {
    liveInspectorDraftTransaction.recorded = true
  }
  liveInspectorDraftCoalescing = coalesceKey ? { key: coalesceKey, updatedAt: now } : null
  liveInspectorDraftRedoStack.value = []
  return true
}

function applyLiveInspectorDraftSnapshot(snapshot: Map<string, LiveInspectorPatchDraft>) {
  liveInspectorPatchDrafts.value = copyLiveInspectorDraftMap(snapshot)
  postLiveInspectorCommand({ action: 'clear-preview-style' })
  for (const draft of liveInspectorPatchDrafts.value.values()) postLiveInspectorPreview(draft)
  liveInspectorDraftHistoryEpoch.value += 1
  void persistLiveInspectorDrafts()
}

export function setLiveInspectorPatchDraft(
  draft: LiveInspectorPatchDraft | null,
  options: { coalesceKey?: string; label?: string } = {}
) {
  if (!draft) {
    clearLiveInspectorPatchDraft()
    return
  }
  const drafts = new Map(liveInspectorPatchDrafts.value)
  drafts.set(draft.nodeId, copyLiveInspectorPatchDraft(draft))
  if (!recordLiveInspectorDraftMutation(drafts, options.coalesceKey, options.label, draft.nodeId))
    return
  liveInspectorPatchDrafts.value = drafts
  void persistLiveInspectorDrafts()
}

export function clearLiveInspectorPatchDraft(nodeId = liveInspectorSelectedId.value ?? undefined) {
  if (!nodeId) return
  const drafts = new Map(liveInspectorPatchDrafts.value)
  drafts.delete(nodeId)
  if (!recordLiveInspectorDraftMutation(drafts, undefined, 'Reset live layer', nodeId)) return
  liveInspectorPatchDrafts.value = drafts
  void persistLiveInspectorDrafts()
}

export function clearAllLiveInspectorPatchDrafts() {
  const drafts = new Map<string, LiveInspectorPatchDraft>()
  if (!recordLiveInspectorDraftMutation(drafts)) return
  liveInspectorPatchDrafts.value = drafts
  void persistLiveInspectorDrafts()
}

/**
 * Return the Current frame to its production DOM and keep saved alternates intact.
 * The empty draft set is persisted before the iframe reloads, so reconnecting
 * cannot replay an edit that the user explicitly reset.
 */
export function resetLiveInspectorToProduction() {
  const drafts = new Map<string, LiveInspectorPatchDraft>()
  recordLiveInspectorDraftMutation(drafts, undefined, 'Reset Current to production')
  liveInspectorPatchDrafts.value = drafts
  pendingRestoredDrafts = []
  pendingDraftReplay = false
  void persistLiveInspectorDrafts()
  postLiveInspectorCommand({ action: 'clear-preview-style' })
  reloadLiveInspectorFrame()
}

export function undoLiveInspectorDraft() {
  const previous = liveInspectorDraftUndoStack.value.at(-1)
  if (!previous) return false
  liveInspectorDraftCoalescing = null
  liveInspectorDraftUndoStack.value = liveInspectorDraftUndoStack.value.slice(0, -1)
  liveInspectorDraftRedoStack.value = [
    ...liveInspectorDraftRedoStack.value,
    { label: previous.label, nodeId: previous.nodeId, snapshot: copyLiveInspectorDraftMap() }
  ]
  applyLiveInspectorDraftSnapshot(previous.snapshot)
  return true
}

export function redoLiveInspectorDraft() {
  const next = liveInspectorDraftRedoStack.value.at(-1)
  if (!next) return false
  liveInspectorDraftCoalescing = null
  liveInspectorDraftRedoStack.value = liveInspectorDraftRedoStack.value.slice(0, -1)
  liveInspectorDraftUndoStack.value = [
    ...liveInspectorDraftUndoStack.value,
    { label: next.label, nodeId: next.nodeId, snapshot: copyLiveInspectorDraftMap() }
  ]
  applyLiveInspectorDraftSnapshot(next.snapshot)
  return true
}

export function beginLiveInspectorDraftTransaction(key: string) {
  liveInspectorDraftTransaction = { key, recorded: false }
}

export function endLiveInspectorDraftTransaction(key: string) {
  if (liveInspectorDraftTransaction?.key === key) liveInspectorDraftTransaction = null
  if (liveInspectorDraftCoalescing?.key === key) liveInspectorDraftCoalescing = null
}

export function liveInspectorPatchDraftFor(nodeId: string) {
  return liveInspectorPatchDrafts.value.get(nodeId) ?? null
}

export function setLiveInspectorClipboardHtml(nodeId: string, html: string) {
  const copies = new Map(liveInspectorClipboardHtmlByNode.value)
  copies.set(nodeId, html)
  liveInspectorClipboardHtmlByNode.value = copies
}

export function liveInspectorClipboardHtmlFor(nodeId: string) {
  return liveInspectorClipboardHtmlByNode.value.get(nodeId) ?? null
}

export function previewLiveInspectorDraft(
  draft: LiveInspectorPatchDraft,
  options: { coalesceKey?: string; label?: string } = {}
) {
  setLiveInspectorPatchDraft(draft, options)
  return postLiveInspectorPreview(draft)
}

export function resetLiveInspectorPreview(nodeId?: string) {
  const targetNodeId = nodeId ?? liveInspectorSelectedId.value ?? undefined
  if (targetNodeId) clearLiveInspectorPatchDraft(targetNodeId)
  return postLiveInspectorCommand({ action: 'clear-preview-style', nodeId: targetNodeId })
}

export function setLiveInspectorCommandTarget(target: Window | null, targetOrigin?: string | null) {
  if (!target || !targetOrigin || targetOrigin === '*') {
    liveInspectorCommandTarget.value = null
    return
  }

  try {
    const normalizedOrigin = new URL(targetOrigin).origin
    liveInspectorCommandTarget.value =
      normalizedOrigin === targetOrigin && normalizedOrigin !== 'null'
        ? { origin: normalizedOrigin, target }
        : null
  } catch {
    liveInspectorCommandTarget.value = null
  }
}

export function setLiveInspectorDirectCommandTarget(
  frameId: string,
  dispatch: LiveInspectorDirectCommandDispatcher | null
) {
  if (!dispatch) {
    if (liveInspectorDirectCommandTarget.value?.frameId === frameId) {
      liveInspectorDirectCommandTarget.value = null
    }
    return
  }
  liveInspectorDirectCommandTarget.value = { dispatch, frameId }
}

function mountedLiveInspectorCommandTarget() {
  if (!IS_BROWSER) return null
  const frame = document.querySelector<HTMLIFrameElement>(
    '[data-test-id="smylr-trusted-web-app-frame"]'
  )
  // A flow canvas can keep its pooled runtime active beside the current-page
  // iframe. Only let the mounted current-page iframe override the registered
  // command target when it actually owns the active inspector document.
  if (
    frame &&
    liveInspectorActiveFrameId.value &&
    frame.dataset.liveFrameId !== liveInspectorActiveFrameId.value
  ) {
    return null
  }
  const target = frame?.contentWindow ?? null
  const source = frame?.getAttribute('src')
  const parentHref = window.location.href
  if (!target || !source || !parentHref) return null

  try {
    const origin = new URL(source, parentHref).origin
    return origin === 'null' ? null : { origin, target }
  } catch {
    return null
  }
}

export function postLiveInspectorCommand(command: Omit<SmylrOpenPencilInspectorCommand, 'kind'>) {
  const directTarget = liveInspectorDirectCommandTarget.value
  if (directTarget?.frameId === liveInspectorActiveFrameId.value) {
    try {
      return directTarget.dispatch(command)
    } catch {
      return false
    }
  }
  const mountedTarget = mountedLiveInspectorCommandTarget()
  if (mountedTarget) liveInspectorCommandTarget.value = mountedTarget
  const target = mountedTarget ?? liveInspectorCommandTarget.value
  if (!target) return false

  try {
    const data = {
      ...command,
      kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
    }
    // The production Smylr iframe is deliberately same-origin. Dispatching in
    // that window avoids browser/proxy cases where postMessage is silently
    // dropped, while the iframe's normal source + origin validation still runs.
    if (IS_BROWSER && target.origin === window.location.origin) {
      const directCommand = (
        target.target as Window & {
          __smylrOpenPencilCommand?: (command: typeof data) => void
        }
      ).__smylrOpenPencilCommand
      if (directCommand) directCommand(data)
      else target.target.postMessage(data, target.origin)
    } else {
      target.target.postMessage(data, target.origin)
    }
    return true
  } catch {
    return false
  }
}

function privacySafeRoute(route: string) {
  try {
    return new URL(route, 'https://smylr.invalid').pathname || '/'
  } catch {
    const path = route.split('#', 1)[0]?.split('?', 1)[0]?.trim() ?? ''
    return path.startsWith('/') ? path : `/${path}`
  }
}

function sanitizedOwner(owner: SmylrLiveContainerOwner): SmylrLiveContainerOwner {
  return {
    componentName: owner.componentName,
    filePath: owner.filePath,
    lineNumber: owner.lineNumber,
    sourceKind: owner.sourceKind
  }
}

function sanitizedSource(
  source: SmylrLiveContainerSource | undefined
): SmylrLiveContainerSource | undefined {
  if (!source) return undefined
  const ownerPath = source.ownerPath?.map(sanitizedOwner)
  return {
    ...sanitizedOwner(source),
    ownerPath: ownerPath?.length ? ownerPath : undefined
  }
}
