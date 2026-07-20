import { computed, ref } from 'vue'

import {
  migrateOversizedLocalStorageCacheToIndexedDb,
  readCacheJson,
  readCacheValue,
  removeCacheEntry,
  removeLocalStorageCacheEntry,
  writeCacheJson,
  writeCacheValue
} from '../cache'
import {
  availableWorkLifecycleActions,
  createWorkLifecycleState,
  normalizeWorkLifecycleState,
  transitionWorkLifecycle,
  workLifecycleStatusLabel,
  type TransitionWorkLifecycleInput,
  type WorkLifecycleAction,
  type WorkLifecycleState,
  type WorkLifecycleStatus,
  type WorkLifecycleTransitionResult,
  type WorkLifecycleVerificationEvidence
} from '../flow-state'
import type { LiveInspectorPatchDraft } from './patch'

export type LiveWorkspaceItemKind =
  | 'draft'
  | 'variant'
  | 'flow'
  | 'review'
  | 'change-set'
  | 'archived'

export type LiveWorkspacePreview = {
  capturedAt?: string
  dataUrl?: string
  height?: number
  mimeType?: string
  status: 'queued' | 'rendering' | 'ready' | 'failed'
  width?: number
}

export type LiveWorkspaceBranchStatus = 'not-started' | 'active' | 'ready-for-review' | 'approved'

export type LiveWorkspaceBranch = {
  createdAt?: string
  approvedAt?: string
  name: string
  reviewRequestedAt?: string
  status: LiveWorkspaceBranchStatus
}

export type LiveWorkspaceFlow = {
  flowId: string
  index?: number
  nextIds?: string[]
  previousId?: string
  transition?: string
}

export type LiveWorkspaceChangeSet = {
  acceptanceCriteria: string[]
  sourceItemIds: string[]
  verificationStatus?: 'not-checked' | 'workspace-checked' | 'source-verified'
}

export type LiveWorkspaceChangeSetReadiness = {
  checks: {
    acceptanceCriteriaPresent: boolean
    patchesPresent: boolean
    sourceTargetsResolved: boolean
  }
  passed: boolean
}

export type LiveWorkspaceItem = {
  baseRevision?: string
  branch?: LiveWorkspaceBranch
  createdAt: string
  changeSet?: LiveWorkspaceChangeSet
  flow?: LiveWorkspaceFlow
  id: string
  kind: LiveWorkspaceItemKind
  lifecycle: WorkLifecycleState
  name: string
  nodeId: string
  note?: string
  parentId?: string
  patch: LiveInspectorPatchDraft
  patches?: LiveInspectorPatchDraft[]
  preview?: LiveWorkspacePreview
  route: string
  /** Last Smylr screen visited inside this alternate's leased runtime. */
  runtimeRoute?: string
  status:
    | 'active'
    | 'unmerged'
    | 'preferred'
    | 'change-set'
    | 'in-review'
    | 'approved'
    | 'implementing'
    | 'applied'
    | 'verified'
    | 'archived'
  updatedAt: string
}

export const liveWorkspaceItems = ref<LiveWorkspaceItem[]>([])
export const liveWorkspaceSelectedItemId = ref<string | null>(null)
export const liveWorkspaceReady = ref(false)
export const liveWorkspacePreviewRequest = ref<{ itemId: string; requestedAt: number } | null>(null)

export const liveWorkspaceSelectedItem = computed(
  () =>
    liveWorkspaceItems.value.find((item) => item.id === liveWorkspaceSelectedItemId.value) ?? null
)

const CACHE_KEY = 'smylr-live-workspaces/v1'
const PREVIEW_CACHE_PREFIX = 'smylr-live-workspace-preview/v1/'

function previewCacheKey(itemId: string) {
  return `${PREVIEW_CACHE_PREFIX}${itemId}`
}

