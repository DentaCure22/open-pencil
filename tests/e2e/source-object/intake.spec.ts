import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')

const TINY_PNG_BYTES = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 12, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 0, 0, 3, 1, 1, 0,
  24, 221, 141, 178, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
]

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

test('drop on the Board surface places photos and videos as native objects', async () => {
  await editor.page.getByTestId('canvas-area').evaluate((surface, pngBytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(pngBytes)], 'reference.png', { type: 'image/png' }))
    transfer.items.add(
      new File([new Uint8Array([0, 0, 0, 24])], 'walkthrough.mp4', { type: 'video/mp4' })
    )
    const rect = surface.getBoundingClientRect()
    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      dataTransfer: transfer
    }
    surface.dispatchEvent(new DragEvent('dragenter', eventInit))
    surface.dispatchEvent(new DragEvent('dragover', eventInit))
    surface.dispatchEvent(new DragEvent('drop', eventInit))
  }, TINY_PNG_BYTES)

  await expect(editor.page.getByTestId('media-evidence-video')).toBeVisible()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return [...store.state.selectedIds]
          .map((id) => store.graph.getNode(id))
          .filter((node) => node !== undefined)
          .map((node) => ({
            fileName: node.pluginData.find((entry) => entry.key === 'content-source/file-name')
              ?.value,
            mimeType: node.pluginData.find((entry) => entry.key === 'content-source/mime-type')
              ?.value,
            name: node.name,
            type: node.type
          }))
          .sort((left, right) => left.name.localeCompare(right.name))
      })
    )
    .toEqual([
      { fileName: 'reference.png', mimeType: 'image/png', name: 'reference', type: 'RECTANGLE' },
      {
        fileName: 'walkthrough.mp4',
        mimeType: 'video/mp4',
        name: 'walkthrough',
        type: 'FRAME'
      }
    ])
  editor.canvas.assertNoErrors()
})

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
