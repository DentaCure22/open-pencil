import { describe, expect, test } from 'bun:test'

import { effectScope, nextTick, ref } from 'vue'

import { useConversationTranscriptLifecycle } from '@/app/agent-chat/conversation-transcript-lifecycle'

describe('conversation transcript lifecycle', () => {
  test('retains only the selected transcript and releases it with its scope', async () => {
    const selectedId = ref<string | null>('agent:first')
    const retained: string[] = []
    const released: string[] = []
    const loaded: string[] = []
    const revealed: string[] = []
    const scope = effectScope()
    const lifecycle = scope.run(() =>
      useConversationTranscriptLifecycle(selectedId, {
        loadOlder: async (threadId) => void loaded.push(threadId),
        release: (threadId) => released.push(threadId),
        retain: (threadId) => retained.push(threadId),
        reveal: async (threadId, chapterId) => void revealed.push(`${threadId}:${chapterId}`)
      })
    )
    if (!lifecycle) throw new Error('Transcript lifecycle scope did not start')

    expect(retained).toEqual(['agent:first'])
    selectedId.value = 'agent:second'
    await nextTick()
    expect(released).toEqual(['agent:first'])
    expect(retained).toEqual(['agent:first', 'agent:second'])

    await lifecycle.loadOlderSelectedTranscript()
    await lifecycle.revealSelectedChapter('chapter-1')
    expect(loaded).toEqual(['agent:second'])
    expect(revealed).toEqual(['agent:second:chapter-1'])
    expect(lifecycle.loadingOlder.value).toBe(false)

    scope.stop()
    expect(released).toEqual(['agent:first', 'agent:second'])
  })
})
