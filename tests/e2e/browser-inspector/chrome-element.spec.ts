import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&html-source')

async function enterBoard() {
  const start = editor.page.getByTestId('native-board-start')
  if (await start.isVisible()) await start.click()
}

test('adds Chrome DOM elements to a capture session for agent and Trace context', async () => {
  await enterBoard()
  const toolbar = editor.page.getByRole('toolbar', { name: 'Editor tools' })
  const inspect = toolbar.getByTestId('browser-inspector-select')
  await expect(inspect).toHaveCount(1)
  await expect(inspect).toHaveAttribute('aria-label', 'Inspect Chrome')
  await expect(inspect).toHaveScreenshot('chrome-inspect-tool.png')

  await expect(editor.page.getByTestId('browser-inspector-selection-panel')).toHaveCount(0)
  await editor.page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (
        event.source !== window ||
        event.data?.contract !== 'openpencil-browser-element-command/v1' ||
        event.data?.command?.kind !== 'activate-picker'
      ) {
        return
      }
      ;(window as typeof window & { __browserPickerRequest?: unknown }).__browserPickerRequest =
        event.data
      window.postMessage(
        {
          contract: 'openpencil-browser-element-command-result/v1',
          ok: true,
          requestId: event.data.requestId
        },
        window.location.origin
      )
    })
  })
  await inspect.click()
  await expect
    .poll(() =>
      editor.page.evaluate(
        () =>
          (window as typeof window & { __browserPickerRequest?: unknown }).__browserPickerRequest
      )
    )
    .toMatchObject({ command: { kind: 'activate-picker' } })
  await expect(inspect).toBeEnabled()

  await editor.page.evaluate(() => {
    const preview = document.createElement('canvas')
    preview.width = 640
    preview.height = 360
    const context = preview.getContext('2d')
    if (!context) throw new Error('Preview canvas unavailable')
    context.fillStyle = '#f5f6f8'
    context.fillRect(0, 0, 640, 360)
    context.fillStyle = '#20242c'
    context.fillRect(0, 0, 640, 46)
    context.fillStyle = '#ffffff'
    context.font = '600 17px sans-serif'
    context.fillText('Patients', 20, 29)
    window.postMessage(
      {
        contract: 'openpencil-browser-element/v1',
        kind: 'selection',
        selection: {
          capturedAt: '2026-08-22T12:00:00.000Z',
          element: {
            accessibleName: 'Patient search',
            attributes: { 'aria-label': 'Patient search' },
            bounds: { height: 40, width: 280, x: 220, y: 80 },
            classes: ['patient-search'],
            role: 'searchbox',
            selector: '[aria-label="Patient search"]',
            tag: 'input',
            text: ''
          },
          id: 'e2e-browser-element',
          page: {
            origin: 'https://example.com',
            title: 'Patients',
            url: 'https://example.com/patients'
          },
          session: {
            captureSessionId: 'e2e-browser-session',
            captureStartedAt: '2026-08-22T12:00:00.000Z',
            frameId: 0,
            sequence: 1,
            tabId: 12
          },
          snapshot: { dataUrl: preview.toDataURL('image/png'), height: 360, width: 640 }
        }
      },
      window.location.origin
    )
  })

  await expect(editor.page.getByTestId('browser-inspector-selection')).toContainText(
    'Patient search'
  )
  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(editor.page.getByTestId('browser-inspector-session-strip')).toContainText('Patients')
  await expect(editor.page.getByTestId('browser-inspector-session')).toContainText('1')

  const capturedSelection = editor.page.getByTestId('browser-inspector-selection')
  await capturedSelection.hover()
  await capturedSelection.getByRole('button', { name: 'Annotate Patient search' }).click()
  const annotationReview = editor.page.getByTestId('browser-inspector-annotation-review')
  await expect(annotationReview).toBeVisible()
  await annotationReview
    .getByRole('img', { name: 'Chrome capture ready for annotation' })
    .click({ position: { x: 320, y: 180 } })
  await annotationReview
    .getByRole('textbox', { name: 'Screenshot comment' })
    .fill('Keep this search field visible')
  await annotationReview.getByRole('button', { name: 'Done' }).click()
  await annotationReview.getByRole('button', { name: 'Close annotation review' }).click()
  await expect(capturedSelection).toContainText('1')

  await editor.page.evaluate(() => {
    const preview = document.createElement('canvas')
    preview.width = 640
    preview.height = 360
    const context = preview.getContext('2d')
    if (!context) throw new Error('Preview canvas unavailable')
    context.fillStyle = '#f5f6f8'
    context.fillRect(0, 0, 640, 360)
    window.postMessage(
      {
        contract: 'openpencil-browser-element/v1',
        kind: 'selection',
        selection: {
          capturedAt: '2026-08-22T12:02:00.000Z',
          element: {
            accessibleName: 'Save patient',
            attributes: { 'aria-label': 'Save patient' },
            bounds: { height: 40, width: 120, x: 500, y: 80 },
            classes: ['save-patient'],
            role: 'button',
            selector: '[aria-label="Save patient"]',
            tag: 'button',
            text: 'Save patient'
          },
          id: 'e2e-browser-element-2',
          page: {
            origin: 'https://example.com',
            title: 'Patient editor',
            url: 'https://example.com/patients/1'
          },
          session: {
            captureSessionId: 'e2e-browser-session-2',
            captureStartedAt: '2026-08-22T12:02:00.000Z',
            frameId: 0,
            sequence: 1,
            tabId: 13
          },
          snapshot: {
            dataUrl: preview.toDataURL('image/png'),
            height: 360,
            width: 640
          }
        }
      },
      window.location.origin
    )
  })
  await expect(editor.page.getByTestId('browser-inspector-session')).toHaveCount(2)
  await expect(editor.page.getByTestId('browser-inspector-session-strip')).toContainText(
    'Patient editor'
  )
  const headerTops = await editor.page
    .getByTestId('browser-inspector-session')
    .evaluateAll((headers) =>
      headers.map((header) => Math.round(header.getBoundingClientRect().top))
    )
  expect(new Set(headerTops).size).toBe(1)
  await expect(editor.page.getByTestId('browser-inspector-selection-panel')).toHaveScreenshot(
    'chrome-selection-context.png'
  )
  editor.canvas.assertNoErrors()
})
