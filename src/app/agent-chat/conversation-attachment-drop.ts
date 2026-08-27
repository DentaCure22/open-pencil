import { ref, type Ref } from 'vue'

import {
  appendDraftAttachments,
  carriesAttachmentDrag,
  readAttachmentDrag,
  type AttachmentDragReader
} from './attachments'
import type { AgentConversationThread } from './conversations'

type AttachmentDropDataTransfer = AttachmentDragReader & {
  dropEffect: DataTransfer['dropEffect']
}

export type ConversationAttachmentDropEvent = {
  currentTarget: unknown
  dataTransfer: AttachmentDropDataTransfer | null
  preventDefault: () => void
  relatedTarget: unknown
  stopPropagation: () => void
}

type ConversationAttachmentDropOptions = {
  attachments: Ref<File[]>
  selectThread: (thread: AgentConversationThread) => Promise<void>
  startNewConversation: () => Promise<void>
}

export function useConversationAttachmentDrop(options: ConversationAttachmentDropOptions) {
  const captureDropTargetId = ref<string | null>(null)
  const listDragDepth = ref(0)

  function browserCaptureDragEnter(
    event: ConversationAttachmentDropEvent,
    thread: AgentConversationThread
  ) {
    if (!carriesAttachmentDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    captureDropTargetId.value = thread.id
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function browserCaptureDragLeave(
    event: ConversationAttachmentDropEvent,
    thread: AgentConversationThread
  ) {
    if (captureDropTargetId.value !== thread.id) return
    const current = event.currentTarget
    const related = event.relatedTarget
    if (current instanceof HTMLElement && related instanceof Node && current.contains(related))
      return
    captureDropTargetId.value = null
  }

  async function dropBrowserCaptureOnThread(
    event: ConversationAttachmentDropEvent,
    thread: AgentConversationThread
  ) {
    if (!carriesAttachmentDrag(event.dataTransfer)) return
    captureDropTargetId.value = null
    event.preventDefault()
    event.stopPropagation()
    const files = readAttachmentDrag(event.dataTransfer)
    if (!files.length) return
    await options.selectThread(thread)
    options.attachments.value = appendDraftAttachments(options.attachments.value, files).attachments
  }

  function listDragEnter(event: ConversationAttachmentDropEvent) {
    if (!carriesAttachmentDrag(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    listDragDepth.value += 1
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  function listDragLeave(event: ConversationAttachmentDropEvent) {
    if (listDragDepth.value === 0) return
    const current = event.currentTarget
    const related = event.relatedTarget
    if (current instanceof HTMLElement && related instanceof Node && current.contains(related))
      return
    listDragDepth.value = Math.max(0, listDragDepth.value - 1)
  }

  async function dropOnList(event: ConversationAttachmentDropEvent) {
    if (!carriesAttachmentDrag(event.dataTransfer)) return
    listDragDepth.value = 0
    event.preventDefault()
    event.stopPropagation()
    const files = readAttachmentDrag(event.dataTransfer)
    if (!files.length) return
    await options.startNewConversation()
    options.attachments.value = appendDraftAttachments(options.attachments.value, files).attachments
  }

  return {
    browserCaptureDragEnter,
    browserCaptureDragLeave,
    captureDropTargetId,
    dropBrowserCaptureOnThread,
    dropOnList,
    listDragDepth,
    listDragEnter,
    listDragLeave
  }
}
