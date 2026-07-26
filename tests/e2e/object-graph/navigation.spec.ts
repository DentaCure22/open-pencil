import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import {
  connectTestObjectGraphNodes,
  createTestCodeObject,
  readTestNodePosition
} from '#tests/helpers/object-graph'

const editor = useEditorSetupWithClear('/?test&no-rulers')

async function selectedIds(): Promise<string[]> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    return store ? [...store.state.selectedIds] : []
  })
}

test('uses Shift+Arrow for directional connected Code Object navigation and otherwise nudges', async () => {
  const sourceId = await createTestCodeObject(editor.page, 'Navigation source', 220, 260)
  const rightId = await createTestCodeObject(editor.page, 'Navigation right', 820, 260)
  const downId = await createTestCodeObject(editor.page, 'Navigation down', 220, 720)
  await createTestCodeObject(editor.page, 'Unconnected closer', 640, 260)
  await connectTestObjectGraphNodes(editor.page, sourceId, rightId)
  await connectTestObjectGraphNodes(editor.page, sourceId, downId)
  await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.undo.clear()
    store.select([id])
  }, sourceId)

  await expect(editor.page.getByTestId(`code-object-controls-${sourceId}`)).toBeVisible()
  const sourceBefore = await readTestNodePosition(editor.page, sourceId)
  await editor.page.keyboard.press('Shift+ArrowRight')
  await expect.poll(selectedIds).toEqual([rightId])
  expect(await readTestNodePosition(editor.page, sourceId)).toEqual(sourceBefore)
  expect(
    await editor.page.evaluate(() => window.openPencil?.getStore?.().undo.canUndo ?? true)
  ).toBe(false)

  await editor.page.keyboard.press('Shift+ArrowLeft')
  await expect.poll(selectedIds).toEqual([sourceId])
  await editor.page.keyboard.press('Shift+ArrowDown')
  await expect.poll(selectedIds).toEqual([downId])
  await editor.page.keyboard.press('Shift+ArrowUp')
  await expect.poll(selectedIds).toEqual([sourceId])

  await editor.page.keyboard.press('Shift+ArrowUp')
  await expect
    .poll(async () => (await readTestNodePosition(editor.page, sourceId)).y)
    .toBe(sourceBefore.y - 10)
  await editor.page.waitForTimeout(350)
  await expect
    .poll(() => editor.page.evaluate(() => window.openPencil?.getStore?.().undo.undoLabel))
    .toBe('Nudge')
  await editor.page.keyboard.press('Meta+z')
  await expect.poll(() => readTestNodePosition(editor.page, sourceId)).toEqual(sourceBefore)

  await editor.page.keyboard.press('Enter')
  await expect(editor.page.getByTestId(`code-object-controls-${sourceId}`)).toHaveCount(0)
  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByTestId(`code-object-controls-${sourceId}`)).toBeVisible()
})
