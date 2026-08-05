import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('keeps Office shapes quiet on the board and opens full editors on interaction', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.locator('[data-asset-group="interactive"]').click()
  await editor.page.getByTestId('code-object-asset-office-document').click()

  const document = editor.page.getByTestId('office-document')
  await expect(document).toHaveAttribute('data-office-mode', 'design')
  await expect(document.getByTestId('office-document-preview')).toBeVisible()
  await expect(document.getByText('Product direction')).toBeVisible()
  await expect(document.getByTestId('office-document-runtime')).toHaveCount(0)
  await expect(document.locator('iframe')).toHaveCount(0)

  await editor.page.getByTestId('code-object-design-hit-target').last().dblclick()
  await expect(document).toHaveAttribute('data-office-mode', 'interact')
  await expect(document.getByTestId('office-document-loading')).toBeHidden({ timeout: 15_000 })
  await expect(document.locator('[data-u-comp="workbench-layout"]')).toBeVisible()
  await expect(document.locator('canvas')).toBeVisible()
  await editor.page.keyboard.press('Escape')
  await expect(document).toHaveAttribute('data-office-mode', 'design')
  await expect(document.getByTestId('office-document-preview')).toBeVisible()
  await expect(document.getByTestId('office-document-runtime')).toHaveCount(0)

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.locator('[data-asset-group="interactive"]').click()
  await editor.page.getByTestId('code-object-asset-office-spreadsheet').click()

  const spreadsheet = editor.page.getByTestId('office-spreadsheet')
  await expect(spreadsheet).toHaveAttribute('data-office-mode', 'design')
  await expect(spreadsheet.getByTestId('office-spreadsheet-preview')).toBeVisible()
  await expect(spreadsheet.getByText('Channel')).toBeVisible()
  await expect(spreadsheet.getByText('Q1')).toBeVisible()
  await expect(spreadsheet.getByTestId('office-spreadsheet-runtime')).toHaveCount(0)

  await editor.page.getByTestId('code-object-design-hit-target').last().dblclick()
  await expect(spreadsheet).toHaveAttribute('data-office-mode', 'interact')
  await expect(spreadsheet.getByTestId('office-spreadsheet-loading')).toBeHidden({
    timeout: 15_000
  })
  await expect(spreadsheet.locator('[data-u-comp="workbench-layout"]')).toBeVisible()
  await expect(spreadsheet.locator('canvas')).toBeVisible()
  await editor.page.keyboard.press('Escape')
  await expect(spreadsheet).toHaveAttribute('data-office-mode', 'design')
  await expect(spreadsheet.getByTestId('office-spreadsheet-preview')).toBeVisible()
  await expect(spreadsheet.getByTestId('office-spreadsheet-runtime')).toHaveCount(0)
  await expect(spreadsheet.locator('iframe')).toHaveCount(0)
})