function createId(kind: LiveWorkspaceItemKind) {
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneDraft(draft: LiveInspectorPatchDraft) {
  return JSON.parse(JSON.stringify(draft)) as LiveInspectorPatchDraft
}

export function workspaceItemPatches(item: LiveWorkspaceItem) {
  return (item.patches?.length ? item.patches : [item.patch]).map(cloneDraft)
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function branchNameFor(item: LiveWorkspaceItem) {
  const route = item.route.split('?')[0]?.match(/[^/]+$/)?.[0] ?? 'page'
  return `codex/openpencil/${slug(route) || 'page'}/${slug(item.name) || item.id}`
}

function normalizeRuntimeRoute(route: string) {
  try {
    return new URL(route, 'https://smylr.invalid').pathname || '/'
  } catch {
    const pathname = route.split('#', 1)[0]?.split('?', 1)[0]?.trim() ?? ''
    return pathname.startsWith('/') ? pathname : `/${pathname}`
  }
}

function legacyLifecycleStatus(
  item: Pick<LiveWorkspaceItem, 'kind' | 'status'>
): WorkLifecycleStatus {
  if (item.status === 'in-review') return 'in-review'
  if (item.status === 'preferred') return 'preferred'
  if (item.status === 'change-set') return 'change-set'
  if (item.status === 'approved') return 'approved'
  if (item.status === 'implementing') return 'implementing'
  if (item.status === 'applied' || item.status === 'verified') return 'verified'
  if (item.status === 'archived' || item.kind === 'archived') return 'historical'
  if (item.kind === 'review') return 'in-review'
  if (item.kind === 'change-set') return 'change-set'
  return item.kind === 'draft' || item.kind === 'variant' || item.kind === 'flow'
    ? 'draft'
    : 'reference'
}

function normalizedLiveWorkspaceItem(item: LiveWorkspaceItem): LiveWorkspaceItem {
  return {
    ...item,
    lifecycle: normalizeWorkLifecycleState(item.lifecycle, legacyLifecycleStatus(item))
  }
}

function legacyStatusForLifecycle(status: WorkLifecycleStatus): LiveWorkspaceItem['status'] {
  if (status === 'reference') return 'active'
  if (status === 'draft') return 'unmerged'
  if (status === 'historical') return 'archived'
  return status
}

/** Persist metadata only — never put snapshot dataUrls in localStorage. */
function serializeWorkspaceForStorage(items: LiveWorkspaceItem[]): LiveWorkspaceItem[] {
  return items.map((item) => {
    if (!item.preview || item.preview.dataUrl === undefined) return item
    const { dataUrl: _dataUrl, ...previewMeta } = item.preview
    return { ...item, preview: previewMeta }
  })
}

function isLiveWorkspaceItem(value: unknown): value is LiveWorkspaceItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LiveWorkspaceItem>
  return Boolean(
    typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.name === 'string' &&
    typeof item.nodeId === 'string' &&
    typeof item.route === 'string' &&
    (item.runtimeRoute === undefined || typeof item.runtimeRoute === 'string') &&
    typeof item.status === 'string' &&
    item.patch &&
    typeof item.patch === 'object'
  )
}

export function liveWorkspaceItemsForSync(): LiveWorkspaceItem[] {
  return JSON.parse(
    JSON.stringify(serializeWorkspaceForStorage(liveWorkspaceItems.value))
  ) as LiveWorkspaceItem[]
}

export function replaceLiveWorkspaceItemsFromSync(value: unknown): boolean {
  if (!Array.isArray(value) || !value.every(isLiveWorkspaceItem)) return false
  const localItems = new Map(liveWorkspaceItems.value.map((item) => [item.id, item]))
  liveWorkspaceItems.value = value.map((item) => {
    const localPreview = localItems.get(item.id)?.preview
    return normalizedLiveWorkspaceItem({
      ...item,
      patch: cloneDraft(item.patch),
      patches: item.patches?.map(cloneDraft),
      preview: item.preview
        ? {
            ...item.preview,
            ...(localPreview?.dataUrl ? { dataUrl: localPreview.dataUrl } : {})
          }
        : localPreview
    })
  })
  if (
    liveWorkspaceSelectedItemId.value &&
    !liveWorkspaceItems.value.some((item) => item.id === liveWorkspaceSelectedItemId.value)
  ) {
    liveWorkspaceSelectedItemId.value = null
  }
  liveWorkspaceReady.value = true
  void persistWorkspace()
  return true
}

async function persistPreviewImage(itemId: string, dataUrl: string | undefined) {
  if (!dataUrl) return
  try {
    await writeCacheValue(previewCacheKey(itemId), dataUrl)
  } catch (error) {
    console.warn(`Workspace preview image cache skipped for "${itemId}":`, error)
  }
}

function coercePreviewDataUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && value.startsWith('data:')) return value
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value?: unknown }).value
    if (typeof inner === 'string' && inner.startsWith('data:')) return inner
  }
  return undefined
}

