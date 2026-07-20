import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

async function dropFile(name: string, type: string, bytes: number[]) {
  await editor.page.getByTestId('canvas-element').evaluate(
    (canvas, input) => {
      const rect = canvas.getBoundingClientRect()
      const transfer = new DataTransfer()
      transfer.items.add(new File([new Uint8Array(input.bytes)], input.name, { type: input.type }))
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
    { bytes, name, type }
  )
}

async function pngBytes(width: number, height: number): Promise<number[]> {
  return editor.page.evaluate(
    async ({ height, width }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Canvas 2D context unavailable')
      context.fillStyle = '#7c6be8'
      context.fillRect(0, 0, width, height)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value)
          else reject(new Error('PNG encode failed'))
        })
      })
      return [...new Uint8Array(await blob.arrayBuffer())]
    },
    { height, width }
  )
}

test('dropped PDF becomes a visible source-backed viewer frame', async () => {
  await dropFile('research.pdf', 'application/pdf', [37, 80, 68, 70, 45, 49, 46, 52])

  const overlay = editor.page.getByTestId('media-evidence-pdf')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('research.pdf')
  await expect(editor.page.getByTestId('media-evidence-pdf-viewer')).toBeVisible()
  await expect(
    editor.page.getByRole('link', { name: 'Open source PDF: research.pdf' })
  ).toBeVisible()

  const state = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const selectedId = [...store.state.selectedIds][0]
    const node = selectedId ? store.graph.getNode(selectedId) : undefined
    const source = node?.pluginData
      .filter((entry) => entry.pluginId === 'open-pencil')
      .reduce<Record<string, string>>((result, entry) => {
        result[entry.key] = entry.value
        return result
      }, {})
    return {
      assetCount: store.graph.images.size,
      nodeType: node?.type,
      source
    }
  })

  expect(state.nodeType).toBe('FRAME')
  expect(state.assetCount).toBe(1)
  expect(state.source?.['content-source/file-name']).toBe('research.pdf')
  expect(state.source?.['content-source/mime-type']).toBe('application/pdf')
  expect(state.source?.['content-source/source']).toMatch(/^openpencil-asset:\/\//)
  expect(state.source?.['content-source/source']).not.toContain('base64')
  editor.canvas.assertNoErrors()
})

test('dropped large PNG stays native, editable, source-backed, and fit to the viewport', async () => {
  await dropFile('photo.png', 'image/png', await pngBytes(1600, 900))
  await expect
    .poll(() => editor.page.evaluate(() => window.openPencil?.getStore?.().state.selectedIds.size))
    .toBe(1)

  const state = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const id = [...store.state.selectedIds][0]
    const node = id ? store.graph.getNode(id) : undefined
    return {
      fileName: node?.pluginData.find((entry) => entry.key === 'content-source/file-name')?.value,
      fillType: node?.fills[0]?.type,
      height: node?.height,
      nodeType: node?.type,
      source: node?.pluginData.find((entry) => entry.key === 'content-source/source')?.value,
      width: node?.width
    }
  })

  expect(state).toEqual({
    fileName: 'photo.png',
    fillType: 'IMAGE',
    height: expect.any(Number),
    nodeType: 'RECTANGLE',
    source: expect.stringMatching(/^openpencil-asset:\/\//),
    width: expect.any(Number)
  })
  expect(state.width).toBeLessThanOrEqual(960)
  expect(state.height).toBeLessThanOrEqual(640)
  editor.canvas.assertNoErrors()
})

test('invalid video shows an explicit preview error state', async () => {
  await dropFile('broken.webm', 'video/webm', [1, 2, 3, 4, 5, 6])

  await expect(editor.page.getByTestId('media-evidence-video')).toBeVisible()
  const status = editor.page.getByTestId('media-evidence-video-status')
  await expect(status).toHaveAttribute('role', 'alert')
  await expect(status).toContainText('VIDEO preview could not be loaded')
  editor.canvas.assertNoErrors()
})
