import { describe, expect, test } from 'bun:test'

import { createLiveInspectorCommandChannel } from '@/app/smylr-live-inspector/command-channel'
import { SMYLR_OPENPENCIL_INSPECTOR_MESSAGE } from '@/app/smylr-live-inspector/protocol'

describe('Smylr live-inspector command channel', () => {
  test('routes direct commands only to the active frame', () => {
    let activeFrameId: string | null = 'frame-a'
    const commands: unknown[] = []
    const channel = createLiveInspectorCommandChannel(() => activeFrameId)

    channel.setDirectTarget('frame-a', (command) => {
      commands.push(command)
      return true
    })

    expect(channel.post({ action: 'request-tree' })).toBe(true)
    activeFrameId = 'frame-b'
    expect(channel.post({ action: 'request-tree' })).toBe(false)
    expect(commands).toEqual([{ action: 'request-tree' }])
  })

  test('validates a registered window origin and adds the wire contract', () => {
    const messages: Array<{ data: unknown; origin: string }> = []
    const target = {
      postMessage(data: unknown, origin: string) {
        messages.push({ data, origin })
      }
    } as Window
    const channel = createLiveInspectorCommandChannel(() => null)

    channel.setWindowTarget(target, '*')
    expect(channel.post({ action: 'request-tree' })).toBe(false)

    channel.setWindowTarget(target, 'https://app.example.com')
    expect(channel.post({ action: 'request-tree' })).toBe(true)
    expect(messages).toEqual([
      {
        data: {
          action: 'request-tree',
          kind: SMYLR_OPENPENCIL_INSPECTOR_MESSAGE
        },
        origin: 'https://app.example.com'
      }
    ])
  })

  test('contains direct-dispatch failures at the channel seam', () => {
    const channel = createLiveInspectorCommandChannel(() => 'frame-a')
    channel.setDirectTarget('frame-a', () => {
      throw new Error('runtime disappeared')
    })

    expect(channel.post({ action: 'request-tree' })).toBe(false)
  })
})