async function loadPreviewImage(itemId: string): Promise<string | undefined> {
  try {
    return coercePreviewDataUrl(await readCacheValue<unknown>(previewCacheKey(itemId)))
  } catch {
    return undefined
  }
}

async function persistWorkspace() {
  const items = liveWorkspaceItems.value

  // Free any legacy image-bearing localStorage entry before writing slim JSON.
  removeLocalStorageCacheEntry(CACHE_KEY)

  try {
    await writeCacheJson(CACHE_KEY, serializeWorkspaceForStorage(items))
  } catch (error) {
    console.warn('Workspace cache write failed:', error)
  }
}

async function persistWorkspacePreviewUpdate(itemId: string, dataUrl: string | undefined) {
  // Persist only the image carried by this update. Rewriting every previously
  // captured data URL on each status or metadata change forces IndexedDB to
  // clone all decoded previews again and can grow the renderer by gigabytes.
  if (dataUrl) await persistPreviewImage(itemId, dataUrl)
  await persistWorkspace()
}

export async function restoreLiveWorkspace() {
  if (liveWorkspaceReady.value) return

  // Read first while any legacy image-bearing workspace blob still exists.
  const restored = (await readCacheJson<LiveWorkspaceItem[]>(CACHE_KEY)) ?? []
  let migratedInlineImages = false

  liveWorkspaceItems.value = await Promise.all(
    restored.map(async (item) => {
      const normalized = normalizedLiveWorkspaceItem({
        ...item,
        patch: cloneDraft(item.patch),
        patches: item.patches?.map(cloneDraft)
      })

      let dataUrl = normalized.preview?.dataUrl
      if (dataUrl) {
        migratedInlineImages = true
        await persistPreviewImage(normalized.id, dataUrl)
      } else if (normalized.preview?.status === 'ready') {
        dataUrl = await loadPreviewImage(normalized.id)
      }

      const preview = normalized.preview
        ? {
            ...normalized.preview,
            ...(dataUrl ? { dataUrl } : {}),
            // In-flight captures resume as queued after reload.
            ...(normalized.preview.status === 'rendering' ? { status: 'queued' as const } : {})
          }
        : undefined

      return preview ? { ...normalized, preview } : normalized
    })
  )

  liveWorkspaceReady.value = true

  // Migrate leftover image payloads into IndexedDB (never delete without copy).
  await migrateOversizedLocalStorageCacheToIndexedDb()
  if (migratedInlineImages || restored.length > 0) {
    void persistWorkspace()
  }
}

export function workspaceItemsForRoute(route: string | null) {
  if (!route) return []
  return liveWorkspaceItems.value.filter((item) => item.route === route)
}

export function saveLiveWorkspaceItem(input: {
  baseRevision?: string
  branch?: LiveWorkspaceBranch
  changeSet?: LiveWorkspaceChangeSet
  flow?: LiveWorkspaceFlow
  kind: LiveWorkspaceItemKind
  lifecycle?: WorkLifecycleState
  name: string
  nodeId: string
  note?: string
  parentId?: string
  patch: LiveInspectorPatchDraft
  patches?: LiveInspectorPatchDraft[]
  route: string
  runtimeRoute?: string
  status?: LiveWorkspaceItem['status']
}) {
  const now = new Date().toISOString()
  const legacyStatus =
    input.status ??
    (input.kind === 'variant'
      ? 'unmerged'
      : input.kind === 'review'
        ? 'in-review'
        : input.kind === 'archived'
          ? 'archived'
          : 'active')
  const item: LiveWorkspaceItem = normalizedLiveWorkspaceItem({
    ...input,
    id: createId(input.kind),
    lifecycle:
      input.lifecycle ??
      createWorkLifecycleState(legacyLifecycleStatus({ kind: input.kind, status: legacyStatus })),
    patch: cloneDraft(input.patch),
    patches: input.patches?.map(cloneDraft),
    preview: { status: 'queued' },
    runtimeRoute: normalizeRuntimeRoute(input.runtimeRoute ?? input.route),
    status: legacyStatus,
    createdAt: now,
    updatedAt: now
  })
  liveWorkspaceItems.value = [...liveWorkspaceItems.value, item]
  liveWorkspaceSelectedItemId.value = item.id
  void persistWorkspace()
  return item
}

