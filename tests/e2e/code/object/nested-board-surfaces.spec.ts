import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test('keeps nested iframe and agent surfaces on one Board presentation layer', async ({ page }) => {
  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await canvas.clearCanvas()

  const ids = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const {
      createAgentConversationTerminalDocument,
      createCodeObject,
      createUserCodeObjectDocument
    } = await import('/src/app/code-object/model.ts')
    const parent = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 1200,
      name: 'Dental Chart Workspace',
      width: 1800,
      x: -900,
      y: 160
    })
    const iframe = createCodeObject(store, {
      document: createUserCodeObjectDocument({ name: 'Nested iframe' }),
      height: 320,
      name: 'Nested iframe',
      parentId: parent.id,
      width: 520,
      x: 80,
      y: 120
    })
    const agent = createCodeObject(store, {
      document: createAgentConversationTerminalDocument({
        name: 'Task conversation',
        workerConversationId: 'thread-1'
      }),
      height: 320,
      name: 'Task conversation',
      parentId: parent.id,
      width: 520,
      x: 680,
      y: 120
    })
    store.setViewport({ panX: 300, panY: 220, zoom: 0.5 })
    store.requestRender()
    return { agent: agent.id, iframe: iframe.id, parent: parent.id }
  })

  const iframeSurface = page.getByTestId(`code-object-${ids.iframe}`)
  const agentSurface = page.getByTestId(`code-object-${ids.agent}`)
  await expect(iframeSurface).toBeVisible()
  await expect(agentSurface).toBeVisible()
  await canvas.waitForRender()

  const readSurfaceState = () =>
    page.evaluate(({ agent, iframe }) => {
      const iframeElement = document.querySelector(`[data-test-id="code-object-${iframe}"]`)
      const agentElement = document.querySelector(`[data-test-id="code-object-${agent}"]`)
      if (!iframeElement || !agentElement) throw new Error('Expected both nested Board surfaces')
      const iframeBounds = iframeElement.getBoundingClientRect()
      const agentBounds = agentElement.getBoundingClientRect()
      return {
        agent: { x: agentBounds.x, y: agentBounds.y },
        iframe: { x: iframeBounds.x, y: iframeBounds.y },
        zIndex: {
          agent: getComputedStyle(agentElement).zIndex,
          iframe: getComputedStyle(iframeElement).zIndex
        }
      }
    }, ids)

  const before = await readSurfaceState()
  expect(before.zIndex).toEqual({ agent: '4', iframe: '4' })

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.setViewport({ panX: 540, panY: 100, zoom: 0.5 })
  })
  await canvas.waitForRender()
  const after = await readSurfaceState()

  expect({
    agent: { x: after.agent.x - before.agent.x, y: after.agent.y - before.agent.y },
    iframe: { x: after.iframe.x - before.iframe.x, y: after.iframe.y - before.iframe.y }
  }).toEqual({
    agent: { x: 240, y: -120 },
    iframe: { x: 240, y: -120 }
  })
})
