import type { Locator } from '@playwright/test'

import type { Rect, Vector } from '@open-pencil/scene-graph'

import { isBenignResizeObserverError } from '@/app/shell/ui'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import {
  createTestCodeObject,
  createTestRectangle,
  readTestNodePosition
} from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

const createRectangle = (
  name: string,
  x: number,
  y: number,
  color: { b: number; g: number; r: number }
) => createTestRectangle(editor.page, name, x, y, color)
const createCodeObject = (name: string, x: number, y: number) =>
  createTestCodeObject(editor.page, name, x, y)

async function dragBetween(source: Locator, target: Locator): Promise<void> {
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('React Flow drag endpoints are not visible')
  await editor.page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    {
      steps: 12
    }
  )
  await editor.page.mouse.up()
}

async function expectEdgeEndpointsAttached(
  edgePath: Locator,
  sourceHandle: Locator,
  targetHandle: Locator
): Promise<void> {
  await expect
    .poll(async () => {
      const [pathEndpoints, sourceBox, targetBox] = await Promise.all([
        edgePath.evaluate((element) => {
          if (!(element instanceof SVGPathElement)) {
            throw new Error('Object Graph edge is not an SVG path')
          }
          const matrix = element.getScreenCTM()
          if (!matrix) throw new Error('Object Graph edge has no screen transform')
          const length = element.getTotalLength()
          const sourcePoint = element.getPointAtLength(0)
          const targetPoint = element.getPointAtLength(length)
          const source = new DOMPoint(sourcePoint.x, sourcePoint.y).matrixTransform(matrix)
          const target = new DOMPoint(targetPoint.x, targetPoint.y).matrixTransform(matrix)
          return {
            source: { x: source.x, y: source.y },
            target: { x: target.x, y: target.y }
          }
        }),
        sourceHandle.boundingBox(),
        targetHandle.boundingBox()
      ])
      if (!sourceBox || !targetBox) return Number.POSITIVE_INFINITY
      const attachmentGap = (endpoint: Vector, handle: Rect) =>
        Math.max(
          0,
          Math.hypot(
            endpoint.x - (handle.x + handle.width / 2),
            endpoint.y - (handle.y + handle.height / 2)
          ) -
            Math.max(handle.width, handle.height) / 2
        )
      return Math.max(
        attachmentGap(pathEndpoints.source, sourceBox),
        attachmentGap(pathEndpoints.target, targetBox)
      )
    })
    .toBeLessThan(1)
}

async function readCodeObjectSourceAttachmentOffset(
  edgePath: Locator,
  codeObjectId: string
): Promise<Vector> {
  return edgePath.evaluate(
    (element, frameId) =>
      new Promise<Vector>((resolve, reject) => {
        requestAnimationFrame(() => {
          if (!(element instanceof SVGPathElement)) {
            reject(new Error('Object Graph edge is not an SVG path'))
            return
          }
          const codeObject = document.querySelector(`[data-test-id="code-object-${frameId}"]`)
          const matrix = element.getScreenCTM()
          if (!(codeObject instanceof HTMLElement) || !matrix) {
            reject(new Error('Code Object or Object Graph transform is unavailable'))
            return
          }
          const sourcePoint = element.getPointAtLength(0)
          const source = new DOMPoint(sourcePoint.x, sourcePoint.y).matrixTransform(matrix)
          const frame = codeObject.getBoundingClientRect()
          resolve({
            x: source.x - frame.right,
            y: source.y - (frame.top + frame.height / 2)
          })
        })
      }),
    codeObjectId
  )
}

async function readNodePosition(nodeId: string): Promise<Vector> {
  return readTestNodePosition(editor.page, nodeId)
}

async function readConnectionIds(): Promise<string[]> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const page = store.graph.getNode(store.state.currentPageId)
    const serialized = page?.pluginData.find(
      (entry) => entry.pluginId === 'openpencil-object-graph' && entry.key === 'connections'
    )?.value
    if (!serialized) return []
    const parsed: unknown = JSON.parse(serialized)
    return Array.isArray(parsed)
      ? parsed.flatMap((value) =>
          value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
            ? [value.id]
            : []
        )
      : []
  })
}