export function snapshotLiveWorkspace(input: {
  baseRevision?: string
  name: string
  nodeId: string
  note?: string
  patches: LiveInspectorPatchDraft[]
  route: string
}) {
  const primaryPatch = input.patches[0] ?? {
    add: [],
    nodeId: input.nodeId,
    note: input.note,
    remove: [],
    styles: {}
  }
  return saveLiveWorkspaceItem({
    baseRevision: input.baseRevision ?? 'production-at-snapshot',
    branch: { name: '', status: 'not-started' },
    kind: 'variant',
    name: input.name,
    nodeId: input.nodeId,
    note: input.note,
    patch: primaryPatch,
    patches: input.patches.length > 0 ? input.patches : [primaryPatch],
    route: input.route,
    status: 'unmerged'
  })
}

export function requestLiveWorkspacePreview(itemId: string) {
  setLiveWorkspaceItemPreview(itemId, { status: 'rendering' })
  liveWorkspacePreviewRequest.value = { itemId, requestedAt: Date.now() }
}

export function setLiveWorkspaceItemPreview(itemId: string, preview: LiveWorkspacePreview) {
  liveWorkspaceItems.value = liveWorkspaceItems.value.map((item) =>
    item.id === itemId
      ? { ...item, preview: { ...item.preview, ...preview }, updatedAt: new Date().toISOString() }
      : item
  )
  void persistWorkspacePreviewUpdate(itemId, preview.dataUrl)
}

export function completeLiveWorkspacePreview(
  itemId: string,
  preview: Omit<LiveWorkspacePreview, 'status'>
) {
  setLiveWorkspaceItemPreview(itemId, {
    ...preview,
    capturedAt: preview.capturedAt ?? new Date().toISOString(),
    status: 'ready'
  })
  if (liveWorkspacePreviewRequest.value?.itemId === itemId) {
    liveWorkspacePreviewRequest.value = null
  }
}

export function failLiveWorkspacePreview(itemId: string) {
  setLiveWorkspaceItemPreview(itemId, { status: 'failed' })
  if (liveWorkspacePreviewRequest.value?.itemId === itemId) {
    liveWorkspacePreviewRequest.value = null
  }
}

export function updateLiveWorkspaceItem(
  id: string,
  changes: Partial<
    Pick<
      LiveWorkspaceItem,
      | 'baseRevision'
      | 'branch'
      | 'changeSet'
      | 'flow'
      | 'kind'
      | 'lifecycle'
      | 'name'
      | 'note'
      | 'runtimeRoute'
      | 'status'
    >
  >
) {
  liveWorkspaceItems.value = liveWorkspaceItems.value.map((item) =>
    item.id === id ? { ...item, ...changes, updatedAt: new Date().toISOString() } : item
  )
  void persistWorkspace()
}

export function liveWorkspaceLifecycle(item: LiveWorkspaceItem): WorkLifecycleState {
  return normalizeWorkLifecycleState(item.lifecycle, legacyLifecycleStatus(item))
}

export function liveWorkspaceLifecycleLabel(item: LiveWorkspaceItem): string {
  return workLifecycleStatusLabel(liveWorkspaceLifecycle(item).status)
}

export function availableLiveWorkspaceLifecycleActions(
  item: LiveWorkspaceItem
): WorkLifecycleAction[] {
  const actions = availableWorkLifecycleActions(liveWorkspaceLifecycle(item))
  return actions.filter((action) => {
    if (action === 'start-branch') {
      return !item.branch || item.branch.status === 'not-started'
    }
    if (action === 'request-review') return item.branch?.status === 'active'
    if (action === 'create-change-set') return workspaceItemPatches(item).length > 0
    if (action === 'approve') {
      return Boolean(
        item.changeSet?.acceptanceCriteria.length && item.branch?.status === 'ready-for-review'
      )
    }
    if (action === 'start-implementation') {
      return item.changeSet?.verificationStatus === 'workspace-checked'
    }
    // Verification is intentionally unavailable without an explicit evidence packet.
    return action !== 'verify'
  })
}

