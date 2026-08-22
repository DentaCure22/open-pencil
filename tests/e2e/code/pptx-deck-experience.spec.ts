import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

test('opens a source PowerPoint as a focused deck with thumbnails and slide navigation', async () => {
  const bytes = [...new Uint8Array(await readFile('outputs/openpencil-native-pptx-preview.pptx'))]

  await editor.page.getByTestId('canvas-element').evaluate((canvas, pptxBytes) => {
    const bounds = canvas.getBoundingClientRect()
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array(pptxBytes)], 'openpencil-native-pptx-preview.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      })
    )
    canvas.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: bounds.left + bounds.width / 2,
        clientY: bounds.top + bounds.height / 2,
        dataTransfer: transfer
      })
    )
  }, bytes)

  const deck = editor.page.getByTestId('pptx-deck-experience')
  await expect(deck).toHaveAttribute(
    'aria-label',
    'openpencil-native-pptx-preview.pptx, slide 1 of 3'
  )
  await expect(editor.page.getByTestId('pptx-deck-controls')).toHaveCount(0)
  await expect(editor.page.getByTestId('pptx-active-slide')).toBeVisible()

  await editor.page.getByTestId('code-object-design-hit-target').click()
  await expect(editor.page.getByTestId('pptx-deck-controls')).toBeVisible()
  await expect(editor.page.getByRole('complementary', { name: 'Slide thumbnails' })).toBeVisible()
  await expect(editor.page.getByTestId('pptx-thumbnail-slide')).toHaveCount(3)
  await expect(editor.page.getByRole('link', { name: 'Download original' })).toBeVisible()

  await editor.page.getByRole('button', { name: 'Open slide 2' }).click()
  await expect(deck).toHaveAttribute(
    'aria-label',
    'openpencil-native-pptx-preview.pptx, slide 2 of 3'
  )
  await expect(editor.page.getByText('Slide 2 of 3')).toBeVisible()

  await deck.focus()
  await editor.page.keyboard.press('ArrowRight')
  await expect(deck).toHaveAttribute(
    'aria-label',
    'openpencil-native-pptx-preview.pptx, slide 3 of 3'
  )
  await expect(editor.page.getByRole('button', { name: 'Next slide' })).toBeDisabled()

  await editor.page.keyboard.press('Escape')
  await expect(editor.page.getByTestId('pptx-deck-controls')).toHaveCount(0)
  await expect(editor.page.getByTestId('pptx-active-slide')).toBeVisible()
  await expect(editor.page.locator('iframe')).toHaveCount(0)
})
