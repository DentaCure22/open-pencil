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
    const snapshotDataUrl = preview.toDataURL('image/png')
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
          snapshot: { dataUrl: snapshotDataUrl, height: 360, width: 640 }
        }
      },
      window.location.origin
    )
    window.postMessage(
      {
        contract: 'openpencil-browser-element/v1',
        kind: 'selection',
        selection: {
          capturedAt: '2026-08-22T12:00:05.000Z',
          element: {
            accessibleName: 'Patient filters',
            attributes: { 'aria-label': 'Patient filters' },
            bounds: { height: 40, width: 120, x: 510, y: 80 },
            classes: ['patient-filters'],
            role: 'button',
            selector: '[aria-label="Patient filters"]',
            tag: 'button',
            text: 'Filters'
          },
          id: 'e2e-browser-element-filter',
          page: {
            origin: 'https://example.com',
            title: 'Patients',
            url: 'https://example.com/patients'
          },
          session: {
            captureSessionId: 'e2e-browser-session',
            captureStartedAt: '2026-08-22T12:00:00.000Z',
            frameId: 0,
            sequence: 2,
            tabId: 12
          },
          snapshot: { dataUrl: snapshotDataUrl, height: 360, width: 640 }
        }
      },
      window.location.origin
    )
  })

  await expect(editor.page.getByTestId('left-panel-layers-tab')).toHaveAttribute(
    'data-state',
    'active'
  )
  await expect(editor.page.getByTestId('browser-inspector-session-strip')).toContainText('Patients')
  await editor.page.emulateMedia({ colorScheme: 'light' })
  const sessionHeader = editor.page.getByTestId('browser-inspector-session')
  await expect(sessionHeader).toContainText('2')
  await expect(editor.page.getByTestId('browser-inspector-session-children')).toHaveCount(0)
  const sessionRowToggle = editor.page.getByTestId('browser-inspector-session-row-toggle')
  await expect(sessionRowToggle).toHaveCSS('opacity', '0')
  await expect(sessionHeader).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.98)')
  await expect(editor.page.getByTestId('browser-inspector-selection-panel')).toHaveCSS(
    'border-bottom-width',
    '0px'
  )
  const removeSession = sessionHeader.getByRole('button', {
    name: /Remove Patients.*from sidebar/
  })
  await expect(removeSession).toHaveCSS('opacity', '0')
  await sessionHeader.hover()
  await expect(sessionRowToggle).toHaveCSS('opacity', '1')
  await expect(removeSession).toHaveCSS('opacity', '1')
  await expect(sessionHeader).toHaveScreenshot('chrome-session-header-hover.png', {
    maxDiffPixelRatio: 0,
    threshold: 0
  })
  await expect(editor.page.getByTestId('browser-inspector-selection-panel')).toHaveScreenshot(
    'chrome-session-row-hover.png',
    { maxDiffPixelRatio: 0, threshold: 0 }
  )

  await sessionRowToggle.click()
  await expect(editor.page.getByTestId('browser-inspector-session-strip')).toBeHidden()
  await expect(sessionRowToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(sessionRowToggle).toHaveAttribute('aria-label', 'Expand Chrome capture session row')
  await sessionRowToggle.click()
  await expect(editor.page.getByTestId('browser-inspector-session-strip')).toBeVisible()

  await editor.page
    .getByTestId('browser-inspector-session')
    .getByRole('button', { name: /Patients.*2 items/ })
    .click()
  const sessionChildren = editor.page.getByTestId('browser-inspector-session-children')
  await expect(sessionChildren).toBeVisible()
  const childInsets = await sessionChildren.evaluate((popover) => {
    const rows = Array.from(
      popover.querySelectorAll<HTMLElement>('[data-test-id="browser-inspector-selection"]')
    )
    const first = rows.at(0)?.getBoundingClientRect()
    const last = rows.at(-1)?.getBoundingClientRect()
    const firstContent = rows.at(0)?.querySelector('span')?.getBoundingClientRect()
    const bounds = popover.getBoundingClientRect()
    if (!first || !last || !firstContent) {
      throw new Error('Expected browser inspector selection rows and content')
    }
    const rowStyles = rows.map((row) => getComputedStyle(row))
    return {
      bottom: bounds.bottom - last.bottom,
      contentInsetLeft: firstContent.left - first.left,
      contentInsetTop: firstContent.top - first.top,
      left: first.left - bounds.left,
      radii: rowStyles.map((style) => style.borderRadius),
      right: bounds.right - first.right,
      separators: rowStyles.map((style) => [style.borderTopWidth, style.borderBottomWidth]),
      top: first.top - bounds.top
    }
  })
  expect(Math.abs(childInsets.top - childInsets.left)).toBeLessThanOrEqual(1)
  expect(Math.abs(childInsets.bottom - childInsets.right)).toBeLessThanOrEqual(1)
  expect(childInsets.top).toBeGreaterThanOrEqual(3)
  expect(childInsets.left).toBeGreaterThanOrEqual(3)
  expect(childInsets.top).toBeLessThanOrEqual(5)
  expect(childInsets.left).toBeLessThanOrEqual(5)
  expect(Math.abs(childInsets.contentInsetTop - childInsets.contentInsetLeft)).toBeLessThanOrEqual(
    1
  )
  expect(childInsets.separators).toEqual([
    ['0px', '0px'],
    ['0px', '0px']
  ])
  expect(childInsets.radii).toEqual(['7px', '7px'])
  await expect(sessionChildren).toHaveScreenshot('chrome-session-dropdown.png', {
    maxDiffPixelRatio: 0,
    threshold: 0
  })

  const capturedSelection = editor.page.getByTestId('browser-inspector-selection').first()
  await expect(capturedSelection).toContainText('Patient search')
  await expect(
    capturedSelection.getByRole('button', { name: 'Annotate Patient search' })
  ).toHaveCount(0)
  const removeSelection = capturedSelection.getByRole('button', {
    name: 'Remove Patient search from session'
  })
  await expect(removeSelection).toHaveCSS('opacity', '0')
  await capturedSelection.hover()
  await expect(removeSelection).toHaveCSS('opacity', '1')
  await expect(sessionChildren).toHaveScreenshot('chrome-session-dropdown-hover.png', {
    maxDiffPixelRatio: 0,
    threshold: 0
  })
  await capturedSelection.click()
  const annotationReview = editor.page.getByTestId('browser-inspector-annotation-review')
  await expect(annotationReview).toBeVisible()
  const annotationSurfaces = await annotationReview.evaluate((review) => {
    const header = review.querySelector<HTMLElement>(
      '[data-test-id="browser-inspector-annotation-header"]'
    )
    const stage = review.querySelector<HTMLElement>(
      '[data-test-id="browser-inspector-annotation-stage"]'
    )
    if (!header || !stage) throw new Error('Expected annotation review surfaces')
    const headerStyle = getComputedStyle(header)
    return {
      header: headerStyle.backgroundColor,
      headerBorder: headerStyle.borderBottomWidth,
      stage: getComputedStyle(stage).backgroundColor
    }
  })
  expect(annotationSurfaces.header).toBe(annotationSurfaces.stage)
  expect(annotationSurfaces.headerBorder).toBe('0px')
  const annotationClose = annotationReview.getByTestId('browser-inspector-annotation-close')
  await expect(annotationReview).toContainText('Patient search')
  await expect(annotationReview).not.toContainText('Click the screenshot to pin a comment')
  await expect(annotationClose).toHaveCSS('opacity', '0')
  await annotationReview.getByTestId('browser-inspector-annotation-header').hover()
  await expect(annotationClose).toHaveCSS('opacity', '1')
  await expect(annotationReview).toHaveScreenshot('chrome-annotation-header-hover.png')
  const annotationInput = annotationReview.getByRole('textbox', {
    name: 'Screenshot comment'
  })
  await annotationInput.hover()
  await expect(annotationInput).toBeFocused()
  await expect(annotationClose).toHaveCSS('opacity', '0')
  await expect(annotationReview.getByTestId('browser-inspector-annotation-marker')).toHaveCount(1)
  await annotationInput.fill('Keep this search field visible')
  await expect(annotationReview).toHaveScreenshot('chrome-annotation-editor.png')
  await annotationInput.press('Enter')
  await expect(annotationReview.getByTestId('browser-inspector-annotation-editor')).toHaveCount(0)
  await annotationReview.getByRole('button', { name: 'Open screenshot comment 1' }).click()
  await expect(annotationReview.getByRole('textbox', { name: 'Screenshot comment' })).toHaveValue(
    'Keep this search field visible'
  )
  await annotationReview
    .getByRole('textbox', { name: 'Screenshot comment' })
    .fill('Keep this search field visible while scrolling')
  await annotationReview.getByRole('textbox', { name: 'Screenshot comment' }).press('Enter')
  await annotationReview.getByTestId('browser-inspector-annotation-header').hover()
  await annotationClose.click()
  await editor.page.emulateMedia({ colorScheme: 'dark' })

  await editor.page
    .getByTestId('browser-inspector-session')
    .getByRole('button', { name: /Patients.*2 items/ })
    .click()
  await expect(editor.page.getByTestId('browser-inspector-selection').first()).toBeVisible()

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

test('shows extension failures as a faded notice above the bottom toolbar', async () => {
  await enterBoard()
  await editor.page.evaluate(() => {
    window.addEventListener('message', (event) => {
      if (
        event.source !== window ||
        event.data?.contract !== 'openpencil-browser-element-command/v1' ||
        event.data?.command?.kind !== 'activate-picker'
      ) {
        return
      }
      window.postMessage(
        {
          contract: 'openpencil-browser-element-command-result/v1',
          ok: false,
          reason: 'extension-unavailable',
          requestId: event.data.requestId
        },
        window.location.origin
      )
    })
  })

  await editor.page.getByTestId('browser-inspector-select').click()

  const notice = editor.page.getByTestId('browser-inspector-error')
  const toolbar = editor.page.getByRole('toolbar', { name: 'Editor tools' })
  await expect(notice).toHaveText('Reload the OpenPencil Chrome extension.')
  await expect(editor.page.getByTestId('browser-inspector-selection-panel')).toHaveCount(0)
  expect(
    await notice.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backdropFilter: style.backdropFilter,
        transitionDuration: style.transitionDuration,
        transitionProperty: style.transitionProperty,
        willChange: style.willChange
      }
    })
  ).toEqual({
    backdropFilter: 'none',
    transitionDuration: '0.22s',
    transitionProperty: 'opacity',
    willChange: 'opacity'
  })

  const [noticeBounds, toolbarBounds] = await Promise.all([
    notice.boundingBox(),
    toolbar.boundingBox()
  ])
  if (!noticeBounds || !toolbarBounds) throw new Error('Expected toolbar error notice bounds')
  expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(toolbarBounds.y - 7)
  expect(noticeBounds.x + noticeBounds.width / 2).toBeCloseTo(
    toolbarBounds.x + toolbarBounds.width / 2,
    1
  )
  await expect(notice).toBeHidden({ timeout: 5_000 })
})

