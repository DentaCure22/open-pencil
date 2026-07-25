import { describe, expect, test } from 'bun:test'

import {
  smylrLiveRuntimeLabelFor,
  smylrLiveRuntimeTargetFor,
  smylrLiveRuntimeUrlFor
} from '@/app/smylr-production/live/runtime-target'

describe('Smylr live runtime targets', () => {
  test('preserves the route and deterministic state for every flow screen', () => {
    const target = smylrLiveRuntimeTargetFor({
      flowNodeKind: 'screen',
      route: '/calendar',
      state: 'calendar'
    })

    expect(target).toEqual({
      isFlowScreen: true,
      route: '/calendar',
      state: 'calendar'
    })
    expect(smylrLiveRuntimeLabelFor(target)).toBe('/calendar · calendar')

    const url = new URL(
      smylrLiveRuntimeUrlFor({
        baseUrl: 'http://localhost:3000',
        openPencilHref: 'http://127.0.0.1:1420/',
        target
      })
    )
    expect(url.pathname).toBe('/calendar')
    expect(url.searchParams.get('smylr-flow-state')).toBe('calendar')
    expect(url.searchParams.get('smylr-openpencil-transport')).toBe('post-message')
  })

  test('does not present an alternate workspace id as a source flow state', () => {
    const target = smylrLiveRuntimeTargetFor({
      route: '/dental-chart',
      state: 'variant-123'
    })

    expect(smylrLiveRuntimeLabelFor(target)).toBe('/dental-chart')
    const url = new URL(
      smylrLiveRuntimeUrlFor({
        baseUrl: 'http://localhost:3000',
        openPencilHref: 'http://127.0.0.1:1420/',
        target
      })
    )
    expect(url.searchParams.get('smylr-flow-state')).toBe('shared-page-runtime')
  })
})
