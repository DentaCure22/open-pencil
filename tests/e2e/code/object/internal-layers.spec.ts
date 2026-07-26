import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

function frameGeometry(frameId: string) {
  return editor.page.evaluate((id) => {
    const frame = window.openPencil?.getStore?.().graph.getNode(id)
    if (!frame) throw new Error('Smylr Code Object frame unavailable')
    return {
      height: frame.height,
      rotation: frame.rotation,
      width: frame.width,
      x: frame.x,
      y: frame.y
    }
  }, frameId)
}

function frameDocument(frameId: string) {
  return editor.page.evaluate((id) => {
    const frame = window.openPencil?.getStore?.().graph.getNode(id)
    return frame?.pluginData.find(
      (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
    )?.value
  }, frameId)
}

function boardFocusGeometry(frameId: string) {
  return editor.page.evaluate((id) => {
    const surface = document.querySelector<HTMLElement>(`[data-code-object-id="${id}"]`)
    const canvas = document.querySelector<HTMLElement>('[data-test-id="canvas-area"]')
    const layers = document.querySelector<HTMLElement>('[data-test-id="layers-shell"]')
    const properties = document.querySelector<HTMLElement>('[data-test-id="properties-panel"]')
    const toolbar = document.querySelector<HTMLElement>('[data-test-id="toolbar"]')
    const boardDock = document.querySelector<HTMLElement>('[data-test-id="board-dock"]')
    if (!surface || !canvas || !layers || !toolbar || !boardDock) {
      throw new Error('Expected Code Object and editor chrome')
    }

    const surfaceRect = surface.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const layersRect = layers.getBoundingClientRect()
    const propertiesRect = properties?.getBoundingClientRect()
    const toolbarRect = toolbar.getBoundingClientRect()
    const boardDockRect = boardDock.getBoundingClientRect()
    const rightEdge =
      propertiesRect && propertiesRect.left >= canvasRect.left + canvasRect.width / 2
        ? propertiesRect.left
        : canvasRect.right

    return {
      targetX: (layersRect.right + rightEdge) / 2,
      targetY: (toolbarRect.bottom + boardDockRect.top) / 2,
      x: surfaceRect.left + surfaceRect.width / 2,
      y: surfaceRect.top + surfaceRect.height / 2
    }
  }, frameId)
}

test('keeps the rounded Smylr iframe and frame chrome aligned during movement', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  const smylr = editor.page.frameLocator('[data-test-id="smylr-trusted-web-app-frame"]')
  await expect(smylr.locator('[data-smylr-program-shell="browser"]')).toBeVisible({
    timeout: 20_000
  })
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)

  const selectionOverlay = editor.page.getByTestId(`code-object-overlay-${frameId}`)
  await expect(surface).toHaveCSS('border-radius', '16px')
  await expect(surface).toHaveCSS('overflow', 'hidden')
  await expect(iframe).toBeVisible()
  expect(
    await selectionOverlay.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderRadius)
    )
  ).toBeGreaterThan(0)

  const beforeMoveGeometry = await frameGeometry(frameId)
  const moveStartBounds = await surface.boundingBox()
  if (!moveStartBounds) throw new Error('Code Object move target unavailable')
  const moveStart = {
    x: moveStartBounds.x + moveStartBounds.width / 2,
    y: moveStartBounds.y + moveStartBounds.height / 2
  }
  await editor.page.mouse.move(moveStart.x, moveStart.y)
  await editor.page.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await editor.page.mouse.move(moveStart.x + step * 18, moveStart.y + step * 12)
    await editor.page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
    )
    const [surfaceBounds, overlayBounds] = await Promise.all([
      surface.boundingBox(),
      selectionOverlay.boundingBox()
    ])
    if (!surfaceBounds || !overlayBounds) {
      throw new Error('Code Object presentation surfaces unavailable during movement')
    }
    expect(Math.abs(surfaceBounds.x - overlayBounds.x)).toBeLessThan(1)
    expect(Math.abs(surfaceBounds.y - overlayBounds.y)).toBeLessThan(1)
    expect(Math.abs(surfaceBounds.width - overlayBounds.width)).toBeLessThan(1)
    expect(Math.abs(surfaceBounds.height - overlayBounds.height)).toBeLessThan(1)
    if (step === 3) {
      expect(await surface.screenshot()).toMatchSnapshot('smylr-code-object-mid-drag.png')
    }
  }
  await editor.page.mouse.up()
  await expect.poll(() => frameGeometry(frameId)).not.toEqual(beforeMoveGeometry)
  await editor.page.keyboard.press('Meta+z')
  await expect.poll(() => frameGeometry(frameId)).toEqual(beforeMoveGeometry)
})

