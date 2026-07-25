import type { Page } from '@playwright/test'

export type MockChatTransportOptions = {
  delayMs?: number
}

export type MockChatStats = {
  active: number
  maxActive: number
  submitted: string[]
  submittedFileCounts: number[]
}

declare global {
  interface Window {
    __openPencilMockChatStats?: MockChatStats
  }
}

export async function installMockChatTransport(page: Page, options: MockChatTransportOptions = {}) {
  await page.evaluate(({ delayMs }) => {
    const setChatTransport = window.openPencil?.setChatTransport
    if (!setChatTransport) throw new Error('Transport override not available')

    let messageCounter = 0
    const stats: MockChatStats = {
      active: 0,
      maxActive: 0,
      submitted: [] as string[],
      submittedFileCounts: [] as number[]
    }
    window.__openPencilMockChatStats = stats

    setChatTransport(() => ({
      async sendMessages({
        messages
      }: {
        messages: Array<{
          id?: string
          role: string
          parts: Array<{ mediaType?: string; text?: string; type: string; url?: string }>
        }>
      }) {
        const lastUser = [...messages].reverse().find((message) => message.role === 'user')
        const text = lastUser?.parts?.find((part) => part.type === 'text')?.text ?? ''
        const submittedFileCount =
          lastUser?.parts?.filter(
            (part) => part.type === 'file' && part.mediaType?.startsWith('image/')
          ).length ?? 0
        const messageId = `mock-msg-${++messageCounter}`
        const lowerText = text.toLowerCase()
        const wantsTool = lowerText.includes('frame') || lowerText.includes('rectangle')
        stats.active += 1
        stats.maxActive = Math.max(stats.maxActive, stats.active)
        stats.submitted.push(text)
        stats.submittedFileCounts.push(submittedFileCount)

        if (lowerText.includes('missing agent')) {
          stats.active -= 1
          throw new Error(
            '"claude-agent-acp" is not installed. Install it with: npm i -g @agentclientprotocol/claude-agent-acp'
          )
        }

        return new ReadableStream({
          start(controller) {
            const finish = () => {
              controller.enqueue({ type: 'start', messageId })

              if (wantsTool) {
                const toolCallId = `call-${messageId}`
                controller.enqueue({
                  type: 'tool-input-start',
                  toolCallId,
                  toolName: 'create_shape'
                })
                controller.enqueue({
                  type: 'tool-input-delta',
                  toolCallId,
                  inputTextDelta:
                    '{"type":"FRAME","x":100,"y":100,"width":200,"height":150,"name":"Card"}'
                })
                controller.enqueue({
                  type: 'tool-input-available',
                  toolCallId,
                  toolName: 'create_shape',
                  input: {
                    height: 150,
                    name: 'Card',
                    type: 'FRAME',
                    width: 200,
                    x: 100,
                    y: 100
                  }
                })
                controller.enqueue({
                  type: 'tool-output-available',
                  toolCallId,
                  toolName: 'create_shape',
                  output: {
                    height: 150,
                    id: '0:99',
                    name: 'Card',
                    type: 'FRAME',
                    width: 200,
                    x: 100,
                    y: 100
                  }
                })
              }

              const words = wantsTool
                ? ['Created', 'a', 'frame', 'called', '"Card".']
                : `I'll help you with: "${text}". Here's a mock response.`.split(' ')

              controller.enqueue({ type: 'text-start', id: 'text-1' })
              for (const word of words) {
                controller.enqueue({ type: 'text-delta', id: 'text-1', delta: `${word} ` })
              }
              controller.enqueue({ type: 'text-end', id: 'text-1' })
              controller.enqueue({ type: 'finish', finishReason: 'stop' })
              stats.active -= 1
              controller.close()
            }

            if (delayMs && delayMs > 0) window.setTimeout(finish, delayMs)
            else finish()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))
  }, options)
}