function unexpectedCanvasErrors(messages: string[]): string[] {
  return messages.filter(
    (message) =>
      !message.includes("WebSocket connection to 'ws://127.0.0.1:7601/' failed") &&
      !message.startsWith('[Automation] WebSocket') &&
      !isBenignResizeObserverError(message)
  )
}

test('uses React Flow connections on the ordinary OpenPencil board', async () => {
  const sourceId = await createRectangle('Controller', 350, 230, {
    b: 0.95,
    g: 0.27,
    r: 0.55
  })
  const targetId = await createRectangle('Result card', 690, 330, {
    b: 0.78,
    g: 0.58,
    r: 0.04
  })
  await expect(editor.page.getByTestId('object-graph-runtime')).toBeVisible()
  await expect(editor.page.getByTestId('react-flow-object-graph')).toBeVisible()
  await expect(editor.page.getByTestId('scene-canvas-element')).toBeVisible()
  await expect(editor.page.getByTestId('canvas-element')).toBeVisible()
  await expect(editor.page.getByRole('button', { name: 'Graph' })).toHaveCount(0)
  await expect(editor.page.getByTestId('react-flow-graph-panel')).toHaveCount(0)
  const surface = editor.page.getByTestId('react-flow-object-graph')
  await expect(surface.locator('.react-flow__controls')).toHaveCount(0)
  await expect(surface.locator('.react-flow__minimap')).toHaveCount(0)
  await expect(editor.page.getByTestId('object-graph-toggle-node')).toHaveCount(0)

  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(surface.locator('.react-flow')).toBeVisible()
  const sourceNode = editor.page.getByTestId(`react-flow-node-${sourceId}`)
  const targetNode = editor.page.getByTestId(`react-flow-node-${targetId}`)
  await expect(sourceNode).toBeVisible()
  await expect(targetNode).toBeVisible()
  await expect(sourceNode).toHaveAttribute('data-object-name', 'Controller')
  await expect(targetNode).toHaveAttribute('data-object-name', 'Result card')
  const sourceHandle = sourceNode.locator('[data-handleid="port:right"]')
  const targetHandle = targetNode.locator('[data-handleid="port:left"]')
  await expect(sourceHandle).toHaveCSS('opacity', '0')
  await expect(targetHandle).toHaveCSS('opacity', '0')
  const sourceHoverBox = await sourceNode.boundingBox()
  if (!sourceHoverBox) throw new Error('React Flow source node is not visible')
  await editor.page.mouse.move(
    sourceHoverBox.x + sourceHoverBox.width / 2,
    sourceHoverBox.y + sourceHoverBox.height / 2
  )
  await expect(sourceHandle).toHaveCSS('opacity', '1')
  const sourceOutline = editor.page.getByTestId(`object-graph-outline-${sourceId}`)
  await expect(sourceOutline).toHaveCount(0)

  await dragBetween(sourceHandle, targetHandle)

  await expect.poll(readConnectionIds).toHaveLength(1)
  const connectionId = (await readConnectionIds())[0]
  if (!connectionId) throw new Error('React Flow connection was not persisted')

  const edge = surface.locator(`.react-flow__edge[data-id="${connectionId}"]`)
  await expect(edge).toBeVisible()
  await expect(edge.locator('.react-flow__edge-path')).toBeVisible()
  await expect(editor.page.getByTestId(`react-flow-edge-label-${connectionId}`)).toContainText(
    'action'
  )
  await expect(sourceNode).toHaveCSS('width', '240px')
  await expect(sourceNode).toHaveCSS('height', '170px')
  await expect(sourceNode).not.toContainText('A view of the original OpenPencil object')
  await expect(surface.locator('.react-flow__edge.animated')).toHaveCount(0)
  await expect(edge.locator('.react-flow__edge-path')).not.toHaveCSS('filter', 'none')
  await expect(edge.locator('.react-flow__edge-path')).toHaveCSS(
    'vector-effect',
    'non-scaling-stroke'
  )
  await expect(edge.locator('.react-flow__edge-interaction')).toHaveCSS(
    'vector-effect',
    'non-scaling-stroke'
  )
  await expect(editor.page.locator('iframe')).toHaveCount(0)

  expect(
    await editor.page.evaluate((id) => {
      const store = window.openPencil?.getStore?.()
      return Boolean(store?.graph.getNode(id))
    }, connectionId)
  ).toBe(false)

  const beforeMove = await readNodePosition(targetId)
  const targetBox = await targetNode.boundingBox()
  if (!targetBox) throw new Error('React Flow target node is not visible')
  await targetNode.evaluate((element) => {
    element.setAttribute('data-projection-instance', 'stable')
  })
  const edgePath = edge.locator('.react-flow__edge-path')
  await edge.evaluate((element) => {
    element.setAttribute('data-edge-instance', 'move-stable')
  })
  const beforeMoveEdgePath = await edgePath.getAttribute('d')
  if (!beforeMoveEdgePath) throw new Error('React Flow edge path is unavailable')
  expect(beforeMoveEdgePath).toContain('C')
  await editor.page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(
    targetBox.x + targetBox.width / 2 + 120,
    targetBox.y + targetBox.height / 2 + 80,
    { steps: 12 }
  )
  await expect
    .poll(async () => (await targetNode.boundingBox())?.x ?? null)
    .toBeGreaterThan(targetBox.x + 80)
  await expect.poll(() => edgePath.getAttribute('d')).not.toBe(beforeMoveEdgePath)
  await editor.page.mouse.up()
  await expect.poll(() => readNodePosition(targetId)).not.toEqual(beforeMove)
  await expect(targetNode).toHaveAttribute('data-projection-instance', 'stable')
  await expect(edge).toHaveAttribute('data-edge-instance', 'move-stable')

  await editor.page.keyboard.press('Meta+z')
  await expect.poll(() => readNodePosition(targetId)).toEqual(beforeMove)

  await edge.locator('.react-flow__edge-interaction').click({ force: true })
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return store ? [...store.state.selectedIds] : []
      })
    )
    .toEqual([connectionId])
  await expect(editor.page.locator(`[data-node-id="${connectionId}"]`)).toHaveCount(0)
  await expect(editor.page.getByTestId('position-section')).toHaveCount(0)
  await expect(editor.page.getByTestId('layout-section')).toHaveCount(0)
  await expect(editor.page.getByTestId('object-graph-section')).toBeVisible()

  await editor.page.getByTestId(`react-flow-edge-delete-${connectionId}`).click()
  await expect.poll(readConnectionIds).toEqual([])
  await editor.page.keyboard.press('Meta+z')
  await expect.poll(readConnectionIds).toEqual([connectionId])

  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), sourceId)
  await expect(editor.page.getByTestId('properties-tab-code')).toHaveCount(0)
  await expect(sourceNode).toBeVisible()
  await expect(edge).toBeVisible()
  await expect(editor.page.getByTestId('object-graph-toggle-node')).toHaveCount(0)
  await expect(editor.page.getByTestId(`object-graph-connection-${connectionId}`)).toBeVisible()
  await edge.locator('.react-flow__edge-interaction').click({ force: true })
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return store ? [...store.state.selectedIds] : []
      })
    )
    .toEqual([connectionId])
  await expect(editor.page.locator(`[data-node-id="${connectionId}"]`)).toHaveCount(0)
  await expect(editor.page.getByTestId('position-section')).toHaveCount(0)

  const unexpectedErrors = unexpectedCanvasErrors(editor.canvas.errors)
  expect(unexpectedErrors).toEqual([])
  editor.canvas.errors.length = 0
  expect(await editor.page.getByTestId('canvas-area').screenshot()).toMatchSnapshot(
    'react-flow-object-graph.png'
  )

  await expect(sourceNode).toBeVisible()
  await expect(edge).toBeVisible()
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), sourceId)
  await expect(sourceOutline).toHaveCount(0)
  await edge.evaluate((element) => {
    element.setAttribute('data-edge-instance', 'pan-stable')
  })
  const edgeLabel = editor.page.getByTestId(`react-flow-edge-label-${connectionId}`)
  const arrow = edge.locator('.openpencil-object-graph-arrow path')
  const handleDot = sourceHandle.locator('.openpencil-object-graph-handle-dot')
  const beforeZoomChrome = await Promise.all([
    sourceHandle.boundingBox(),
    handleDot.boundingBox(),
    edgeLabel.boundingBox(),
    arrow.boundingBox()
  ])
  const beforeZoomEdgeStroke = Number.parseFloat(
    await edgePath.evaluate((element) => getComputedStyle(element).strokeWidth)
  )
  await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    for (let step = 1; step <= 12; step += 1) {
      store.setViewport({
        panX: step * 10,
        panY: step * (80 / 12),
        zoom: 1 + step * (0.25 / 12)
      })
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    }
  })
  await expect
    .poll(() =>
      surface
        .locator('.react-flow__viewport')
        .evaluate((element) => (element as HTMLElement).style.transform)
    )
    .toContain('translate(120px, 80px) scale(1.25)')
  await expect(targetNode).toHaveAttribute('data-projection-instance', 'stable')
  await expect(edge).toHaveAttribute('data-edge-instance', 'pan-stable')
  const afterZoomChrome = await Promise.all([
    sourceHandle.boundingBox(),
    handleDot.boundingBox(),
    edgeLabel.boundingBox(),
    arrow.boundingBox()
  ])
  const afterZoomEdgeStroke = Number.parseFloat(
    await edgePath.evaluate((element) => getComputedStyle(element).strokeWidth)
  )
  const [handleBeforeZoom, handleAfterZoom] = [beforeZoomChrome[0], afterZoomChrome[0]]
  if (!handleBeforeZoom || !handleAfterZoom) {
    throw new Error('Object Graph handle hit target is unavailable')
  }
  expect(Math.abs(handleBeforeZoom.width - handleAfterZoom.width)).toBeLessThan(1)
  expect(Math.abs(handleBeforeZoom.height - handleAfterZoom.height)).toBeLessThan(1)
  const [dotBeforeZoom, dotAfterZoom] = [beforeZoomChrome[1], afterZoomChrome[1]]
  if (!dotBeforeZoom || !dotAfterZoom) {
    throw new Error('Object Graph handle visual is unavailable')
  }
  expect(Math.abs(dotBeforeZoom.width - dotAfterZoom.width)).toBeLessThan(1)
  expect(Math.abs(dotBeforeZoom.height - dotAfterZoom.height)).toBeLessThan(1)
  expect(afterZoomEdgeStroke / beforeZoomEdgeStroke).toBeCloseTo(1.25, 1)
  for (const index of [2, 3]) {
    const before = beforeZoomChrome[index]
    const after = afterZoomChrome[index]
    if (!before || !after) throw new Error('Object Graph visual chrome is unavailable')
    expect(after.width / before.width).toBeCloseTo(1.25, 1)
    expect(after.height / before.height).toBeCloseTo(1.25, 1)
  }
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 120, panY: 80, zoom: 0.1 })
  })
  await expect
    .poll(() => edgePath.evaluate((element) => getComputedStyle(element).strokeWidth))
    .toBe('1.5px')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 0, panY: 0, zoom: 1 })
  })
  await editor.page.waitForTimeout(1_000)
  await expect(surface.locator('.react-flow__node')).toHaveCount(2)
  expect(unexpectedCanvasErrors(editor.canvas.errors)).toEqual([])
})

