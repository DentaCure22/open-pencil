import type { Page } from '@playwright/test'

import type { Vector } from '@open-pencil/scene-graph'

export async function createTestRectangle(
  page: Page,
  name: string,
  x: number,
  y: number,
  color: { b: number; g: number; r: number }
): Promise<string> {
  return page.evaluate(
    ({ color, name, x, y }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
        cornerRadius: 24,
        fills: [
          {
            color: { ...color, a: 1 },
            opacity: 1,
            type: 'SOLID',
            visible: true
          }
        ],
        height: 170,
        name,
        strokes: [],
        width: 240,
        x,
        y
      })
      store.requestRender()
      return node.id
    },
    { color, name, x, y }
  )
}

export async function createTestCodeObject(
  page: Page,
  name: string,
  x: number,
  y: number
): Promise<string> {
  return page.evaluate(
    async ({ name, x, y }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const { createCodeObject, createUserCodeObjectDocument } =
        await import('/src/app/code-object/model.ts')
      const frame = createCodeObject(store, {
        cornerRadius: 16,
        document: createUserCodeObjectDocument({ name }),
        height: 260,
        name,
        width: 360,
        x,
        y
      })
      store.requestRender()
      return frame.id
    },
    { name, x, y }
  )
}

export async function connectTestObjectGraphNodes(
  page: Page,
  sourceNodeId: string,
  targetNodeId: string
): Promise<string> {
  return page.evaluate(
    async ({ sourceNodeId, targetNodeId }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      const { connectObjects } = await import('/src/app/object-graph/actions.ts')
      const connection = connectObjects(store, {
        kind: 'visual',
        sourceNodeId,
        targetNodeId
      })
      if (!connection) throw new Error('Object Graph connection was not created')
      return connection.id
    },
    { sourceNodeId, targetNodeId }
  )
}

export async function readTestNodePosition(page: Page, nodeId: string): Promise<Vector> {
  return page.evaluate((id) => {
    const node = window.openPencil?.getStore?.().graph.getNode(id)
    if (!node) throw new Error('OpenPencil object unavailable')
    return { x: node.x, y: node.y }
  }, nodeId)
}
