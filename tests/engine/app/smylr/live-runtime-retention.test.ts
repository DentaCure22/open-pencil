import { describe, expect, test } from 'bun:test'

import {
  resolveSelectedLiveRuntimeFrameId,
  shouldShowLiveRuntime
} from '@/app/smylr-production/live/runtime-retention'

describe('Smylr live runtime retention', () => {
  test('selecting an alternate claims its runtime before interaction starts', () => {
    expect(
      resolveSelectedLiveRuntimeFrameId({
        activeFrameId: 'alternate-b',
        alternateFrameIds: ['alternate-a', 'alternate-b'],
        hasLiveContainerSelection: false,
        selectedSceneNodeIds: new Set(['alternate-b'])
      })
    ).toBe('alternate-b')
  })

  test('a selected live container keeps its active alternate runtime', () => {
    expect(
      resolveSelectedLiveRuntimeFrameId({
        activeFrameId: 'alternate-a',
        alternateFrameIds: ['alternate-a', 'alternate-b'],
        hasLiveContainerSelection: true,
        selectedSceneNodeIds: new Set()
      })
    ).toBe('alternate-a')
  })

  test('keeps the last interacted Alternate visible after clicking away', () => {
    const runtime = {
      currentPageId: 'page-1',
      frameId: 'alternate-1',
      frameParentId: 'page-1',
      lastInteractedFrameId: 'alternate-1',
      loadedFrameId: 'alternate-1'
    }

    expect(shouldShowLiveRuntime({ ...runtime, ownsInteraction: true })).toBe(true)
    expect(shouldShowLiveRuntime({ ...runtime, ownsInteraction: false })).toBe(true)
  })

  test('hides the retained runtime on another page and restores it when returning', () => {
    const runtime = {
      frameId: 'alternate-1',
      frameParentId: 'page-1',
      lastInteractedFrameId: 'alternate-1',
      loadedFrameId: 'alternate-1',
      ownsInteraction: false
    }

    expect(shouldShowLiveRuntime({ ...runtime, currentPageId: 'page-2' })).toBe(false)
    expect(shouldShowLiveRuntime({ ...runtime, currentPageId: 'page-1' })).toBe(true)
  })

  test('does not show a stale runtime under the wrong Alternate', () => {
    expect(
      shouldShowLiveRuntime({
        currentPageId: 'page-1',
        frameId: 'alternate-2',
        frameParentId: 'page-1',
        lastInteractedFrameId: 'alternate-1',
        loadedFrameId: 'alternate-1',
        ownsInteraction: false
      })
    ).toBe(false)
  })
})
