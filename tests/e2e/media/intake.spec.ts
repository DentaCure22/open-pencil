import { readFile } from 'node:fs/promises'

import { jsPDF } from 'jspdf'

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

function threePagePdfBytes(): number[] {
  const pdf = new jsPDF()
  pdf.setFontSize(24)
  pdf.text('Research brief - page 1', 24, 34)
  pdf.addPage()
  pdf.text('Evidence map - page 2', 24, 34)
  pdf.addPage()
  pdf.text('Decision record - page 3', 24, 34)
  return [...new Uint8Array(pdf.output('arraybuffer'))]
}

test('dropped PDF becomes a visible source-backed viewer frame', async () => {
  await dropFile('research.pdf', 'application/pdf', threePagePdfBytes())

  const overlay = editor.page.getByTestId('media-evidence-pdf')
  await expect(overlay).toBeVisible()
  await expect(overlay).toContainText('research.pdf')
  await expect(editor.page.getByTestId('media-evidence-pdf-viewer')).toBeVisible()
  await expect(editor.page.getByTestId('media-evidence-pdf-canvas')).toHaveAttribute(
    'aria-label',
    'PDF page 1 of 3: research.pdf'
  )
  await expect(editor.page.getByTestId('media-evidence-pdf-controls')).toContainText('/ 3')
  await expect(
    editor.page.getByRole('link', { name: 'Open source PDF: research.pdf' })
  ).toBeVisible()

  const nextPage = editor.page.getByRole('button', {
    name: 'Next PDF page, currently page 1 of 3'
  })
  await expect(nextPage).toBeEnabled()
  await nextPage.focus()
  await expect(nextPage).toBeFocused()
  await editor.page.keyboard.press('Enter')
  await expect(editor.page.getByTestId('media-evidence-pdf-canvas')).toHaveAttribute(
    'aria-label',
    'PDF page 2 of 3: research.pdf'
  )
  await editor.page.getByRole('button', { name: 'Extract page 2' }).click()
  await expect
    .poll(() =>
      editor.page.evaluate(
        () =>
          [...(window.openPencil?.getStore?.().graph.getAllNodes() ?? [])].filter((candidate) =>
            candidate.pluginData.some(
              (entry) => entry.key === 'media-evidence/pdf-page' && entry.value === '2'
            )
          ).length
      )
    )
    .toBe(1)

  const state = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = [...store.graph.getAllNodes()].find((candidate) =>
      candidate.pluginData.some(
        (entry) => entry.key === 'content-source/file-name' && entry.value === 'research.pdf'
      )
    )
    const source = node?.pluginData
      .filter((entry) => entry.pluginId === 'open-pencil')
      .reduce<Record<string, string>>((result, entry) => {
        result[entry.key] = entry.value
        return result
      }, {})
    const extracted = [...store.graph.getAllNodes()].find((candidate) =>
      candidate.pluginData.some(
        (entry) => entry.key === 'media-evidence/pdf-page' && entry.value === '2'
      )
    )
    return {
      assetCount: store.graph.images.size,
      extractedId: extracted?.id,
      extractedType: extracted?.type,
      nodeType: node?.type,
      source
    }
  })

  expect(state.nodeType).toBe('FRAME')
  expect(state.assetCount).toBe(2)
  expect(state.extractedId).toBeTruthy()
  expect(state.extractedType).toBe('RECTANGLE')
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

test('captured video frame becomes a source-linked native image', async () => {
  const startingAssetCount = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.graph.images.size
  })
  const bytes = await readFile('packages/demos/videos/toolbar.webm')
  await dropFile('toolbar.webm', 'video/webm', [...bytes])

  await expect(editor.page.getByTestId('media-evidence-video-viewer')).toBeVisible()
  const capture = editor.page.getByRole('button', { name: 'Capture frame' })
  await expect(capture).toBeEnabled()
  await capture.click()
  await expect
    .poll(() =>
      editor.page.evaluate(
        () =>
          [...(window.openPencil?.getStore?.().graph.getAllNodes() ?? [])].filter((candidate) =>
            candidate.pluginData.some(
              (entry) => entry.key === 'media-evidence/kind' && entry.value === 'video-frame'
            )
          ).length
      )
    )
    .toBe(1)

  const state = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = [...store.graph.getAllNodes()].find((candidate) =>
      candidate.pluginData.some(
        (entry) => entry.key === 'media-evidence/kind' && entry.value === 'video-frame'
      )
    )
    return {
      assetCount: store.graph.images.size,
      selected: frame ? store.state.selectedIds.has(frame.id) : false,
      timeMs: frame?.pluginData.find((entry) => entry.key === 'media-evidence/video-time-ms')
        ?.value,
      type: frame?.type
    }
  })

  expect(state).toEqual({
    assetCount: startingAssetCount + 2,
    selected: true,
    timeMs: expect.stringMatching(/^\d+$/),
    type: 'RECTANGLE'
  })
  editor.canvas.assertNoErrors()
})
