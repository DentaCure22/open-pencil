import { describe, expect, test } from 'bun:test'

import { createAutomationCodeObjectCreateHandler } from '@/app/automation/bridge/code-object-handler'
import {
  assertSafeCodeObjectSource,
  preflightCodeObjectSource
} from '@/app/automation/bridge/code-object/source'
import { mutationRequestLedgerState } from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { createEditorStore } from '@/app/editor/session'

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

function target(): AutomationTarget {
  const store = createEditorStore()
  const pageId = store.state.currentPageId
  const page = store.graph.getNode(pageId)
  if (!page) throw new Error('Missing Code Object capability test page.')
  return {
    documentId: 'document:code-object-source-capabilities',
    documentName: 'Code Object source capability test',
    pageId,
    pageName: page.name,
    store
  }
}

describe('Code Object source capabilities', () => {
  test('re-exports the non-executing shared static preflight', async () => {
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

  test('rejects an aliased capability before request reservation or Board mutation', async () => {
    const automationTarget = target()
    const anchorId = automationTarget.store.createShape(
      'RECTANGLE',
      100,
      100,
      160,
      120,
      automationTarget.pageId
    )
    automationTarget.store.select([anchorId])
    const revision = automationTarget.store.state.sceneVersion
    const children = [...automationTarget.store.graph.getChildren(automationTarget.pageId)]
    const requestId = 'request:aliased-code-object-capability'

    await expect(
      createAutomationCodeObjectCreateHandler()(automationTarget, {
        anchor_id: anchorId,
        height: 240,
        mutation: { expected_revision: revision, request_id: requestId },
        name: 'Must not exist',
        object_key: 'must-not-exist',
        persist: false,
        placement: {
          clearance: 24,
          preferred_directions: ['right', 'below', 'left', 'above']
        },
        props: {},
        source:
          'const browser = globalThis; export default function Blocked() { return <div>{browser.location}</div> }',
        state: {},
        width: 360,
        zoom: false
      })
    ).rejects.toThrow('blocked ambient capability "globalThis"')

    expect(mutationRequestLedgerState(automationTarget, requestId)).toEqual({ status: 'missing' })
    expect(automationTarget.store.state.sceneVersion).toBe(revision)
    expect(automationTarget.store.graph.getChildren(automationTarget.pageId)).toEqual(children)
  })
})
