import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { serializeSmylrProductionDocumentForAuthority } from '@/app/smylr-production/document-state'
import type { LocalWorkspaceAuthorityHead } from '@/app/workspace-document/local-authority/client'
import {
  createLocalWorkspaceAuthorityHistoryBridge,
  latestAppliedBoardTransaction,
  type LocalWorkspaceAuthorityTransactionRevert
} from '@/app/workspace-document/local-authority/history'

function authorityFixture() {
  const store = createEditorStore()
  store.setViewportSize(1200, 800)
  const page = store.graph.getPages()[0]
  if (!page) throw new Error('Expected an authority fixture page')
  store.graph.updateNode(page.id, {
    pluginData: [
      { key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' },
      { key: 'pageId', pluginId: 'smylr-production', value: 'fixture-first' }
    ]
  })

  function addTransaction(requestId: string, appliedRevision: number) {
    const currentPage = store.graph.getNode(page.id)
    if (currentPage?.type !== 'CANVAS') throw new Error('Authority fixture page disappeared')
    store.graph.updateNode(page.id, {
      pluginData: [
        ...currentPage.pluginData,
        {
          key: `authority-board-plan-request:${requestId}`,
          pluginId: 'openpencil.agent-tools',
          value: JSON.stringify({
            appliedRevision,
            pageId: page.id,
            requestId,
            route: 'board_build:plan/v1',
            version: 1
          })
        }
      ]
    })
  }

  function head(revision: number): LocalWorkspaceAuthorityHead {
    const document = serializeSmylrProductionDocumentForAuthority(store)
    if (!document) throw new Error('Expected a serializable authority document')
    return {
      authorityId: 'authority-history-test',
      contentHash: `authority-head-${String(revision)}`,
      document,
      identity: {
        documentId: 'document-history-test',
        documentName: 'OpenPencil Workspace',
        roomId: 'room-history-test',
        schemaVersion: 1,
        workspaceId: 'workspace-history-test'
      },
      revision,
      updatedAt: '2026-08-02T00:00:00.000Z',
      version: 1
    }
  }

  return { addTransaction, head, page, store }
}

describe('local workspace authority editor history bridge', () => {
  test('keeps local Undo first, then delegates durable Board Undo and Redo', async () => {
    const fixture = authorityFixture()
    const reverts: LocalWorkspaceAuthorityTransactionRevert[] = []
    let pending: LocalWorkspaceAuthorityTransactionRevert | null = null
    let revision = 41
    let bridge: ReturnType<typeof createLocalWorkspaceAuthorityHistoryBridge>

    bridge = createLocalWorkspaceAuthorityHistoryBridge({
      onError: (error) => {
        throw error
      },
      revertTransaction: async (input) => {
        reverts.push(input)
        pending = input
      },
      store: fixture.store,
      synchronize: async () => {
        if (!pending) return false
        revision += 1
        fixture.addTransaction(pending.requestId, revision)
        pending = null
        bridge.applyHead(fixture.head(revision))
        return true
      }
    })

    fixture.addTransaction('agent-build-1', revision)
    bridge.applyHead(fixture.head(revision))

    const marker = fixture.store.graph.createNode('RECTANGLE', fixture.page.id, {
      name: 'Before local edit'
    })
    fixture.store.updateNodeWithUndo(marker.id, { name: 'After local edit' }, 'Local rename')

    fixture.store.undoAction()
    expect(fixture.store.graph.getNode(marker.id)?.name).toBe('Before local edit')
    expect(reverts).toHaveLength(0)

    fixture.store.undoAction()
    await bridge.whenIdle()
    expect(reverts[0]?.transactionId).toBe('agent-build-1')
    expect(fixture.store.undo.canRedo).toBe(true)

    const undoRequestId = reverts[0]?.requestId
    fixture.store.redoAction()
    await bridge.whenIdle()
    expect(reverts[1]?.transactionId).toBe(undoRequestId)
    expect(fixture.store.undo.canUndo).toBe(true)

    bridge.dispose()
  })

  test('restores the delegated Undo entry when the durable revert fails', async () => {
    const fixture = authorityFixture()
    const errors: unknown[] = []
    fixture.addTransaction('agent-build-failure', 8)
    const bridge = createLocalWorkspaceAuthorityHistoryBridge({
      onError: (error) => errors.push(error),
      revertTransaction: async () => {
        throw new Error('simulated durable revert rejection')
      },
      store: fixture.store,
      synchronize: async () => false
    })
    bridge.applyHead(fixture.head(8))

    fixture.store.undoAction()
    await bridge.whenIdle()

    expect(errors).toHaveLength(1)
    expect(fixture.store.undo.canUndo).toBe(true)
    expect(fixture.store.undo.canRedo).toBe(false)
    bridge.dispose()
  })

  test('selects only the newest durable Board transaction at the applied head', () => {
    const fixture = authorityFixture()
    fixture.addTransaction('older-agent-build', 3)
    fixture.addTransaction('newer-agent-build', 7)

    expect(latestAppliedBoardTransaction(fixture.store, 6)?.requestId).toBe('older-agent-build')
    expect(latestAppliedBoardTransaction(fixture.store, 7)?.requestId).toBe('newer-agent-build')
  })
})
