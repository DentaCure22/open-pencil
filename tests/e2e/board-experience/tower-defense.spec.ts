import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&html-source')

type ExperienceComponentReadback = {
  definitionId: string
  id: string
  lifecycle: string
  name: string
  type: string
}

async function experienceReadback(): Promise<ExperienceComponentReadback[]> {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) return []
    return store.graph.getChildren(store.state.currentPageId).flatMap((node) => {
      const owner = node.pluginData.some(
        (entry) =>
          entry.pluginId === 'openpencil-board-experience' &&
          entry.key === 'owner' &&
          entry.value.includes('tower-defense')
      )
      if (!owner) return []
      const documentEntry = node.pluginData.find(
        (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
      )
      if (!documentEntry) return []
      try {
        const document = JSON.parse(documentEntry.value) as { definitionId?: unknown }
        const lifecycle =
          node.pluginData.find(
            (entry) =>
              entry.pluginId === 'openpencil-board-permissions' &&
              entry.key === 'component-lifecycle'
          )?.value ?? 'durable'
        return [
          {
            definitionId: typeof document.definitionId === 'string' ? document.definitionId : '',
            id: node.id,
            lifecycle,
            name: node.name,
            type: node.type
          }
        ]
      } catch {
        return []
      }
    })
  })
}

async function selectedIds() {
  return editor.page.evaluate(() => [...(window.openPencil?.getStore?.().state.selectedIds ?? [])])
}

test('composes tower defense from selectable Code Object instances', async () => {
  await editor.page.getByTestId('code-object-start').click()
  await editor.page.getByTestId('left-panel-assets-tab').click()
  const experienceFolder = editor.page.locator('[data-asset-group="board-experiences"]')
  await expect(experienceFolder).toHaveAttribute('aria-expanded', 'false')
  await expect(editor.page.getByTestId('board-experience-asset-tower-defense')).toBeHidden()
  await experienceFolder.click()
  await expect(experienceFolder).toHaveAttribute('aria-expanded', 'true')
  await editor.page.getByTestId('board-experience-asset-tower-defense').click()

  await expect(editor.page.getByTestId('board-experience-runtime')).toHaveAttribute(
    'data-board-experience-id',
    'tower-defense'
  )
  await expect(editor.page.getByTestId('board-experience-hud')).toHaveCount(0)
  await expect(editor.page.getByTestId('board-experience-overlay')).toHaveCount(0)
  await expect(editor.page.locator('iframe')).toHaveCount(0)

  await expect.poll(experienceReadback).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        definitionId: 'openpencil.tower-defense.lane',
        name: 'Defense lane',
        type: 'FRAME'
      }),
      expect.objectContaining({
        definitionId: 'openpencil.tower-defense.controls',
        name: 'Tower defense controls',
        type: 'FRAME'
      })
    ])
  )
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.filter(
        (component) => component.definitionId === 'openpencil.tower-defense.tower'
      ).length
    })
    .toBe(2)

  const lane = (await experienceReadback()).find(
    (component) => component.definitionId === 'openpencil.tower-defense.lane'
  )
  if (!lane) throw new Error('Defense lane component was unavailable')
  await editor.page
    .getByLabel('Defense lane. Click to select or interact. Double-click to focus.', {
      exact: true
    })
    .click()
  await expect.poll(selectedIds).toEqual([lane.id])
  await expect(editor.page.getByTestId('selection-context-trigger')).toBeVisible()

  const controls = (await experienceReadback()).find(
    (component) => component.definitionId === 'openpencil.tower-defense.controls'
  )
  if (!controls) throw new Error('Tower defense controls were unavailable')

  const controlsTarget = editor.page.getByLabel(
    'Tower defense controls. Click to select or interact. Double-click to focus.',
    { exact: true }
  )
  await controlsTarget.dblclick()
  await expect.poll(selectedIds).toEqual([controls.id])
  await editor.page.getByRole('button', { name: 'Add pulse · 45g', exact: true }).click()
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.filter(
        (component) => component.definitionId === 'openpencil.tower-defense.tower'
      ).length
    })
    .toBe(3)

  await editor.page.keyboard.press('Escape')
  await editor.page.keyboard.press('Meta+z')
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.filter(
        (component) => component.definitionId === 'openpencil.tower-defense.tower'
      ).length
    })
    .toBe(2)
  await editor.page.keyboard.press('Meta+Shift+z')
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.filter(
        (component) => component.definitionId === 'openpencil.tower-defense.tower'
      ).length
    })
    .toBe(3)

  await controlsTarget.dblclick()
  await editor.page.getByRole('button', { name: 'Start wave', exact: true }).click()
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.filter(
        (component) => component.definitionId === 'openpencil.tower-defense.enemy'
      ).length
    })
    .toBeGreaterThan(0)

  await editor.page.getByRole('button', { name: 'Pause wave', exact: true }).click()
  await editor.page.keyboard.press('Escape')
  const enemy = (await experienceReadback()).find(
    (component) => component.definitionId === 'openpencil.tower-defense.enemy'
  )
  if (!enemy) throw new Error('Enemy component was unavailable')
  expect(enemy).toMatchObject({
    lifecycle: 'transient',
    name: 'Enemy',
    type: 'FRAME'
  })
  await editor.page
    .getByTestId(`code-object-overlay-${enemy.id}`)
    .getByTestId('code-object-design-hit-target')
    .click()
  await expect.poll(selectedIds).toEqual([enemy.id])
  await expect(editor.page.getByTestId('selection-context-trigger')).toBeVisible()

  await controlsTarget.dblclick()
  await editor.page.getByRole('button', { name: 'Exit', exact: true }).click()
  await expect(editor.page.getByTestId('board-experience-runtime')).toHaveCount(0)
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.filter((component) => component.lifecycle === 'transient').length
    })
    .toBe(0)
  await expect
    .poll(async () => {
      const components = await experienceReadback()
      return components.some(
        (component) => component.definitionId === 'openpencil.tower-defense.lane'
      )
    })
    .toBe(true)
})
