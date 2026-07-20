import { describe, expect, test } from 'bun:test'

import {
  canonicalSmylrOpenPencilUrlFor,
  smylrFrameBaseUrlFor,
  smylrOpenPencilFrameUrlFor
} from '@/app/smylr-live-inspector/frame-origin'

describe('Smylr live-frame URLs', () => {
  test('routes loopback OpenPencil URLs to the Smylr development server', () => {
    const openPencilHref = 'http://127.0.0.1:1420/?smylr-app='

    expect(canonicalSmylrOpenPencilUrlFor(openPencilHref)).toBe('http://localhost:3000/?smylr-app=')
    expect(smylrFrameBaseUrlFor(openPencilHref)).toBe('http://localhost:3000')
  })

  test('passes the trusted OpenPencil parent origin to cross-origin Smylr frames', () => {
    const href = smylrOpenPencilFrameUrlFor({
      baseUrl: 'http://localhost:3000',
      openPencilHref: 'http://127.0.0.1:1420/?smylr-app=',
      params: {
        'smylr-flow-state': 'shared-page-runtime',
        'smylr-openpencil': '0',
        'smylr-openpencil-parent-origin': 'https://untrusted.example'
      },
      route: '/dental-chart?patient=robert-demo'
    })
    const url = new URL(href)

    expect(url.origin).toBe('http://localhost:3000')
    expect(url.pathname).toBe('/dental-chart')
    expect(url.searchParams.get('patient')).toBe('robert-demo')
    expect(url.searchParams.get('smylr-flow-state')).toBe('shared-page-runtime')
    expect(url.searchParams.get('smylr-openpencil')).toBe('1')
    expect(url.searchParams.get('smylr-openpencil-parent-origin')).toBe('http://127.0.0.1:1420')
  })
})
