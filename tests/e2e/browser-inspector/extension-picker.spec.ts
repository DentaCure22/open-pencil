import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { expectDefined } from '#tests/helpers/assert'

const pickerPath = new URL('../../../extensions/openpencil-chrome/picker.js', import.meta.url)
const offscreenPath = new URL('../../../extensions/openpencil-chrome/offscreen.js', import.meta.url)
const pickerIconNames = ['message-circle-filled', 'mic', 'mic-off', 'trash-2', 'video'] as const

async function addPickerScript(page: Page, pickerSource: string) {
  const iconData = Object.fromEntries(
    await Promise.all(
      pickerIconNames.map(async (name) => {
        const source = await readFile(
          new URL(`../../../extensions/openpencil-chrome/icons/${name}.svg`, import.meta.url),
          'utf8'
        )
        return [name, `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`]
      })
    )
  )
  await page.evaluate((icons) => {
    ;(window as PickerHarnessWindow).__openpencilPickerIconData = icons
  }, iconData)
  await page.addScriptTag({ content: pickerSource })
}

type PickerHarnessWindow = typeof window & {
  __blockedHotkeys?: string[]
  __openPencilMessages?: Array<{
    annotations?: Array<{ comment?: string }>
    kind?: string
    selection?: { element?: { tag?: string } }
  }>
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
  __openpencilPickerIconData?: Record<string, string>
  __blockPickerCaptures?: boolean
  __releasePickerCaptures?: Array<() => void>
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
              return Promise.resolve({
                dataUrl: canvas.toDataURL('image/png'),
                ok: true
              })
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await addPickerScript(page, pickerSource)

  const picker = page.locator('[data-op-inspector-layer]')
  await expect(picker).toHaveCount(1)
  await expect(picker).toBeVisible()
  await expect(picker).toHaveAttribute('data-ready', 'true')
  await page.mouse.move(445, 182)
  await expect(page).toHaveScreenshot('extension-picker-hover.png', {
    animations: 'disabled'
  })
  await expect(picker).toHaveAttribute('data-exit-hint-visible', 'false', {
    timeout: 3_000
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
    const pickerTarget = window as PickerHarnessWindow
    pickerTarget.__blockPickerCaptures = true
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          sendMessage: (message: { kind?: string }) => {
            const target = window as PickerHarnessWindow
            target.__openPencilMessages ??= []
            target.__openPencilMessages.push(structuredClone(message))
            if (message.kind === 'capture-visible-browser-element') {
              const capture = () => {
                const canvas = document.createElement('canvas')
                canvas.width = window.innerWidth
                canvas.height = window.innerHeight
                const context = canvas.getContext('2d')
                if (context) {
                  context.fillStyle = '#f4f5f8'
                  context.fillRect(0, 0, canvas.width, canvas.height)
                }
                return {
                  dataUrl: canvas.toDataURL('image/png'),
                  ok: true
                }
              }
              if (!target.__blockPickerCaptures) return Promise.resolve(capture())
              return new Promise((resolve) => {
                target.__releasePickerCaptures ??= []
                target.__releasePickerCaptures.push(() => resolve(capture()))
              })
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await addPickerScript(page, pickerSource)
  await page.mouse.click(146, 160)
  await page.mouse.click(390, 208)
  const picker = page.locator('[data-op-inspector-layer]')
  await expect(picker).toHaveAttribute('data-icons-ready', 'true')
  await expect(picker).toHaveAttribute('data-committed-count', '2')
  expect(
    await page.evaluate(
      () =>
        ((window as PickerHarnessWindow).__openPencilMessages ?? []).filter(
          (message) => message.kind === 'browser-element-selection'
        ).length
    )
  ).toBe(0)
  await page.evaluate(() => {
    const target = window as PickerHarnessWindow
    target.__blockPickerCaptures = false
    for (const release of target.__releasePickerCaptures?.splice(0) ?? []) release()
  })
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
  await expect(picker).toBeVisible()
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
            reason?: string
            selection?: {
              session?: { captureSessionId?: string; sequence?: number }
            }
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
  expect(ended?.reason).toBe('finished')
})

test('selects iframe shells and controls inside open shadow roots', async ({ page }) => {
  const pickerSource = await readFile(pickerPath, 'utf8')
  await page.setViewportSize({ width: 820, height: 520 })
  await page.setContent(`
    <style>
      body { margin: 0; background: #f4f5f8; font-family: system-ui, sans-serif; }
      main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 90px 40px; }
      iframe, open-shadow-card { display: block; width: 340px; height: 180px; border: 1px solid #d8dbe4; border-radius: 14px; background: white; }
    </style>
    <main>
      <iframe title="Embedded schedule" srcdoc="<button>Inside frame</button>"></iframe>
      <open-shadow-card></open-shadow-card>
    </main>
  `)
  await page.evaluate(() => {
    customElements.define(
      'open-shadow-card',
      class extends HTMLElement {
        constructor() {
          super()
          const root = this.attachShadow({ mode: 'open' })
          const button = document.createElement('button')
          button.textContent = 'Shadow action'
          button.setAttribute('aria-label', 'Shadow action')
          Object.assign(button.style, {
            border: '0',
            borderRadius: '10px',
            margin: '56px',
            padding: '16px',
            width: '220px'
          })
          root.append(button)
        }
      }
    )
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
              return Promise.resolve({
                dataUrl: canvas.toDataURL('image/png'),
                ok: true
              })
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await addPickerScript(page, pickerSource)

  const picker = page.locator('[data-op-inspector-layer]')
  await expect(picker).toHaveAttribute('data-embedded-shield-count', '1')
  const iframeBounds = expectDefined(await page.locator('iframe').boundingBox())
  await page.mouse.click(
    iframeBounds.x + iframeBounds.width / 2,
    iframeBounds.y + iframeBounds.height / 2
  )
  await expect(picker).toHaveAttribute('data-committed-count', '1')
  await expect(picker).toHaveAttribute('data-annotation-open', 'true')
  await expect(page).toHaveScreenshot('extension-picker-iframe-selection.png', {
    animations: 'disabled'
  })
  await page.keyboard.press('Enter')

  await page.getByRole('button', { name: 'Shadow action' }).click()
  await expect(picker).toHaveAttribute('data-committed-count', '2')
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as PickerHarnessWindow).__openPencilMessages ?? [])
          .filter((message) => message.kind === 'browser-element-selection')
          .map((message) => message.selection?.element?.tag)
      )
    )
    .toEqual(['iframe', 'button'])
})

test('records a WebM from the visible-frame fallback', async ({ page }) => {
  const offscreenSource = await readFile(offscreenPath, 'utf8')
  await page.setContent('<main>Sampled recording surface</main>')
  await page.evaluate(() => {
    const target = window as typeof window & {
      __offscreenMessages?: Array<Record<string, unknown>>
      __offscreenRuntimeListener?: (
        message: Record<string, unknown>,
        sender: unknown,
        sendResponse: (response: unknown) => void
      ) => boolean
    }
    const source = document.createElement('canvas')
    source.width = 640
    source.height = 360
    const sourceContext = source.getContext('2d')
    if (!sourceContext) throw new Error('Canvas unavailable')
    sourceContext.fillStyle = '#6d5efc'
    sourceContext.fillRect(0, 0, source.width, source.height)
    sourceContext.fillStyle = 'white'
    sourceContext.font = '700 32px system-ui'
    sourceContext.fillText('Sampled motion frame', 120, 190)
    const frameDataUrl = source.toDataURL('image/jpeg', 0.82)
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: {
        runtime: {
          onMessage: {
            addListener: (listener: typeof target.__offscreenRuntimeListener) => {
              target.__offscreenRuntimeListener = listener
            }
          },
          sendMessage: async (message: Record<string, unknown>) => {
            target.__offscreenMessages ??= []
            target.__offscreenMessages.push(structuredClone(message))
            if (message.kind === 'capture-motion-frame') {
              return { dataUrl: frameDataUrl, ok: true }
            }
            return { ok: true }
          }
        }
      }
    })
  })
  await page.addScriptTag({ content: offscreenSource })

  const started = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const listener = (
          window as typeof window & {
            __offscreenRuntimeListener?: (
              message: Record<string, unknown>,
              sender: unknown,
              sendResponse: (response: unknown) => void
            ) => boolean
          }
        ).__offscreenRuntimeListener
        listener?.(
          {
            captureSessionId: 'sampled-recording',
            kind: 'start-frame-recording',
            startedAt: '2026-08-24T20:00:00.000Z',
            target: 'offscreen'
          },
          {},
          resolve
        )
      })
  )
  expect(started).toEqual(
    expect.objectContaining({ mode: 'frame-sampling', ok: true })
  )
  await page.waitForTimeout(700)

  const stopped = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const listener = (
          window as typeof window & {
            __offscreenRuntimeListener?: (
              message: Record<string, unknown>,
              sender: unknown,
              sendResponse: (response: unknown) => void
            ) => boolean
          }
        ).__offscreenRuntimeListener
        listener?.(
          {
            captureSessionId: 'sampled-recording',
            kind: 'stop-recording',
            target: 'offscreen'
          },
          {},
          resolve
        )
      })
  )
  expect(stopped).toEqual({ ok: true })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __offscreenMessages?: Array<Record<string, unknown>>
            }
          ).__offscreenMessages?.find((message) => message.kind === 'recording-complete')
      )
    )
    .toEqual(
      expect.objectContaining({
        captureSessionId: 'sampled-recording',
        byteLength: expect.any(Number),
        dataUrl: expect.stringMatching(/^data:video\/webm/),
        kind: 'recording-complete'
      })
    )
  expect(
    await page.evaluate(
      () =>
        Number(
          (
            window as typeof window & {
              __offscreenMessages?: Array<Record<string, unknown>>
            }
          ).__offscreenMessages?.find((message) => message.kind === 'recording-complete')
            ?.byteLength ?? 0
        )
    )
  ).toBeGreaterThan(0)
})

