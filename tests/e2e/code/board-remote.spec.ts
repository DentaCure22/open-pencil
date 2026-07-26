import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

type OwnedShapeReadback = {
  fill: { b: number; g: number; r: number } | null
  id: string
  rotation: number
  x: number
}

async function ownedShape(controllerId: string): Promise<OwnedShapeReadback | null> {
  return editor.page.evaluate((ownerId) => {
    const store = window.openPencil?.getStore?.()
    const shape = store?.graph
      .getChildren(store.state.currentPageId)
      .find((node) =>
        node.pluginData.some(
          (entry) =>
            entry.pluginId === 'openpencil-code-object' &&
            entry.key === 'board-owner-frame-id' &&
            entry.value === ownerId
        )
      )
    if (!shape) return null
    const fill = shape.fills.find((candidate) => candidate.type === 'SOLID')
    return {
      fill: fill?.type === 'SOLID' ? fill.color : null,
      id: shape.id,
      rotation: shape.rotation,
      x: shape.x
    }
  }, controllerId)
}

test('lets a Code Object control an ordinary native board shape through the shared board', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.getByTestId('code-object-asset-board-remote').click()

  const demo = editor.page.getByTestId('board-remote-demo')
  await expect(demo).toBeVisible()
  await expect(demo).toContainText('BOARD ACCESS ON')
  const runtime = editor.page.locator('[data-code-object-root]').filter({ has: demo })
  const controllerId = await runtime.getAttribute('data-code-object-root')
  if (!controllerId) throw new Error('Board remote Code Object ID unavailable')

  const wrapper = editor.page.locator('[data-code-object-mode]').filter({ has: demo })
  await editor.page.keyboard.press('Enter')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')

  await demo.getByTestId('board-remote-add').click()
  await expect(demo.getByTestId('board-remote-count')).toHaveText('1')
  await expect.poll(() => ownedShape(controllerId)).not.toBeNull()
  const created = await ownedShape(controllerId)
  if (!created) throw new Error('Board remote did not create a native shape')
  expect(created.fill?.r).toBeCloseTo(139 / 255)
  expect(created.fill?.g).toBeCloseTo(92 / 255)
  expect(created.fill?.b).toBeCloseTo(246 / 255)

  await demo.getByTestId('board-remote-move').click()
  await expect
    .poll(async () => {
      const moved = await ownedShape(controllerId)
      return moved ? { rotation: moved.rotation, x: moved.x } : null
    })
    .toEqual({ rotation: 8, x: created.x + 72 })

  await editor.page.keyboard.press('Escape')
  await editor.page.keyboard.press('Meta+z')
  await expect
    .poll(async () => {
      const restored = await ownedShape(controllerId)
      return restored ? { rotation: restored.rotation, x: restored.x } : null
    })
    .toEqual({ rotation: 0, x: created.x })

  await editor.page.keyboard.press('Meta+Shift+z')
  await expect
    .poll(async () => {
      const redone = await ownedShape(controllerId)
      return redone ? { rotation: redone.rotation, x: redone.x } : null
    })
    .toEqual({ rotation: 8, x: created.x + 72 })

  await editor.page.keyboard.press('Enter')
  await demo.getByTestId('board-remote-delete').click()
  await expect(demo.getByTestId('board-remote-count')).toHaveText('0')
  await expect.poll(() => ownedShape(controllerId)).toBeNull()
})
