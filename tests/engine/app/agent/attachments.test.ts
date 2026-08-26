import { describe, expect, test } from 'bun:test'

import {
  attachmentImagePaths,
  promptWithAttachments,
  type AgentPromptAttachment
} from '@/app/agent-chat/attachment-transfer'

const attachments: AgentPromptAttachment[] = [
  {
    name: 'walkthrough.mp4',
    path: '/tmp/agent-attachments/walkthrough.mp4',
    visual: {
      durationSeconds: 9.1,
      frameCount: 19,
      imagePaths: ['/tmp/agent-attachments/walkthrough-contact-sheet.jpg'],
      intervalSeconds: 0.48,
      kind: 'video-frames',
      summary:
        '19 representative frames across 9.1 seconds, ordered left-to-right and top-to-bottom.'
    }
  },
  {
    name: 'reference.png',
    path: '/tmp/agent-attachments/reference.png',
    visual: {
      imagePaths: ['/tmp/agent-attachments/reference.png'],
      kind: 'image',
      summary: 'Image attached directly to the model.'
    }
  }
]

describe('agent attachment prompt handoff', () => {
  test('keeps original paths and explains the sampled video timeline', () => {
    const prompt = promptWithAttachments('Review this.', attachments)

    expect(prompt).toContain('"walkthrough.mp4": /tmp/agent-attachments/walkthrough.mp4')
    expect(prompt).toContain('19 representative frames across 9.1 seconds')
    expect(prompt).toContain('left-to-right and top-to-bottom')
  })

  test('deduplicates all model-readable images', () => {
    const first = attachments.at(0)
    if (!first) throw new Error('Missing attachment fixture')
    expect(attachmentImagePaths([...attachments, first])).toEqual([
      '/tmp/agent-attachments/walkthrough-contact-sheet.jpg',
      '/tmp/agent-attachments/reference.png'
    ])
  })
})
