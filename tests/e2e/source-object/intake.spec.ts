import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

async function transferFile(
  eventName: 'drop' | 'paste',
  name: string,
  type: string,
  bytes: number[]
) {
  await editor.page.getByTestId('canvas-element').evaluate(
    (canvas, input) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(input.bytes)], input.name, { type: input.type }))
      if (input.eventName === 'paste') {
        window.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
        )
        return
      }
      const rect = canvas.getBoundingClientRect()
      canvas.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          dataTransfer: transfer
        })
      )
    },
    { bytes, eventName, name, type }
  )
}

async function expectRetainedSource(fileName: string, mimeType: string) {
  const overlay = editor.page.getByTestId('source-object')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText(fileName)
  await expect(overlay).toContainText('Preview unavailable')
  await expect(overlay).toContainText('Original file preserved')
  await expect(overlay).toContainText(mimeType)
  await expect(
    editor.page.getByRole('link', { name: `Open source file: ${fileName}` })
  ).toBeVisible()
  await expect(
    editor.page.getByRole('link', { name: `Download source file: ${fileName}` })
  ).toBeVisible()
}

test('drop preserves an unsupported XLSX as an openable and downloadable source object', async () => {
  await transferFile('drop', 'forecast.xlsx', '', [80, 75, 3, 4, 9, 8, 7])
  await expectRetainedSource(
    'forecast.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )

  const downloadPromise = editor.page.waitForEvent('download')
  await editor.page.getByRole('link', { name: 'Download source file: forecast.xlsx' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('forecast.xlsx')
  editor.canvas.assertNoErrors()
})

test('paste routes a GLB into the source-backed 3D viewer', async () => {
  await transferFile('paste', 'scene.glb', 'model/gltf-binary', [103, 108, 84, 70, 2, 0, 0, 0])
  await expect(editor.page.getByTestId('spatial-media-gltf-viewer')).toBeVisible()
  await expect(editor.page.getByTestId('spatial-media-status')).toBeVisible()
  await expect(editor.page.getByTestId('source-object')).toHaveCount(0)
  editor.canvas.assertNoErrors()
})

test('Open accepts an unsupported file and routes it into a source-backed board', async () => {
  await editor.page.evaluate(() => {
    Reflect.deleteProperty(window, 'showOpenFilePicker')
  })
  await editor.page.getByTestId('app-menu-toggle').click()
  await editor.page.getByTestId('menubar-file').click()
  const fileChooserPromise = editor.page.waitForEvent('filechooser')
  await editor.page.getByRole('menuitem', { name: 'Open…' }).click()
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    buffer: Buffer.from([83, 84, 69, 80, 1, 2, 3, 4]),
    mimeType: 'application/step',
    name: 'assembly.step'
  })

  await expectRetainedSource('assembly.step', 'application/step')
  await expect(editor.page.getByTestId('app-document-name')).toHaveText('assembly')
  editor.canvas.assertNoErrors()
})
