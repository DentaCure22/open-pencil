import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { readTestSelectedIds } from '#tests/helpers/code-object'

const editor = useEditorSetupWithClear('/?test&no-rulers')

test('container traversal takes arrow priority over ordinary object navigation', async () => {
  const target = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const parent = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 760,
      name: 'Dashboard',
      width: 980,
      x: 120,
      y: 120
    })
    const topLeft = store.graph.createNode('FRAME', parent.id, {
      height: 160,
      name: 'Summary',
      width: 220,
      x: 60,
      y: 60
    })
    const topRight = store.graph.createNode('FRAME', parent.id, {
      height: 160,
      name: 'Activity',
      width: 220,
      x: 520,
      y: 60
    })
    const bottomRight = store.graph.createNode('SECTION', parent.id, {
      height: 160,
      name: 'Details',
      width: 220,
      x: 520,
      y: 430
    })
    store.graph.createNode('RECTANGLE', parent.id, {
      height: 80,
      name: 'Leaf',
      width: 80,
      x: 320,
      y: 60
    })
    store.requestRender()
    store.undo.clear()
    store.select([parent.id])
    return {
      bottomRightId: bottomRight.id,
      parentId: parent.id,
      topLeftId: topLeft.id,
      topRightId: topRight.id
    }
  })

  await editor.page.keyboard.press('Enter')
  await expect(editor.page.getByTestId('container-navigation-status')).toContainText(
    'Inside Dashboard'
  )
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.topLeftId])
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.canUndo ?? true)
  ).toBe(false)

  await editor.page.keyboard.press('ArrowRight')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.topRightId])
  await editor.page.keyboard.press('ArrowDown')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.bottomRightId])

  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByTestId('container-navigation-status')).toHaveCount(0)
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.parentId])
  await expect
    .poll(() =>
      editor.page.evaluate(() => window.openPencil?.getStore?.().state.enteredContainerId)
    )
    .toBeNull()

  const beforeNudge = await editor.page.evaluate((id) => {
    const node = window.openPencil?.getStore?.().graph.getNode(id)
    if (!node) throw new Error('Expected parent container')
    return node.y
  }, target.parentId)
  await editor.page.keyboard.press('Shift+ArrowDown')
  await expect
    .poll(() =>
      editor.page.evaluate(
        (id) => window.openPencil?.getStore?.().graph.getNode(id)?.y,
        target.parentId
      )
    )
    .toBe(beforeNudge + 10)
})

test('live Containers mode takes arrow priority over Board object navigation', async () => {
  const target = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const {
      liveInspectorDocument,
      selectLiveInspectorNode,
      setLiveInspectorActiveFrame,
      setLiveInspectorDirectCommandTarget,
      setLiveInspectorInteractionMode
    } = await import('/src/app/smylr-live-inspector/session.ts')
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 360,
      name: 'Live app frame',
      width: 480,
      x: 120,
      y: 120
    })
    const neighbor = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 120,
      name: 'Board neighbor',
      width: 160,
      x: 760,
      y: 120
    })
    const child = {
      children: [],
      id: 'live-child',
      label: 'Live child',
      rect: { height: 180, width: 240, x: 40, y: 40 },
      tagName: 'section'
    }
    const root = {
      children: [child],
      id: 'live-root',
      label: 'Live root',
      rect: { height: 360, width: 480, x: 0, y: 0 },
      tagName: 'main'
    }
    store.select([frame.id])
    setLiveInspectorActiveFrame(frame.id)
    setLiveInspectorDirectCommandTarget(frame.id, () => true)
    liveInspectorDocument.value = {
      capturedAt: new Date(0).toISOString(),
      route: '/test',
      selectedId: root.id,
      title: 'Keyboard navigation test',
      tree: root
    }
    setLiveInspectorInteractionMode('select')
    selectLiveInspectorNode(root.id)
    store.undo.clear()
    return {
      frameId: frame.id,
      framePosition: { x: frame.x, y: frame.y },
      neighborId: neighbor.id
    }
  })

  await editor.page.keyboard.press('ArrowRight')

  await expect
    .poll(() =>
      editor.page.evaluate(async () => {
        const { liveInspectorSelectedId } = await import('/src/app/smylr-live-inspector/session.ts')
        return liveInspectorSelectedId.value
      })
    )
    .toBe('live-child')
  await expect.poll(() => readTestSelectedIds(editor.page)).toEqual([target.frameId])
  expect(
    await editor.page.evaluate((id) => {
      const node = window.openPencil?.getStore?.().graph.getNode(id)
      return node ? { x: node.x, y: node.y } : null
    }, target.frameId)
  ).toEqual(target.framePosition)
  expect(await readTestSelectedIds(editor.page)).not.toContain(target.neighborId)

  await editor.page.evaluate(async (frameId) => {
    const {
      liveInspectorActiveFrameId,
      liveInspectorDocument,
      liveInspectorInteractionMode,
      liveInspectorSelectedId,
      setLiveInspectorDirectCommandTarget
    } = await import('/src/app/smylr-live-inspector/session.ts')
    setLiveInspectorDirectCommandTarget(frameId, null)
    liveInspectorInteractionMode.value = 'frame'
    liveInspectorDocument.value = null
    liveInspectorSelectedId.value = null
    liveInspectorActiveFrameId.value = null
  }, target.frameId)
})
