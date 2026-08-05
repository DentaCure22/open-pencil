import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { readTestSelectedIds } from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

test('enters container traversal explicitly and navigates child containers with arrows', async () => {
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
