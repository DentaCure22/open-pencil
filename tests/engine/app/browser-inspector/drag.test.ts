import { describe, expect, test } from 'bun:test'

import {
  BROWSER_CAPTURE_DRAG_TYPE,
  hasBrowserCaptureDrag,
  readBrowserCaptureDrag,
  writeBrowserCaptureDrag
} from '@/app/browser-inspector/drag'

class TestDataTransfer {
  effectAllowed = 'uninitialized'
  private readonly values = new Map<string, string>()

  get types() {
    return [...this.values.keys()]
  }

  getData(type: string) {
    return this.values.get(type) ?? ''
  }

  setData(type: string, value: string) {
    this.values.set(type, value)
  }
}

describe('browser capture drag', () => {
  test('round trips a whole session and a single selection', () => {
    const sessionTransfer = new TestDataTransfer()
    writeBrowserCaptureDrag(
      { dataTransfer: sessionTransfer },
      {
        sessionId: 'session-1'
      }
    )
    expect(hasBrowserCaptureDrag(sessionTransfer)).toBe(true)
    expect(readBrowserCaptureDrag(sessionTransfer)).toEqual({
      sessionId: 'session-1'
    })
    expect(sessionTransfer.effectAllowed).toBe('copy')

    sessionTransfer.setData(
      BROWSER_CAPTURE_DRAG_TYPE,
      JSON.stringify({ selectionId: 'selection-2', sessionId: 'session-1' })
    )
    expect(readBrowserCaptureDrag(sessionTransfer)).toEqual({
      selectionId: 'selection-2',
      sessionId: 'session-1'
    })

    sessionTransfer.setData(
      BROWSER_CAPTURE_DRAG_TYPE,
      JSON.stringify({ recordingId: 'recording-3', sessionId: 'session-1' })
    )
    expect(readBrowserCaptureDrag(sessionTransfer)).toEqual({
      recordingId: 'recording-3',
      sessionId: 'session-1'
    })
  })

  test('rejects malformed and empty capture references', () => {
    const transfer = new TestDataTransfer()
    transfer.setData(BROWSER_CAPTURE_DRAG_TYPE, JSON.stringify({ sessionId: ' ' }))
    expect(readBrowserCaptureDrag(transfer)).toBeNull()
    transfer.setData(
      BROWSER_CAPTURE_DRAG_TYPE,
      JSON.stringify({ selectionId: 12, sessionId: 'session-1' })
    )
    expect(readBrowserCaptureDrag(transfer)).toBeNull()
    transfer.setData(
      BROWSER_CAPTURE_DRAG_TYPE,
      JSON.stringify({
        recordingId: 'recording-1',
        selectionId: 'selection-1',
        sessionId: 'session-1'
      })
    )
    expect(readBrowserCaptureDrag(transfer)).toBeNull()
  })
})
