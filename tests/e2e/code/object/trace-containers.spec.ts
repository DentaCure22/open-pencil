import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&smylr-app=&smylr-page=dental-chart')

test('keeps both Trace and Containers usable over a non-selection editor tool', async () => {
  const surface = editor.page.locator('[data-code-object-id]').first()
  await expect(surface).toBeVisible()
  const frameId = await surface.getAttribute('data-code-object-id')
  if (!frameId) throw new Error('Smylr Code Object id unavailable')

  const smylr = editor.page.frameLocator('[data-test-id="smylr-trusted-web-app-frame"]')
  const pageContent = smylr.locator('[data-smylr-container-id="page-content"]')
  await expect(pageContent).toBeVisible({ timeout: 20_000 })
  const initialNodeCount = await editor.page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store unavailable')
    store.state.loading = false
    store.select([id])
    store.setTool('RECTANGLE')
    Object.defineProperties(window, {
      SpeechRecognition: { configurable: true, value: undefined },
      webkitSpeechRecognition: { configurable: true, value: undefined }
    })
    return store.graph.nodes.size
  }, frameId)

  const focusTool = editor.page.getByTestId('narrated-trace-focus-tool')
  const containersTool = editor.page.getByTestId('smylr-containers-tool')
  await expect(containersTool).toHaveAttribute('aria-label', /Select containers \(.+C\)/)
  await expect(containersTool).toHaveAttribute('aria-pressed', 'false')
  await editor.page.keyboard.press('Meta+c')
  await focusTool.click()

  await expect(containersTool).toHaveAttribute('aria-pressed', 'true')
  await expect(focusTool).toHaveAttribute('aria-pressed', 'true')
  await expect(editor.page.getByTestId('smylr-live-select-surface')).toBeVisible()
  await expect(editor.page.getByTestId('narrated-trace-annotation-overlay')).toHaveCSS(
    'pointer-events',
    'none'
  )

  const readLiveState = () =>
    editor.page.evaluate(async () => {
      const {
        liveInspectorDocument,
        liveInspectorInteractionMode,
        liveInspectorSelectedId,
        liveInspectorStatus
      } = await import('/src/app/smylr-live-inspector/session.ts')
      return {
        mode: liveInspectorInteractionMode.value,
        rootId: liveInspectorDocument.value?.tree.id ?? null,
        selectedId: liveInspectorSelectedId.value,
        status: liveInspectorStatus.value
      }
    })
  await expect.poll(readLiveState).toMatchObject({
    mode: 'select',
    rootId: expect.any(String),
    selectedId: expect.any(String),
    status: 'connected'
  })
  const initialLiveSelectionId = (await readLiveState()).selectedId
  await expect(editor.page.getByTestId('smylr-live-container-overlay')).toBeVisible()
  const commentComposer = editor.page.getByTestId('context-comment-composer')
  await expect(commentComposer).toBeVisible()
  const layersFilter = editor.page.getByTestId('layers-filter')
  await layersFilter.fill('Application Shell')
  await expect(
    editor.page.getByTestId('layers-item').filter({ hasText: 'Application Shell' }).first()
  ).toBeVisible()
  await layersFilter.fill('')

  const iframe = surface.getByTestId('smylr-trusted-web-app-frame')
  const iframeBounds = await iframe.boundingBox()
  const iframeSize = await iframe.evaluate((element) => ({
    height: element.clientHeight,
    width: element.clientWidth
  }))
  const nestedTargetBounds = await smylr
    .getByRole('heading', { name: 'No Patient Selected' })
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return { height: bounds.height, width: bounds.width, x: bounds.x, y: bounds.y }
    })
  if (!iframeBounds || iframeSize.width === 0 || iframeSize.height === 0) {
    throw new Error('Smylr iframe bounds unavailable')
  }
  await editor.page.mouse.click(
    iframeBounds.x +
      (nestedTargetBounds.x + nestedTargetBounds.width / 2) *
        (iframeBounds.width / iframeSize.width),
    iframeBounds.y +
      (nestedTargetBounds.y + nestedTargetBounds.height / 2) *
        (iframeBounds.height / iframeSize.height)
  )

  await expect
    .poll(async () => {
      const selectedId = await editor.page.evaluate(async () => {
        const { liveInspectorSelectedId } = await import('/src/app/smylr-live-inspector/session.ts')
        return liveInspectorSelectedId.value
      })
      return Boolean(selectedId && selectedId !== initialLiveSelectionId)
    })
    .toBe(true)
  await expect(commentComposer).toHaveAttribute('aria-label', /Comment on /)
  const commentBounds = await commentComposer.boundingBox()
  const placedIframeBounds = await iframe.boundingBox()
  if (!commentBounds) throw new Error('Context comment bounds unavailable')
  if (!placedIframeBounds) throw new Error('Placed Smylr iframe bounds unavailable')
  expect(commentBounds.width).toBeLessThanOrEqual(604)
  expect(commentBounds.height).toBeLessThanOrEqual(58)
  const iframeBottom = placedIframeBounds.y + placedIframeBounds.height
  const belowIframe = Math.abs(commentBounds.y - (iframeBottom + 10))
  const centeredCommentX =
    placedIframeBounds.x + (placedIframeBounds.width - commentBounds.width) / 2
  const viewportHeight = await editor.page.evaluate(() => window.innerHeight)
  expect(Math.abs(commentBounds.x - centeredCommentX)).toBeLessThanOrEqual(4)
  expect(belowIframe).toBeLessThanOrEqual(4)
  expect(commentBounds.y).toBeGreaterThanOrEqual(iframeBottom + 6)
  expect(commentBounds.y + commentBounds.height).toBeLessThanOrEqual(viewportHeight - 8)
  await expect
    .poll(() => editor.page.evaluate(() => window.openPencil?.getStore?.().graph.nodes.size))
    .toBe(initialNodeCount)

  const tracePacket = await editor.page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store unavailable')
    const {
      liveInspectorActiveFrameId,
      liveInspectorDocument,
      liveInspectorSelectedId,
      liveInspectorSelectedRect
    } = await import('/src/app/smylr-live-inspector/session.ts')
    const { narratedTraceSession } = await import('/src/app/narrated-trace/state.ts')
    const frameId = liveInspectorActiveFrameId.value
    const selectedId = liveInspectorSelectedId.value
    const selectedRect = liveInspectorSelectedRect.value
    const session = narratedTraceSession.value
    if (!frameId || !selectedId || !selectedRect || !session) {
      throw new Error('Live Trace selection proof unavailable')
    }
    const frameBounds = store.graph.getAbsoluteBounds(frameId)
    const matches = session.events.filter(
      (event) =>
        event.kind === 'selection' &&
        event.target?.frameId === frameId &&
        event.target.stableId === selectedId
    )
    const target = matches[0]?.target
    return {
      expectedBounds: {
        height: selectedRect.height,
        width: selectedRect.width,
        x: frameBounds.x + selectedRect.x,
        y: frameBounds.y + selectedRect.y
      },
      expectedRoute: liveInspectorDocument.value?.route,
      matchCount: matches.length,
      session: structuredClone(session),
      target
    }
  })
  expect(tracePacket.matchCount).toBe(1)
  expect(tracePacket.target).toMatchObject({
    bounds: tracePacket.expectedBounds,
    frameId,
    route: tracePacket.expectedRoute
  })
  expect(tracePacket.target?.path.length).toBeGreaterThan(1)

  const authorityRoot = await mkdtemp(path.join(tmpdir(), 'openpencil-trace-containers-'))
  const authority = new LocalWorkspaceAuthorityStore({
    root: authorityRoot,
    semanticServices: false
  })
  try {
    await authority.initialize({
      document: { test: 'trace-containers' },
      requestId: 'trace-containers-test',
      sourceWorkspaceId: 'workspace-trace-containers-test'
    })
    await authority.recordTraceSession({
      gestures: [],
      session: tracePacket.session,
      summary: {
        id: tracePacket.session.id,
        startedAt: tracePacket.session.startedAt,
        title: 'Trace Containers test',
        updatedAt: new Date().toISOString()
      }
    })
    const persisted = await authority.traceSession(tracePacket.session.id)
    expect(persisted).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({
          kind: 'selection',
          target: tracePacket.target
        })
      ]),
      id: tracePacket.session.id
    })
  } finally {
    authority.close()
    await rm(authorityRoot, { force: true, recursive: true })
  }

  await editor.page.keyboard.press('Escape')
  await expect(commentComposer).toBeHidden()
  await expect.poll(readLiveState).toMatchObject({ mode: 'frame' })
})
