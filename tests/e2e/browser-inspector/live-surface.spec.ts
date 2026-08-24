import type { BrowserLiveSurfaceInputCommand } from '@/app/external-live-surface/contracts'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

type LiveSurfaceCommand =
  | BrowserLiveSurfaceInputCommand
  | {
      command: { kind: 'start-live-surface-capture'; sessionId: string }
      contract: 'openpencil-browser-element-command/v1'
      requestId: string
    }

type LiveSurfaceTestWindow = Window & {
  __liveSurfaceCommands?: LiveSurfaceCommand[]
}

const editor = useEditorSetupWithClear('/?test&html-source')

async function enterBoard() {
  const start = editor.page.getByTestId('native-board-start')
  if (await start.isVisible()) await start.click()
}

test('drops a Chrome selection as an interactive persisted live surface', async () => {
  await enterBoard()
  await editor.page.evaluate(() => {
    ;(window as LiveSurfaceTestWindow).__liveSurfaceCommands = []
    const commandObserver = new MutationObserver(() => {
      const payload = document.documentElement.getAttribute(
        'data-openpencil-browser-element-command'
      )
      if (!payload) return
      document.documentElement.removeAttribute('data-openpencil-browser-element-command')
      const command = JSON.parse(payload) as LiveSurfaceCommand
      if (command.contract === 'openpencil-browser-element-command/v1') {
        ;(window as LiveSurfaceTestWindow).__liveSurfaceCommands?.push(command)
        if (command.command.kind === 'start-live-surface-capture') {
          window.postMessage(
            {
              contract: 'openpencil-browser-element-command-result/v1',
              ok: true,
              requestId: command.requestId
            },
            window.location.origin
          )
        }
      }
    })
    commandObserver.observe(document.documentElement, {
      attributeFilter: ['data-openpencil-browser-element-command'],
      attributes: true
    })
    const preview = document.createElement('canvas')
    preview.width = 560
    preview.height = 80
    const context = preview.getContext('2d')
    if (!context) throw new Error('Preview canvas unavailable')
    context.fillStyle = '#f5f6f8'
    context.fillRect(0, 0, preview.width, preview.height)
    context.fillStyle = '#6d5efc'
    context.fillRect(0, 0, 36, preview.height)
    context.fillStyle = '#20242c'
    context.font = '600 28px sans-serif'
    context.fillText('Patient search', 58, 50)
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
          id: 'live-surface-selection',
          page: {
            origin: 'https://example.com',
            title: 'Patients',
            url: 'https://example.com/patients'
          },
          session: {
            captureSessionId: 'live-surface-session',
            captureStartedAt: '2026-08-22T12:00:00.000Z',
            frameId: 0,
            sequence: 1,
            tabId: 12
          },
          snapshot: { dataUrl: preview.toDataURL('image/png'), height: 360, width: 640 },
          sourceWindow: {
            devicePixelRatio: 2,
            innerHeight: 800,
            innerWidth: 1200,
            outerHeight: 900,
            outerWidth: 1200,
            screenX: 40,
            screenY: 20
          },
          surfacePreview: {
            dataUrl: preview.toDataURL('image/png'),
            height: preview.height,
            width: preview.width
          }
        }
      },
      window.location.origin
    )
  })

  const session = editor.page.getByTestId('browser-inspector-session')
  await expect(session).toHaveCount(1)
  await session.getByRole('button', { name: /Patients.*1 item/ }).click()
  const selection = editor.page.getByTestId('browser-inspector-selection')
  const canvas = editor.page.getByTestId('canvas-area')
  const dataTransfer = await editor.page.evaluateHandle(() => new DataTransfer())
  await selection.dispatchEvent('dragstart', { dataTransfer })
  expect(
    await dataTransfer.evaluate((transfer) => ({
      payload: transfer.getData('application/x-openpencil-browser-capture'),
      types: [...transfer.types]
    }))
  ).toMatchObject({
    types: ['application/x-openpencil-browser-capture']
  })
  for (const type of ['dragenter', 'dragover', 'drop']) {
    await canvas.dispatchEvent(type, { clientX: 680, clientY: 300, dataTransfer })
  }

  await expect
    .poll(() =>
      editor.page.evaluate(() => {
        const store = window.openPencil?.getStore?.()
        return store?.graph
          .getChildren(store.state.currentPageId)
          .some((node) =>
            node.pluginData.some(
              (entry) =>
                entry.pluginId === 'openpencil-code-object' &&
                entry.key === 'document' &&
                entry.value.includes('external-live-surface')
            )
          )
      })
    )
    .toBe(true)

  expect(
    await editor.page.evaluate(async () => {
      const store = window.openPencil?.getStore?.()
      const frameId = store ? [...store.state.selectedIds][0] : null
      const frame = frameId ? store?.graph.getNode(frameId) : null
      const { codeObjectDocument } = await import('/src/app/code-object/model.ts')
      return codeObjectDocument(frame)
    })
  ).toMatchObject({ component: 'external-live-surface' })
  await expect(editor.page.locator('[data-code-object-id]')).toHaveCount(1)

  const surface = editor.page.getByTestId('external-live-surface')
  await expect(surface).toHaveCount(1)
  await expect(surface).toHaveAttribute('data-external-live-surface-status', 'preview')
  const readCaptureSessionId = () =>
    editor.page.evaluate(() => {
      const command = (window as LiveSurfaceTestWindow).__liveSurfaceCommands?.find(
        (candidate) => candidate.command.kind === 'start-live-surface-capture'
      )
      return command?.command.kind === 'start-live-surface-capture'
        ? command.command.sessionId
        : null
    })
  await expect.poll(readCaptureSessionId).not.toBeNull()
  const captureSessionId = await readCaptureSessionId()
  if (!captureSessionId) throw new Error('Live surface capture session was not started')
  const liveFrame = await editor.page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 560
    canvas.height = 80
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Live frame canvas unavailable')
    context.fillStyle = '#111827'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#78eca5'
    context.font = '700 28px sans-serif'
    context.fillText('Live Chrome pixels', 28, 50)
    return canvas.toDataURL('image/jpeg')
  })
  await editor.page.evaluate(
    ({ dataUrl, sessionId }) => {
      window.postMessage(
        {
          contract: 'openpencil-browser-element/v1',
          dataUrl,
          kind: 'live-surface-frame',
          sequence: 1,
          sessionId
        },
        window.location.origin
      )
    },
    { dataUrl: liveFrame, sessionId: captureSessionId }
  )
  await expect(surface).toHaveAttribute('data-external-live-surface-status', 'live')
  await expect(surface.locator('img')).toHaveAttribute('src', liveFrame)
  const persisted = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    const frameId = store ? [...store.state.selectedIds][0] : null
    const frame = frameId ? store?.graph.getNode(frameId) : null
    if (!frame) return null
    const documentEntry = frame.pluginData.find(
      (entry) => entry.pluginId === 'openpencil-code-object' && entry.key === 'document'
    )
    return {
      document: documentEntry ? JSON.parse(documentEntry.value) : null,
      height: frame.height,
      width: frame.width
    }
  })
  expect(persisted).toMatchObject({
    document: {
      captureSource: { selectionId: 'live-surface-selection', tabId: 12 },
      component: 'external-live-surface',
      preview: { height: 80, width: 560 }
    },
    height: 40,
    width: 280
  })

  await editor.page.getByTestId('code-object-design-hit-target').click()
  await expect(editor.page.locator('[data-code-object-mode="interact"]')).toHaveCount(1)
  await surface.click({ position: { x: 140, y: 20 } })
  await expect
    .poll(() =>
      editor.page.evaluate(
        () =>
          (window as LiveSurfaceTestWindow).__liveSurfaceCommands?.filter(
            (candidate) => candidate.command.kind === 'relay-live-surface-input'
          ).length ?? 0
      )
    )
    .toBeGreaterThan(0)
  const lastCommand = await editor.page.evaluate(() =>
    (window as LiveSurfaceTestWindow).__liveSurfaceCommands?.findLast(
      (candidate) => candidate.command.kind === 'relay-live-surface-input'
    )
  )
  expect(lastCommand).toMatchObject({
    command: {
      input: { kind: 'pointer', phase: 'up', xRatio: 0.5, yRatio: 0.5 },
      kind: 'relay-live-surface-input',
      source: { selectionId: 'live-surface-selection' }
    }
  })
})