test('keeps editable annotation handles, deletes selections, and records with clean pixels', async ({
  page
}) => {
  const pickerSource = await readFile(pickerPath, 'utf8')
  await page.setViewportSize({ width: 900, height: 520 })
  await page.setContent(`
    <style>
      body { margin: 0; background: #f4f5f8; font-family: system-ui, sans-serif; }
      main { display: flex; align-items: center; justify-content: center; gap: 28px; min-height: 100vh; }
      button { width: 280px; height: 140px; border: 1px solid #d8dbe4; border-radius: 14px; background: white; }
    </style>
    <main>
      <button aria-label="Patient card">Patient card</button>
      <button aria-label="Appointment card">Appointment card</button>
    </main>
  `)
  await page.evaluate(() => {
    const target = window as PickerHarnessWindow & {
      __pageClicks?: number
      __recordingVisibilityAtStart?: string
    }
    document.querySelector('[aria-label="Patient card"]')?.addEventListener('click', () => {
      target.__pageClicks = (target.__pageClicks ?? 0) + 1
    })
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.target instanceof HTMLInputElement) return
        target.__blockedHotkeys ??= []
        target.__blockedHotkeys.push(event.key)
        event.preventDefault()
      },
      true
    )
    class FakeSpeechRecognition {
      continuous = false
      interimResults = false
      lang = ''
      onend: (() => void) | null = null
      onerror: ((event: { error: string }) => void) | null = null
      onresult:
        | ((event: { results: Array<Array<{ transcript: string }>> }) => void)
        | null = null

      start() {
        this.onresult?.({ results: [[{ transcript: 'Dictated patient note' }]] })
      }

      stop() {
        this.onend?.()
      }
    }
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition
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
              return Promise.resolve({
                dataUrl: canvas.toDataURL('image/png'),
                ok: true
              })
            }
            if (message.kind === 'start-browser-motion-recording') {
              const picker = document.querySelector('[data-op-inspector-layer]')
              target.__recordingVisibilityAtStart = picker
                ? getComputedStyle(picker).visibility
                : 'missing'
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await addPickerScript(page, pickerSource)

  const picker = page.locator('[data-op-inspector-layer]')
  await expect(picker).toHaveAttribute('data-icons-ready', 'true')
  const annotationInput = picker.locator(':scope > input[slot="annotation-input"]')
  const target = page.getByRole('button', { name: 'Patient card' })
  const otherTarget = page.getByRole('button', { name: 'Appointment card' })
  const targetBounds = expectDefined(await target.boundingBox())
  const otherTargetBounds = expectDefined(await otherTarget.boundingBox())
  const clickPatientPoint = () =>
    page.mouse.click(
      targetBounds.x + targetBounds.width / 2,
      targetBounds.y + targetBounds.height / 2
    )
  const clickAppointmentClearPoint = () =>
    page.mouse.click(
      otherTargetBounds.x + otherTargetBounds.width - 24,
      otherTargetBounds.y + otherTargetBounds.height - 24
    )
  await target.click()
  await expect(picker).toHaveAttribute('data-annotation-open', 'true')
  await expect(picker).toHaveAttribute('data-annotation-revisit', 'false')
  await expect(picker).toHaveAttribute('data-committed-count', '1')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'input')
  await expect(page).toHaveScreenshot('extension-picker-annotation-bubble.png', {
    animations: 'disabled'
  })

  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  })
  const inputBounds = expectDefined(await annotationInput.boundingBox())
  await page.mouse.click(inputBounds.x + inputBounds.width / 2, inputBounds.y + inputBounds.height / 2)
  await expect.poll(() => annotationInput.evaluate((input) => document.activeElement === input)).toBe(true)
  await page.keyboard.type('Type real note')
  await expect(annotationInput).toHaveValue('Type real note')
  expect(
    await page.evaluate(
      () => (window as PickerHarnessWindow).__blockedHotkeys ?? []
    )
  ).toEqual([])
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-annotation-open', 'false')
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as PickerHarnessWindow).__openPencilMessages ?? []).some(
          (message) =>
            message.kind === 'browser-element-annotations-updated' &&
            message.annotations?.[0]?.comment === 'Type real note'
        )
      )
    )
    .toBe(true)

  await clickPatientPoint()
  await expect(picker).toHaveAttribute('data-annotation-open', 'true')
  await expect(picker).toHaveAttribute('data-annotation-revisit', 'true')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'input')
  await page.keyboard.press('Tab')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'delete')
  await page.waitForTimeout(450)
  await expect(page).toHaveScreenshot('extension-picker-annotation-delete-tooltip.png', {
    animations: 'disabled'
  })
  await page.keyboard.press('Shift+Tab')
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
  await page.keyboard.type(' and click away')
  await clickAppointmentClearPoint()
  await expect(picker).toHaveAttribute('data-annotation-open', 'true')
  await expect(picker).toHaveAttribute('data-annotation-revisit', 'false')
  await expect(picker).toHaveAttribute('data-committed-count', '2')
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as PickerHarnessWindow).__openPencilMessages ?? []).some(
          (message) =>
            message.kind === 'browser-element-annotations-updated' &&
            message.annotations?.[0]?.comment === 'Type real note and click away'
        )
      )
    )
    .toBe(true)
  await page.keyboard.press('Enter')

  await clickPatientPoint()
  await expect(picker).toHaveAttribute('data-annotation-revisit', 'true')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'input')
  await page.keyboard.press('Tab')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'delete')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-committed-count', '1')
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          ((window as PickerHarnessWindow).__openPencilMessages ?? []).some(
            (message) => message.kind === 'browser-element-selection-removed'
          )
        )
      )
    )
    .toBe(true)

  await clickPatientPoint()
  await expect(picker).toHaveAttribute('data-committed-count', '2')
  await expect(picker).toHaveAttribute('data-annotation-revisit', 'false')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'input')
  await page.keyboard.press('Tab')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'dictate')
  await page.waitForTimeout(450)
  await expect(page).toHaveScreenshot('extension-picker-annotation-tooltip.png', {
    animations: 'disabled'
  })
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-dictating', 'true')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-annotation-open', 'false')
  await expect(picker).toHaveAttribute('data-dictating', 'false')
  await expect
    .poll(() =>
      page.evaluate(() =>
        ((window as PickerHarnessWindow).__openPencilMessages ?? []).some(
          (message) =>
            message.kind === 'browser-element-annotations-updated' &&
            message.annotations?.[0]?.comment === 'Dictated patient note'
        )
      )
    )
    .toBe(true)

  await clickPatientPoint()
  await expect(picker).toHaveAttribute('data-annotation-revisit', 'true')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'input')
  await page.keyboard.press('Tab')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'delete')
  await page.keyboard.press('Tab')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'dictate')
  await page.keyboard.press('Tab')
  await expect(picker).toHaveAttribute('data-annotation-focus', 'record')
  await page.waitForTimeout(450)
  await expect(page).toHaveScreenshot('extension-picker-annotation-record-tooltip.png', {
    animations: 'disabled'
  })
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('data-recording-clean', 'true')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as PickerHarnessWindow & {
              __recordingVisibilityAtStart?: string
            }
          ).__recordingVisibilityAtStart
      )
    )
    .toBe('hidden')

  await target.click()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as PickerHarnessWindow & { __pageClicks?: number }).__pageClicks ?? 0
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
    .toBe(3)

  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  const finalMessages = await page.evaluate(
    () => (window as PickerHarnessWindow).__openPencilMessages ?? []
  )
  expect(finalMessages.some((message) => message.kind === 'stop-browser-motion-recording')).toBe(
    true
  )
  expect(finalMessages.some((message) => message.kind === 'browser-element-picker-ended')).toBe(
    true
  )
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
    const target = window as PickerHarnessWindow & {
      __openPencilUiClicks?: number
    }
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
              return Promise.resolve({
                dataUrl: canvas.toDataURL('image/png'),
                ok: true
              })
            }
            return Promise.resolve({ ok: true })
          }
        }
      }
    })
  })
  await addPickerScript(page, pickerSource)

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
                  return {
                    ok: true,
                    sequence: await target.__reserveOpenPencilSequence?.()
                  }
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
      {
        id: captureSessionId,
        label,
        selectedCount: globalSequence,
        startedAt: captureStartedAt
      }
    )
  await addPickerScript(page, pickerSource)
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
            selection?: {
              session?: { captureSessionId?: string; sequence?: number }
            }
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
        {
          captureSessionId: sessionId,
          kind: 'browser-element-picker-stop-session'
        },
        {},
        () => undefined
      )
    }
  }, captureSessionId)
  await expect(firstTab.locator('[data-op-inspector-layer]')).toHaveCount(0)
  await expect(secondTab.locator('[data-op-inspector-layer]')).toHaveCount(0)
})
