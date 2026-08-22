import type { Page } from '@playwright/test'

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

export async function readTestSelectedIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    return store ? [...store.state.selectedIds] : []
  })
}