test('runs the full Smylr web app inside one Board-owned Code Object', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  const smylr = editor.page.frameLocator('[data-test-id="smylr-trusted-web-app-frame"]')
  await expect(iframe).toHaveCount(1)
  await expect(surface.locator('[data-smylr-code-object-root="true"]')).toHaveCount(0)
  await expect(smylr.locator('[data-smylr-program-shell="browser"]')).toBeVisible({
    timeout: 20_000
  })
  await expect(smylr.locator('[data-smylr-container-id="application-shell"]')).toBeVisible()

  const initialDocument = await frameDocument(frameId)
  const initialGeometry = await frameGeometry(frameId)
  expect(initialDocument).toBeTruthy()
  await expect(editor.page.getByTestId('code-object-header-title')).toHaveText(
    'Dental Chart / Current'
  )

  const selectionOverlay = editor.page.getByTestId(`code-object-overlay-${frameId}`)
  await expect(selectionOverlay).toHaveCSS('z-index', '14')
  for (const preset of ['desktop', 'laptop', 'ipad', 'phone']) {
    await expect(editor.page.getByTestId(`code-object-viewport-${preset}`)).toBeVisible()
  }

  await editor.page.getByTestId('code-object-viewport-phone').click()
  await expect
    .poll(() => frameGeometry(frameId))
    .toMatchObject({ height: 844, rotation: 0, width: 390 })
  await expect(iframe).toHaveJSProperty('clientWidth', 390)
  await expect(iframe).toHaveJSProperty('clientHeight', 844)

  await editor.page.keyboard.press('Meta+z')
  expect(await frameGeometry(frameId)).toEqual(initialGeometry)

  await editor.page.getByTestId('code-object-viewport-desktop').click()
  await expect
    .poll(() => frameGeometry(frameId))
    .toMatchObject({ height: 900, rotation: 0, width: 1440 })

  const resizeHandle = editor.page.getByTestId('code-object-resize-se')
  const resizeHandleBounds = await resizeHandle.boundingBox()
  if (!resizeHandleBounds) throw new Error('Code Object resize handle unavailable')
  await editor.page.mouse.move(
    resizeHandleBounds.x + resizeHandleBounds.width / 2,
    resizeHandleBounds.y + resizeHandleBounds.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    resizeHandleBounds.x + resizeHandleBounds.width / 2 + 80,
    resizeHandleBounds.y + resizeHandleBounds.height / 2 + 60,
    { steps: 5 }
  )
  await editor.page.mouse.up()
  const resized = await frameGeometry(frameId)
  expect(resized.width).toBeGreaterThan(1440)
  expect(resized.height).toBeGreaterThan(900)
  await editor.page.keyboard.press('Meta+z')
  await expect
    .poll(() => frameGeometry(frameId))
    .toMatchObject({ height: 900, rotation: 0, width: 1440 })

  await editor.page.evaluate(() => window.openPencil?.getStore?.().pan(180, -120))
  await editor.page.getByTestId('code-object-design-hit-target').dblclick()
  await expect(surface).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(iframe).toBeFocused()
  await expect(smylr.locator('html')).toHaveAttribute('data-smylr-openpencil-mode', 'interact')
  await expect
    .poll(async () => {
      const geometry = await boardFocusGeometry(frameId)
      return Math.max(
        Math.abs(geometry.x - geometry.targetX),
        Math.abs(geometry.y - geometry.targetY)
      )
    })
    .toBeLessThan(1)

  await smylr.locator('a[href="/patients"]').first().click()
  await expect
    .poll(
      () => editor.page.frames().some((frame) => new URL(frame.url()).pathname === '/patients'),
      { timeout: 20_000 }
    )
    .toBe(true)

  const scrollState = () =>
    smylr.locator('body').evaluate(() => {
      const candidates = [
        document.scrollingElement,
        ...document.querySelectorAll<HTMLElement>('*')
      ].filter((element): element is Element => element instanceof Element)
      const scrollable = candidates.filter((element) => {
        const style = window.getComputedStyle(element)
        return (
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          element.scrollHeight > element.clientHeight + 1
        )
      })
      return {
        count: scrollable.length,
        position: scrollable.reduce((total, element) => total + element.scrollTop, 0)
      }
    })

  const pageContent = smylr.locator('[data-smylr-container-id="page-content"]')
  await expect(pageContent).toHaveCSS('overflow-y', 'auto')
  await pageContent.evaluate((element) => {
    const spacer = document.createElement('div')
    spacer.dataset.testId = 'openpencil-scroll-proof-spacer'
    spacer.style.flex = '0 0 1200px'
    element.appendChild(spacer)
  })
  const beforeScroll = await scrollState()
  expect(beforeScroll.count).toBeGreaterThan(0)
  const iframeBounds = await iframe.boundingBox()
  if (!iframeBounds) throw new Error('Smylr iframe unavailable')
  await editor.page.mouse.move(
    iframeBounds.x + iframeBounds.width / 2,
    iframeBounds.y + iframeBounds.height / 2
  )
  await editor.page.mouse.wheel(0, 700)
  await expect
    .poll(async () => (await scrollState()).position)
    .toBeGreaterThan(beforeScroll.position)

  await smylr.locator('body').press('Escape')
  await expect(surface).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.getByTestId('code-object-header')).toBeVisible()
  expect(await frameDocument(frameId)).toBe(initialDocument)

  const containersTool = editor.page.getByTestId('smylr-containers-tool')
  if ((await containersTool.getAttribute('aria-pressed')) === 'true') {
    await containersTool.click()
  }
  await containersTool.click()
  await expect(containersTool).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.page.getByTestId('smylr-live-select-surface')).toBeVisible({
    timeout: 10_000
  })

  const layersFilter = editor.page.getByTestId('layers-filter')
  for (const layerName of [
    'Application Shell',
    'Shell Layout',
    'AuthContextProvider',
    'Application Layout',
    'Application Navigation',
    'Page Layout',
    'Page Content'
  ]) {
    await layersFilter.fill(layerName)
    await expect(
      editor.page.getByTestId('layers-item').filter({ hasText: layerName }).first()
    ).toBeVisible({ timeout: 20_000 })
  }

  await layersFilter.fill('')

  await containersTool.click()
  await expect(containersTool).toHaveAttribute('aria-pressed', 'false')

  await editor.page.reload()
  await editor.canvas.waitForInit()
  const restoredSurface = editor.page.locator(`[data-code-object-id="${frameId}"]`)
  await expect(restoredSurface).toBeVisible()
  await expect(restoredSurface.getByTestId('smylr-trusted-web-app-frame')).toHaveCount(1)
  const restoredSmylr = editor.page.frameLocator(
    `[data-code-object-id="${frameId}"] [data-test-id="smylr-trusted-web-app-frame"]`
  )
  await expect(restoredSmylr.getByText('Patients', { exact: true }).first()).toBeVisible({
    timeout: 20_000
  })
  expect(await frameDocument(frameId)).toBe(initialDocument)
})

