import { afterEach, expect, test } from 'bun:test'

import {
  liveInspectorInteractionMode,
  receiveLiveInspectorMessage,
  setLiveInspectorInteractionMode,
  SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
} from '@/app/smylr-live-inspector/session'

afterEach(() => {
  setLiveInspectorInteractionMode('frame')
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
