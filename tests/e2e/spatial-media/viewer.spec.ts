import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'

const FIXTURE_BYTES = [...readFileSync('tests/fixtures/spatial-media/animated-triangle.gltf')]
const SOURCE_HASH = 'e2e-animated-triangle'

async function cameraState(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    const value = node?.pluginData.find((entry) => entry.key === 'spatial-media/camera')?.value
    return value ? (JSON.parse(value) as { position: number[]; target: number[] }) : null
  }, nodeId)
}

test('glTF viewer persists camera state and disposes its offscreen runtime', async ({ page }) => {
  await page.goto('http://127.0.0.1:1466/?test&no-chrome&no-rulers')
  const nodeId = await page.evaluate(
    ({ bytes, hash }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const x = (280 - store.state.panX) / store.state.zoom
      const y = (160 - store.state.panY) / store.state.zoom
      store.graph.images.set(hash, new Uint8Array(bytes))
      const node = store.graph.createNode('FRAME', store.state.currentPageId, {
        clipsContent: true,
        cornerRadius: 12,
        height: 480,
        name: 'Animated triangle',
        pluginData: [
          { pluginId: 'open-pencil', key: 'content-source/format', value: 'gltf' },
          { pluginId: 'open-pencil', key: 'content-source/mime-type', value: 'model/gltf+json' },
          { pluginId: 'open-pencil', key: 'content-source/revision', value: '1' },
          {
            pluginId: 'open-pencil',
            key: 'content-source/source',
            value: `openpencil-asset://${hash}`
          },
          {
            pluginId: 'open-pencil',
            key: 'content-source/file-name',
            value: 'animated-triangle.gltf'
          },
          { pluginId: 'open-pencil', key: 'spatial-media/kind', value: 'gltf' }
        ],
        width: 720,
        x,
        y
      })
      store.select([node.id])
      store.requestRender()
      return node.id
    },
    { bytes: FIXTURE_BYTES, hash: SOURCE_HASH }
  )

  const viewer = page.getByTestId('spatial-media-gltf-viewer')
  await expect(viewer).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewer).toHaveAttribute('data-interactive', 'true')
  await expect(viewer).toHaveAttribute('data-element-visible', 'true')
  await expect(viewer).toHaveAttribute('data-render-loop', 'running')
  const webgl = viewer.getByTestId('spatial-media-webgl-canvas')
  await expect(webgl).toBeVisible()
  await expect(viewer).toContainText('1 TRI · 1 ANIM')
  await expect(viewer).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewer).toHaveAttribute('data-element-visible', 'true')

  const initial = await cameraState(page, nodeId)
  expect(initial).not.toBeNull()
  const bounds = await webgl.boundingBox()
  if (!bounds) throw new Error('3D canvas has no bounds')

  const orbitPoint = {
    x: bounds.x + bounds.width * 0.55,
    y: bounds.y + bounds.height * 0.55
  }
  const orbitHitTarget = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return {
      pointerEvents: target ? getComputedStyle(target).pointerEvents : null,
      tagName: target?.tagName ?? null,
      testId: target instanceof HTMLElement ? target.dataset.testId : null
    }
  }, orbitPoint)
  expect(orbitHitTarget).toEqual({
    pointerEvents: 'auto',
    tagName: 'CANVAS',
    testId: 'spatial-media-webgl-canvas'
  })

  await page.mouse.move(orbitPoint.x, orbitPoint.y)
  await page.mouse.down({ button: 'left' })
  await expect(viewer).toHaveAttribute('data-interactive', 'true')
  await page.mouse.move(bounds.x + bounds.width * 0.72, bounds.y + bounds.height * 0.42, {
    steps: 8
  })
  await page.mouse.up({ button: 'left' })
  await expect.poll(() => cameraState(page, nodeId)).not.toEqual(initial)
  const afterOrbit = await cameraState(page, nodeId)

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.wheel(0, -180)
  await expect.poll(() => cameraState(page, nodeId)).not.toEqual(afterOrbit)
  const afterZoom = await cameraState(page, nodeId)

  await page.mouse.down({ button: 'right' })
  await page.mouse.move(bounds.x + bounds.width * 0.62, bounds.y + bounds.height * 0.58, {
    steps: 8
  })
  await page.mouse.up({ button: 'right' })
  await expect.poll(() => cameraState(page, nodeId)).not.toEqual(afterZoom)

  const cameraBeforePause = await cameraState(page, nodeId)
  const originalPosition = await page.evaluate((id) => {
    const node = window.openPencil?.getStore?.()?.graph.getNode(id)
    return node ? { x: node.x, y: node.y } : null
  }, nodeId)
  expect(originalPosition).not.toBeNull()

  await page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.graph.updateNode(id, { x: 100_000, y: 100_000 })
    store.requestRender()
  }, nodeId)
  await expect(viewer).toHaveAttribute('data-element-visible', 'false')
  await expect(viewer).toHaveAttribute('data-render-loop', 'paused')
  await expect(webgl).toHaveCount(0)

  await page.evaluate(
    ({ id, position }) => {
      const store = window.openPencil?.getStore?.()
      if (!store || !position) throw new Error('OpenPencil store not initialized')
      store.graph.updateNode(id, position)
      store.requestRender()
    },
    { id: nodeId, position: originalPosition }
  )
  await expect(viewer).toHaveAttribute('data-element-visible', 'true')
  await expect(viewer).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewer).toHaveAttribute('data-render-loop', 'running')
  await expect(webgl).toBeVisible()
  await expect.poll(() => cameraState(page, nodeId)).toEqual(cameraBeforePause)

  await page.getByTestId('spatial-media-fit').click()
  await page.getByTestId('spatial-media-reset').click()
  await expect.poll(() => cameraState(page, nodeId)).toEqual(initial)

  const previewState = await page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    const previewHash = node?.pluginData.find(
      (entry) => entry.key === 'spatial-media/preview-asset'
    )?.value
    return {
      bytes: previewHash ? store?.graph.images.get(previewHash)?.byteLength : 0,
      previewHash
    }
  }, nodeId)
  expect(previewState.previewHash).toBeTruthy()
  expect(previewState.bytes).toBeGreaterThan(0)
})

