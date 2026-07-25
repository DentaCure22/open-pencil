import { afterEach, describe, expect, test } from 'bun:test'

import {
  liveInspectorDocument,
  receiveLiveInspectorMessage,
  requestLiveInspectorPageFace,
  setLiveInspectorCommandTarget
} from '@/app/smylr-live-inspector/session'

const PAGE_FACE = {
  dataUrl: 'data:image/png;base64,trace-pixels',
  height: 640,
  mimeType: 'image/png' as const,
  width: 960
}

afterEach(() => {
  liveInspectorDocument.value = null
  setLiveInspectorCommandTarget(null)
})

describe('Smylr live inspector snapshots', () => {
  test('attaches a standalone fresh snapshot to the active inspector document', () => {
    liveInspectorDocument.value = {
      capturedAt: new Date(0).toISOString(),
      route: '/dental-chart',
      selectedId: '',
      title: 'Dental chart',
      tree: {
        id: 'root',
        label: 'Dental chart',
        rect: { height: 640, width: 960, x: 0, y: 0 }
      }
    }

    receiveLiveInspectorMessage({ action: 'snapshot', pageFace: PAGE_FACE })

    expect(liveInspectorDocument.value?.pageFace).toEqual(PAGE_FACE)
  })

  test('resolves a capture request with the next snapshot packet', async () => {
    const commands: unknown[] = []
    setLiveInspectorCommandTarget(
      {
        postMessage(command) {
          commands.push(command)
        }
      } as Window,
      'https://smylr.test'
    )

    const pageFace = requestLiveInspectorPageFace(100)
    receiveLiveInspectorMessage({ action: 'snapshot', pageFace: PAGE_FACE })

    expect(await pageFace).toEqual(PAGE_FACE)
    expect(commands).toEqual([
      {
        action: 'request-snapshot',
        kind: 'SMYLR_OPENPENCIL_INSPECTOR_V1'
      }
    ])
  })
})
