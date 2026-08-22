import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import { readTestSelectedIds } from '#tests/helpers/code-object'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

function framePosition(frameId: string) {
  return editor.page.evaluate((id) => {
    const frame = window.openPencil?.getStore?.().graph.getNode(id)
    if (!frame) throw new Error('Smylr Code Object frame unavailable')
    return { x: frame.x, y: frame.y }
  }, frameId)
}

function liveSelection() {
  return editor.page.evaluate(async () => {
    const { liveInspectorDocument, liveInspectorSelectedId } =
      await import('/src/app/smylr-live-inspector/session.ts')
    return {
      firstChildId: liveInspectorDocument.value?.tree.children?.[0]?.id ?? null,
      rootId: liveInspectorDocument.value?.tree.id ?? null,
      selectedId: liveInspectorSelectedId.value
    }
  })
}

test('uses arrows to traverse live Containers before Board objects', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const smylr = editor.page.frameLocator('[data-test-id="smylr-trusted-web-app-frame"]')
  await expect(smylr.locator('[data-smylr-container-id="application-shell"]')).toBeVisible({
    timeout: 20_000
  })
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)

  const before = await framePosition(frameId)
  const containersTool = editor.page.getByTestId('smylr-containers-tool')
  await containersTool.click()
  await expect(containersTool).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.page.getByTestId('smylr-live-select-surface')).toBeVisible()

  await editor.page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (event.data?.action !== 'hover') return
      document.documentElement.dataset.testSmylrHoverPacket =
        'document' in event.data ? 'full' : 'light'
    })
  })
  await smylr.locator('[data-smylr-container-id="application-shell"]').hover()
  await expect
    .poll(() => editor.page.evaluate(() => document.documentElement.dataset.testSmylrHoverPacket))
    .toBe('light')

  await expect.poll(liveSelection).toMatchObject({ selectedId: expect.any(String) })
  const initial = await liveSelection()
  expect(initial.rootId).toBeTruthy()
  expect(initial.firstChildId).toBeTruthy()
  expect(initial.selectedId).toBe(initial.rootId)

  await editor.page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await liveSelection()).selectedId).toBe(initial.firstChildId)
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([frameId])
  expect(await framePosition(frameId)).toEqual(before)

  await editor.page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await liveSelection()).selectedId).toBe(initial.rootId)
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([frameId])
  expect(await framePosition(frameId)).toEqual(before)
})

test('accepts Space+Arrow navigation relayed by the trusted iframe bridge', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const target = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const frame = store?.graph.getNode(id)
    if (!store || !frame) throw new Error('Smylr Code Object frame unavailable')
    const neighbor = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 120,
      name: 'Trusted iframe neighbor',
      width: 160,
      x: frame.x + frame.width + 320,
      y: frame.y + frame.height / 2 - 60
    })
    store.requestRender()
    store.select([id])
    return { neighborId: neighbor.id, zoom: store.state.zoom }
  }, frameId)

  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  await expect(iframe).toBeVisible({ timeout: 20_000 })
  await editor.page
    .getByTestId(`code-object-overlay-${frameId}`)
    .getByTestId('code-object-design-hit-target')
    .click()
  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(iframe).toBeFocused()
  await iframe.evaluate((element) => {
    if (!(element instanceof HTMLIFrameElement) || !element.contentWindow) {
      throw new Error('Trusted iframe window unavailable')
    }
    const runtimeInstanceId = element.dataset.runtimeInstanceId
    if (!runtimeInstanceId) throw new Error('Trusted iframe runtime identity unavailable')
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'board-navigate',
          direction: 'right',
          kind: 'SMYLR_OPENPENCIL_INSPECTOR_V1',
          runtimeInstanceId
        },
        origin: new URL(element.src).origin,
        source: element.contentWindow
      })
    )
  })

  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.neighborId])
  await expect(surface).toHaveAttribute('data-code-object-mode', 'design')
  await expect
    .poll(() => editor.page.evaluate(() => window.openPencil?.getStore?.().state.zoom))
    .toBe(target.zoom)
})

test('focuses a trusted iframe when its bridge relays a double-click', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  await expect(iframe).toBeVisible({ timeout: 20_000 })
  const runtimeInstanceId = await iframe.getAttribute('data-runtime-instance-id')
  if (!runtimeInstanceId) throw new Error('Trusted iframe runtime identity unavailable')

  await editor.page
    .getByTestId(`code-object-overlay-${frameId}`)
    .getByTestId('code-object-design-hit-target')
    .click()
  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')

  const viewportBefore = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 1_400, panY: 900, zoom: 0.2 })
    return { panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom }
  })
  await iframe.evaluate((element) => {
    if (!(element instanceof HTMLIFrameElement) || !element.contentWindow) {
      throw new Error('Trusted iframe window unavailable')
    }
    const runtimeId = element.dataset.runtimeInstanceId
    if (!runtimeId) throw new Error('Trusted iframe runtime identity unavailable')
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          action: 'focus-frame',
          kind: 'SMYLR_OPENPENCIL_INSPECTOR_V1',
          runtimeInstanceId: runtimeId
        },
        origin: new URL(element.src).origin,
        source: element.contentWindow
      })
    )
  })

  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return { panX: store.state.panX, panY: store.state.panY, zoom: store.state.zoom }
      })
    )
    .not.toEqual(viewportBefore)
  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(iframe).toHaveAttribute('data-runtime-instance-id', runtimeInstanceId)
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([frameId])
})
