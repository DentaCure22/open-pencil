import { describe, expect, test } from 'bun:test'

import { messageToolPreview } from '@/app/agent-chat/approval'

describe('agent Messages approval', () => {
  test('reads the direct Pi Messages tool arguments', () => {
    expect(
      messageToolPreview({
        input: JSON.stringify({
          chat_guid: 'iMessage;-;test-recipient',
          recipient_label: 'Test Recipient',
          text: 'Be there in 10 minutes.'
        }),
        name: 'messages__send_send_message'
      })
    ).toEqual({ recipient: 'Test Recipient', texts: ['Be there in 10 minutes.'] })
  })

  test('reads Antigravity wrapped Messages tool arguments', () => {
    expect(
      messageToolPreview({
        input: JSON.stringify({
          Arguments: {
            chat_guid: 'any;-;test-recipient',
            recipient_label: 'Test Recipient',
            text: 'Be there in 10 minutes.'
          },
          ServerName: 'pi-antigravity-bridge',
          ToolName: 'messages__send_send_message'
        }),
        name: 'messages__send_send_message'
      })
    ).toEqual({ recipient: 'Test Recipient', texts: ['Be there in 10 minutes.'] })
  })

  test('keeps explicit multi-message boundaries and embedded line breaks', () => {
    expect(
      messageToolPreview({
        input: JSON.stringify({
          chat_guid: 'iMessage;-;test-recipient',
          recipient_label: 'Test Recipient',
          texts: ['First bubble', 'Second bubble\nwith two lines']
        }),
        name: 'messages__send_send_message'
      })
    ).toEqual({
      recipient: 'Test Recipient',
      texts: ['First bubble', 'Second bubble\nwith two lines']
    })
  })

  test('rejects ambiguous text and texts arguments', () => {
    expect(
      messageToolPreview({
        input: JSON.stringify({
          chat_guid: 'iMessage;-;test-recipient',
          recipient_label: 'Test Recipient',
          text: 'One bubble',
          texts: ['Another bubble']
        }),
        name: 'messages__send_send_message'
      })
    ).toBeNull()
  })
})
