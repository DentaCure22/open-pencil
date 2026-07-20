import { expect, test } from '@playwright/test'

test('source-backed Three.js sample runs with every external request blocked', async ({ page }) => {
  await page.goto('/?test&html-source')
  await page.getByTestId('three-experience-start').click()
  await expect(page.getByTestId('html-board-frame')).toBeVisible()
  const sourceMetadata = await page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const board = [...store.state.selectedIds]
      .map((id) => store.graph.getNode(id))
      .find((node) =>
        node?.pluginData.some((entry) => entry.key === 'spatial-media/three-experience')
      )
    const value = board?.pluginData.find(
      (entry) => entry.key === 'spatial-media/three-experience'
    )?.value
    return value ? JSON.parse(value) : null
  })
  expect(sourceMetadata).toMatchObject({
    permission: {
      execution: 'explicit-user-start',
      hostAccess: 'opaque-origin',
      network: 'none'
    },
    runtimeUrl: 'bundled:three@0.184.0',
    sourceId: 'starter-torus-knot',
    sourceRevision: 1
  })
  expect(sourceMetadata?.sourceHash).toMatch(/^[a-f0-9]{40}$/)
  await page.getByTestId('html-board-mode-interact').click()

  const attemptedRuntimeRequests: string[] = []
  await page.route(/^https?:\/\//, async (route) => {
    if (route.request().frame() !== page.mainFrame()) {
      attemptedRuntimeRequests.push(route.request().url())
    }
    await route.abort()
  })

  const frame = page.frameLocator('[data-test-id="html-board-frame"]')
  await frame.getByRole('button', { name: 'Start interactive Three.js scene' }).click()
  await expect(frame.getByText('Interactive · source live', { exact: true })).toBeVisible()
  await expect(frame.locator('canvas')).toBeVisible()
  await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /connect-src 'none'/
  )
  await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).not.toHaveAttribute(
    'content',
    /unsafe-eval/
  )
  expect(attemptedRuntimeRequests).toEqual([])
})
