import { describe, expect, test } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'
import { createHtmlBoardFrame, htmlBoardSrcdoc } from '@/app/html-board/workspace'

describe('HTML board private observer bridge', () => {
  test('installs before user code and keeps trusted interaction signals on the transferred port', () => {
    const store = createEditorStore()
    const board = createHtmlBoardFrame(
      store,
      '<html><head><script data-board-inline>window.__inlineStarted = true</script></head><body><main><button id="apply">Apply</button></main></body></html>',
      '',
      'window.__openpencilUserScriptStarted = true'
    )
    const srcdoc = htmlBoardSrcdoc(board)
    const bridgeIndex = srcdoc.indexOf('<script data-openpencil-bridge>')
    const inlineScriptIndex = srcdoc.indexOf('<script data-board-inline>')
    const userScriptIndex = srcdoc.indexOf('<script data-openpencil-html-board-js>')
    const privateObserverStart = srcdoc.indexOf('function sendPrivateToHost')
    const privateObserverEnd = srcdoc.indexOf('function handleHostMessage', privateObserverStart)
    const privateObserver = srcdoc.slice(privateObserverStart, privateObserverEnd)

    expect(bridgeIndex).toBeGreaterThanOrEqual(0)
    expect(inlineScriptIndex).toBeGreaterThan(bridgeIndex)
    expect(userScriptIndex).toBeGreaterThan(bridgeIndex)
    expect(srcdoc).toContain("window.addEventListener('message', (event) => {")
    expect(srcdoc).toContain('if (event.source !== parent) return')
    expect(srcdoc).toContain('event.stopImmediatePropagation()')
    expect(srcdoc).toContain("document.addEventListener('pointerdown', (event) =>")
    expect(srcdoc).toContain("document.addEventListener('keydown', (event) =>")
    expect(srcdoc).toContain("document.addEventListener('wheel', (event) =>")
    expect(srcdoc).toContain("action: 'canvas-wheel'")
    expect(srcdoc).toContain('if (!event.ctrlKey && !event.metaKey) return')
    expect(srcdoc).toContain('{ capture: true, passive: false }')
    expect(srcdoc).toContain('}, true)')
    expect(srcdoc).toContain("message.action === 'set-surface-view'")
    expect(srcdoc).toContain("document.querySelectorAll('[data-view]')")
    expect(srcdoc).toContain("document.querySelectorAll('[data-view-target]')")
    const surfaceViewStart = srcdoc.indexOf('function applySurfaceView')
    const surfaceViewEnd = srcdoc.indexOf('function handleHostMessage', surfaceViewStart)
    const surfaceView = srcdoc.slice(surfaceViewStart, surfaceViewEnd)
    expect(surfaceView).toContain("getAttribute('data-view') === rendererViewId")
    expect(surfaceView).toContain("getAttribute('data-view-target') === rendererViewId")
    expect(surfaceView).not.toContain('.click(')
    expect(surfaceView).not.toContain('openpencil:surface-event')

    expect(privateObserver).toContain('if (!hostPort) return')
    expect(privateObserver).toContain('event.isTrusted')
    expect(privateObserver).toContain("mode !== 'interact'")
    expect(privateObserver).toContain("action: 'trusted-interaction'")
    expect(privateObserver).toContain('kind,')
    expect(privateObserver).toContain('occurredAt:')
    expect(privateObserver).toContain('sequence: trustedInteractionSequence')
    expect(privateObserver).not.toContain('parent.postMessage')
    expect(privateObserver).not.toContain('event.key')
    expect(privateObserver).not.toContain('event.target')
    expect(privateObserver).not.toContain('event.clientX')
  })
})
