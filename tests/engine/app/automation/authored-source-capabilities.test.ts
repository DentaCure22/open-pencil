import { describe, expect, test } from 'bun:test'

import {
  assertSafeCodeObjectSource,
  preflightCodeObjectSource
} from '@open-pencil/core/code-object'

const BLOCKED_SOURCES = [
  ['direct fetch', 'fetch("/private")', 'fetch'],
  ['aliased fetch', 'const send = fetch; send("/private")', 'fetch'],
  ['aliased constructor', 'const Socket = WebSocket; new Socket("wss://example.com")', 'WebSocket'],
  ['destructured global', 'const { fetch: send } = globalThis; send("/private")', 'globalThis'],
  ['computed global', 'window["fetch"]("/private")', 'window'],
  ['optional global', 'document?.querySelector("main")', 'document'],
  ['XHR alias', 'const Request = XMLHttpRequest; new Request()', 'XMLHttpRequest'],
  ['navigator alias', 'const browser = navigator; browser.userAgent', 'navigator'],
  ['dynamic import', 'import("./remote")', 'dynamic import'],
  ['eval alias', 'const execute = eval; execute("1 + 1")', 'eval'],
  ['Function alias', 'const Build = Function; new Build("return 1")', 'Function constructor'],
  ['worker alias', 'const Background = Worker; new Background("worker.js")', 'Worker'],
  ['storage alias', 'const cache = localStorage; cache.getItem("x")', 'localStorage'],
  ['later assignment', 'let send: typeof fetch; send = fetch', 'fetch'],
  ['sequence alias', 'const send = (0, fetch); send("/private")', 'fetch'],
  ['object shorthand', 'const capabilities = { fetch }', 'fetch'],
  ['type assertion', 'const send = fetch as typeof fetch', 'fetch'],
  // oxlint-disable-next-line no-template-curly-in-string -- This is authored source under test.
  ['template interpolation', 'const label = `${fetch}`', 'fetch']
] as const

const ALLOWED_SOURCES = [
  `
    import React from 'react'
    export default function Card({ fetch: label }: { fetch: string }) {
      const navigator = { state: 'ready' }
      return <article data-fetch={label}>{navigator.state}</article>
    }
  `,
  `
    const fetch = (value: string) => value.toUpperCase()
    const settings = { fetch, window: 'compact' }
    export default function LocalHelpers() {
      return <div>{settings.fetch(settings.window)}</div>
    }
  `,
  `
    export default function Words() {
      return <p>{'fetch window document navigator globalThis'}</p>
    }
  `,
  `
    // fetch window document navigator globalThis
    type Labels = { window: string }
    const api = { fetch: 'local label' }
    export default function PropertyNames() {
      return <p>{api.fetch} {'window globalThis'}</p>
    }
  `
]

describe('Code Object source capabilities', () => {
  test('runs the non-executing shared static preflight', async () => {
    await expect(
      preflightCodeObjectSource(
        'export default function SharedPolicy() { return <main>Shared policy</main> }'
      )
    ).resolves.toMatchObject({ execution: 'not_attempted', syntax: 'passed' })
  })

  test('rejects direct, aliased, destructured, computed, and optional ambient access', () => {
    for (const [description, statement, label] of BLOCKED_SOURCES) {
      expect(
        () =>
          assertSafeCodeObjectSource(
            `${statement}; export default function Blocked() { return <div>${description}</div> }`
          ),
        description
      ).toThrow(`blocked ambient capability "${label}"`)
    }
    expect(() =>
      assertSafeCodeObjectSource(
        'const local = 1\nconst send = fetch\nexport default function Blocked() { return <div>{local}</div> }'
      )
    ).toThrow('"fetch" at 2:14')
  })

  test('allows ordinary React source, local helpers, property names, and inert text', () => {
    for (const source of ALLOWED_SOURCES) {
      expect(() => assertSafeCodeObjectSource(source)).not.toThrow()
    }
  })
})
