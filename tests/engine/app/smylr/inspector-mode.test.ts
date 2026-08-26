import { afterEach, expect, test } from 'bun:test'

import {
  liveInspectorDocument,
  liveInspectorInteractionMode,
  liveInspectorSelectedId,
  receiveLiveInspectorMessage,
  selectAdjacentLiveInspectorNode,
  setLiveInspectorActiveFrame,
  setLiveInspectorDirectCommandTarget,
  setLiveInspectorInteractionMode,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
} from '@/app/smylr-live-inspector/session'

afterEach(() => {
  setLiveInspectorDirectCommandTarget('frame-a', null)
  liveInspectorDocument.value = null
  liveInspectorSelectedId.value = null
  setLiveInspectorActiveFrame(null)
  setLiveInspectorInteractionMode('frame')
})

test('moves live selection from a root to its first child', () => {
  setLiveInspectorActiveFrame('frame-a')
  setLiveInspectorDirectCommandTarget('frame-a', () => true)
  liveInspectorDocument.value = {
    capturedAt: new Date(0).toISOString(),
    route: '/test',
    selectedId: 'live-root',
    title: 'Navigation test',
    tree: {
      children: [
        {
          children: [],
          id: 'live-child',
          label: 'Live child',
          rect: { height: 100, width: 100, x: 0, y: 0 }
        }
      ],
      id: 'live-root',
      label: 'Live root',
      rect: { height: 200, width: 200, x: 0, y: 0 }
    }
  }
  liveInspectorSelectedId.value = 'live-root'
  setLiveInspectorInteractionMode('select')

  expect(selectAdjacentLiveInspectorNode('child')).toBe(true)
  expect(liveInspectorSelectedId.value).toBe('live-child')
})

test('ignores a stale iframe mode acknowledgement after Containers exits', () => {
  setLiveInspectorInteractionMode('select')
  receiveLiveInspectorMessage({
    action: 'mode',
    kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
    mode: 'select'
  })
  expect(liveInspectorInteractionMode.value).toBe('select')

  setLiveInspectorInteractionMode('frame')
  receiveLiveInspectorMessage({
    action: 'mode',
    kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE,
    mode: 'select'
  })

  expect(liveInspectorInteractionMode.value).toBe('frame')
})
