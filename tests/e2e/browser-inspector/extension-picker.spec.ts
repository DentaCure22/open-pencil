import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { expectDefined } from '#tests/helpers/assert'

const pickerPath = new URL('../../../extensions/openpencil-chrome/picker.js', import.meta.url)

type PickerHarnessWindow = typeof window & {
  __openPencilMessages?: Array<{ kind?: string }>
  __openPencilRuntimeListeners?: Array<
    (
      message: { captureSessionId?: string; kind?: string },
      sender: unknown,
      sendResponse: (response: unknown) => void
    ) => unknown
  >
  __openpencilPickerSessionConfig?: {
    captureSessionId: string
    captureStartedAt: string
    selectedCount: number
  }
  __reserveOpenPencilSequence?: () => Promise<number>
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

test('selects OpenPencil while leaving its capture and annotation controls interactive', async ({
  page
}) => {
  const pickerSource = await readFile(pickerPath, 'utf8')
  await page.setViewportSize({ width: 720, height: 440 })
  await page.setContent(`
    <main style="display:flex;gap:24px;padding:100px">
      <button aria-label="Board canvas" style="width:240px;height:120px">Board canvas</button>
      <div data-openpencil-browser-inspector-ui>
        <button aria-label="Annotate capture" style="width:180px;height:120px">Annotate</button>
      </div>
    </main>
  `)
  await page.evaluate(() => {
    const target = window as PickerHarnessWindow & { __openPencilUiClicks?: number }
    document.querySelector('[aria-label="Annotate capture"]')?.addEventListener('click', () => {
      target.__openPencilUiClicks = (target.__openPencilUiClicks ?? 0) + 1
    })
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (message: { kind?: string }) => {
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

  await page.getByRole('button', { name: 'Annotate capture' }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as PickerHarnessWindow & { __openPencilUiClicks?: number })
            .__openPencilUiClicks ?? 0
      )
    )
    .toBe(1)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as PickerHarnessWindow).__openPencilMessages ?? []).filter(
            (message) => message.kind === 'browser-element-selection'
          ).length
      )
    )
    .toBe(0)

  await page.getByRole('button', { name: 'Board canvas' }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          ((window as PickerHarnessWindow).__openPencilMessages ?? []).filter(
            (message) => message.kind === 'browser-element-selection'
          ).length
      )
    )
    .toBe(1)
})

test('continues one globally numbered session after the user switches tabs', async ({
  context
}) => {
  const pickerSource = await readFile(pickerPath, 'utf8')
  const captureSessionId = 'cross-tab-session'
  const captureStartedAt = '2026-08-22T12:00:00.000Z'
  let globalSequence = 0

  async function prepareTab(label: string) {
    const page = await context.newPage()
    await page.setViewportSize({ width: 720, height: 440 })
    await page.setContent(
      `<main style="padding:100px"><button aria-label="${label}" style="width:240px;height:120px">${label}</button></main>`
    )
    await page.exposeFunction('__reserveOpenPencilSequence', () => ++globalSequence)
    await page.evaluate(
      ({ id, label, selectedCount, startedAt }) => {
        const target = window as PickerHarnessWindow
        target.__openpencilPickerSessionConfig = {
          captureSessionId: id,
          captureStartedAt: startedAt,
          selectedCount
        }
        Object.defineProperty(window, 'chrome', {
          configurable: true,
          value: {
            runtime: {
              onMessage: {
                addListener: (
                  listener: NonNullable<PickerHarnessWindow['__openPencilRuntimeListeners']>[number]
                ) => {
                  target.__openPencilRuntimeListeners ??= []
                  target.__openPencilRuntimeListeners.push(listener)
                },
                removeListener: (
                  listener: NonNullable<PickerHarnessWindow['__openPencilRuntimeListeners']>[number]
                ) => {
                  target.__openPencilRuntimeListeners = (
                    target.__openPencilRuntimeListeners ?? []
                  ).filter((candidate) => candidate !== listener)
                }
              },
              sendMessage: async (message: { kind?: string }) => {
                target.__openPencilMessages ??= []
                target.__openPencilMessages.push(structuredClone(message))
                if (message.kind === 'reserve-browser-element-sequence') {
                  return { ok: true, sequence: await target.__reserveOpenPencilSequence?.() }
                }
                if (message.kind === 'capture-visible-browser-element') {
                  const canvas = document.createElement('canvas')
                  canvas.width = window.innerWidth
                  canvas.height = window.innerHeight
                  return { dataUrl: canvas.toDataURL('image/png'), ok: true }
                }
                return { ok: true }
              }
            }
          }
        })
        document.title = label
      },
      { id: captureSessionId, label, selectedCount: globalSequence, startedAt: captureStartedAt }
    )
    await page.addScriptTag({ content: pickerSource })
    return page
  }

  const firstTab = await prepareTab('First tab target')
  await firstTab.getByRole('button', { name: 'First tab target' }).click()
  await expect.poll(() => globalSequence).toBe(1)

  const secondTab = await prepareTab('Second tab target')
  await secondTab.getByRole('button', { name: 'Second tab target' }).click()
  await expect.poll(() => globalSequence).toBe(2)

  await Promise.all(
    [firstTab, secondTab].map((page) =>
      expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              ((window as PickerHarnessWindow).__openPencilMessages ?? []).some(
                (message) => message.kind === 'browser-element-selection'
              )
            )
          )
        )
        .toBe(true)
    )
  )

  const selectionEvents = await Promise.all(
    [firstTab, secondTab].map((page) =>
      page.evaluate(
        () =>
          ((window as PickerHarnessWindow).__openPencilMessages ?? []).find(
            (message) => message.kind === 'browser-element-selection'
          ) as {
            selection?: { session?: { captureSessionId?: string; sequence?: number } }
          }
      )
    )
  )
  const selections = selectionEvents.map((event, index) =>
    expectDefined(event, `selection event ${String(index + 1)}`)
  )
  expect(selections.map((event) => event.selection?.session?.captureSessionId)).toEqual([
    captureSessionId,
    captureSessionId
  ])
  expect(selections.map((event) => event.selection?.session?.sequence)).toEqual([1, 2])
  await expect(secondTab).toHaveScreenshot('extension-picker-cross-tab.png', {
    animations: 'disabled'
  })
  await secondTab.keyboard.press('Escape')
  await firstTab.evaluate((sessionId) => {
    for (const listener of (window as PickerHarnessWindow).__openPencilRuntimeListeners ?? []) {
      listener(
        { captureSessionId: sessionId, kind: 'browser-element-picker-stop-session' },
        {},
        () => undefined
      )
    }
  }, captureSessionId)
  await expect(firstTab.locator('[data-op-inspector-layer]')).toHaveCount(0)
  await expect(secondTab.locator('[data-op-inspector-layer]')).toHaveCount(0)
})
