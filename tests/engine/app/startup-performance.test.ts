import { describe, expect, test } from 'bun:test'

describe('startup and lightweight runtime contracts', () => {
  test('preserves warm PWA caches and browser zoom on normal boots', async () => {
    const [html, main] = await Promise.all([
      Bun.file('index.html').text(),
      Bun.file('src/main.ts').text()
    ])

    expect(html).not.toContain('navigator.serviceWorker.getRegistrations()')
    expect(html).not.toContain('caches.keys()')
    expect(html).not.toContain('user-scalable=no')
    expect(html).not.toContain('maximum-scale=1.0')
    expect(main).toContain("import('virtual:pwa-register')")
    expect(main).not.toContain('setTimeout(() => fadeOutGlobalLoader()')
  })

  test('reports CanvasKit failure without declaring the surface ready', async () => {
    const [loader, canvas] = await Promise.all([
      Bun.file('packages/vue/src/canvas/surface/kit-loader.ts').text(),
      Bun.file('src/components/EditorCanvas.vue').text()
    ])

    const errorBranch = loader.slice(
      loader.indexOf("console.error('[canvas] CanvasKit init failed'")
    )
    expect(errorBranch).toContain('onError?.(err)')
    expect(errorBranch).not.toContain('onReady?.()')
    expect(canvas).toContain('data-test-id="canvas-error"')
    expect(canvas).toContain('role="alert"')
    expect(canvas).toContain('data-test-id="canvas-error-retry"')
  })

  test('loads automation and React Code Object runtimes only on demand', async () => {
    const [server, runtime, overlays] = await Promise.all([
      Bun.file('src/app/automation/bridge/server.ts').text(),
      Bun.file('src/app/code-object/runtime.ts').text(),
      Bun.file('src/components/canvas/CodeObjectOverlays.vue').text()
    ])

    expect(server).not.toContain("from '@/app/automation/bridge/handlers'")
    expect(server).toContain("import('@/app/automation/bridge/handlers')")
    expect(runtime).toContain("import('@/app/code-object/runtime-implementation')")
    expect(overlays).toContain("if ('pluginData' in changes) scheduleRuntimeRender(id)")
    expect(overlays).not.toContain("store.onEditorEvent('node:updated', () =>")
  })

  test('keeps document viewers out of the initial editor bundle', async () => {
    const [media, markdown] = await Promise.all([
      Bun.file('src/components/canvas/MediaEvidenceOverlays.vue').text(),
      Bun.file('src/components/canvas/MarkdownDocumentOverlays.vue').text()
    ])

    expect(media).toContain("import('@/components/canvas/media-evidence/PdfEvidenceViewer.vue')")
    expect(media).not.toContain(
      "import PdfEvidenceViewer from '@/components/canvas/media-evidence/PdfEvidenceViewer.vue'"
    )
    expect(markdown).toContain("await import('vue-stream-markdown')")
    expect(markdown).not.toContain("import { Markdown } from 'vue-stream-markdown'")
  })

  test('does one canvas layout read per pointer move and frame-coalesces iframe hover', async () => {
    const [canvasInput, trustedApp] = await Promise.all([
      Bun.file('packages/vue/src/canvas/useCanvasInput.ts').text(),
      Bun.file('src/components/code-object/SmylrTrustedWebApp.vue').text()
    ])

    const mouseMove = canvasInput.slice(
      canvasInput.indexOf('function onMouseMove'),
      canvasInput.indexOf('function onMouseUp')
    )
    expect(mouseMove.match(/getCoords\(e\)/g)).toHaveLength(1)
    expect(trustedApp).toContain('function queuePointHover')
    expect(trustedApp).toContain('hoverFrame = requestAnimationFrame')
    expect(trustedApp).toContain('@pointermove="queuePointHover"')
  })

  test('keeps one creation flush timer for a burst of agent changes', async () => {
    const bindings = await Bun.file('src/app/narrated-trace/bindings.ts').text()
    const scheduler = bindings.slice(
      bindings.indexOf('function scheduleCreationFlush'),
      bindings.indexOf('function queueCreation')
    )

    expect(scheduler).toContain('if (creationFlushTimer) return')
    expect(scheduler.match(/setTimeout\(/g)).toHaveLength(1)
    expect(scheduler).not.toContain('clearTimeout')
  })

  test('enforces an initial JavaScript regression ceiling during production builds', async () => {
    const [config, budget] = await Promise.all([
      Bun.file('vite.config.ts').text(),
      Bun.file('vite/performance-budget.ts').text()
    ])

    expect(config).toContain('initialJavaScriptBudgetPlugin()')
    expect(budget).toContain('INITIAL_JAVASCRIPT_RAW_BUDGET_BYTES = 4_750_000')
    expect(budget).toContain('INITIAL_JAVASCRIPT_GZIP_BUDGET_BYTES = 1_300_000')
    expect(budget).toContain('gzipSync(bytes)')
  })
})
