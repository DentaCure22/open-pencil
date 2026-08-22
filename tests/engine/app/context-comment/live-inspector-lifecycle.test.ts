import { afterEach, describe, expect, mock, test } from 'bun:test'

import {
  closeContextComment,
  contextCommentState,
  openContextComment,
  reconcileLiveInspectorContextComment
} from '@/app/context-comment'

function openLiveTarget(stableId: string) {
  openContextComment({
    anchorBounds: { height: 600, width: 900, x: 40, y: 30 },
    bounds: { height: 80, width: 120, x: 90, y: 100 },
    frameId: 'frame-1',
    kind: 'live-container',
    label: stableId,
    path: ['Frame', stableId],
    scope: { documentId: 'document-1', pageId: 'page-1' },
    stableIds: [stableId]
  })
}

afterEach(closeContextComment)

describe('live inspector contextual comment lifecycle', () => {
  test('preserves the draft on duplicate selection packets and retargets a new container', () => {
    openLiveTarget('container-a')
    if (contextCommentState.draft) contextCommentState.draft.text = 'Keep this draft'
    const duplicateOpen = mock(() => true)

    expect(
      reconcileLiveInspectorContextComment({
        active: true,
        open: duplicateOpen,
        selectedId: 'container-a'
      })
    ).toBe(true)
    expect(duplicateOpen).not.toHaveBeenCalled()
    expect(contextCommentState.draft?.text).toBe('Keep this draft')

    const retargetOpen = mock(() => {
      openLiveTarget('container-b')
      return true
    })
    expect(
      reconcileLiveInspectorContextComment({
        active: true,
        open: retargetOpen,
        selectedId: 'container-b'
      })
    ).toBe(true)
    expect(retargetOpen).toHaveBeenCalledTimes(1)
    expect(contextCommentState.draft?.target.stableIds).toEqual(['container-b'])
  })

  test('closes the live-container draft when Containers mode exits', () => {
    openLiveTarget('container-a')
    expect(
      reconcileLiveInspectorContextComment({
        active: false,
        open: mock(() => true),
        selectedId: 'container-a'
      })
    ).toBe(false)
    expect(contextCommentState.draft).toBeNull()
  })
})
