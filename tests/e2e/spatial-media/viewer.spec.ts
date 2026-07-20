import { readFileSync } from 'node:fs'

import type { Page } from '@playwright/test'

import { expect, test } from '#tests/e2e/fixtures'

const FIXTURE_BYTES = [...readFileSync('tests/fixtures/spatial-media/animated-triangle.gltf')]
const SOURCE_HASH = 'e2e-animated-triangle'
const OBJ_BYTES = [...new TextEncoder().encode('o Triangle\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')]
const STL_BYTES = [
  ...new TextEncoder().encode(
    'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n'
  )
]

function externalGltfFixture(): { buffer: number[]; source: number[] } {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  const buffer = [...new Uint8Array(positions.buffer)]
  const source = [
    ...new TextEncoder().encode(
      JSON.stringify({
        accessors: [
          {
            bufferView: 0,
            componentType: 5126,
            count: 3,
            max: [1, 1, 0],
            min: [0, 0, 0],
            type: 'VEC3'
          }
        ],
        asset: { version: '2.0' },
        bufferViews: [{ buffer: 0, byteLength: buffer.length }],
        buffers: [{ byteLength: buffer.length, uri: 'triangle.bin' }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }]
      })
    )
  ]
  return { buffer, source }
}

async function dropFiles(
  page: Page,
  files: Array<{ bytes: number[]; name: string; type: string }>
): Promise<void> {
  await page.getByTestId('canvas-element').evaluate((canvas, inputs) => {
    const transfer = new DataTransfer()
    for (const input of inputs) {
      transfer.items.add(new File([new Uint8Array(input.bytes)], input.name, { type: input.type }))
    }
    const bounds = canvas.getBoundingClientRect()
    canvas.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        dataTransfer: transfer
      })
    )
  }, files)
}

async function cameraState(page: Page, nodeId: string) {
  return page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    const value = node?.pluginData.find((entry) => entry.key === 'spatial-media/camera')?.value
    return value ? (JSON.parse(value) as { position: number[]; target: number[] }) : null
  }, nodeId)
}

test('glTF viewer persists camera state and disposes its offscreen runtime', async ({ page }) => {
  await page.goto('/?test&no-chrome&no-rulers')
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
  await page.goto('/?test&no-chrome&no-rulers')
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

test('dropped OBJ and STL sources open as real offline orbitable viewers', async ({ page }) => {
  await page.goto('/?test&no-chrome&no-rulers')
  await dropFiles(page, [
    { bytes: OBJ_BYTES, name: 'triangle.obj', type: 'model/obj' },
    { bytes: STL_BYTES, name: 'triangle.stl', type: 'model/stl' }
  ])

  const viewers = page.getByTestId('spatial-media-gltf-viewer')
  await expect(viewers).toHaveCount(2)
  await expect(viewers.nth(0)).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewers.nth(1)).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewers.nth(0)).toContainText('OBJ · SOURCE')
  await expect(viewers.nth(1)).toContainText('STL · SOURCE')
  await expect(viewers.nth(0).getByTestId('spatial-media-webgl-canvas')).toBeVisible()
  await expect(viewers.nth(1).getByTestId('spatial-media-webgl-canvas')).toBeVisible()
  await expect(page.getByTestId('source-object')).toHaveCount(0)
  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.state.zoom = 0.7
    store.state.panX = 124
    store.state.panY = 210
    store.requestRepaint()
  })
  await expect(viewers.nth(0)).toHaveAttribute('data-element-visible', 'true')
  await expect(viewers.nth(1)).toHaveAttribute('data-element-visible', 'true')
  await expect(viewers.nth(0)).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewers.nth(1)).toHaveAttribute('data-runtime-state', 'ready')
  await page.getByTestId('animated-dither-background').evaluate((background) => {
    const canvas = background.querySelector('canvas')
    if (canvas instanceof HTMLCanvasElement) canvas.style.display = 'none'
  })
  await expect(page).toHaveScreenshot('obj-stl-source-viewers.png')
})

test('dropped glTF resolves its exact local buffer and exposes retained provenance', async ({
  page
}) => {
  await page.goto('/?test&no-chrome&no-rulers')
  const fixture = externalGltfFixture()
  await dropFiles(page, [
    { bytes: fixture.source, name: 'external-triangle.gltf', type: 'model/gltf+json' },
    { bytes: fixture.buffer, name: 'triangle.bin', type: 'application/octet-stream' }
  ])

  const viewer = page.getByTestId('spatial-media-gltf-viewer')
  await expect(viewer).toHaveCount(1)
  await expect(viewer).toHaveAttribute('data-format', 'gltf')
  await expect(viewer).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewer.getByTestId('spatial-media-webgl-canvas')).toBeVisible()
  await expect(viewer.getByTestId('spatial-media-resource-count')).toHaveText('+1 LOCAL')
  await expect(page.getByTestId('source-object')).toHaveCount(0)

  const provenance = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const node = [...(store?.graph.getAllNodes() ?? [])].find((candidate) =>
      candidate.pluginData.some(
        (entry) =>
          entry.key === 'content-source/file-name' && entry.value === 'external-triangle.gltf'
      )
    )
    const value = node?.pluginData.find((entry) => entry.key === 'spatial-media/resources')?.value
    const resources = value
      ? (JSON.parse(value) as Array<{ assetHash: string; fileName: string; uri: string }>)
      : []
    return {
      bytes: resources[0] ? store?.graph.images.get(resources[0].assetHash)?.byteLength : 0,
      fileName: resources[0]?.fileName,
      uri: resources[0]?.uri
    }
  })
  expect(provenance).toEqual({
    bytes: fixture.buffer.length,
    fileName: 'triangle.bin',
    uri: 'triangle.bin'
  })
})

test('dropped glTF reports a missing local companion without inventing a fallback', async ({
  page
}) => {
  await page.goto('/?test&no-chrome&no-rulers')
  const fixture = externalGltfFixture()
  await dropFiles(page, [
    { bytes: fixture.source, name: 'missing-buffer.gltf', type: 'model/gltf+json' }
  ])

  const viewer = page.getByTestId('spatial-media-gltf-viewer')
  await expect(viewer).toHaveCount(1)
  await expect(viewer).toHaveAttribute('data-runtime-state', 'error')
  await expect(viewer.getByTestId('spatial-media-status')).toContainText(
    'Local glTF resource "triangle.bin" was not included with the model.'
  )
  await expect(page.getByTestId('source-object')).toHaveCount(0)
})