test('bounds live Smylr runtimes and restores each parked frame view', async () => {
  const originalSurface = editor.page.locator('[data-code-object-id]').first()
  await expect(originalSurface).toBeVisible()
  const originalFrameId = await originalSurface.getAttribute('data-code-object-id')
  if (!originalFrameId) throw new Error('Original Smylr Code Object id unavailable')

  const originalIframe = originalSurface.getByTestId('smylr-trusted-web-app-frame')
  const originalSmylr = editor.page.frameLocator(
    `[data-code-object-id="${originalFrameId}"] [data-test-id="smylr-trusted-web-app-frame"]`
  )
  await expect(originalSmylr.locator('[data-smylr-program-shell="browser"]')).toBeVisible({
    timeout: 20_000
  })
  const originalRuntimeInstanceId = await originalIframe.getAttribute('data-runtime-instance-id')
  if (!originalRuntimeInstanceId) throw new Error('Original Smylr runtime identity unavailable')

  await editor.page
    .getByTestId(`code-object-overlay-${originalFrameId}`)
    .getByTestId('code-object-design-hit-target')
    .click()
  await expect(originalSurface).toHaveAttribute('data-code-object-mode', 'interact')
  await originalSmylr.locator('a[href="/patients"]').first().click()
  await expect(originalSmylr.getByText('Patients', { exact: true }).first()).toBeVisible({
    timeout: 20_000
  })
  await originalSmylr
    .locator('[data-smylr-container-id="page-content"]')
    .evaluate((element) => element.scrollTo({ top: 300 }))
  await editor.page.waitForTimeout(250)

  const duplicateFrameIds: string[] = []
  let duplicationSourceFrameId = originalFrameId
  for (let index = 0; index < 4; index += 1) {
    const duplicateFrameId = await editor.page.evaluate((sourceId) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store unavailable')
      store.select([sourceId])
      store.duplicateSelected()
      return [...store.state.selectedIds][0] ?? null
    }, duplicationSourceFrameId)
    if (!duplicateFrameId) throw new Error('Duplicate Smylr Code Object unavailable')
    duplicateFrameIds.push(duplicateFrameId)
    duplicationSourceFrameId = duplicateFrameId
  }

  await expect(editor.page.locator('[data-code-object-id]')).toHaveCount(5)
  await expect(editor.page.getByTestId('smylr-trusted-web-app-frame')).toHaveCount(4)
  await expect(editor.page.getByTestId('smylr-trusted-web-app-paused')).toHaveCount(1)

  const duplicateDocument = await frameDocument(duplicateFrameIds.at(-1) ?? '')
  expect(duplicateDocument).toBe(await frameDocument(originalFrameId))
  const newestDuplicate = editor.page.locator(`[data-code-object-id="${duplicateFrameIds.at(-1)}"]`)
  const newestDuplicateSmylr = editor.page.frameLocator(
    `[data-code-object-id="${duplicateFrameIds.at(-1)}"] [data-test-id="smylr-trusted-web-app-frame"]`
  )
  await expect(newestDuplicate.getByTestId('smylr-trusted-web-app-frame')).toHaveCount(1)
  await expect(newestDuplicateSmylr.getByText('Dental Chart', { exact: true }).first()).toBeVisible(
    {
      timeout: 20_000
    }
  )

  await editor.page.evaluate(
    (frameId) => window.openPencil?.getStore?.().select([frameId]),
    originalFrameId
  )
  await expect(originalSurface).toHaveAttribute('data-code-object-mode', 'design')

  const originalMoveTarget = editor.page
    .getByTestId(`code-object-overlay-${originalFrameId}`)
    .getByTestId('code-object-design-hit-target')
  const originalBeforeMove = await originalSurface.boundingBox()
  const originalMoveBounds = await originalMoveTarget.boundingBox()
  if (!originalBeforeMove || !originalMoveBounds) {
    throw new Error('Original Smylr Code Object move target unavailable')
  }
  await editor.page.mouse.move(
    originalMoveBounds.x + originalMoveBounds.width / 2,
    originalMoveBounds.y + originalMoveBounds.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    originalMoveBounds.x + originalMoveBounds.width / 2 + 40,
    originalMoveBounds.y + originalMoveBounds.height / 2 + 24,
    { steps: 4 }
  )
  await editor.page.mouse.up()
  await expect
    .poll(async () => (await originalSurface.boundingBox())?.x)
    .toBeCloseTo(originalBeforeMove.x + 40, 0)
  await expect
    .poll(async () => (await originalSurface.boundingBox())?.y)
    .toBeCloseTo(originalBeforeMove.y + 24, 0)
  await editor.page.keyboard.press('Meta+z')
  await expect
    .poll(async () => (await originalSurface.boundingBox())?.x)
    .toBeCloseTo(originalBeforeMove.x, 0)
  await expect
    .poll(async () => (await originalSurface.boundingBox())?.y)
    .toBeCloseTo(originalBeforeMove.y, 0)

  await expect(originalSurface.getByTestId('smylr-trusted-web-app-frame')).toHaveCount(1)
  await expect(editor.page.getByTestId('smylr-trusted-web-app-frame')).toHaveCount(4)
  await expect(editor.page.getByTestId('smylr-trusted-web-app-paused')).toHaveCount(1)
  await expect(originalIframe).not.toHaveAttribute(
    'data-runtime-instance-id',
    originalRuntimeInstanceId
  )
  await expect(originalSmylr.getByText('Patients', { exact: true }).first()).toBeVisible({
    timeout: 20_000
  })
})
