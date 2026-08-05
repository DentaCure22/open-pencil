import type { Locator } from '@playwright/test'

import type { Rect, Vector } from '@open-pencil/scene-graph'

import { isBenignResizeObserverError } from '@/app/shell/ui'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import {
  createTestCodeObject,
  createTestRectangle,
  readTestNodePosition,
  readTestSelectedIds
} from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

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

type TestDatabaseSchemaField = {
  key: 'FK' | 'PK' | null
  name: string
  required: boolean
  type: string
}

const DATABASE_SCHEMA_HEADER_HEIGHT = 36
const DATABASE_SCHEMA_HEADER_OVERLAP = 0
const DATABASE_SCHEMA_BODY_PADDING = 0
const DATABASE_SCHEMA_ROW_HEIGHT = 32
const DATABASE_SCHEMA_MINIMUM_HEIGHT = 36

function databaseSchemaHeight(fieldCount: number): number {
  return Math.max(
    DATABASE_SCHEMA_MINIMUM_HEIGHT,
    DATABASE_SCHEMA_HEADER_HEIGHT -
      DATABASE_SCHEMA_HEADER_OVERLAP +
      DATABASE_SCHEMA_BODY_PADDING +
      fieldCount * DATABASE_SCHEMA_ROW_HEIGHT
  )
}

async function createTestDatabaseSchemaNode(
  name: string,
  table: string,
  fields: TestDatabaseSchemaField[],
  x: number,
  y: number
): Promise<string> {
  return editor.page.evaluate(
    async ({ fields, height, name, table, x, y }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const { createCodeObject, createUserCodeObjectDocument } =
        await import('/src/app/code-object/model.ts')
      const frame = createCodeObject(store, {
        document: createUserCodeObjectDocument({
          definitionId: `registry:database-schema-node:e2e:${table.toLowerCase()}:v2`,
          name,
          props: { fields, table },
          source: 'export default function Schema({ renderComponent }) { return renderComponent() }'
        }),
        height,
        name,
        width: 400,
        x,
        y
      })
      store.requestRender()
      return frame.id
    },
    { fields, height: databaseSchemaHeight(fields.length), name, table, x, y }
  )
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
  return messages.filter((message) => !isBenignResizeObserverError(message))
}