test('keeps a connector attached to Code Object and native endpoints while they and the viewport move', async () => {
  const codeObjectId = await createCodeObject('Code endpoint', 180, 180)
  const nativeId = await createRectangle('Native endpoint', 820, 300, {
    b: 0.48,
    g: 0.72,
    r: 0.12
  })
  const surface = editor.page.getByTestId('react-flow-object-graph')
  const codeNode = editor.page.getByTestId(`react-flow-node-${codeObjectId}`)
  const nativeNode = editor.page.getByTestId(`react-flow-node-${nativeId}`)
  const codeHandle = codeNode.locator('[data-handleid="port:right"]')
  const nativeHandle = nativeNode.locator('[data-handleid="port:left"]')
  await expect(codeNode).toBeVisible()
  await expect(nativeNode).toBeVisible()
  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), codeObjectId)
  const codeObjectSurface = editor.page.getByTestId(`code-object-${codeObjectId}`)
  const codeObjectControls = editor.page.getByTestId(`code-object-controls-${codeObjectId}`)
  const codeHandleDot = codeHandle.locator('.openpencil-object-graph-handle-dot')
  const resizeHandle = editor.page.getByTestId('code-object-resize-ne')
  await expect(codeObjectControls).toHaveCSS('border-radius', '16px')
  await expect(editor.page.getByTestId(`object-graph-outline-${codeObjectId}`)).toHaveCount(0)
  await expect(codeHandleDot).toBeVisible()
  await expect(resizeHandle).toBeVisible()
  const [surfaceBox, portBox, resizeBox] = await Promise.all([
    codeObjectSurface.boundingBox(),
    codeHandleDot.boundingBox(),
    resizeHandle.boundingBox()
  ])
  if (!surfaceBox || !portBox || !resizeBox) {
    throw new Error('Code Object selection controls are unavailable')
  }
  expect(portBox.x + portBox.width / 2 - (surfaceBox.x + surfaceBox.width)).toBeGreaterThan(5)
  expect(Math.abs(portBox.width - resizeBox.width)).toBeLessThan(1)
  expect(Math.abs(portBox.height - resizeBox.height)).toBeLessThan(1)
  expect(
    await codeHandleDot.evaluate((element) => getComputedStyle(element).backgroundColor)
  ).not.toBe(await resizeHandle.evaluate((element) => getComputedStyle(element).backgroundColor))
  expect(
    await codeHandleDot.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return document
        .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest('.openpencil-object-graph-handle')
        ?.getAttribute('data-handleid')
    })
  ).toBe('port:right')
  await dragBetween(codeHandle, nativeHandle)

  await expect.poll(readConnectionIds).toHaveLength(1)
  const connectionId = (await readConnectionIds())[0]
  if (!connectionId) throw new Error('Code Object connection was not persisted')
  const edge = surface.locator(`.react-flow__edge[data-id="${connectionId}"]`)
  const edgePath = edge.locator('.react-flow__edge-path')
  const edgeArrow = edge.locator('.openpencil-object-graph-arrow path')
  const edgeLabel = editor.page.getByTestId(`react-flow-edge-label-${connectionId}`)
  await expect(edge).toBeVisible()
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)
  const sourceAttachment = await readCodeObjectSourceAttachmentOffset(edgePath, codeObjectId)
  expect(Math.abs(sourceAttachment.x)).toBeLessThan(1)
  expect(Math.abs(sourceAttachment.y)).toBeLessThan(1)

  const codeDesignTarget = editor.page
    .getByTestId(`code-object-overlay-${codeObjectId}`)
    .getByTestId('code-object-design-hit-target')
  const codeBox = await codeNode.boundingBox()
  if (!codeBox) throw new Error('Code Object projection is not visible')
  const dragStart = {
    x: codeBox.x + codeBox.width / 2,
    y: codeBox.y + codeBox.height / 2
  }
  const dragEnd = {
    x: dragStart.x + 120,
    y: codeBox.y + 90
  }
  const initialAttachment = await readCodeObjectSourceAttachmentOffset(edgePath, codeObjectId)
  await editor.page.mouse.move(dragStart.x, dragStart.y)
  await editor.page.mouse.down()
  const attachmentGaps: number[] = []
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8
    await editor.page.mouse.move(
      dragStart.x + (dragEnd.x - dragStart.x) * progress,
      dragStart.y + (dragEnd.y - dragStart.y) * progress
    )
    const attachment = await readCodeObjectSourceAttachmentOffset(edgePath, codeObjectId)
    attachmentGaps.push(
      Math.hypot(attachment.x - initialAttachment.x, attachment.y - initialAttachment.y)
    )
    if (step === 4) {
      expect(await editor.page.getByTestId('canvas-area').screenshot()).toMatchSnapshot(
        'react-flow-code-object-mid-drag.png'
      )
    }
  }
  expect(Math.max(...attachmentGaps)).toBeLessThan(2)
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)
  await editor.page.mouse.up()
  await expect(codeDesignTarget).toBeVisible()
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)

  const nativeBox = await nativeNode.boundingBox()
  if (!nativeBox) throw new Error('Native projection is not visible')
  await editor.page.mouse.move(
    nativeBox.x + nativeBox.width / 2,
    nativeBox.y + nativeBox.height / 2
  )
  await editor.page.mouse.down()
  await editor.page.mouse.move(nativeBox.x + nativeBox.width / 2 + 80, nativeBox.y + 120, {
    steps: 8
  })
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)
  await editor.page.mouse.up()
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)

  const handleBeforeResize = await codeHandle.boundingBox()
  const [strokeBeforeResize, scaleBeforeResize, arrowBeforeResize, labelBeforeResize] =
    await Promise.all([
      edgePath.evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth)),
      edgeLabel.getAttribute('data-object-scale').then(Number),
      edgeArrow.boundingBox(),
      edgeLabel.boundingBox()
    ])
  expect(strokeBeforeResize).toBeGreaterThanOrEqual(1.5)
  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!store || !node) throw new Error('Code Object is unavailable for resize')
    store.updateNodeWithUndo(
      id,
      { height: node.height + 120, width: node.width + 180 },
      'Resize connected Code Object'
    )
  }, codeObjectId)
  await expect(codeNode).toHaveCSS('width', '540px')
  await expect(codeNode).toHaveCSS('height', '380px')
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)
  const handleAfterResize = await codeHandle.boundingBox()
  const [strokeAfterResize, scaleAfterResize, arrowAfterResize, labelAfterResize] =
    await Promise.all([
      edgePath.evaluate((element) => Number.parseFloat(getComputedStyle(element).strokeWidth)),
      edgeLabel.getAttribute('data-object-scale').then(Number),
      edgeArrow.boundingBox(),
      edgeLabel.boundingBox()
    ])
  if (!handleBeforeResize || !handleAfterResize) {
    throw new Error('Code Object graph handle is unavailable after resize')
  }
  expect(Math.abs(handleBeforeResize.width - handleAfterResize.width)).toBeLessThan(1)
  expect(Math.abs(handleBeforeResize.height - handleAfterResize.height)).toBeLessThan(1)
  expect(scaleBeforeResize).toBeCloseTo(1.33, 2)
  expect(scaleAfterResize).toBeCloseTo(1.74, 2)
  const scaleChange = scaleAfterResize / scaleBeforeResize
  expect(strokeAfterResize / strokeBeforeResize).toBeCloseTo(scaleChange, 2)
  if (!arrowBeforeResize || !arrowAfterResize || !labelBeforeResize || !labelAfterResize) {
    throw new Error('Visible connector chrome is unavailable after object resize')
  }
  expect(arrowAfterResize.width / arrowBeforeResize.width).toBeCloseTo(scaleChange, 1)
  expect(arrowAfterResize.height / arrowBeforeResize.height).toBeCloseTo(scaleChange, 1)
  expect(labelAfterResize.width / labelBeforeResize.width).toBeCloseTo(scaleChange, 1)
  expect(labelAfterResize.height / labelBeforeResize.height).toBeCloseTo(scaleChange, 1)

  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.updateNodeWithUndo(id, { rotation: 30 }, 'Rotate connected Code Object')
  }, codeObjectId)
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)

  const handleBeforeZoom = await codeHandle.boundingBox()
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 130, panY: 75, zoom: 1.35 })
  })
  await expect
    .poll(() =>
      surface
        .locator('.react-flow__viewport')
        .evaluate((element) => (element as HTMLElement).style.transform)
    )
    .toContain('translate(130px, 75px) scale(1.35)')
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)
  const handleAfterZoom = await codeHandle.boundingBox()
  if (!handleBeforeZoom || !handleAfterZoom) {
    throw new Error('Code Object graph handle is unavailable after zoom')
  }
  expect(Math.abs(handleBeforeZoom.width - handleAfterZoom.width)).toBeLessThan(1)
  expect(Math.abs(handleBeforeZoom.height - handleAfterZoom.height)).toBeLessThan(1)
})
