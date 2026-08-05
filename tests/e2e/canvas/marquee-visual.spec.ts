import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-rulers')

const SCREEN_MARQUEE = { x: 180, y: 140, width: 560, height: 340 }
const SCREEN_SUBJECT = { x: 320, y: 240, width: 180, height: 100 }

test.beforeEach(async () => {
  await editor.page.emulateMedia({ reducedMotion: 'reduce' })
  await editor.page.reload()
  await editor.canvas.waitForInit()
  await editor.canvas.clearCanvas()
})

async function loadTheme(theme: 'dark' | 'light') {
  const appMenuToggle = editor.page.getByTestId('app-menu-toggle')
  if ((await appMenuToggle.getAttribute('aria-expanded')) !== 'true') {
    await appMenuToggle.click()
  }

  await editor.page.getByTestId('menubar-settings').click()
  await editor.page.getByRole('menuitem', { name: 'Theme', exact: true }).hover()
  await editor.page
    .getByRole('menuitemcheckbox', {
      name: theme === 'light' ? 'Light' : 'Dark',
      exact: true
    })
    .click()
  await expect(editor.page.locator('html')).toHaveAttribute('data-theme', theme)

  if ((await appMenuToggle.getAttribute('aria-expanded')) === 'true') {
    await appMenuToggle.click()
  }
}

async function renderMarquee(zoom: number): Promise<Buffer<ArrayBufferLike>> {
  await editor.page.evaluate(
    ({ zoom, marquee, subject }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('OpenPencil store not initialized')

      const existing = store.graph
        .getChildren(store.state.currentPageId)
        .find((node) => node.name === 'Marquee regression subject')
      const node =
        existing ??
        store.graph.createNode('RECTANGLE', store.state.currentPageId, {
          name: 'Marquee regression subject'
        })

      store.graph.updateNode(node.id, {
        x: subject.x / zoom,
        y: subject.y / zoom,
        width: subject.width / zoom,
        height: subject.height / zoom,
        cornerRadius: 12 / zoom
      })
      store.state.panX = 0
      store.state.panY = 0
      store.state.zoom = zoom
      store.select([node.id])
      store.setMarquee({
        x: marquee.x / zoom,
        y: marquee.y / zoom,
        width: marquee.width / zoom,
        height: marquee.height / zoom
      })
    },
    { zoom, marquee: SCREEN_MARQUEE, subject: SCREEN_SUBJECT }
  )
  await editor.canvas.waitForRender()
  return editor.canvas.screenshotCanvas()
}

test('marquee stays thin and rounded across zoom levels and theme backgrounds', async () => {
  await loadTheme('light')
  const lightZoomedOut = await renderMarquee(0.25)
  const lightZoomedIn = await renderMarquee(2)
  expect(lightZoomedOut).toMatchSnapshot('marquee-light-25-percent.png')
  expect(lightZoomedIn).toMatchSnapshot('marquee-light-200-percent.png')

  await loadTheme('dark')
  const darkZoomedOut = await renderMarquee(0.25)
  const darkZoomedIn = await renderMarquee(2)
  expect(darkZoomedOut).toMatchSnapshot('marquee-dark-25-percent.png')
  expect(darkZoomedIn).toMatchSnapshot('marquee-dark-200-percent.png')
})
