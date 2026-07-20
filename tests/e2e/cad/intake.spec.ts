import { readFileSync } from 'node:fs'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test')
const FIXTURE_BYTES = [...readFileSync('tests/fixtures/cad/basic-drawing.dxf')]

test('dropped ASCII DXF opens a bounded read-only drawing with its exact source attached', async () => {
  await editor.page.getByTestId('canvas-element').evaluate((canvas, bytes) => {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array(bytes)], 'basic-drawing.dxf', { type: 'image/vnd.dxf' })
    )
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
  }, FIXTURE_BYTES)

  const viewer = editor.page.getByTestId('cad-dxf-viewer')
  await expect(viewer).toBeVisible()
  await expect(viewer).toHaveAttribute('data-runtime-state', 'ready')
  await expect(viewer).toContainText('DXF · READ ONLY')
  await expect(editor.page.getByTestId('cad-dxf-geometry')).toBeVisible()
  await expect(editor.page.getByTestId('cad-dxf-geometry').locator('polyline')).toHaveCount(4)
  await expect(editor.page.getByTestId('cad-dxf-geometry')).toContainText('PHASE 1 DXF')
  await expect(editor.page.getByTestId('cad-dxf-stats')).toContainText('5 / 6 ENTITIES')
  await expect(editor.page.getByTestId('cad-dxf-stats')).toContainText('2 LAYERS')
  await expect(editor.page.getByTestId('cad-dxf-stats')).toContainText('MILLIMETERS')
  await expect(editor.page.getByTestId('cad-dxf-stats')).toContainText('1 OMITTED')
  await expect(viewer).toContainText('Visual reference only · exact source retained')

  const drawing = editor.page.getByTestId('cad-dxf-geometry')
  const fittedViewBox = await drawing.getAttribute('viewBox')
  await editor.page.getByTestId('cad-zoom-in').click()
  await expect.poll(() => drawing.getAttribute('viewBox')).not.toBe(fittedViewBox)
  await editor.page.getByTestId('cad-fit').click()
  await expect.poll(() => drawing.getAttribute('viewBox')).toBe(fittedViewBox)

  const downloadPromise = editor.page.waitForEvent('download')
  await editor.page
    .getByRole('link', { name: 'Download exact DXF source: basic-drawing.dxf' })
    .click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('basic-drawing.dxf')
  editor.canvas.assertNoErrors()
})

test('STEP remains an explicit CAD-kernel fallback with exact source actions', async () => {
  await editor.page.getByTestId('canvas-element').evaluate((canvas) => {
    const transfer = new DataTransfer()
    transfer.items.add(
      new File([new Uint8Array([83, 84, 69, 80, 1, 2, 3])], 'assembly.step', {
        type: 'application/step'
      })
    )
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
  })

  const source = editor.page.getByTestId('source-object')
  await expect(source).toBeVisible()
  await expect(source).toContainText('Preview unavailable')
  await expect(source).toContainText('STEP needs a pinned CAD kernel')
  await expect(source).toContainText('Original file preserved')
  await expect(source).toContainText('CAD kernel fallback · exact source retained')
  await expect(editor.page.getByTestId('cad-dxf-viewer')).toHaveCount(0)
  await expect(
    editor.page.getByRole('link', { name: 'Download source file: assembly.step' })
  ).toBeVisible()
  editor.canvas.assertNoErrors()
})
