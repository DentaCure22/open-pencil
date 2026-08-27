import { describe, expect, test } from 'bun:test'

import { ref } from 'vue'

import {
  useConversationAttachmentDrop,
  type ConversationAttachmentDropEvent
} from '@/app/agent-chat/conversation-attachment-drop'
import type { AgentConversationThread } from '@/app/agent-chat/conversations'

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: '2026-08-26T12:00:00.000Z',
    effort: 'medium',
    id: 'agent:thread-1',
    messages: [],
    model: 'gpt-5.6-sol',
    nativeThreadId: 'thread-1',
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task: 'Review capture',
    updatedAt: '2026-08-26T12:00:00.000Z'
  }
}

function attachmentEvent(files: File[]) {
  const state = { prevented: 0, stopped: 0 }
  const dataTransfer = {
    dropEffect: 'none' as DataTransfer['dropEffect'],
    files,
    getData: () => '',
    types: ['Files']
  }
  const event: ConversationAttachmentDropEvent = {
    currentTarget: null,
    dataTransfer,
    preventDefault: () => {
      state.prevented += 1
    },
    relatedTarget: null,
    stopPropagation: () => {
      state.stopped += 1
    }
  }
  return { dataTransfer, event, state }
}

describe('conversation attachment drops', () => {
  test('starts a new conversation before attaching files dropped on the list', async () => {
    const attachments = ref<File[]>([])
    let starts = 0
    const drop = useConversationAttachmentDrop({
      attachments,
      selectThread: async () => {
        throw new Error('Thread selection was not expected')
      },
      startNewConversation: async () => {
        starts += 1
      }
    })
    const fixture = attachmentEvent([new File(['capture'], 'capture.png', { type: 'image/png' })])

    drop.listDragEnter(fixture.event)
    expect(drop.listDragDepth.value).toBe(1)
    expect(fixture.dataTransfer.dropEffect).toBe('copy')
    await drop.dropOnList(fixture.event)

    expect(starts).toBe(1)
    expect(attachments.value.map((file) => file.name)).toEqual(['capture.png'])
    expect(drop.listDragDepth.value).toBe(0)
    expect(fixture.state).toEqual({ prevented: 2, stopped: 2 })
  })

  test('selects a thread before attaching a capture to its composer', async () => {
    const attachments = ref<File[]>([])
    const selected: string[] = []
    const drop = useConversationAttachmentDrop({
      attachments,
      selectThread: async (candidate) => {
        selected.push(candidate.id)
      },
      startNewConversation: async () => {
        throw new Error('New conversation was not expected')
      }
    })
    const fixture = attachmentEvent([new File(['notes'], 'notes.txt', { type: 'text/plain' })])

    await drop.dropBrowserCaptureOnThread(fixture.event, thread())

    expect(selected).toEqual(['agent:thread-1'])
    expect(attachments.value.map((file) => file.name)).toEqual(['notes.txt'])
    expect(drop.captureDropTargetId.value).toBeNull()
  })
})
