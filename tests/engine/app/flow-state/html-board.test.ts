import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import {
  approveHtmlBoardChangeSet,
  createHtmlBoardBranch,
  createHtmlBoardChangeSet,
  createHtmlBoardFrame,
  htmlBoardDocument,
  htmlBoardImplementationRequest,
  markHtmlBoardChangeSetWorkspaceChecked,
  markHtmlBoardPreferred,
  requestHtmlBoardReview,
  upsertHtmlBoardSourceBinding,
  verifyHtmlBoardChangeSet
} from '@/app/html-board/workspace'

describe('HTML board lifecycle receipts', () => {
  test('uses the shared guarded lifecycle through real-app verification', () => {
    const store = createEditorStore()
    store.setViewportSize(1440, 900)
    const production = createHtmlBoardFrame(
      store,
      '<main data-openpencil-artifact-id="flow-proof">Flow proof</main>',
      ''
    )
    const draft = createHtmlBoardBranch(store, production.id)
    if (!draft) throw new Error('HTML board draft was not created')

    expect(htmlBoardDocument(draft).workflow.history?.[0]?.action).toBe('start-draft')
    expect(requestHtmlBoardReview(store, draft.id)).toBe(true)
    expect(markHtmlBoardPreferred(store, draft.id)).toBe(true)
    expect(
      upsertHtmlBoardSourceBinding(store, draft.id, {
        filePath: 'src/components/FlowProof.vue',
        kind: 'component',
        repository: 'OpenPencil',
        route: '/dental-chart',
        selector: '[data-openpencil-artifact-id="flow-proof"]',
        symbol: 'FlowProof'
      })
    ).toBe(true)
    expect(
      createHtmlBoardChangeSet(store, draft.id, ['Keep the reviewed flow proof visible'])
    ).toBe(true)
    expect(approveHtmlBoardChangeSet(store, draft.id)).toBe(true)
    expect(markHtmlBoardChangeSetWorkspaceChecked(store, draft.id)).toBe(true)

    const ready = store.graph.getNode(draft.id)
    if (!ready) throw new Error('HTML board disappeared')
    expect(htmlBoardImplementationRequest(ready).ok).toBe(true)
    expect(
      verifyHtmlBoardChangeSet(store, draft.id, {
        realAppVerified: true,
        sourcePatchId: 'patch-html-flow-proof',
        testCommand: 'bun test tests/engine/app/flow-state/html-board.test.ts',
        testPassed: true,
        verifiedBy: 'codex'
      })
    ).toBe(true)

    const verified = store.graph.getNode(draft.id)
    if (!verified) throw new Error('Verified HTML board disappeared')
    const workflow = htmlBoardDocument(verified).workflow
    expect(workflow.status).toBe('verified')
    expect(workflow.history?.map((receipt) => receipt.action)).toEqual([
      'start-draft',
      'request-review',
      'mark-preferred',
      'create-change-set',
      'approve',
      'start-implementation',
      'verify'
    ])
    expect(workflow.history?.at(-1)?.evidence?.sourcePatchId).toBe('patch-html-flow-proof')
    store.dispose()
  })
})
