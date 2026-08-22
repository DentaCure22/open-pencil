import { afterEach, describe, expect, test } from 'bun:test'

import {
  addContextCommentImageAnnotation,
  closeContextComment,
  contextCommentState,
  openAgentImageComment,
  openContextComment,
  setContextCommentCapture,
  updateContextCommentImageAnnotation
} from '@/app/context-comment'
import {
  contextCommentBoardCapture,
  contextCommentSourceCropBounds
} from '@/app/context-comment/screen-capture'
import type { ContextCommentCaptureSource } from '@/app/context-comment/types'
import type { NarratedTraceEvidence } from '@/app/narrated-trace'

const target = {
  kind: 'board' as const,
  label: 'Page 1',
  path: ['Document', 'Page 1'],
  scope: {
    documentId: 'document-1',
    documentName: 'Document',
    pageId: 'page-1',
    pageName: 'Page 1',
    workspaceId: 'workspace-1'
  },
  stableIds: ['page-1']
}

const source: ContextCommentCaptureSource = {
  canvasBounds: { height: 700, width: 900, x: 250, y: 80 },
  displaySurface: 'browser',
  height: 1_600,
  imageUrl: 'blob:capture-source',
  source: 'display-capture',
  viewport: { panX: 40, panY: 20, zoom: 2 },
  viewportHeight: 800,
  viewportWidth: 1_200,
  width: 2_400
}

function capture(evidenceId: string): NarratedTraceEvidence {
  return {
    annotation: {
      bounds: { height: 100, width: 200, x: 10, y: 20 },
      color: '#3b82f6',
      kind: 'focus',
      points: [],
      strokeWidth: 2
    },
    capturedAtMs: 1,
    cropBounds: { height: 100, width: 200, x: 10, y: 20 },
    evidenceId,
    height: 100,
    mimeType: 'image/png',
    omissions: [],
    source: 'canvas',
    width: 200
  }
}

afterEach(closeContextComment)

describe('context comment screenshot state', () => {
  test('maps a screen crop to display pixels and exact Board page coordinates', () => {
    const screenBounds = { height: 200, width: 300, x: 100, y: 80 }

    expect(contextCommentSourceCropBounds(source, screenBounds)).toEqual({
      height: 400,
      width: 600,
      x: 700,
      y: 320
    })
    expect(contextCommentBoardCapture(source, screenBounds)).toEqual({
      boardBounds: { height: 100, width: 150, x: 30, y: 30 },
      screenBounds,
      viewport: { panX: 40, panY: 20, zoom: 2 }
    })
  })

  test('maps a permissionless Board capture without browser chrome offsets', () => {
    const boardSource: ContextCommentCaptureSource = {
      ...source,
      canvasBounds: { height: 700, width: 900, x: 250, y: 80 },
      displaySurface: 'board',
      height: 1_400,
      source: 'canvas',
      viewportHeight: 700,
      viewportWidth: 900,
      width: 1_800
    }

    expect(
      contextCommentSourceCropBounds(boardSource, { height: 100, width: 150, x: 50, y: 40 })
    ).toEqual({ height: 200, width: 300, x: 100, y: 80 })
  })

  test('normalizes marker positions and keeps their authored order', () => {
    openContextComment(target, 'screenshot')
    setContextCommentCapture(capture('capture-1'))

    const firstId = addContextCommentImageAnnotation({ x: 1.4, y: -0.2 })
    const secondId = addContextCommentImageAnnotation({ x: 0.23, y: 0.788 })
    if (!firstId || !secondId) throw new Error('Screenshot annotations were not created')
    updateContextCommentImageAnnotation(firstId, 'remove this tag')
    updateContextCommentImageAnnotation(secondId, 'this should be shorter')

    expect(contextCommentState.draft?.annotations).toEqual([
      { comment: 'remove this tag', id: firstId, x: 1, y: 0 },
      { comment: 'this should be shorter', id: secondId, x: 0.23, y: 0.788 }
    ])
  })

  test('keeps comments while resizing and clears them only after a replacement capture', () => {
    openContextComment(target, 'screenshot')
    setContextCommentCapture(capture('capture-1'))
    addContextCommentImageAnnotation({ x: 0.5, y: 0.5 })

    expect(contextCommentState.draft?.annotations).toHaveLength(1)
    expect(contextCommentState.draft?.capture?.evidenceId).toBe('capture-1')

    setContextCommentCapture(capture('capture-2'))

    expect(contextCommentState.draft?.annotations).toEqual([])
    expect(contextCommentState.draft?.capture?.evidenceId).toBe('capture-2')
  })

  test('opens generated images against their existing conversation', () => {
    openAgentImageComment(capture('generated-image'), {
      action: 'steer',
      kind: 'agent-conversation',
      modelScope: 'task:thread-1',
      threadId: 'thread-1'
    })

    expect(contextCommentState.draft?.capture?.evidenceId).toBe('generated-image')
    expect(contextCommentState.draft?.destination).toEqual({
      action: 'steer',
      kind: 'agent-conversation',
      modelScope: 'task:thread-1',
      threadId: 'thread-1'
    })
    expect(contextCommentState.draft?.target).toBeNull()
  })
})
