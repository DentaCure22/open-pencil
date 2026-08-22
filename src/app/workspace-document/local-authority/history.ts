import type { EditorStore } from '@/app/editor/session'

import type { LocalWorkspaceAuthorityHead } from './client'

const BOARD_PLAN_RECEIPT_KEY_PREFIX = 'authority-board-plan-request:'
const BOARD_PLAN_RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
export const DURABLE_HISTORY_LABEL = 'Agent Board transaction'

type AppliedBoardTransaction = {
  appliedRevision: number
  pageId: string
  requestId: string
}

export type LocalWorkspaceAuthorityTransactionRevert = {
  head: LocalWorkspaceAuthorityHead
  pageId: string
  requestId: string
  transactionId: string
}

export type LocalWorkspaceAuthorityHistoryBridgeOptions = {
  onError(error: unknown): void
  revertTransaction(input: LocalWorkspaceAuthorityTransactionRevert): Promise<void>
  store: EditorStore
  synchronize(): Promise<boolean>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseBoardTransaction(value: string): AppliedBoardTransaction | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (
    parsed.route !== 'board_build:plan/v1' ||
    parsed.version !== 1 ||
    typeof parsed.appliedRevision !== 'number' ||
    typeof parsed.pageId !== 'string' ||
    typeof parsed.requestId !== 'string'
  ) {
    return null
  }
  return {
    appliedRevision: parsed.appliedRevision,
    pageId: parsed.pageId,
    requestId: parsed.requestId
  }
}

export function latestAppliedBoardTransaction(
  store: EditorStore,
  authorityRevision: number
): AppliedBoardTransaction | null {
  const transactions = store.graph.getPages(true).flatMap((page) =>
    page.pluginData.flatMap((entry) => {
      if (
        entry.pluginId !== BOARD_PLAN_RECEIPT_PLUGIN_ID ||
        !entry.key.startsWith(BOARD_PLAN_RECEIPT_KEY_PREFIX)
      ) {
        return []
      }
      const transaction = parseBoardTransaction(entry.value)
      return transaction &&
        transaction.pageId === page.id &&
        transaction.appliedRevision <= authorityRevision
        ? [transaction]
        : []
    })
  )
  if (transactions.length === 0) return null
  const latestRevision = Math.max(...transactions.map(({ appliedRevision }) => appliedRevision))
  const latest = transactions.filter(({ appliedRevision }) => appliedRevision === latestRevision)
  return latest.length === 1 ? (latest.at(0) ?? null) : null
}

export function createLocalWorkspaceAuthorityHistoryBridge(
  options: LocalWorkspaceAuthorityHistoryBridgeOptions
) {
  type Placement = 'redo' | 'undo'
  type PendingAction = { nextPlacement: Placement; requestId: string }

  let currentHead: LocalWorkspaceAuthorityHead | null = null
  let currentTransaction: AppliedBoardTransaction | null = null
  let inFlight: Promise<void> | null = null
  let pending: PendingAction | null = null
  let placement: Placement | null = null

  const historyEntry = {
    forward: () => undefined,
    inverse: () => undefined,
    label: DURABLE_HISTORY_LABEL
  }

  function install(nextPlacement: Placement): void {
    options.store.undo.push(historyEntry)
    if (nextPlacement === 'redo') options.store.undo.undo()
  }

  function applyHead(head: LocalWorkspaceAuthorityHead): void {
    currentHead = head
    const transaction = latestAppliedBoardTransaction(options.store, head.revision)
    const nextPlacement =
      transaction && pending?.requestId === transaction.requestId ? pending.nextPlacement : 'undo'

    pending = null
    placement = transaction ? nextPlacement : null
    currentTransaction = transaction
    options.store.undo.clear()
    if (transaction) install(nextPlacement)
  }

  function rollback(action: Placement): void {
    if (action === 'undo' && options.store.undo.redoLabel === DURABLE_HISTORY_LABEL) {
      options.store.undo.redo()
    } else if (action === 'redo' && options.store.undo.undoLabel === DURABLE_HISTORY_LABEL) {
      options.store.undo.undo()
    }
  }

  function start(action: Placement): void {
    const head = currentHead
    const transaction = currentTransaction
    if (!head || !transaction || inFlight) return

    const requestId = `editor-history-${action}-${crypto.randomUUID()}`
    pending = {
      nextPlacement: action === 'undo' ? 'redo' : 'undo',
      requestId
    }

    inFlight = (async () => {
      try {
        await options.revertTransaction({
          head,
          pageId: transaction.pageId,
          requestId,
          transactionId: transaction.requestId
        })
        const synchronized = await options.synchronize()
        if (!synchronized || pending?.requestId === requestId) {
          throw new Error('The reverted authority head was not applied to the editor.')
        }
      } catch (error) {
        if (pending?.requestId === requestId) {
          pending = null
          rollback(action)
        }
        options.onError(error)
      }
    })().finally(() => {
      inFlight = null
    })
  }

  const releaseDelegate = options.store.bindHistoryDelegate({
    redo() {
      if (inFlight) return true
      if (placement !== 'redo' || options.store.undo.redoLabel !== DURABLE_HISTORY_LABEL) {
        return false
      }
      options.store.undo.redo()
      start('redo')
      return true
    },
    undo() {
      if (inFlight) return true
      if (placement !== 'undo' || options.store.undo.undoLabel !== DURABLE_HISTORY_LABEL) {
        return false
      }
      options.store.undo.undo()
      start('undo')
      return true
    }
  })

  return {
    applyHead,
    dispose: releaseDelegate,
    async whenIdle(): Promise<void> {
      await inFlight
    }
  }
}
