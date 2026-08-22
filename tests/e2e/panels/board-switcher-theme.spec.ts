import type { Locator } from '@playwright/test'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test')

type ThemeColors = {
  chromeControl: string
  chromeDetail: string
  chromeRaised: string
  hover: string
  muted: string
  surface: string
}

async function letAppReceivePointerEvents() {
  await editor.page.addStyleTag({
    content: '[data-testid="react-grab-overlay"] { pointer-events: none !important; }'
  })
}

async function setTheme(theme: 'dark' | 'light') {
  await editor.page.evaluate((nextTheme) => {
    document.documentElement.dataset.theme = nextTheme
  }, theme)
}

async function openSwitcher() {
  await letAppReceivePointerEvents()
  const switcher = editor.page.getByTestId('board-project-browser')
  if (!(await switcher.isVisible()))
    await editor.page.getByTestId('workspace-toolbar-button').click()
  const back = switcher.getByTestId('board-switcher-back')
  if (await back.isVisible()) await back.click()
  await expect(switcher).toBeVisible()
  return switcher
}

function css(locator: Locator, property: 'backgroundColor' | 'color') {
  return locator.evaluate(
    (element, cssProperty) => getComputedStyle(element)[cssProperty],
    property
  )
}

async function themeColors(): Promise<ThemeColors> {
  return editor.page.evaluate(() => {
    const token = (name: string, property: 'backgroundColor' | 'color') => {
      const probe = document.createElement('span')
      probe.style.setProperty(
        property === 'backgroundColor' ? 'background-color' : 'color',
        `var(${name})`
      )
      document.body.append(probe)
      const value = getComputedStyle(probe)[property]
      probe.remove()
      return value
    }

    return {
      chromeControl: token('--color-chrome-control', 'backgroundColor'),
      chromeDetail: token('--color-chrome-detail', 'backgroundColor'),
      chromeRaised: token('--color-chrome-raised', 'backgroundColor'),
      hover: token('--color-hover', 'backgroundColor'),
      muted: token('--color-muted', 'color'),
      surface: token('--color-surface', 'color')
    }
  })
}

test('uses readable semantic colors in light mode and preserves dark mode', async () => {
  await setTheme('light')
  const switcher = await openSwitcher()
  const search = switcher.getByTestId('board-switcher-search')
  const searchField = switcher.getByTestId('board-switcher-search-field')
  const projectRows = switcher.getByTestId('board-switcher-project-row')
  expect(await projectRows.count()).toBeGreaterThan(0)
  const projectRow = projectRows.first()
  const activeRows = switcher.locator('[data-current="true"]')
  expect(await activeRows.count()).toBeGreaterThan(0)
  const activeRow = activeRows.first()
  const primaryAction = switcher.getByTestId('board-switcher-create-board')
  const secondaryAction = switcher.getByTestId('board-switcher-create-project')

  const readActual = async () => {
    const [
      activeRowBackground,
      activeRowColor,
      panelBackground,
      panelColor,
      primaryActionColor,
      projectRowColor,
      searchBackground,
      searchColor,
      secondaryActionColor
    ] = await Promise.all([
      css(activeRow, 'backgroundColor'),
      css(activeRow, 'color'),
      css(switcher, 'backgroundColor'),
      css(switcher, 'color'),
      css(primaryAction, 'color'),
      css(projectRow, 'color'),
      css(searchField, 'backgroundColor'),
      css(search, 'color'),
      css(secondaryAction, 'color')
    ])
    return {
      activeRowBackground,
      activeRowColor,
      panelBackground,
      panelColor,
      primaryActionColor,
      projectRowColor,
      searchBackground,
      searchColor,
      secondaryActionColor
    }
  }

  const expectTheme = async (tokens: ThemeColors) => {
    await expect.poll(readActual).toEqual({
      activeRowBackground: tokens.chromeDetail,
      activeRowColor: tokens.surface,
      panelBackground: tokens.chromeRaised,
      panelColor: tokens.surface,
      primaryActionColor: tokens.surface,
      projectRowColor: tokens.surface,
      searchBackground: tokens.chromeControl,
      searchColor: tokens.surface,
      secondaryActionColor: tokens.muted
    })
  }

  const light = await themeColors()
  await expectTheme(light)
  await projectRow.hover()
  await expect(projectRow).toHaveCSS('background-color', light.hover)
  await search.focus()
  await expect(searchField).toHaveCSS('background-color', light.chromeControl)
  await search.blur()

  await setTheme('dark')
  await expectTheme(await themeColors())
})

test('keeps project browsing open and closes after selection, Escape, or outside click', async () => {
  await setTheme('light')
  const switcher = await openSwitcher()
  const projectRows = switcher.getByTestId('board-switcher-project-row')
  expect(await projectRows.count()).toBeGreaterThan(0)
  await projectRows.first().click()
  await expect(switcher).toBeVisible()

  await switcher.getByTestId('board-switcher-search').fill('Main board')
  const boardRows = switcher.getByTestId('board-switcher-board-row')
  expect(await boardRows.count()).toBeGreaterThan(0)
  await boardRows.first().click()
  await expect(switcher).not.toBeVisible()

  await openSwitcher()
  await editor.page.keyboard.press('Escape')
  await expect(switcher).not.toBeVisible()

  await openSwitcher()
  await editor.page.mouse.click(700, 100)
  await expect(switcher).not.toBeVisible()
})
