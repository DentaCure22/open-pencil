import { nextTick, ref, type ComputedRef } from 'vue'

import { toast } from '@/app/shell/ui'

import type { AgentConversationThread } from './conversations'
import { agentConversationDisplayTitle, setAgentConversationTitle } from './thread-preferences'

export function useConversationTitleRename(
  selectedThread: ComputedRef<AgentConversationThread | null>
) {
  const renamingTitle = ref(false)
  const renamingTitleDraft = ref('')
  const titleRenameInput = ref<HTMLInputElement | null>(null)

  function beginTitleRename() {
    if (!selectedThread.value) return
    renamingTitleDraft.value = agentConversationDisplayTitle(selectedThread.value)
    renamingTitle.value = true
    void nextTick(() => {
      titleRenameInput.value?.focus()
      titleRenameInput.value?.select()
    })
  }

  function commitTitleRename() {
    if (!renamingTitle.value) return
    const thread = selectedThread.value
    const next = renamingTitleDraft.value.trim()
    if (thread && next && next !== agentConversationDisplayTitle(thread)) {
      setAgentConversationTitle(thread, next)
      toast.info('Task renamed')
    }
    renamingTitle.value = false
  }

  function cancelTitleRename() {
    renamingTitle.value = false
  }

  function setTitleRenameInput(element: unknown) {
    titleRenameInput.value = element instanceof HTMLInputElement ? element : null
  }

  return {
    beginTitleRename,
    cancelTitleRename,
    commitTitleRename,
    renamingTitle,
    renamingTitleDraft,
    setTitleRenameInput
  }
}
