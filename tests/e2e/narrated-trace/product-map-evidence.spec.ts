import type { Locator } from '@playwright/test'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'
import {
  readNarratedTraceEvidencePixels,
  startNarratedTraceForTest,
  stopNarratedTraceForTest
} from '#tests/helpers/narrated-trace'

const editor = useEditorSetup(
  '/?test&no-rulers&smylr-production=1&smylr-page=product-map-dental-chart'
)

type ProductMapCaptureFixture = {
  captureSrc: string
  frameId: string
  frameName: string
  route: string
  state: string
}

async function seedProductMapCapture() {
  const fixture = await editor.page.evaluate<ProductMapCaptureFixture>(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = [...store.graph.getAllNodes()].find((node) => {
      const values = new Map(node.pluginData.map((entry) => [entry.key, entry.value]))
      return (
        values.get('kind') === 'live-app-frame' &&
        values.get('captureSrc')?.includes('dental-chart')
      )
    })
    if (!frame) throw new Error('Product Map Dental Chart screen is missing')
    const values = new Map(frame.pluginData.map((entry) => [entry.key, entry.value]))
    const captureSrc = values.get('captureSrc')
    const route = values.get('route')
    const state = values.get('state')
    if (!captureSrc || !route || !state)
      throw new Error('Product Map capture metadata is incomplete')
    return { captureSrc, frameId: frame.id, frameName: frame.name, route, state }
  })

  await editor.page.evaluate(async ({ captureSrc, route, state }) => {
    const response = await fetch(captureSrc)
    if (!response.ok) throw new Error(`Product Map capture failed to load: ${response.status}`)
    const blob = await response.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('Product Map capture did not produce a data URL'))
      reader.onerror = () => reject(reader.error ?? new Error('Product Map capture read failed'))
      reader.readAsDataURL(blob)
    })
    const key = `smylr-live-frame-snapshot/v5/${encodeURIComponent(route)}/${encodeURIComponent(state)}`
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-pencil-cache-v1', 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('binary-entries')) {
          request.result.createObjectStore('binary-entries')
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Evidence fixture cache failed'))
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const request = database
          .transaction('binary-entries', 'readwrite')
          .objectStore('binary-entries')
          .put({ updatedAt: Date.now(), value: dataUrl }, key)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error('Evidence fixture write failed'))
      })
    } finally {
      database.close()
    }
  }, fixture)

  await editor.page.reload()
  await editor.canvas.waitForInit()
  await expect(editor.page.getByTestId('smylr-live-app-embed')).toBeVisible()
  await editor.page.evaluate(async ({ route, state }) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized after capture seeding')
    const frame = [...store.graph.getAllNodes()].find((node) => {
      const values = new Map(node.pluginData.map((entry) => [entry.key, entry.value]))
      return (
        values.get('kind') === 'live-app-frame' &&
        values.get('route') === route &&
        values.get('state') === state
      )
    })
    if (!frame) throw new Error('Seeded Product Map screen is missing after reload')
    if (!frame.parentId) throw new Error('Seeded Product Map screen has no page')
    await store.switchPage(frame.parentId)
    store.zoomToNode(frame.id)
  }, fixture)
  await editor.canvas.waitForRender()
  await expect(editor.page.getByTestId('app-screen-flow-overview')).toBeVisible()
  return fixture
}

async function focusFrame(frame: Locator) {
  await editor.page.getByTestId('narrated-trace-focus-tool').click()
  await expect(editor.page.getByTestId('narrated-trace-annotation-overlay')).toHaveAttribute(
    'data-tool',
    'focus'
  )

  const bounds = await frame.boundingBox()
  if (!bounds) throw new Error('Product Map screen is not visible')
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  const radiusX = Math.min(90, bounds.width * 0.25)
  const radiusY = Math.min(70, bounds.height * 0.25)
  for (let index = 0; index <= 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2
    const point = {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY
    }
    if (index === 0) {
      await editor.page.mouse.move(point.x, point.y)
      await editor.page.mouse.down()
    } else {
      await editor.page.mouse.move(point.x, point.y)
    }
  }
  await editor.page.mouse.up()
}

test('captures the Product Map screen beneath Focus and bakes the highlight into Copy', async () => {
  const fixture = await seedProductMapCapture()
  const frame = editor.page
    .locator(`[data-live-frame-state="${fixture.state}"][data-live-frame-route="${fixture.route}"]`)
    .first()
  const snapshot = frame.getByRole('img', { name: `${fixture.frameName} last rendered snapshot` })
  await expect(snapshot).toBeVisible()

  await startNarratedTraceForTest(editor.page)
  await expect(editor.page.getByTestId('narrated-trace-start')).toHaveCount(0)
  await focusFrame(frame)

  const row = editor.page.getByTestId('narrated-trace-row-screenshot')
  await expect(row).toContainText(`Highlighted ${fixture.frameName}`)
  await expect(row).not.toContainText('Highlighted Canvas area')
  const evidence = row.getByTestId('narrated-trace-evidence-image')
  await expect(evidence).toBeVisible()
  await expect(evidence).toHaveAttribute('data-evidence-source', 'frame-snapshot')

  const pixels = await readNarratedTraceEvidencePixels(evidence)
  expect(pixels.nonWhite).toBeGreaterThan(100)
  expect(pixels.violet).toBeGreaterThan(5)
  const copy = row.getByTestId('narrated-trace-copy-evidence')
  await expect(copy).toHaveText('Copy')
  await editor.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(editor.page.url()).origin
  })
  await copy.click()
  await expect(copy).toHaveText('Copied')
  const clipboardPngSize = await editor.page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const png = items.find((item) => item.types.includes('image/png'))
    return png ? (await png.getType('image/png')).size : 0
  })
  expect(clipboardPngSize).toBeGreaterThan(1_000)
  await expect(copy).toHaveText('Copy')
  await editor.page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: () =>
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 60_000)
        })
    })
  })
  await copy.click()
  await expect(copy).toHaveText('Copying…')
  await expect(copy).toHaveText('Retry')
  await stopNarratedTraceForTest(editor.page)
})

test('rejects a blank frame capture instead of saving white evidence', async () => {
  await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = [...store.graph.getAllNodes()].find((node) => {
      const values = new Map(node.pluginData.map((entry) => [entry.key, entry.value]))
      return values.get('kind') === 'live-app-frame' && values.get('state') === 'health-chart'
    })
    if (!frame) throw new Error('Product Map Health Chart screen is missing')
    store.zoomToNode(frame.id)
  })
  await editor.canvas.waitForRender()

  const frame = editor.page
    .locator('[data-live-frame-state="health-chart"][data-live-frame-route="/health-chart"]')
    .first()
  await expect(frame).toBeVisible()
  await frame.evaluate(async (element) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Blank capture fixture canvas is unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const image = document.createElement('img')
    image.src = canvas.toDataURL('image/png')
    image.alt = 'Intentionally blank frame fixture'
    image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
    element.querySelector('img')?.remove()
    element.append(image)
    await image.decode()
  })

  await startNarratedTraceForTest(editor.page)
  await focusFrame(frame)

  const row = editor.page.getByTestId('narrated-trace-row-screenshot')
  await expect(row).toContainText('Highlighted Product Map — Dental Chart / Health Chart')
  await expect(row.getByTestId('narrated-trace-evidence-status')).toHaveText(
    'Screenshot unavailable. Try Focus again.'
  )
  await expect(row.getByTestId('narrated-trace-evidence-image')).toHaveCount(0)
})
