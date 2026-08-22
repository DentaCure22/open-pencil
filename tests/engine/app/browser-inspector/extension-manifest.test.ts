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

describe('OpenPencil Chrome extension manifest', () => {
  test('has the page access required for rail-initiated screenshot capture', async () => {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      host_permissions: string[]
      manifest_version: number
      optional_host_permissions?: string[]
      permissions: string[]
    }
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(['offscreen', 'scripting', 'storage', 'tabCapture'])
    expect(manifest.host_permissions).toEqual(['<all_urls>'])
    expect(manifest.optional_host_permissions).toBeUndefined()
  })

  test('makes active element-picking visually obvious', async () => {
    const picker = await readFile(pickerPath, 'utf8')
    expect(picker).toContain('data-role="status"')
    expect(picker).toContain('data-role="cursor"')
    expect(picker).toContain('openpencil-picker-pulse')
    expect(picker).toContain('transform 80ms cubic-bezier')
    expect(picker).toContain('Click to add')
    expect(picker).toContain('data-action="finish"')
    expect(picker).toContain('data-role="committed"')
    expect(picker).toContain("canvas.toDataURL('image/png')")
    expect(picker).toContain('captureSessionId')
    expect(picker).toContain('captureStartedAt')
    expect(picker).toContain('prefers-reduced-motion: reduce')
    expect(picker).not.toContain('browser-surface-command')
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
    expect(serviceWorker).toContain("reasons: ['USER_MEDIA']")
    expect(offscreen).toContain('new MediaRecorder')
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
      "'activate-browser-element-picker': () => armPickerFromOpenPencil()"
    )
    expect(serviceWorker).toContain(
      "'reserve-browser-element-sequence': (message) => reserveCaptureSequence(message)"
    )
    expect(serviceWorker).toContain("files: ['openpencil-bridge.js']")
  })
})
