import { computed, ref, shallowRef } from 'vue'

import { copyLiveInspectorDraftMap, liveInspectorDraftMapsEqual } from './draft-policy'
import type { LiveInspectorPatchDraft } from './patch'

const DRAFT_COALESCE_MS = 500
const MAX_DRAFT_UNDO_ENTRIES = 100

type LiveInspectorDraftHistoryEntry = {
  label: string
  nodeId?: string
  snapshot: Map<string, LiveInspectorPatchDraft>
}

export type LiveInspectorDraftMutationOptions = {
  coalesceKey?: string
  label?: string
  nodeId?: string
}

export type LiveInspectorDraftHistoryOptions = {
  now?: () => number
  onReplay: (drafts: ReadonlyMap<string, LiveInspectorPatchDraft>) => void
  selectedNodeId: () => string | null
}

export function createLiveInspectorDraftHistory(options: LiveInspectorDraftHistoryOptions) {
  const drafts = shallowRef<Map<string, LiveInspectorPatchDraft>>(new Map())
  const undoStack = shallowRef<LiveInspectorDraftHistoryEntry[]>([])
  const redoStack = shallowRef<LiveInspectorDraftHistoryEntry[]>([])
  const historyEpoch = ref(0)
  const now = options.now ?? Date.now
  let coalescing: { key: string; updatedAt: number } | null = null
  let transaction: { key: string; recorded: boolean } | null = null

  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)
  const canUndoSelected = computed(
    () => undoStack.value.at(-1)?.nodeId === options.selectedNodeId()
  )
  const canRedoSelected = computed(
    () => redoStack.value.at(-1)?.nodeId === options.selectedNodeId()
  )
  const undoLabel = computed(() => undoStack.value.at(-1)?.label ?? 'live change')
  const redoLabel = computed(() => redoStack.value.at(-1)?.label ?? 'live change')
  const selectedDraft = computed(() => {
    const selectedId = options.selectedNodeId()
    return selectedId ? (drafts.value.get(selectedId) ?? null) : null
  })

  function reset() {
    undoStack.value = []
    redoStack.value = []
    coalescing = null
    transaction = null
  }

  function replace(next: ReadonlyMap<string, LiveInspectorPatchDraft>) {
    drafts.value = copyLiveInspectorDraftMap(new Map(next))
  }

  function commit(
    next: ReadonlyMap<string, LiveInspectorPatchDraft>,
    mutation: LiveInspectorDraftMutationOptions = {}
  ) {
    const nextDrafts = copyLiveInspectorDraftMap(new Map(next))
    if (liveInspectorDraftMapsEqual(drafts.value, nextDrafts)) return false

    const changedAt = now()
    const coalescesWithPrevious = Boolean(
      mutation.coalesceKey &&
      ((transaction?.key === mutation.coalesceKey && transaction.recorded) ||
        (coalescing?.key === mutation.coalesceKey &&
          changedAt - coalescing.updatedAt < DRAFT_COALESCE_MS))
    )
    if (!coalescesWithPrevious) {
      undoStack.value = [
        ...undoStack.value.slice(-(MAX_DRAFT_UNDO_ENTRIES - 1)),
        {
          label: mutation.label ?? 'Edit live layer',
          nodeId: mutation.nodeId,
          snapshot: copyLiveInspectorDraftMap(drafts.value)
        }
      ]
    }
    if (transaction && transaction.key === mutation.coalesceKey) transaction.recorded = true
    coalescing = mutation.coalesceKey ? { key: mutation.coalesceKey, updatedAt: changedAt } : null
    redoStack.value = []
    drafts.value = nextDrafts
    return true
  }

  function apply(snapshot: Map<string, LiveInspectorPatchDraft>) {
    replace(snapshot)
    historyEpoch.value += 1
    options.onReplay(drafts.value)
  }

  function undo() {
    const previous = undoStack.value.at(-1)
    if (!previous) return false
    coalescing = null
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [
      ...redoStack.value,
      {
        label: previous.label,
        nodeId: previous.nodeId,
        snapshot: copyLiveInspectorDraftMap(drafts.value)
      }
    ]
    apply(previous.snapshot)
    return true
  }

  function redo() {
    const next = redoStack.value.at(-1)
    if (!next) return false
    coalescing = null
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [
      ...undoStack.value,
      {
        label: next.label,
        nodeId: next.nodeId,
        snapshot: copyLiveInspectorDraftMap(drafts.value)
      }
    ]
    apply(next.snapshot)
    return true
  }

  function beginTransaction(key: string) {
    transaction = { key, recorded: false }
  }

  function endTransaction(key: string) {
    if (transaction?.key === key) transaction = null
    if (coalescing?.key === key) coalescing = null
  }

  return {
    beginTransaction,
    canRedo,
    canRedoSelected,
    canUndo,
    canUndoSelected,
    commit,
    drafts,
    endTransaction,
    historyEpoch,
    redo,
    redoLabel,
    replace,
    reset,
    selectedDraft,
    undo,
    undoLabel
  }
}