test('expands a capture session to the chat budget and bakes screenshot notes', async () => {
  await enterBoard()
  const result: {
    contextPrompt?: string
    evidence: Array<{ height: number; name: string }>
    summary: { annotationCount: number } | null
  } = await editor.page.evaluate(async () => {
    const attachmentPath = '/src/app/browser-inspector/attachment.ts'
    const attachmentModule = await import(attachmentPath)
    const preview = document.createElement('canvas')
    preview.width = 640
    preview.height = 360
    const context = preview.getContext('2d')
    if (!context) throw new Error('Preview canvas unavailable')
    context.fillStyle = '#f5f6f8'
    context.fillRect(0, 0, 640, 360)
    context.fillStyle = '#20242c'
    context.fillRect(0, 0, 640, 46)
    const dataUrl = preview.toDataURL('image/png')
    const page = {
      origin: 'https://example.com',
      title: 'Patients',
      url: 'https://example.com/patients'
    }
    const selections = Array.from({ length: 4 }, (_, index) => ({
      ...(index === 3
        ? {
            annotations: [
              {
                comment: 'Keep this later capture visible',
                id: 'attachment-note',
                x: 0.72,
                y: 0.28
              }
            ]
          }
        : {}),
      capturedAt: `2026-08-22T12:00:0${String(index + 1)}.000Z`,
      element: {
        accessibleName: `Patient control ${String(index + 1)}`,
        attributes: {},
        bounds: { height: 40, width: 120, x: 500, y: 80 },
        classes: ['patient-control'],
        role: 'button',
        selector: `[data-patient-control="${String(index + 1)}"]`,
        tag: 'button',
        text: `Control ${String(index + 1)}`
      },
      id: `attachment-selection-${String(index + 1)}`,
      page,
      session: {
        captureSessionId: 'attachment-session',
        captureStartedAt: '2026-08-22T12:00:00.000Z',
        frameId: 0,
        sequence: index + 1,
        tabId: 12
      },
      snapshot: { dataUrl, height: 360, width: 640 }
    }))
    const attachment = attachmentModule.createBrowserCaptureAttachment({
      id: 'attachment-session',
      page,
      recordings: [],
      selections,
      startedAt: '2026-08-22T12:00:00.000Z',
      title: 'Patients · 12:00 PM'
    })
    if (!attachment) throw new Error('Expected a session attachment')
    const summary = attachmentModule.browserCaptureAttachmentSummary(attachment)
    const resolved = await attachmentModule.resolveBrowserCaptureAttachments([attachment])
    const evidence = await Promise.all(
      resolved.attachments.map(
        (file: File) =>
          new Promise<{ height: number; name: string }>((resolve, reject) => {
            const url = URL.createObjectURL(file)
            const image = new Image()
            image.addEventListener(
              'load',
              () => {
                resolve({ height: image.naturalHeight, name: file.name })
                URL.revokeObjectURL(url)
              },
              { once: true }
            )
            image.addEventListener(
              'error',
              () => {
                URL.revokeObjectURL(url)
                reject(new Error(`Evidence image ${file.name} failed to load`))
              },
              { once: true }
            )
            image.src = url
          })
      )
    )
    return { contextPrompt: resolved.contextPrompt, evidence, summary }
  })

  expect(result.summary?.annotationCount).toBe(1)
  expect(result.evidence).toHaveLength(4)
  expect(result.evidence.map((item) => item.name)).toContain(
    'chrome-selection-attachment-selection-4-annotated.png'
  )
  expect(result.evidence.find((item) => item.name.includes('-annotated.'))?.height).toBeGreaterThan(
    360
  )
  expect(result.contextPrompt).toContain('Keep this later capture visible')
})
