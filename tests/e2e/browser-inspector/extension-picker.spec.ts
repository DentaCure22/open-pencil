import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

const pickerPath = new URL('../../../extensions/openpencil-chrome/picker.js', import.meta.url)

type PickerHarnessWindow = typeof window & {
  __openPencilMessages?: Array<{ kind?: string }>
}

test('shows animated feedback while moving across Chrome elements', async ({ page }) => {
  const pickerSource = await readFile(pickerPath, 'utf8')
  await page.setViewportSize({ width: 720, height: 440 })
  await page.setContent(`
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #f4f5f8; color: #20232b; font-family: system-ui, sans-serif; }
      header { height: 58px; padding: 18px 24px; background: #20232b; color: white; font-weight: 650; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; padding: 28px; }
      section { min-height: 138px; border: 1px solid #d8dbe4; border-radius: 14px; background: white; padding: 18px; box-shadow: 0 8px 26px #1f233014; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      p { margin: 0; color: #747986; font-size: 13px; }
      button { margin-top: 18px; border: 0; border-radius: 8px; background: #6d5efc; color: white; padding: 10px 14px; font-weight: 650; }
      openpencil-inspector-layer { display: none !important; visibility: hidden !important; opacity: 0 !important; position: absolute !important; width: 0 !important; height: 0 !important; }
    </style>
    <header>Example workspace</header>
    <main>
      <section aria-label="Patient details">
        <h2>Patient details</h2>
        <p>Contact and appointment information</p>
      </section>
      <section aria-label="Actions">
        <h2>Actions</h2>
        <p>Choose an action for this record</p>
        <button aria-label="Open patient">Open patient</button>
      </section>
    </main>
  `)
  await page.evaluate(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (message: { kind?: string }) => {
            const target = window as PickerHarnessWindow
            target.__openPencilMessages ??= []
            target.__openPencilMessages.push(structuredClone(message))
            if (message.kind === 'capture-visible-browser-element') {
              const canvas = document.createElement('canvas')
              canvas.width = window.innerWidth
              canvas.height = window.innerHeight
              return Promise.resolve({ dataUrl: canvas.toDataURL('image/png'), ok: true })
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await page.addScriptTag({ content: pickerSource })

  const picker = page.locator('[data-op-inspector-layer]')
  await expect(picker).toHaveCount(1)
  await expect(picker).toBeVisible()
  await expect(picker).toHaveAttribute('data-ready', 'true')
  await page.mouse.move(445, 182)
  await expect(page).toHaveScreenshot('extension-picker-hover.png', {
    animations: 'disabled'
  })
})

test('keeps one numbered session active across multiple selections', async ({ page }) => {
  const pickerSource = await readFile(pickerPath, 'utf8')
  await page.setViewportSize({ width: 720, height: 440 })
  await page.setContent(`
    <style>
      body { margin: 0; background: #f4f5f8; font-family: system-ui, sans-serif; }
      main { display: flex; gap: 24px; padding: 100px 36px; }
      button { width: 220px; height: 120px; border: 1px solid #d8dbe4; border-radius: 14px; background: white; }
    </style>
    <main><button aria-label="First target">First target</button><button aria-label="Second target">Second target</button></main>
  `)
  await page.evaluate(() => {
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (message: { kind?: string }) => {
            const target = window as PickerHarnessWindow
            target.__openPencilMessages ??= []
            target.__openPencilMessages.push(structuredClone(message))
            if (message.kind === 'capture-visible-browser-element') {
              const canvas = document.createElement('canvas')
              canvas.width = window.innerWidth
              canvas.height = window.innerHeight
              const context = canvas.getContext('2d')
              if (context) {
                context.fillStyle = '#f4f5f8'
                context.fillRect(0, 0, canvas.width, canvas.height)
              }
              return Promise.resolve({ dataUrl: canvas.toDataURL('image/png'), ok: true })
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await page.addScriptTag({ content: pickerSource })
  await page.mouse.click(146, 160)
  await page.mouse.click(390, 160)
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          ((window as PickerHarnessWindow).__openPencilMessages ?? []).filter(
            (message) => message.kind === 'browser-element-selection'
          ).length
      )
    )
    .toBe(2)
  await expect(page.locator('[data-op-inspector-layer]')).toBeVisible()
  await expect(page).toHaveScreenshot('extension-picker-multi-select.png', {
    animations: 'disabled'
  })
  await page.keyboard.press('Escape')

  const events = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __openPencilMessages?: Array<{
            captureSessionId?: string
            kind?: string
            selection?: { session?: { captureSessionId?: string; sequence?: number } }
          }>
        }
      ).__openPencilMessages ?? []
  )
  const started = events.find((event) => event.kind === 'browser-element-picker-started')
  const selections = events.filter((event) => event.kind === 'browser-element-selection')
  const ended = events.find((event) => event.kind === 'browser-element-picker-ended')
  expect(selections.map((event) => event.selection?.session?.sequence)).toEqual([1, 2])
  expect(
    selections.every(
      (event) => event.selection?.session?.captureSessionId === started?.captureSessionId
    )
  ).toBe(true)
  expect(ended?.captureSessionId).toBe(started?.captureSessionId)
})
