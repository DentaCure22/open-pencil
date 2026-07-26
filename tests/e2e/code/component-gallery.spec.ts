import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

test('reveals an inserted component asset as the selected layer', async () => {
  const componentId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const component = store.graph.createNode('COMPONENT', store.state.currentPageId, {
      name: 'Layer reveal asset',
      x: 80,
      y: 80,
      width: 160,
      height: 96
    })
    store.requestRender()
    return component.id
  })

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.getByTestId('assets-search').fill('Layer reveal asset')
  const asset = editor.page.locator(`[data-asset-id="${componentId}"]`)
  await asset.getByTestId('asset-open').click()
  await asset.getByTestId('asset-insert').click()

  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  const insertedId = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return [...store.state.selectedIds][0]
  })
  expect(insertedId).not.toBe(componentId)
  const selectedLayer = editor.page
    .locator(`[data-node-id="${insertedId}"]`)
    .getByTestId('layers-item')
  await expect(selectedLayer).toBeVisible()
  await expect(selectedLayer).toHaveClass(/bg-white/)
})

test('adds and uses frame-owned Code Object presets through the normal Assets flow', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.getByTestId('code-object-asset-orbit-lab').click()

  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  const selectedOrbitLayer = editor.page
    .locator('[data-node-id]')
    .filter({ hasText: 'Orbit lab' })
    .getByTestId('layers-item')
  await expect(selectedOrbitLayer).toBeVisible()
  await expect(selectedOrbitLayer).toHaveClass(/bg-white/)

  const orbit = editor.page.getByTestId('code-object-orbit-lab')
  const orbitWrapper = editor.page.locator('[data-code-object-mode]').filter({ has: orbit })
  await expect(orbit).toBeVisible()
  await expect(orbitWrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.locator('iframe')).toHaveCount(0)

  await editor.page.getByRole('tab', { name: 'Code' }).click()
  await expect(editor.page.getByTestId('code-object-code-panel')).toBeVisible()
  await expect(editor.page.getByText('Selection code')).toHaveCount(0)
  await expect(editor.page.getByTestId('code-panel-add-code-object')).toHaveCount(0)
  const orbitSource = editor.page.getByTestId('code-object-source')
  await expect(orbitSource).toHaveValue(/OrbitLabCodeObject/)
  await orbitSource.fill(`${await orbitSource.inputValue()}\n// Frame-owned Orbit source.`)
  await editor.page.getByTestId('code-object-apply').click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        const id = store ? [...store.state.selectedIds][0] : null
        const node = id ? store?.graph.getNode(id) : null
        const raw = node?.pluginData.find(
          (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
        )?.value
        return raw ? JSON.parse(raw).source : ''
      })
    )
    .toContain('Frame-owned Orbit source')

  await editor.page.getByTestId('code-object-design-hit-target').last().dblclick()
  await expect(orbitWrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.getByTestId('code-object-orbit-toggle').click()
  await expect(editor.page.getByTestId('code-object-orbit-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await editor.page.keyboard.press('Escape')
  await expect(orbitWrapper).toHaveAttribute('data-code-object-mode', 'design')

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await expect(editor.page.getByTestId('assets-panel')).toBeVisible()
  const interactiveFolder = editor.page.locator('[data-asset-group="interactive"]')
  await expect(interactiveFolder).toContainText('Code Object presets')
  await expect(interactiveFolder).toHaveAttribute('aria-expanded', 'true')
  await interactiveFolder.click()
  await expect(interactiveFolder).toHaveAttribute('aria-expanded', 'false')
  await expect(editor.page.getByTestId('code-object-asset-signal-bloom')).toBeHidden()
  await interactiveFolder.click()
  await expect(interactiveFolder).toHaveAttribute('aria-expanded', 'true')
  await editor.page.getByTestId('code-object-asset-signal-bloom').click()

  const bloom = editor.page.getByTestId('code-object-signal-bloom')
  const bloomWrapper = editor.page.locator('[data-code-object-mode]').filter({ has: bloom })
  await expect(bloom).toBeVisible()
  await expect(editor.page.locator('[data-code-object-root]')).toHaveCount(3)
  await expect(bloomWrapper).toHaveAttribute('data-code-object-mode', 'design')

  await editor.page.keyboard.press('Enter')
  await expect(bloomWrapper).toHaveAttribute('data-code-object-mode', 'interact')

  await editor.page.getByTestId('code-object-bloom-toggle').click()
  await expect(editor.page.getByTestId('code-object-bloom-toggle')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await editor.page.keyboard.press('Escape')
  await expect(bloomWrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.locator('iframe')).toHaveCount(0)

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.getByTestId('code-object-asset-analytics-chart').click()
  const chart = editor.page.getByTestId('saved-chart')
  const chartWrapper = editor.page.locator('[data-code-object-mode]').filter({ has: chart })
  await expect(chart).toBeVisible()
  await expect(chart).toContainText('Activation trend')
  await editor.page.getByTestId('code-object-design-hit-target').last().dblclick()
  await expect(chartWrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await editor.page.getByRole('button', { name: '7d' }).click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        const id = store ? [...store.state.selectedIds][0] : null
        const node = id ? store?.graph.getNode(id) : null
        const raw = node?.pluginData.find(
          (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
        )?.value
        return raw ? JSON.parse(raw).state.range : null
      })
    )
    .toBe('7d')
  await editor.page.keyboard.press('Escape')

  await editor.page.getByTestId('left-panel-assets-tab').click()
  await editor.page.getByTestId('code-object-asset-interactive-form').click()
  const form = editor.page.getByTestId('saved-form')
  const formWrapper = editor.page.locator('[data-code-object-mode]').filter({ has: form })
  await expect(form).toBeVisible()
  await editor.page.getByRole('tab', { name: 'Code' }).click()
  await expect(editor.page.getByTestId('code-object-code-panel')).toBeVisible()
  await expect(editor.page.getByTestId('code-object-source')).toHaveValue(
    /function InteractiveForm/
  )
  const formSource = editor.page.getByTestId('code-object-source')
  await formSource.fill(
    `${await formSource.inputValue()}\n// Edited in the shared Code Object inspector.`
  )
  await editor.page.getByTestId('code-object-apply').click()
  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        const id = store ? [...store.state.selectedIds][0] : null
        const node = id ? store?.graph.getNode(id) : null
        const raw = node?.pluginData.find(
          (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
        )?.value
        return raw ? JSON.parse(raw).source : ''
      })
    )
    .toContain('Edited in the shared Code Object inspector')
  await editor.page.getByTestId('code-object-design-hit-target').last().dblclick()
  await expect(formWrapper).toHaveAttribute('data-code-object-mode', 'interact')
  await form.getByLabel('Name').fill('Ari')
  await form.getByLabel('Email').fill('ari@example.com')
  await form.getByRole('button', { name: 'Submit' }).click()
  await expect(form.getByRole('button', { name: 'Submitted' })).toBeVisible()
  await editor.page.keyboard.press('Escape')
  await expect(formWrapper).toHaveAttribute('data-code-object-mode', 'design')
  await expect(editor.page.locator('iframe')).toHaveCount(0)
})