test('uses React Flow connections on the ordinary OpenPencil board', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 120, panY: 80, zoom: 0.75 })
  })
  const sourceId = await createTestRectangle(editor.page, 'Controller', 350, 230, {
    b: 0.95,
    g: 0.27,
    r: 0.55
  })
  const targetId = await createTestRectangle(editor.page, 'Result card', 690, 330, {
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
  await expect(surface.locator('.react-flow__attribution')).toHaveCount(0)
  await expect(editor.page.getByTestId('object-graph-toggle-node')).toHaveCount(0)

  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(surface.locator('.react-flow')).toBeVisible()
  await expect
    .poll(() =>
      surface
        .locator('.react-flow__viewport')
        .evaluate((element) => (element as HTMLElement).style.transform)
    )
    .toContain('translate(120px, 80px) scale(0.75)')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 0, panY: 0, zoom: 1 })
  })
  await expect
    .poll(() =>
      surface
        .locator('.react-flow__viewport')
        .evaluate((element) => (element as HTMLElement).style.transform)
    )
    .toContain('translate(0px, 0px) scale(1)')
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
  await expect(editor.page.getByTestId(`react-flow-edge-label-${connectionId}`)).toHaveCount(0)
  await expect(edge.locator('.openpencil-object-graph-arrow')).toHaveCount(0)
  await expect(sourceNode).toHaveCSS('width', '240px')
  await expect(sourceNode).toHaveCSS('height', '170px')
  await expect(sourceNode).not.toContainText('A view of the original OpenPencil object')
  await expect(surface.locator('.react-flow__edge.animated')).toHaveCount(0)
  await expect(edge.locator('.react-flow__edge-path')).toHaveCSS('filter', 'none')
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
  await expect(edgePath).toHaveCSS('vector-effect', 'non-scaling-stroke')
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
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([connectionId])
  await expect(editor.page.locator(`[data-node-id="${connectionId}"]`)).toHaveCount(0)
  await expect(editor.page.getByTestId('position-section')).toHaveCount(0)
  await expect(editor.page.getByTestId('layout-section')).toHaveCount(0)
  await expect(editor.page.getByTestId('object-graph-section')).toBeVisible()
  await expect(editor.page.getByTestId(`react-flow-endpoint-source-${sourceId}`)).toBeVisible()
  await expect(editor.page.getByTestId(`react-flow-endpoint-target-${targetId}`)).toBeVisible()

  await editor.page.keyboard.press('ArrowLeft')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([sourceId])
  await expect(editor.page.getByTestId('object-graph-navigation-status')).toContainText(
    'Focused Controller'
  )
  await expect(editor.page.getByTestId(`react-flow-endpoint-target-${targetId}`)).toBeVisible()
  await editor.page.keyboard.press('ArrowRight')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([connectionId])
  await editor.page.keyboard.press('ArrowRight')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([targetId])
  await editor.page.keyboard.press('Escape')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([connectionId])
  await expect(editor.page.getByTestId('object-graph-navigation-status')).toHaveCount(0)

  await editor.page.keyboard.press('Delete')
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
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([connectionId])
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
  const handleDot = sourceHandle
  const beforeZoomChrome = await Promise.all([sourceHandle.boundingBox(), handleDot.boundingBox()])
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
  const afterZoomChrome = await Promise.all([sourceHandle.boundingBox(), handleDot.boundingBox()])
  const afterZoomEdgeStroke = Number.parseFloat(
    await edgePath.evaluate((element) => getComputedStyle(element).strokeWidth)
  )
  const [handleBeforeZoom, handleAfterZoom] = [beforeZoomChrome[0], afterZoomChrome[0]]
  if (!handleBeforeZoom || !handleAfterZoom) {
    throw new Error('Object Graph handle hit target is unavailable')
  }
  expect(handleAfterZoom.width / handleBeforeZoom.width).toBeCloseTo(1.25, 1)
  expect(handleAfterZoom.height / handleBeforeZoom.height).toBeCloseTo(1.25, 1)
  const [dotBeforeZoom, dotAfterZoom] = [beforeZoomChrome[1], afterZoomChrome[1]]
  if (!dotBeforeZoom || !dotAfterZoom) {
    throw new Error('Object Graph handle visual is unavailable')
  }
  expect(dotAfterZoom.width / dotBeforeZoom.width).toBeCloseTo(1.25, 1)
  expect(dotAfterZoom.height / dotBeforeZoom.height).toBeCloseTo(1.25, 1)
  expect(afterZoomEdgeStroke).toBe(beforeZoomEdgeStroke)
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 120, panY: 80, zoom: 0.1 })
  })
  await expect
    .poll(() => edgePath.evaluate((element) => getComputedStyle(element).strokeWidth))
    .toBe(`${beforeZoomEdgeStroke}px`)
  await expect(editor.page.getByTestId(`react-flow-edge-label-${connectionId}`)).toHaveCount(0)
  await expect(edge.locator('.openpencil-object-graph-arrow')).toHaveCount(0)
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 0, panY: 0, zoom: 1 })
  })
  await editor.page.waitForTimeout(1_000)
  await expect(surface.locator('.react-flow__node')).toHaveCount(2)
  expect(unexpectedCanvasErrors(editor.canvas.errors)).toEqual([])
})

