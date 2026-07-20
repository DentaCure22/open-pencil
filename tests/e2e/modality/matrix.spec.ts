import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const ORIGINAL_SOURCE = `export function PatientCard() {
  return <article>Original</article>
}`
const EDITED_SOURCE = `export function PatientCard() {
  return <article aria-label="Patient summary">Edited</article>
}

globalThis.__OPENPENCIL_MODALITY_EXECUTED__ = true`

test.beforeEach(async ({ page }) => {
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()
})

test('File Open keeps TSX source inert through edit, undo, save, and reopen', async ({ page }) => {
  await page.evaluate((initialSource) => {
    let persistedSource = initialSource
    let writeCount = 0
    const handle = {
      createWritable: async () => ({
        close: async () => undefined,
        write: async (data: Uint8Array) => {
          persistedSource = new TextDecoder().decode(data)
          writeCount += 1
        }
      }),
      getFile: async () => new File([persistedSource], 'PatientCard.tsx', { type: 'text/tsx' }),
      kind: 'file',
      name: 'PatientCard.tsx'
    } as FileSystemFileHandle

    window.openPencil ??= {}
    window.openPencil.test = { mockHandle: handle, writeCount: () => writeCount }
    window.showOpenFilePicker = async () => [handle]
  }, ORIGINAL_SOURCE)

  await page.keyboard.press('Meta+o')

  await expect(page.getByTestId('app-document-name')).toHaveText('PatientCard')
  await expect(page.getByTestId('source-document-format')).toHaveText('tsx')
  await expect(page.getByTestId('source-document-runtime-boundary')).toContainText(
    'does not evaluate arbitrary component code'
  )
  const editor = page.getByRole('textbox', { name: 'TSX source' })
  await expect(editor).toHaveValue(ORIGINAL_SOURCE)

  await editor.fill(EDITED_SOURCE)
  await expect(page.getByTestId('source-document-dirty')).toHaveText('Unsaved source')
  await page.getByTestId('source-document-save').click()
  await expect(page.getByTestId('source-document-message')).toContainText(
    'Source saved on this document'
  )
  expect(
    await page.evaluate(() => Reflect.get(globalThis, '__OPENPENCIL_MODALITY_EXECUTED__'))
  ).toBeUndefined()

  await page.keyboard.press('Meta+z')
  await expect(editor).toHaveValue(ORIGINAL_SOURCE)
  await page.keyboard.press('Meta+Shift+z')
  await expect(editor).toHaveValue(EDITED_SOURCE)

  await page.keyboard.press('Meta+s')
  await expect.poll(() => page.evaluate(() => window.openPencil?.test?.writeCount?.() ?? 0)).toBe(1)

  await page.keyboard.press('Meta+o')
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await expect(page.getByRole('textbox', { name: 'TSX source' })).toHaveValue(EDITED_SOURCE)
  expect(
    await page.evaluate(() => Reflect.get(globalThis, '__OPENPENCIL_MODALITY_EXECUTED__'))
  ).toBeUndefined()
})

test('pasted media file enters the same source-backed intake path as a drop', async ({ page }) => {
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], 'clipboard.pdf', {
        type: 'application/pdf'
      })
    )
    window.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer
      })
    )
  })

  await expect(page.getByTestId('media-evidence-pdf')).toContainText('clipboard.pdf')
  await expect(page.getByRole('link', { name: 'Open source PDF: clipboard.pdf' })).toBeVisible()
  const source = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const node = selectedId ? store.graph.getNode(selectedId) : undefined
    return node?.pluginData.find((entry) => entry.key === 'content-source/source')?.value
  })
  expect(source).toMatch(/^openpencil-asset:\/\//)
  expect(source).not.toContain('base64')
})

test('Insert > Media opens the browser picker and places the selected file', async ({ page }) => {
  const menubar = page.locator('[role="menubar"]')
  if (!(await menubar.isVisible())) await page.getByTestId('app-menu-toggle').click()
  await page.getByRole('menuitem', { name: 'Insert', exact: true }).click()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Media…', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles({
    buffer: Buffer.from([37, 80, 68, 70, 45, 49, 46, 52]),
    mimeType: 'application/pdf',
    name: 'inserted.pdf'
  })

  await expect(page.getByTestId('media-evidence-pdf')).toContainText('inserted.pdf')
  await expect(page.getByRole('link', { name: 'Open source PDF: inserted.pdf' })).toBeVisible()
})
