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

test('dropped PDF becomes one interactive Code Object with retained source bytes', async () => {
  await dropFile('research.pdf', 'application/pdf', threePagePdfBytes())

  const pdf = editor.page.getByTestId('code-object-pdf')
  const wrapper = editor.page.locator('[data-code-object-mode]').filter({ has: pdf })
  await expect(pdf).toBeVisible()
  await expect(pdf).toContainText('research.pdf')
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.getByTestId('code-object-pdf-viewer')).toBeVisible()
  await expect(editor.page.getByTestId('code-object-pdf-canvas')).toHaveAttribute(
    'aria-label',
    'PDF page 1 of 3: research.pdf'
  )
  await expect(editor.page.getByTestId('code-object-pdf-controls')).toContainText('1 / 3')
  await expect(
    editor.page.getByRole('link', { name: 'Open source PDF: research.pdf' })
  ).toBeVisible()
  await expect(editor.page.locator('iframe')).toHaveCount(0)

  const nextPage = editor.page.getByRole('button', {
    name: 'Next PDF page, currently page 1 of 3'
  })
  await expect(nextPage).toBeDisabled()
  await editor.page.getByTestId('code-object-design-hit-target').dblclick()
  await expect(wrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await expect(nextPage).toBeEnabled()
  await nextPage.click()
  await expect(editor.page.getByTestId('code-object-pdf-canvas')).toHaveAttribute(
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
      codeObject: node?.pluginData.find(
        (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
      )?.value,
      extractedId: extracted?.id,
      extractedType: extracted?.type,
      nodeType: node?.type,
      source
    }
  })

  expect(state.nodeType).toBe('FRAME')
  expect(JSON.parse(state.codeObject ?? '{}')).toMatchObject({
    component: 'pdf-document',
    runtime: 'openpencil-code',
    state: { activePage: 2, view: 'pdf' }
  })
  expect(state.assetCount).toBe(2)
  expect(state.extractedId).toBeTruthy()
  expect(state.extractedType).toBe('RECTANGLE')
  expect(state.source?.['content-source/file-name']).toBe('research.pdf')
  expect(state.source?.['content-source/mime-type']).toBe('application/pdf')
  expect(state.source?.['content-source/source']).toMatch(/^openpencil-asset:\/\//)
  expect(state.source?.['content-source/source']).not.toContain('base64')
  editor.canvas.assertNoErrors()
})

test('dropped large PNG stays native, editable, retains source bytes, and fits the viewport', async () => {
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

  const evidence = editor.page.getByTestId('media-evidence-video')
  const video = editor.page.getByTestId('media-evidence-video-viewer')
  await expect(evidence).toBeVisible()
  await expect(evidence).toHaveAttribute('data-media-evidence-mode', 'design')
  await expect(evidence.locator('header')).toHaveCount(0)
  await expect(video).not.toHaveAttribute('controls', '')
  const status = editor.page.getByTestId('media-evidence-video-status')
  await expect(status).toHaveAttribute('role', 'alert')
  await expect(status).toContainText('VIDEO preview could not be loaded')

  const initial = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const node = [...(store?.graph.getAllNodes() ?? [])].find((candidate) =>
      candidate.pluginData.some(
        (entry) => entry.key === 'content-source/file-name' && entry.value === 'broken.webm'
      )
    )
    if (!store || !node) throw new Error('Expected video evidence frame')
    const absolute = store.graph.getAbsolutePosition(node.id)
    return {
      id: node.id,
      screenX: store.state.panX + (absolute.x + node.width / 2) * store.state.zoom,
      screenY: store.state.panY + (absolute.y + node.height / 2) * store.state.zoom,
      x: node.x,
      y: node.y
    }
  })
  await editor.canvas.drag(
    initial.screenX,
    initial.screenY,
    initial.screenX + 64,
    initial.screenY + 40
  )
  await expect
    .poll(() =>
      editor.page.evaluate((id) => {
        const node = window.openPencil?.getStore?.().graph.getNode(id)
        return node ? { x: node.x, y: node.y } : null
      }, initial.id)
    )
    .toEqual({ x: initial.x + 64, y: initial.y + 40 })

  await editor.canvas.dblclick(initial.screenX + 64, initial.screenY + 40)
  await expect(evidence).toHaveAttribute('data-media-evidence-mode', 'interact')
  await expect(video).toHaveAttribute('controls', '')
  editor.canvas.assertNoErrors()
})