export function transitionLiveWorkspaceLifecycle(
  id: string,
  input: TransitionWorkLifecycleInput
): WorkLifecycleTransitionResult {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item) {
    return {
      ok: false,
      reason: `Workspace item ${id} was not found.`,
      state: createWorkLifecycleState('reference')
    }
  }
  const result = transitionWorkLifecycle(item.id, liveWorkspaceLifecycle(item), input)
  if (!result.ok) return result
  updateLiveWorkspaceItem(id, {
    lifecycle: result.state,
    status: legacyStatusForLifecycle(result.state.status)
  })
  return result
}

/** Save a runtime's last visited screen without churning workspace state on repeated tree packets. */
export function setLiveWorkspaceItemRuntimeRoute(id: string, route: string): boolean {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item) return false
  const runtimeRoute = normalizeRuntimeRoute(route)
  if (item.runtimeRoute === runtimeRoute) return false
  updateLiveWorkspaceItem(id, { runtimeRoute })
  return true
}

export function addLiveWorkspaceItemToFlow(id: string) {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item || item.status === 'archived') return null
  if (item.flow) return item

  const flowId = `${slug(normalizeRuntimeRoute(item.route)) || 'app'}-core-flow`
  const flowItems = liveWorkspaceItems.value
    .filter(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.status !== 'archived' &&
        candidate.flow?.flowId === flowId
    )
    .toSorted((left, right) => (left.flow?.index ?? 0) - (right.flow?.index ?? 0))
  const previous = flowItems.at(-1)
  const flow: LiveWorkspaceFlow = {
    flowId,
    index: (previous?.flow?.index ?? -1) + 1,
    previousId: previous?.id,
    transition: 'Continue flow'
  }
  const now = new Date().toISOString()

  liveWorkspaceItems.value = liveWorkspaceItems.value.map((candidate) => {
    if (candidate.id === previous?.id && candidate.flow) {
      return {
        ...candidate,
        flow: {
          ...candidate.flow,
          nextIds: [...new Set([...(candidate.flow.nextIds ?? []), item.id])]
        },
        updatedAt: now
      }
    }
    if (candidate.id !== item.id) return candidate
    return {
      ...candidate,
      flow,
      kind: 'flow',
      // Flow position and work lifecycle are independent. Moving an item into
      // a journey must not silently promote or downgrade its review status.
      status: candidate.status,
      updatedAt: now
    }
  })
  void persistWorkspace()
  return liveWorkspaceItems.value.find((candidate) => candidate.id === item.id) ?? null
}

export function startLiveWorkspaceBranch(id: string) {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item || (item.branch && item.branch.status !== 'not-started')) return null
  const now = new Date().toISOString()
  const transition = transitionLiveWorkspaceLifecycle(id, {
    action: 'start-branch',
    now
  })
  if (!transition.ok) return null
  const branch: LiveWorkspaceBranch = {
    createdAt: item.branch?.createdAt ?? now,
    name: item.branch?.name || branchNameFor(item),
    status: 'active'
  }
  updateLiveWorkspaceItem(id, { branch })
  return branch
}

export function sendLiveWorkspaceItemToReview(id: string) {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item || item.branch?.status !== 'active') return null
  const now = new Date().toISOString()
  const transition = transitionLiveWorkspaceLifecycle(id, {
    action: 'request-review',
    now
  })
  if (!transition.ok) return null
  const branch: LiveWorkspaceBranch = {
    createdAt: item.branch?.createdAt ?? now,
    name: item.branch?.name || branchNameFor(item),
    reviewRequestedAt: now,
    status: 'ready-for-review'
  }
  updateLiveWorkspaceItem(id, { branch })
  return branch
}

export function markLiveWorkspaceItemPreferred(id: string): boolean {
  const transition = transitionLiveWorkspaceLifecycle(id, { action: 'mark-preferred' })
  return transition.ok
}

