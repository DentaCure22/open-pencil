import { describe, expect, test } from 'bun:test'

import {
  reconcileTrustedWebAppResidency,
  TRUSTED_WEB_APP_LIVE_RUNTIME_CAP
} from '@/app/code-object/trusted-web-app-runtime'

describe('trusted web app runtime residency', () => {
  test('keeps the active frame plus the most recently used passive frames', () => {
    const resident = reconcileTrustedWebAppResidency({
      activeFrameId: 'frame-e',
      frameIds: ['frame-a', 'frame-b', 'frame-c', 'frame-d', 'frame-e'],
      interactedAtByFrame: {
        'frame-a': 10,
        'frame-b': 40,
        'frame-c': 30,
        'frame-d': 20
      },
      residentFrameIds: new Set(['frame-a', 'frame-b', 'frame-c', 'frame-d'])
    })

    expect(TRUSTED_WEB_APP_LIVE_RUNTIME_CAP).toBe(4)
    expect([...resident]).toEqual(['frame-e', 'frame-b', 'frame-c', 'frame-d'])
  })

  test('keeps existing residents stable when no interaction order exists', () => {
    const resident = reconcileTrustedWebAppResidency({
      activeFrameId: null,
      frameIds: ['frame-a', 'frame-b', 'frame-c', 'frame-d', 'frame-e'],
      interactedAtByFrame: {},
      residentFrameIds: new Set(['frame-b', 'frame-c'])
    })

    expect([...resident]).toEqual(['frame-b', 'frame-c', 'frame-a', 'frame-d'])
  })
})