test('Markdown frames move normally, center on double-click, and scroll while focused', async () => {
  const source = [
    '# Canvas report',
    '',
    ...Array.from(
      { length: 48 },
      (_, index) =>
        `## Finding ${index + 1}\n\nA concise finding with enough detail to require scrolling.`
    )
  ].join('\n')
  const frameId = await editor.page.evaluate((markdownSource) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const frame = store.graph.createNode('FRAME', store.state.currentPageId, {
      name: 'Canvas report',
      x: 120,
      y: 100,
      width: 520,
      height: 360,
      clipsContent: true,
      cornerRadius: 12,
      fills: [
        {
          type: 'SOLID',
          color: { r: 1, g: 1, b: 1, a: 1 },
          opacity: 1,
          visible: true
        }
      ],
      pluginData: [
        { pluginId: 'open-pencil', key: 'content-source/format', value: 'markdown' },
        { pluginId: 'open-pencil', key: 'content-source/mime-type', value: 'text/markdown' },
        { pluginId: 'open-pencil', key: 'content-source/revision', value: '1' },
        { pluginId: 'open-pencil', key: 'content-source/source', value: markdownSource },
        { pluginId: 'open-pencil', key: 'markdown/source-mode', value: 'markdown' }
      ]
    })
    store.select([frame.id])
    store.requestRender()
    return frame.id
  }, source)

  const document = editor.page.getByTestId('markdown-document')
  const preview = editor.page.getByTestId('markdown-document-preview')
  await expect(document).toBeVisible()
  await expect(document).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(document).toHaveAttribute('data-markdown-document-mode', 'design')
  await expect(preview).toHaveCSS('overflow-y', 'hidden')

  const initial = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const frame = store?.graph.getNode(id)
    if (!store || !frame) throw new Error('Expected Markdown frame')
    const absolute = store.graph.getAbsolutePosition(id)
    return {
      canvasX: store.state.panX + (absolute.x + frame.width / 2) * store.state.zoom,
      canvasY: store.state.panY + (absolute.y + frame.height / 2) * store.state.zoom,
      x: frame.x,
      y: frame.y
    }
  }, frameId)
  await editor.canvas.drag(
    initial.canvasX,
    initial.canvasY,
    initial.canvasX + 60,
    initial.canvasY + 40
  )
  await expect
    .poll(() =>
      editor.page.evaluate((id) => {
        const frame = window.openPencil?.getStore?.().graph.getNode(id)
        return frame ? { x: frame.x, y: frame.y } : null
      }, frameId)
    )
    .toEqual({ x: initial.x + 60, y: initial.y + 40 })

  const movedCenter = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const frame = store?.graph.getNode(id)
    if (!store || !frame) throw new Error('Expected moved Markdown frame')
    const absolute = store.graph.getAbsolutePosition(id)
    return {
      x: store.state.panX + (absolute.x + frame.width / 2) * store.state.zoom,
      y: store.state.panY + (absolute.y + frame.height / 2) * store.state.zoom
    }
  }, frameId)
  await editor.canvas.dblclick(movedCenter.x, movedCenter.y)

  await expect(document).toHaveAttribute('data-markdown-document-mode', 'read')
  await expect(preview).toHaveCSS('overflow-y', 'auto')
  expect(
    await editor.page.evaluate(
      (id) => window.openPencil?.getStore?.().state.enteredContainerId === id,
      frameId
    )
  ).toBe(true)

  const [documentBox, canvasBox] = await Promise.all([
    document.boundingBox(),
    editor.page.getByTestId('canvas-area').boundingBox()
  ])
  if (!documentBox || !canvasBox) throw new Error('Expected Markdown and canvas bounds')
  expect(documentBox.x + documentBox.width / 2).toBeCloseTo(canvasBox.x + canvasBox.width / 2, 0)
  expect(documentBox.y + documentBox.height / 2).toBeCloseTo(canvasBox.y + canvasBox.height / 2, 0)

  const before = await preview.evaluate((element) => element.scrollTop)
  await preview.hover()
  await editor.page.mouse.wheel(0, 500)
  await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(before)

  await editor.page.keyboard.press('Escape')
  await expect(document).toHaveAttribute('data-markdown-document-mode', 'design')
  await expect(preview).toHaveCSS('overflow-y', 'hidden')
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
