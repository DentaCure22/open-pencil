import { describe, expect, test } from 'bun:test'

import {
  canonicalSmylrOpenPencilUrlFor,
  smylrOpenPencilFrameUrlFor
} from '@/app/smylr-live-inspector/frame-origin'

const options = {
  baseUrl: 'http://127.0.0.1:3000',
  openPencilHref: 'http://127.0.0.1:1420/'
}

describe('Smylr trusted frame origin', () => {
  test('preserves the active loopback host for same-site authentication', () => {
    expect(canonicalSmylrOpenPencilUrlFor(options.openPencilHref)).toBe('http://127.0.0.1:3000/')
    expect(canonicalSmylrOpenPencilUrlFor('http://localhost:1420/')).toBe('http://localhost:3000/')
  })

  test('keeps ordinary routes on the registered app origin', () => {
    const url = new URL(
      smylrOpenPencilFrameUrlFor({
        ...options,
        route: '/dental-chart?view=current#patient'
      })
    )

    expect(url.origin).toBe('http://127.0.0.1:3000')
    expect(url.pathname).toBe('/dental-chart')
    expect(url.searchParams.get('view')).toBe('current')
    expect(url.hash).toBe('#patient')
  })

  test('pins stale loopback routes to the registered app origin', () => {
    const url = new URL(
      smylrOpenPencilFrameUrlFor({
        ...options,
        route: '//127.0.0.1:3001/dental-chart'
      })
    )

    expect(url.origin).toBe('http://127.0.0.1:3000')
    expect(url.pathname).toBe('/dental-chart')
  })
})
