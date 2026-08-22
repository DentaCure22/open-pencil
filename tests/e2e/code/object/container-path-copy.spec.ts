import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

test('enters Containers, selects on click, then copies outerHTML with Command-C', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  const smylr = editor.page.frameLocator('[data-test-id="smylr-trusted-web-app-frame"]')
  const target = smylr.locator('[data-smylr-container-id="page-content"]')
  await expect(target).toBeVisible({ timeout: 20_000 })

  await editor.page.evaluate((id) => window.openPencil?.getStore?.().select([id]), frameId)
  await editor.page.keyboard.press('Meta+c')

  await expect(editor.page.getByTestId('smylr-containers-tool')).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(editor.page.getByTestId('smylr-live-select-surface')).toBeVisible()

  await editor.page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          document.documentElement.dataset.testClipboardText = text
        }
      }
    })
  })

  const iframeBounds = await iframe.boundingBox()
  const iframeSize = await iframe.evaluate((element) => ({
    height: element.clientHeight,
    width: element.clientWidth
  }))
  const targetBounds = await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y }
  })
  if (!iframeBounds || iframeSize.width === 0 || iframeSize.height === 0) {
    throw new Error('Smylr iframe bounds unavailable')
  }

  await editor.page.mouse.click(
    iframeBounds.x +
      (targetBounds.x + targetBounds.width / 2) * (iframeBounds.width / iframeSize.width),
    iframeBounds.y +
      (targetBounds.y + targetBounds.height / 2) * (iframeBounds.height / iframeSize.height)
  )

  await expect
    .poll(() =>
      editor.page.evaluate(() => document.documentElement.dataset.testClipboardText ?? null)
    )
    .toBeNull()

  const selectedOuterHtml = () =>
    editor.page.evaluate(async () => {
      const { selectedLiveInspectorNode } = await import('/src/app/smylr-live-inspector/session.ts')
      const { liveInspectorNodeOuterHtml } =
        await import('/src/app/smylr-live-inspector/outer-html.ts')
      return liveInspectorNodeOuterHtml(selectedLiveInspectorNode.value)
    })

  await expect.poll(selectedOuterHtml).not.toBeNull()
  await editor.page.keyboard.press('Meta+c')
  await expect
    .poll(() =>
      editor.page.evaluate(() => document.documentElement.dataset.testClipboardText ?? null)
    )
    .toBe(await selectedOuterHtml())
  await expect(editor.page.getByText('Container outerHTML copied', { exact: true })).toBeVisible()
})
