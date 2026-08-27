import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'
import { getLocalStorageItem, setLocalStorageItem } from '#tests/helpers/storage'

const PAGE_ID = 'page:project-frame-interaction'
const FRAME_ID = 'frame:project-frame-interaction'
const PARENT_FRAME_ID = 'frame:project-frame-parent'

test('project Frame chrome matches normal object interaction and opens its directory', async ({
  page
}) => {
  const workMap = {
    bots: [],
    inbox: [],
    placements: [
      {
        manual: true,
        projectId: 'project:interaction',
        threadId: 'thread:sub-bot-demo',
        updatedAt: '2026-08-27T00:00:00.000Z'
      }
    ],
    projects: [
      {
        createdAt: '2026-08-27T00:00:00.000Z',
        id: 'project:root',
        name: 'Clinical workspace',
        spaceFrameId: PARENT_FRAME_ID,
        spacePageId: PAGE_ID,
        updatedAt: '2026-08-27T00:00:00.000Z'
      },
      {
        createdAt: '2026-08-27T00:00:00.000Z',
        id: 'project:interaction',
        name: 'Dental Chart',
        parentId: 'project:root',
        spaceFrameId: FRAME_ID,
        spacePageId: PAGE_ID,
        updatedAt: '2026-08-27T00:00:00.000Z'
      }
    ],
    revision: 1,
    routines: [],
    todos: []
  }

  await Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({ body: '{"threads":[]}', contentType: 'application/json' })
    ),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({ body: '{"models":[]}', contentType: 'application/json' })
    ),
    page.route(/\/agent-router\/v1\/pi\/work-map$/, (route) =>
      route.fulfill({ body: JSON.stringify(workMap), contentType: 'application/json' })
    )
  ])
  await setLocalStorageItem(page, 'open-pencil:agent-chats-panel-view-v1', 'conversation')
  await setLocalStorageItem(page, 'open-pencil:work-map-collapsed-board-directories-v1', '{}')
  await setLocalStorageItem(
    page,
    'open-pencil:work-map-open-projects-v1',
    JSON.stringify({ 'project:interaction': false })
  )

  await page.goto('/?test&no-rulers')
  const canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  const childId = await page.evaluate(
    async ({ frameId, pageId, parentFrameId }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')
      store.graph.createNodeWithId(pageId, 'CANVAS', store.graph.rootId, {
        name: 'Project interaction'
      })
      store.graph.createNodeWithId(parentFrameId, 'FRAME', pageId, {
        name: 'Clinical workspace Bot Frame',
        x: 100,
        y: 100,
        width: 700,
        height: 520,
        cornerRadius: 24,
        fills: [],
        strokes: []
      })
      store.graph.createNodeWithId(frameId, 'FRAME', parentFrameId, {
        name: 'Dental Chart project Frame',
        x: 80,
        y: 50,
        width: 480,
        height: 300,
        cornerRadius: 24,
        fills: [],
        strokes: []
      })
      await store.switchPage(pageId)
      const { createCodeObject, createUserCodeObjectDocument } =
        await import('/src/app/code-object/model.ts')
      const child = createCodeObject(store, {
        document: createUserCodeObjectDocument({ name: 'Large child Code Object' }),
        height: 260,
        name: 'Large child',
        parentId: frameId,
        width: 480,
        x: 0,
        y: 0
      })
      store.clearSelection()
      store.requestRender()
      return child.id
    },
    { frameId: FRAME_ID, pageId: PAGE_ID, parentFrameId: PARENT_FRAME_ID }
  )
  await page.getByTestId('close-layers-panel').click()
  await expect(page.getByTestId('layers-shell-motion')).toHaveAttribute(
    'data-sidebar-open',
    'false'
  )

  const childCenter = await page.evaluate((childId) => {
    const store = window.openPencil?.getStore?.()
    const child = store?.graph.getNode(childId)
    if (!store || !child) throw new Error('Project child missing')
    const absolute = store.graph.getAbsolutePosition(childId)
    return {
      x: store.state.panX + (absolute.x + child.width / 2) * store.state.zoom,
      y: store.state.panY + (absolute.y + child.height / 2) * store.state.zoom
    }
  }, childId)
  await page.mouse.click(childCenter.x, childCenter.y)
  await expect
    .poll(() =>
      page.evaluate((childId) => {
        const store = window.openPencil?.getStore?.()
        return {
          childSelected: store?.state.selectedIds.has(childId) ?? false,
          selectionSize: store?.state.selectedIds.size ?? 0
        }
      }, childId)
    )
    .toEqual({ childSelected: true, selectionSize: 1 })
  await page.evaluate(() => window.openPencil?.getStore?.().clearSelection())

  const label = page.locator('.work-map-project-frame__label', { hasText: 'Dental Chart' })
  const directoryAction = page.getByTestId('open-work-map-project-project:interaction')
  await expect(label).toBeVisible()
  await expect(label).toHaveCSS('pointer-events', 'auto')
  await expect(directoryAction).toHaveCSS('opacity', '0')
  await expect(directoryAction).toHaveCSS('pointer-events', 'auto')
  await directoryAction.hover()
  await expect(directoryAction).toHaveCSS('opacity', '1')

  const projectFrame = page
    .getByTestId('work-map-project-frame')
    .filter({ has: page.getByTestId('work-map-project-frame-marker-project:interaction') })
  const closeDirectory = page.getByRole('button', {
    name: 'Close Dental Chart sub-bot on Board'
  })
  await expect(closeDirectory).toBeVisible()
  await closeDirectory.click()
  await expect
    .poll(() =>
      getLocalStorageItem(page, 'open-pencil:work-map-collapsed-board-directories-v1').then(
        (stored) => {
          return stored ? (JSON.parse(stored) as Record<string, boolean>) : {}
        }
      )
    )
    .toEqual({ 'project:interaction': true })
  await expect(projectFrame).toHaveAttribute('data-collapsed', 'true')
  const collapsedFolder = page.getByTestId('work-map-project-folder-project:interaction')
  await expect(collapsedFolder).toBeVisible()
  await expect(collapsedFolder).toHaveAttribute('data-parent-project-id', 'project:root')
  await expect(collapsedFolder).toHaveAttribute('data-folder-index', '0')
  await expect(page.getByTestId('work-map-project-closed-summary')).toContainText(
    'Clinical workspace · 1 object · 1 chat'
  )
  const [parentFrameBox, collapsedFolderBox] = await Promise.all([
    page
      .getByTestId('work-map-project-frame')
      .filter({ has: page.getByTestId('work-map-project-frame-marker-project:root') })
      .boundingBox(),
    collapsedFolder.boundingBox()
  ])
  if (!parentFrameBox || !collapsedFolderBox) throw new Error('Collapsed folder geometry missing')
  expect(collapsedFolderBox.x).toBeGreaterThan(parentFrameBox.x)
  expect(collapsedFolderBox.y).toBeGreaterThan(parentFrameBox.y + parentFrameBox.height / 2)
  expect(collapsedFolderBox.x + collapsedFolderBox.width).toBeLessThanOrEqual(
    parentFrameBox.x + parentFrameBox.width
  )
  expect(collapsedFolderBox.y + collapsedFolderBox.height).toBeLessThanOrEqual(
    parentFrameBox.y + parentFrameBox.height
  )
  await expect
    .poll(() =>
      page.evaluate((frameId) => {
        const store = window.openPencil?.getStore?.()
        const frame = store?.graph.getNode(frameId)
        if (!store || !frame) return null
        return {
          authoritative: { x: frame.x, y: frame.y },
          presented: store.graph.getPresentedNodePosition(frameId)
        }
      }, FRAME_ID)
    )
    .toEqual({
      authoritative: { x: 80, y: 50 },
      presented: { x: -1_000_480, y: -1_000_300 }
    })
  await expect
    .poll(() =>
      page.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y)
        return hit?.closest('[data-project-id]')?.getAttribute('data-project-id')
      }, childCenter)
    )
    .not.toBe('project:interaction')
  await page.mouse.click(childCenter.x, childCenter.y)
  await expect
    .poll(() =>
      page.evaluate((childId) => {
        const store = window.openPencil?.getStore?.()
        return store?.state.selectedIds.has(childId) ?? false
      }, childId)
    )
    .toBe(false)

  const openDirectory = page.getByRole('button', {
    name: 'Open Dental Chart sub-bot on Board'
  })
  await openDirectory.click()
  await expect(projectFrame).not.toHaveAttribute('data-collapsed', 'true')
  await expect(closeDirectory).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate((frameId) => {
        const store = window.openPencil?.getStore?.()
        return store?.graph.getPresentedNodePosition(frameId) ?? null
      }, FRAME_ID)
    )
    .toEqual({ x: 80, y: 50 })

  const before = await page.evaluate((frameId) => {
    const node = window.openPencil?.getStore?.().graph.getNode(frameId)
    if (!node) throw new Error('Project Frame missing')
    return { x: node.x, y: node.y, zoom: window.openPencil?.getStore?.().state.zoom ?? 1 }
  }, FRAME_ID)
  const box = await label.boundingBox()
  if (!box) throw new Error('Project label has no bounds')

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 72, box.y + box.height / 2 + 44, {
    steps: 8
  })
  await page.mouse.up()

  await expect
    .poll(() =>
      page.evaluate((frameId) => {
        const store = window.openPencil?.getStore?.()
        const node = store?.graph.getNode(frameId)
        return {
          selected: store?.state.selectedIds.has(frameId) ?? false,
          x: node?.x,
          y: node?.y
        }
      }, FRAME_ID)
    )
    .toEqual({
      selected: true,
      x: before.x + 72 / before.zoom,
      y: before.y + 44 / before.zoom
    })

  await page.evaluate(() => window.openPencil?.getStore?.().clearSelection())
  const bottomRail = page
    .getByTestId('work-map-project-frame-chrome-project:interaction')
    .locator('[data-grab-side="bottom"]')
  await expect(bottomRail).toHaveCSS('pointer-events', 'auto')
  const railBox = await bottomRail.boundingBox()
  if (!railBox) throw new Error('Project bottom grab rail has no bounds')
  const beforeRailMove = await page.evaluate((frameId) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(frameId)
    if (!store || !node) throw new Error('Project Frame missing before rail move')
    return { x: node.x, y: node.y, zoom: store.state.zoom }
  }, FRAME_ID)

  await page.mouse.move(railBox.x + railBox.width / 2, railBox.y + railBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(railBox.x + railBox.width / 2 - 48, railBox.y + railBox.height / 2, {
    steps: 8
  })
  await page.mouse.up()

  await expect
    .poll(() =>
      page.evaluate((frameId) => {
        const store = window.openPencil?.getStore?.()
        return {
          selected: store?.state.selectedIds.has(frameId) ?? false,
          x: store?.graph.getNode(frameId)?.x
        }
      }, FRAME_ID)
    )
    .toEqual({ selected: true, x: beforeRailMove.x - 48 / beforeRailMove.zoom })

  await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized before focus')
    store.setViewport({ panX: 0, panY: 0, zoom: 0.5 })
    store.clearSelection()
  })
  await label.dblclick()
  await expect
    .poll(() =>
      page.evaluate((frameId) => {
        const store = window.openPencil?.getStore?.()
        return {
          selected: store?.state.selectedIds.has(frameId) ?? false,
          zoom: store?.state.zoom ?? 0
        }
      }, FRAME_ID)
    )
    .toMatchObject({ selected: true })
  expect(
    await page.evaluate(() => window.openPencil?.getStore?.().state.zoom ?? 0)
  ).toBeGreaterThan(0.5)

  await expect(page.getByTestId('agent-thread-selector')).not.toBeVisible()

  await directoryAction.hover()
  await directoryAction.click()
  await expect(page.getByTestId('layers-shell-motion')).toHaveAttribute('data-sidebar-open', 'true')
  await expect(page.getByTestId('agent-thread-selector')).toBeVisible()
  await expect(page.getByTestId('work-map-project-content-project:interaction')).toBeVisible()
})