test('connects multiple schema rows through distinct named Code Object ports', async () => {
  const products = [
    { key: 'PK', name: 'id', required: true, type: 'uuid' },
    { key: null, name: 'sku', required: true, type: 'varchar(64)' },
    { key: null, name: 'name', required: true, type: 'text' },
    { key: 'FK', name: 'warehouse_id', required: true, type: 'uuid' },
    { key: 'FK', name: 'supplier_id', required: true, type: 'uuid' }
  ] satisfies TestDatabaseSchemaField[]
  const warehouses = [
    { key: 'PK', name: 'id', required: true, type: 'uuid' },
    { key: null, name: 'name', required: true, type: 'text' },
    { key: null, name: 'capacity', required: false, type: 'integer' }
  ] satisfies TestDatabaseSchemaField[]
  const suppliers = [
    { key: 'PK', name: 'id', required: true, type: 'uuid' },
    { key: null, name: 'name', required: true, type: 'text' },
    { key: null, name: 'country', required: false, type: 'text' }
  ] satisfies TestDatabaseSchemaField[]
  const sourceId = await createTestDatabaseSchemaNode(
    'Products schema',
    'Products',
    products,
    180,
    260
  )
  const warehouseId = await createTestDatabaseSchemaNode(
    'Warehouses schema',
    'Warehouses',
    warehouses,
    760,
    120
  )
  const supplierId = await createTestDatabaseSchemaNode(
    'Suppliers schema',
    'Suppliers',
    suppliers,
    760,
    500
  )

  await editor.page.evaluate(
    async ({ metrics, nodes }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const { setObjectGraphPorts } = await import('/packages/scene-graph/src/object-graph.ts')
      for (const node of nodes) {
        const height = Math.max(
          metrics.minimumHeight,
          metrics.headerHeight -
            metrics.headerOverlap +
            metrics.bodyPadding +
            node.fields.length * metrics.rowHeight
        )
        setObjectGraphPorts(
          store.graph,
          node.id,
          node.fields.flatMap((field, index) => {
            const offset =
              (metrics.headerHeight -
                metrics.headerOverlap +
                metrics.bodyPadding / 2 +
                index * metrics.rowHeight +
                metrics.rowHeight / 2) /
              height
            return [
              {
                direction: 'input' as const,
                id: `field/${field}/input`,
                kinds: ['data' as const],
                label: `${field} input`,
                offset,
                side: 'left' as const
              },
              {
                direction: 'output' as const,
                id: `field/${field}/output`,
                kinds: ['data' as const],
                label: `${field} output`,
                offset,
                side: 'right' as const
              }
            ]
          })
        )
      }
      store.requestRender()
    },
    {
      metrics: {
        bodyPadding: DATABASE_SCHEMA_BODY_PADDING,
        headerHeight: DATABASE_SCHEMA_HEADER_HEIGHT,
        headerOverlap: DATABASE_SCHEMA_HEADER_OVERLAP,
        minimumHeight: DATABASE_SCHEMA_MINIMUM_HEIGHT,
        rowHeight: DATABASE_SCHEMA_ROW_HEIGHT
      },
      nodes: [
        { fields: products.map(({ name }) => name), id: sourceId },
        { fields: warehouses.map(({ name }) => name), id: warehouseId },
        { fields: suppliers.map(({ name }) => name), id: supplierId }
      ]
    }
  )

  const surface = editor.page.getByTestId('react-flow-object-graph')
  const sourceNode = editor.page.getByTestId(`react-flow-node-${sourceId}`)
  const warehouseNode = editor.page.getByTestId(`react-flow-node-${warehouseId}`)
  const supplierNode = editor.page.getByTestId(`react-flow-node-${supplierId}`)
  const warehouseSourceHandle = sourceNode.locator(
    '[data-handleid="named-port:field%2Fwarehouse_id%2Foutput"]'
  )
  const supplierSourceHandle = sourceNode.locator(
    '[data-handleid="named-port:field%2Fsupplier_id%2Foutput"]'
  )
  const warehouseTargetHandle = warehouseNode.locator(
    '[data-handleid="named-port:field%2Fid%2Finput"]'
  )
  const supplierTargetHandle = supplierNode.locator(
    '[data-handleid="named-port:field%2Fid%2Finput"]'
  )
  const sourceSurface = editor.page.getByTestId(`code-object-${sourceId}`)
  const warehouseRow = sourceSurface.locator('[data-openpencil-field="warehouse_id"]')
  const supplierRow = sourceSurface.locator('[data-openpencil-field="supplier_id"]')
  await expect(sourceSurface).toContainText('Products')
  await expect(sourceNode.locator('[data-handleid^="named-port:"]')).toHaveCount(10)
  await expect(warehouseNode.locator('[data-handleid^="named-port:"]')).toHaveCount(6)
  await expect(supplierNode.locator('[data-handleid^="named-port:"]')).toHaveCount(6)
  await expect(warehouseSourceHandle).toHaveAttribute('aria-label', 'warehouse_id output')
  await expect(supplierSourceHandle).toHaveAttribute('aria-label', 'supplier_id output')
  await expect(warehouseTargetHandle).toHaveAttribute('aria-label', 'id input')
  await expect(supplierTargetHandle).toHaveAttribute('aria-label', 'id input')
  await expect(warehouseSourceHandle).toHaveCSS('opacity', '1')
  await expect(supplierSourceHandle).toHaveCSS('opacity', '1')

  const [warehouseRowBox, supplierRowBox, warehouseHandleBox, supplierHandleBox] =
    await Promise.all([
      warehouseRow.boundingBox(),
      supplierRow.boundingBox(),
      warehouseSourceHandle.boundingBox(),
      supplierSourceHandle.boundingBox()
    ])
  if (!warehouseRowBox || !supplierRowBox || !warehouseHandleBox || !supplierHandleBox) {
    throw new Error('Database schema rows or named handles are not visible')
  }
  expect(
    Math.abs(
      warehouseRowBox.y +
        warehouseRowBox.height / 2 -
        (warehouseHandleBox.y + warehouseHandleBox.height / 2)
    )
  ).toBeLessThan(2)
  expect(
    Math.abs(
      supplierRowBox.y +
        supplierRowBox.height / 2 -
        (supplierHandleBox.y + supplierHandleBox.height / 2)
    )
  ).toBeLessThan(2)
  expect(Math.abs(warehouseHandleBox.y - supplierHandleBox.y)).toBeGreaterThan(30)

  await dragBetween(warehouseSourceHandle, warehouseTargetHandle)
  await dragBetween(supplierSourceHandle, supplierTargetHandle)
  await expect.poll(readConnectionIds).toHaveLength(2)
  const connections = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const { objectGraphConnectionsOnPage } =
      await import('/packages/scene-graph/src/object-graph.ts')
    return objectGraphConnectionsOnPage(store.graph, store.state.currentPageId)
      .map((connection) => ({
        id: connection.id,
        sourcePortId: connection.sourcePortId,
        targetNodeId: connection.targetNodeId,
        targetPortId: connection.targetPortId
      }))
      .sort((left, right) => (left.sourcePortId ?? '').localeCompare(right.sourcePortId ?? ''))
  })
  expect(connections).toMatchObject([
    {
      sourcePortId: 'field/supplier_id/output',
      targetNodeId: supplierId,
      targetPortId: 'field/id/input'
    },
    {
      sourcePortId: 'field/warehouse_id/output',
      targetNodeId: warehouseId,
      targetPortId: 'field/id/input'
    }
  ])

  for (const connection of connections) {
    const isWarehouse = connection.sourcePortId === 'field/warehouse_id/output'
    const edgePath = surface
      .locator(`.react-flow__edge[data-id="${connection.id}"]`)
      .locator('.react-flow__edge-path')
    await expectEdgeEndpointsAttached(
      edgePath,
      isWarehouse ? warehouseSourceHandle : supplierSourceHandle,
      isWarehouse ? warehouseTargetHandle : supplierTargetHandle
    )
  }

  const resizedSourceHeight = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    if (!store || !node) throw new Error('Database schema Code Object is unavailable for resize')
    const height = node.height + 320
    store.updateNodeWithUndo(id, { height }, 'Resize schema container')
    return height
  }, sourceId)
  await expect(sourceSurface).toHaveCSS('height', `${resizedSourceHeight}px`)
  await expect
    .poll(async () => {
      const [row, handle] = await Promise.all([
        warehouseRow.boundingBox(),
        warehouseSourceHandle.boundingBox()
      ])
      if (!row || !handle) return Number.POSITIVE_INFINITY
      return Math.abs(row.y + row.height / 2 - (handle.y + handle.height / 2))
    })
    .toBeLessThan(2)
  await expect
    .poll(async () => {
      const [row, handle] = await Promise.all([
        supplierRow.boundingBox(),
        supplierSourceHandle.boundingBox()
      ])
      if (!row || !handle) return Number.POSITIVE_INFINITY
      return Math.abs(row.y + row.height / 2 - (handle.y + handle.height / 2))
    })
    .toBeLessThan(2)
  await warehouseRow.evaluate((row) => {
    const spacer = document.createElement('tr')
    spacer.dataset.testId = 'schema-runtime-reflow-spacer'
    spacer.style.height = '48px'
    row.parentElement?.insertBefore(spacer, row)
  })
  await expect
    .poll(async () => {
      const [row, handle] = await Promise.all([
        warehouseRow.boundingBox(),
        warehouseSourceHandle.boundingBox()
      ])
      if (!row || !handle) return Number.POSITIVE_INFINITY
      return Math.abs(row.y + row.height / 2 - (handle.y + handle.height / 2))
    })
    .toBeLessThan(2)
  for (const connection of connections) {
    const isWarehouse = connection.sourcePortId === 'field/warehouse_id/output'
    const edgePath = surface
      .locator(`.react-flow__edge[data-id="${connection.id}"]`)
      .locator('.react-flow__edge-path')
    await expectEdgeEndpointsAttached(
      edgePath,
      isWarehouse ? warehouseSourceHandle : supplierSourceHandle,
      isWarehouse ? warehouseTargetHandle : supplierTargetHandle
    )
  }
})