test('invalid glTF reaches an explicit error state and unmounts cleanly', async ({ page }) => {
  await page.goto('http://127.0.0.1:1466/?test&no-chrome&no-rulers')
  const nodeId = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const hash = 'e2e-invalid-gltf'
    const x = (280 - store.state.panX) / store.state.zoom
    const y = (160 - store.state.panY) / store.state.zoom
    store.graph.images.set(hash, new Uint8Array([1, 2, 3, 4]))
    const node = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 480,
      name: 'Broken asset',
      pluginData: [
        { pluginId: 'open-pencil', key: 'content-source/format', value: 'gltf' },
        { pluginId: 'open-pencil', key: 'content-source/mime-type', value: 'model/gltf+json' },
        { pluginId: 'open-pencil', key: 'content-source/revision', value: '1' },
        {
          pluginId: 'open-pencil',
          key: 'content-source/source',
          value: `openpencil-asset://${hash}`
        },
        { pluginId: 'open-pencil', key: 'content-source/file-name', value: 'broken.gltf' },
        { pluginId: 'open-pencil', key: 'spatial-media/kind', value: 'gltf' }
      ],
      width: 720,
      x,
      y
    })
    store.select([node.id])
    store.requestRender()
    return node.id
  })

  const viewer = page.getByTestId('spatial-media-gltf-viewer')
  await expect(viewer).toHaveAttribute('data-runtime-state', 'error')
  await expect(page.getByTestId('spatial-media-status')).toHaveAttribute('role', 'alert')
  await expect(page.getByTestId('spatial-media-status')).toContainText('glTF JSON is not valid')
  await page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    store?.graph.deleteNode(id)
    store?.requestRender()
  }, nodeId)
  await expect(viewer).toHaveCount(0)
})
