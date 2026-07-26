import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart&no-chrome&no-rulers')

async function sceneVersion() {
  return editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    return store.state.sceneVersion
  })
}

test('continuous pointer awareness never invalidates the Board scene', async () => {
  test.setTimeout(60_000)
  await expect
    .poll(
      () => editor.page.evaluate(() => window.openPencil?.getStore?.().state.documentName ?? null),
      { timeout: 30_000 }
    )
    .toBe('OpenPencil Workspace')
  await expect
    .poll(
      async () => {
        const before = await sceneVersion()
        await editor.page.waitForTimeout(250)
        return (await sceneVersion()) - before
      },
      { timeout: 30_000 }
    )
    .toBe(0)

  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    store.state.panX = -100_000
    store.state.panY = -100_000
    store.requestRepaint()
  })
  const canvas = editor.page.getByTestId('canvas-element')
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('Canvas has no bounds')
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const counts = { overlay: 0, repaint: 0, scene: 0 }
    const stop = [
      store.onEditorEvent('overlay:requested', () => {
        counts.overlay += 1
      }),
      store.onEditorEvent('repaint:requested', () => {
        counts.repaint += 1
      }),
      store.onEditorEvent('render:requested', () => {
        counts.scene += 1
      })
    ]
    const target = window as typeof window & {
      __pointerAwarenessProbe?: {
        counts: typeof counts
        stop: () => void
      }
    }
    target.__pointerAwarenessProbe = {
      counts,
      stop: () => {
        for (const unsubscribe of stop) unsubscribe()
      }
    }
  })
  const before = await sceneVersion()

  await editor.page.mouse.move(bounds.x + 40, bounds.y + 40)
  await editor.page.mouse.move(bounds.x + bounds.width - 40, bounds.y + bounds.height - 40, {
    steps: 120
  })
  await editor.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )

  expect(await sceneVersion()).toBe(before)
  const counts = await editor.page.evaluate(() => {
    const target = window as typeof window & {
      __pointerAwarenessProbe?: {
        counts: { overlay: number; repaint: number; scene: number }
        stop: () => void
      }
    }
    const probe = target.__pointerAwarenessProbe
    if (!probe) throw new Error('Pointer awareness probe is missing')
    probe.stop()
    Reflect.deleteProperty(target, '__pointerAwarenessProbe')
    return probe.counts
  })
  expect(counts).toEqual({ overlay: 0, repaint: 0, scene: 0 })
  editor.canvas.assertNoErrors()
})