test('restores persisted target handles before rendering React Flow edges', async () => {
  editor.canvas.errors.length = 0
  const probe = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const [{ deserializeSceneGraph, serializeSceneGraph }, { connectObjects }] = await Promise.all([
      import('/packages/core/src/kiwi/index.ts'),
      import('/src/app/object-graph/actions.ts')
    ])
    const rectangle = (name: string, x: number, y: number) =>
      store.graph.createNode('RECTANGLE', store.state.currentPageId, {
        height: 170,
        name,
        width: 240,
        x,
        y
      })
    const leftSource = rectangle('Reload left source', 180, 180)
    const leftTarget = rectangle('Reload left target', 620, 180)
    const topSource = rectangle('Reload top source', 180, 360)
    const topTarget = rectangle('Reload top target', 180, 580)
    const leftConnection = connectObjects(store, {
      kind: 'visual',
      sourceNodeId: leftSource.id,
      sourcePort: 'right',
      targetNodeId: leftTarget.id,
      targetPort: 'left'
    })
    const topConnection = connectObjects(store, {
      kind: 'data',
      sourceNodeId: topSource.id,
      sourcePort: 'bottom',
      targetNodeId: topTarget.id,
      targetPort: 'top'
    })
    if (!leftConnection || !topConnection) {
      throw new Error('Persisted Object Graph fixture was not created')
    }
    const restored = deserializeSceneGraph(structuredClone(serializeSceneGraph(store.graph)))
    store.replaceGraph(restored)
    return {
      connections: [
        {
          id: leftConnection.id,
          sourceHandle: 'port:right',
          sourceId: leftSource.id,
          targetHandle: 'port:left',
          targetId: leftTarget.id
        },
        {
          id: topConnection.id,
          sourceHandle: 'port:bottom',
          sourceId: topSource.id,
          targetHandle: 'port:top',
          targetId: topTarget.id
        }
      ]
    }
  })

  const surface = editor.page.getByTestId('react-flow-object-graph')
  await expect(surface).toBeVisible()
  for (const connection of probe.connections) {
    const edge = surface.locator(`.react-flow__edge[data-id="${connection.id}"]`)
    const sourceHandle = editor.page
      .getByTestId(`react-flow-node-${connection.sourceId}`)
      .locator(`[data-handleid="${connection.sourceHandle}"]`)
    const targetHandle = editor.page
      .getByTestId(`react-flow-node-${connection.targetId}`)
      .locator(`[data-handleid="${connection.targetHandle}"]`)
    const edgePath = edge.locator('.react-flow__edge-path')
    await expect(edge).toBeVisible()
    await expect(edgePath).toHaveAttribute('d', /^M/)
    await expect(edgePath).not.toHaveCSS('stroke', 'none')
    await expect(edge.locator('.openpencil-object-graph-arrow')).toHaveCount(0)
    await expect(editor.page.getByTestId(`react-flow-edge-label-${connection.id}`)).toHaveCount(0)
    await expectEdgeEndpointsAttached(edgePath, sourceHandle, targetHandle)
  }

  expect(unexpectedCanvasErrors(editor.canvas.errors)).toEqual([])
})

