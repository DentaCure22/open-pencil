import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { createWorkLifecycleState } from '@/app/flow-state'
import { runLiveWorkspaceMutationWithUndo } from '@/app/smylr-live-inspector/history'
import {
  addLiveWorkspaceItemToFlow,
  approveLiveWorkspaceItemForMerge,
  createLiveWorkspaceItemChangeSet,
  liveWorkspaceItems,
  markLiveWorkspaceItemPreferred,
  markLiveWorkspaceChangeSetWorkspaceChecked,
  sendLiveWorkspaceItemToReview,
  startLiveWorkspaceBranch,
  startLiveWorkspaceImplementation,
  verifyLiveWorkspaceImplementation,
  type LiveWorkspaceItem
} from '@/app/smylr-live-inspector/workspace'
import {
  createSmylrProductionWorkspaceGraph,
  ensureSmylrAlternateLiveAppFrame,
  findSmylrAppViewPage,
  smylrLiveAppFrameWorkspaceItemId
} from '@/app/smylr-production/workspace'

function workspaceItem(id: string, status: LiveWorkspaceItem['status'] = 'unmerged') {
  const createdAt = '2026-07-19T20:00:00.000Z'
  return {
    createdAt,
    id,
    kind: 'variant',
    lifecycle: createWorkLifecycleState(status === 'approved' ? 'approved' : 'draft'),
    name: `Alternate ${id}`,
    nodeId: `node-${id}`,
    patch: {
      add: [],
      nodeId: `node-${id}`,
      remove: [],
      source: { componentName: 'DentalChart', filePath: 'src/dental-chart.tsx' }
    },
    route: '/dental-chart',
    status,
    updatedAt: createdAt
  } satisfies LiveWorkspaceItem
}

beforeEach(() => {
  liveWorkspaceItems.value = []
})

afterEach(() => {
  liveWorkspaceItems.value = []
})

describe('Smylr flow-state projections', () => {
  test('adds stable ordered flow lineage without changing work lifecycle', () => {
    liveWorkspaceItems.value = [workspaceItem('alternate-a', 'unmerged')]

    const first = addLiveWorkspaceItemToFlow('alternate-a')
    expect(first).toMatchObject({
      flow: { flowId: 'dental-chart-core-flow', index: 0, transition: 'Continue flow' },
      id: 'alternate-a',
      kind: 'flow',
      status: 'unmerged'
    })

    liveWorkspaceItems.value = [
      ...liveWorkspaceItems.value,
      workspaceItem('alternate-b', 'approved')
    ]
    const second = addLiveWorkspaceItemToFlow('alternate-b')

    expect(second).toMatchObject({
      flow: {
        flowId: 'dental-chart-core-flow',
        index: 1,
        previousId: 'alternate-a',
        transition: 'Continue flow'
      },
      id: 'alternate-b',
      kind: 'flow',
      status: 'approved'
    })
    expect(
      liveWorkspaceItems.value.find((item) => item.id === 'alternate-a')?.flow?.nextIds
    ).toEqual(['alternate-b'])
  })

  test('projects the same alternate identity into Current and Flow views', async () => {
    const graph = createSmylrProductionWorkspaceGraph({ selectedPageId: 'dental-chart' }).graph
    const store = createEditorStore(graph)
    store.setViewportSize(1440, 900)
    const item = {
      ...workspaceItem('alternate-flow'),
      flow: {
        flowId: 'dental-chart-core-flow',
        index: 0,
        transition: 'Continue flow'
      },
      kind: 'flow' as const
    }
    const currentPage = findSmylrAppViewPage(store, item.route, 'current')
    const flowPage = findSmylrAppViewPage(store, item.route, 'flow')
    if (!currentPage || !flowPage) throw new Error('Smylr Current/Flow fixture pages are missing')

    await store.switchPage(currentPage.id)
    const currentProjection = ensureSmylrAlternateLiveAppFrame(store, item)
    if (!currentProjection) throw new Error('Current projection was not created')

    await store.switchPage(flowPage.id)
    const flowProjection = ensureSmylrAlternateLiveAppFrame(store, item)
    if (!flowProjection) throw new Error('Flow projection was not created')

    expect(flowProjection.id).not.toBe(currentProjection.id)
    expect(flowProjection.parentId).toBe(flowPage.id)
    expect(currentProjection.parentId).toBe(currentPage.id)
    expect(smylrLiveAppFrameWorkspaceItemId(currentProjection)).toBe(item.id)
    expect(smylrLiveAppFrameWorkspaceItemId(flowProjection)).toBe(item.id)

    store.dispose()
  })

  test('guards the software-team lifecycle and receipts every accepted transition', () => {
    liveWorkspaceItems.value = [workspaceItem('alternate-lifecycle')]

    expect(sendLiveWorkspaceItemToReview('alternate-lifecycle')).toBeNull()
    expect(startLiveWorkspaceBranch('alternate-lifecycle')?.status).toBe('active')
    expect(sendLiveWorkspaceItemToReview('alternate-lifecycle')?.status).toBe('ready-for-review')
    expect(approveLiveWorkspaceItemForMerge('alternate-lifecycle')).toBe(false)
    expect(markLiveWorkspaceItemPreferred('alternate-lifecycle')).toBe(true)
    expect(
      createLiveWorkspaceItemChangeSet('alternate-lifecycle', ['Match the reviewed Dental Chart'])
    ).not.toBeNull()
    expect(approveLiveWorkspaceItemForMerge('alternate-lifecycle')).toBe(true)
    expect(markLiveWorkspaceChangeSetWorkspaceChecked('alternate-lifecycle')).toBe(true)
    expect(startLiveWorkspaceImplementation('alternate-lifecycle')).toBe(true)
    expect(
      verifyLiveWorkspaceImplementation('alternate-lifecycle', {
        realAppVerified: true,
        sourcePatchId: 'patch-flow-state-1',
        testCommand: 'bun test tests/engine/app/smylr/flow-state.test.ts',
        testPassed: true,
        verifiedBy: 'codex'
      })
    ).toBe(true)

    const item = liveWorkspaceItems.value[0]
    expect(item?.lifecycle.status).toBe('verified')
    expect(item?.status).toBe('verified')
    expect(item?.lifecycle.history.map((receipt) => receipt.action)).toEqual([
      'start-branch',
      'request-review',
      'mark-preferred',
      'create-change-set',
      'approve',
      'start-implementation',
      'verify'
    ])
    expect(item?.changeSet?.verificationStatus).toBe('source-verified')
  })

  test('participates in the editor undo stack without losing earlier receipts', () => {
    const store = createEditorStore()
    liveWorkspaceItems.value = [workspaceItem('alternate-undo')]

    const branch = runLiveWorkspaceMutationWithUndo(store, 'Start isolated branch', () =>
      startLiveWorkspaceBranch('alternate-undo')
    )
    expect(branch?.status).toBe('active')
    expect(liveWorkspaceItems.value[0]?.lifecycle.history).toHaveLength(1)
    expect(store.undo.canUndo).toBe(true)

    store.undoAction()
    expect(liveWorkspaceItems.value[0]?.branch).toBeUndefined()
    expect(liveWorkspaceItems.value[0]?.lifecycle.status).toBe('draft')
    expect(liveWorkspaceItems.value[0]?.lifecycle.history).toEqual([])

    store.redoAction()
    expect(liveWorkspaceItems.value[0]?.branch?.status).toBe('active')
    expect(liveWorkspaceItems.value[0]?.lifecycle.history[0]?.action).toBe('start-branch')
    store.dispose()
  })
})