export function requestLiveWorkspaceItemChanges(id: string): boolean {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item) return false
  const transition = transitionLiveWorkspaceLifecycle(id, { action: 'request-changes' })
  if (!transition.ok) return false
  updateLiveWorkspaceItem(id, {
    branch: item.branch ? { ...item.branch, status: 'active' } : item.branch,
    changeSet: undefined,
    kind: item.flow ? 'flow' : 'variant'
  })
  return true
}

export function createLiveWorkspaceItemChangeSet(
  id: string,
  acceptanceCriteria: string[]
): LiveWorkspaceChangeSet | null {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item) return null
  const criteria = [...new Set(acceptanceCriteria.map((value) => value.trim()).filter(Boolean))]
  if (criteria.length === 0 || workspaceItemPatches(item).length === 0) return null
  const transition = transitionLiveWorkspaceLifecycle(id, { action: 'create-change-set' })
  if (!transition.ok) return null
  const changeSet: LiveWorkspaceChangeSet = {
    acceptanceCriteria: criteria,
    sourceItemIds: [item.id],
    verificationStatus: 'not-checked'
  }
  updateLiveWorkspaceItem(id, { changeSet })
  return changeSet
}

export function approveLiveWorkspaceItemForMerge(id: string) {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (
    !item?.branch ||
    item.branch.status !== 'ready-for-review' ||
    !item.changeSet?.acceptanceCriteria.length
  ) {
    return false
  }
  const now = new Date().toISOString()
  const transition = transitionLiveWorkspaceLifecycle(id, { action: 'approve', now })
  if (!transition.ok) return false
  updateLiveWorkspaceItem(id, {
    branch: { ...item.branch, approvedAt: now, status: 'approved' }
  })
  return true
}

export function startLiveWorkspaceImplementation(id: string): boolean {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (item?.changeSet?.verificationStatus !== 'workspace-checked') return false
  return transitionLiveWorkspaceLifecycle(id, { action: 'start-implementation' }).ok
}

export function checkLiveWorkspaceChangeSetReadiness(
  item: LiveWorkspaceItem
): LiveWorkspaceChangeSetReadiness {
  const patches = workspaceItemPatches(item)
  const checks = {
    acceptanceCriteriaPresent: Boolean(item.changeSet?.acceptanceCriteria.length),
    patchesPresent: patches.length > 0,
    sourceTargetsResolved: patches.every((patch) => Boolean(patch.source?.filePath))
  }
  return { checks, passed: Object.values(checks).every(Boolean) }
}

export function markLiveWorkspaceChangeSetWorkspaceChecked(id: string): boolean {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item?.changeSet) return false
  const readiness = checkLiveWorkspaceChangeSetReadiness(item)
  if (!readiness.passed) return false
  updateLiveWorkspaceItem(id, {
    changeSet: { ...item.changeSet, verificationStatus: 'workspace-checked' }
  })
  return true
}

export function verifyLiveWorkspaceImplementation(
  id: string,
  evidence: WorkLifecycleVerificationEvidence
): boolean {
  const item = liveWorkspaceItems.value.find((candidate) => candidate.id === id)
  if (!item?.changeSet) return false
  const transition = transitionLiveWorkspaceLifecycle(id, { action: 'verify', evidence })
  if (!transition.ok) return false
  updateLiveWorkspaceItem(id, {
    changeSet: { ...item.changeSet, verificationStatus: 'source-verified' }
  })
  return true
}

export function archiveLiveWorkspaceItem(id: string): boolean {
  const transition = transitionLiveWorkspaceLifecycle(id, { action: 'archive' })
  if (!transition.ok) return false
  updateLiveWorkspaceItem(id, { kind: 'archived' })
  return true
}

export function removeLiveWorkspaceItem(id: string) {
  liveWorkspaceItems.value = liveWorkspaceItems.value.filter((item) => item.id !== id)
  if (liveWorkspaceSelectedItemId.value === id) liveWorkspaceSelectedItemId.value = null
  void removeCacheEntry(previewCacheKey(id)).catch(() => undefined)
  void persistWorkspace()
}

export function selectLiveWorkspaceItem(id: string | null) {
  liveWorkspaceSelectedItemId.value = id
}
