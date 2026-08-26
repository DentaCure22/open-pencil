import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const manifestPath = new URL(
  '../../../../extensions/openpencil-chrome/manifest.json',
  import.meta.url
)
const pickerPath = new URL('../../../../extensions/openpencil-chrome/picker.js', import.meta.url)
const serviceWorkerPath = new URL(
  '../../../../extensions/openpencil-chrome/service-worker.js',
  import.meta.url
)
const offscreenPath = new URL(
  '../../../../extensions/openpencil-chrome/offscreen.js',
  import.meta.url
)
const externalSurfaceRelayPath = new URL(
  '../../../../extensions/openpencil-chrome/external-surface-relay.js',
  import.meta.url
)
const externalSurfaceServicePath = new URL(
  '../../../../extensions/openpencil-chrome/external-surface-service.js',
  import.meta.url
)
const annotationIconPaths = [
  'message-circle-filled',
  'mic',
  'mic-off',
  'trash-2',
  'video'
].map((name) =>
  new URL(`../../../../extensions/openpencil-chrome/icons/${name}.svg`, import.meta.url)
)

describe('OpenPencil Chrome extension manifest', () => {
  test('has the page access required for rail-initiated screenshot capture', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      host_permissions: string[]
      manifest_version: number
      optional_host_permissions?: string[]
      permissions: string[]
      web_accessible_resources?: Array<{ matches: string[]; resources: string[] }>
    }
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['offscreen', 'scripting', 'storage', 'tabCapture'])
    expect(manifest.host_permissions).toEqual(['<all_urls>'])
    expect(manifest.optional_host_permissions).toBeUndefined()
    expect(manifest.web_accessible_resources).toBeUndefined()
  })

  test('makes active element-picking visually obvious', async () => {
    const picker = await readFile(pickerPath, 'utf8')
    const serviceWorker = await readFile(serviceWorkerPath, 'utf8')
    expect(picker).toContain('data-role="status"')
    expect(picker).toContain('data-role="cursor"')
    expect(picker).toContain('border: 2px dashed #7567ff')
    expect(picker).toContain('background: transparent')
    expect(picker).toContain('context.setLineDash')
    expect(picker).not.toContain('context.fillRect(boxX')
    expect(picker).not.toContain('openpencil-picker-pulse')
    expect(picker).toContain('transform 80ms cubic-bezier')
    expect(picker).toContain('Press Esc to exit')
    expect(picker).toContain('data-role="annotation-composer"')
    expect(picker).toContain('data-action="dictate"')
    expect(picker).toContain('data-action="record"')
    expect(picker).toContain('data-action="delete"')
    expect(picker).toContain('data-tooltip')
    expect(picker).toContain("setAttribute('data-tooltip', 'Delete selection')")
    expect(picker).toContain("setAttribute('data-tooltip', 'Dictate comment')")
    expect(picker).toContain("setAttribute('data-tooltip', 'Record motion')")
    expect(picker).toContain("setAnnotationIcon(dictateIcon, 'mic')")
    expect(picker).toContain("setAnnotationIcon(recordIcon, 'video')")
    expect(picker).toContain('transform: translateY(-8px)')
    expect(picker).toContain("document.createElement('img')")
    expect(picker).toContain("ICON_DATA_KEY = '__openpencilPickerIconData'")
    expect(picker).toContain("host.setAttribute('data-icons-ready', String(ready))")
    expect(picker).toContain("source.startsWith('data:image/svg+xml')")
    expect(picker).not.toContain("chrome.runtime.getURL(`icons/")
    expect(picker).not.toContain('mask: var(--annotation-icon)')
    expect(serviceWorker).toContain("fetch(chrome.runtime.getURL(`icons/")
    expect(serviceWorker).toContain('data:image/svg+xml;charset=utf-8')
    expect(picker).toContain("annotationInput.slot = 'annotation-input'")
    expect(picker).toContain('setAnnotationInputVisible(false)')
    expect(picker).toContain('globalThis.SpeechRecognition')
    expect(picker).not.toContain('data-action="save"')
    expect(picker).not.toContain('saveButton')
    expect(picker).toContain('data-recording-clean')
    expect(picker).not.toContain('Click to add')
    expect(picker).not.toContain('data-action="finish"')
    expect(picker).toContain('data-role="committed"')
    expect(picker).toContain("document.querySelectorAll('iframe, frame, embed, object')")
    expect(picker).toContain("data-role', 'embedded-shield'")
    expect(picker).toContain('.composedPath()')
    expect(picker).toContain("canvas.toDataURL('image/png')")
    expect(picker).toContain('captureSessionId')
    expect(picker).toContain('captureStartedAt')
    expect(picker).toContain('prefers-reduced-motion: reduce')
    expect(picker).not.toContain('browser-surface-command')
  })

  test('packages generated annotation artwork as real vector images', async () => {
    const icons = await Promise.all(annotationIconPaths.map((path) => readFile(path, 'utf8')))
    expect(icons.every((icon) => icon.includes('<svg'))).toBe(true)
    expect(icons.every((icon) => !icon.includes('<image'))).toBe(true)
    expect(icons.every((icon) => icon.includes('visioncortex VTracer'))).toBe(true)
    expect(icons[0]).toContain('#3B82F6')
    expect(icons[0]).not.toContain('#FFFFFF')
    expect(icons[4]).toContain('#FF4D5E')
  })

  test('records bounded motion through an offscreen tab capture', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      permissions: string[]
    }
    const offscreen = await readFile(offscreenPath, 'utf8')
    const serviceWorker = await readFile(serviceWorkerPath, 'utf8')
    expect(manifest.permissions).toContain('tabCapture')
    expect(manifest.permissions).toContain('offscreen')
    expect(serviceWorker).toContain('chrome.tabCapture.getMediaStreamId')
    expect(serviceWorker).toContain("kind: 'start-frame-recording'")
    expect(serviceWorker).toContain("'capture-motion-frame': (message) => captureMotionFrame(message)")
    expect(serviceWorker).toContain("format: 'jpeg'")
    expect(serviceWorker).toContain("reasons: ['USER_MEDIA']")
    expect(offscreen).toContain('new MediaRecorder')
    expect(offscreen).toContain('canvas.captureStream(2)')
    expect(offscreen).toContain('FRAME_RECORDING_INTERVAL_MS = 600')
    expect(offscreen).toContain('requestSampledFrame(recording.captureSessionId)')
    expect(offscreen).toContain('MAX_RECORDING_DURATION_MS = 30_000')
    expect(offscreen).toContain('MAX_RECORDING_BYTES = 11_500_000')
    expect(serviceWorker).toContain("kind: 'recording',\n    recording: {")
  })

  test('keeps one active capture session across explicitly visited web tabs', async () => {
    const serviceWorker = await readFile(serviceWorkerPath, 'utf8')
    expect(serviceWorker).toContain(
      "ACTIVE_CAPTURE_SESSION_KEY = 'openpencil-active-capture-session-v1'"
    )
    expect(serviceWorker).toContain('chrome.storage.session.set({ [ACTIVE_CAPTURE_SESSION_KEY]')
    expect(serviceWorker).toContain('chrome.storage.session.remove(ACTIVE_CAPTURE_SESSION_KEY)')
    expect(serviceWorker).not.toContain('LAST_SOURCE_KEY')
    expect(serviceWorker).not.toContain('chrome.storage.local')
    expect(serviceWorker).not.toContain('chrome.tabs.query({})')
    expect(serviceWorker).toContain('chrome.tabs.onActivated.addListener')
    expect(serviceWorker).toContain('chrome.tabs.onUpdated.addListener')
    expect(serviceWorker).toContain('chrome.tabs.onRemoved.addListener')
    expect(serviceWorker).toContain('browser-element-picker-sync-session')
    expect(serviceWorker).toContain('browser-element-picker-stop-session')
    expect(serviceWorker).not.toContain('chrome.tabs.update')
    expect(serviceWorker).toContain('return injectPicker(tabId, session)')
    expect(serviceWorker).toContain(
      "'activate-browser-element-picker': (_message, sender) => armPickerFromOpenPencil(sender)"
    )
    expect(serviceWorker).not.toContain('!page || isOpenPencilPage(tab.url)')
    expect(serviceWorker).not.toContain('isWebPage(tab.url) && !isOpenPencilPage(tab.url)')
    expect(serviceWorker).toContain('const result = await injectPicker(tabId, session)')
    expect(serviceWorker).toContain(
      "'reserve-browser-element-sequence': (message) => reserveCaptureSequence(message)"
    )
    expect(serviceWorker).toContain("files: ['openpencil-bridge.js']")
  })

  test('relays live-surface input without copying destination UI', async () => {
    const picker = await readFile(pickerPath, 'utf8')
    const offscreen = await readFile(offscreenPath, 'utf8')
    const serviceWorker = await readFile(serviceWorkerPath, 'utf8')
    const relay = await readFile(externalSurfaceRelayPath, 'utf8')
    const service = await readFile(externalSurfaceServicePath, 'utf8')
    expect(picker).toContain('surfacePreview')
    expect(picker).toContain('sourceWindow')
    expect(serviceWorker).toContain("'relay-browser-live-surface-input'")
    expect(serviceWorker).toContain('measureBrowserLiveSurface(source)')
    expect(service).toContain("files: ['external-surface-relay.js']")
    expect(service).toContain('browser-live-surface-measure')
    expect(relay).toContain('message?.kind !== MESSAGE_KIND')
    expect(relay).toContain('element.getBoundingClientRect()')
    expect(relay).toContain('new PointerEvent(pointerType')
    expect(relay).toContain("new WheelEvent('wheel'")
    expect(relay).toContain("new InputEvent('input'")
    expect(offscreen).toContain('new MediaStreamTrackProcessor')
    expect(offscreen).toContain('capture.imageCapture.grabFrame()')
    expect(offscreen).toContain('video.requestVideoFrameCallback')
    expect(offscreen).toContain('fallbackIntervalId = setInterval')
    expect(relay).not.toContain('data-attune-component-smuggle')
  })
})