test('keeps a connector attached to Code Object and native endpoints while they and the viewport move', async () => {
  const codeObjectId = await createTestCodeObject(editor.page, 'Code endpoint', 180, 180)
  const nativeId = await createTestRectangle(editor.page, 'Native endpoint', 820, 300, {
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
  const codeHandleDot = codeHandle
  const resizeHandle = editor.page.getByTestId('code-object-resize-ne')
  await expect(codeObjectControls).toHaveCSS('border-radius', '16px')
  await expect(editor.page.getByTestId(`object-graph-outline-${codeObjectId}`)).toHaveCount(0)
  await expect(codeHandleDot).toBeVisible()
  await expect(resizeHandle).toBeVisible()
  const [surfaceBox, portBox] = await Promise.all([
    codeObjectSurface.boundingBox(),
    codeHandleDot.boundingBox()
  ])
  if (!surfaceBox || !portBox) {
    throw new Error('Code Object selection controls are unavailable')
  }
  expect(Math.abs(portBox.x + portBox.width / 2 - (surfaceBox.x + surfaceBox.width))).toBeLessThan(
    1
  )
  expect(portBox.width).toBeGreaterThan(4)
  expect(portBox.height).toBeGreaterThan(4)
  await expect(codeHandleDot).toHaveCSS('width', '11px')
  await expect(codeHandleDot).toHaveCSS('height', '11px')
  await expect(codeHandleDot).toHaveCSS('border-top-width', '1px')
  expect(
    await codeHandleDot.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).borderRadius)
    )
  ).toBeGreaterThan(5)
  await codeHandle.hover()
  await expect(codeHandleDot).toHaveCSS('width', '11px')
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
  await expect(edge).toBeVisible()
  await expect(edge.locator('.openpencil-object-graph-arrow')).toHaveCount(0)
  await expect(editor.page.getByTestId(`react-flow-edge-label-${connectionId}`)).toHaveCount(0)
  await expectEdgeEndpointsAttached(edgePath, codeHandle, nativeHandle)
  const sourceAttachment = await readCodeObjectSourceAttachmentOffset(edgePath, codeObjectId)
  expect(Math.abs(sourceAttachment.x - 5.5)).toBeLessThan(1)
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
  const strokeBeforeResize = await edgePath.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).strokeWidth)
  )
  expect(strokeBeforeResize).toBeGreaterThan(0)
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
  const strokeAfterResize = await edgePath.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).strokeWidth)
  )
  if (!handleBeforeResize || !handleAfterResize) {
    throw new Error('Code Object graph handle is unavailable after resize')
  }
  expect(Math.abs(handleBeforeResize.width - handleAfterResize.width)).toBeLessThan(1)
  expect(Math.abs(handleBeforeResize.height - handleAfterResize.height)).toBeLessThan(1)
  expect(strokeAfterResize).toBe(strokeBeforeResize)

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
  expect(handleAfterZoom.width / handleBeforeZoom.width).toBeCloseTo(1.35, 1)
  expect(handleAfterZoom.height / handleBeforeZoom.height).toBeCloseTo(1.35, 1)
})
