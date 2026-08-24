import { describe, expect, test } from 'bun:test'

import {
  liveStreamingThreadIds,
  nextTranscriptHydrationBatch,
  planBoardTranscriptRetain,
  resolvePreviewTranscriptSource,
  TRANSCRIPT_HYDRATION_BATCH
} from '@/app/agent-chat/transcript-hydration'

describe('live transcript streaming', () => {
  test('streams only the open chats that are still running', () => {
    expect(
      liveStreamingThreadIds(
        [
          { id: 'open-run', state: 'running' },
          { id: 'open-done', state: 'completed' },
          { id: 'other-run', state: 'running' }
        ],
        ['open-run', 'open-done']
      )
    ).toEqual(['open-run'])
  })

  test('keeps a cached transcript when leaving and opening the chat again', () => {
    const cached = { id: 'chat-1', messages: ['full'] }
    const preview = { id: 'chat-1', messages: ['thin'] }
    expect(
      resolvePreviewTranscriptSource({
        cached,
        current: preview,
        retained: false
      })
    ).toBe(cached)
    expect(
      resolvePreviewTranscriptSource({
        cached,
        current: preview,
        retained: true
      })
    ).toBe(cached)
    expect(
      resolvePreviewTranscriptSource({
        current: preview,
        retained: false
      })
    ).toBeUndefined()
  })
})

describe('transcript hydration batching', () => {
  test('hydrates only a small first batch of retained chats', () => {
    const retained = ['a', 'b', 'c', 'd', 'e']
    const updatedAtByThreadId = new Map(retained.map((id) => [id, '2026-08-23T00:00:00.000Z']))
    expect(
      nextTranscriptHydrationBatch(retained, {
        hydratedUpdatedAt: new Map(),
        updatedAtByThreadId
      })
    ).toEqual(['a', 'b'])
    expect(TRANSCRIPT_HYDRATION_BATCH).toBe(2)
  })

  test('skips chats that already match the retained snapshot', () => {
    const retained = ['a', 'b', 'c']
    expect(
      nextTranscriptHydrationBatch(retained, {
        hydratedUpdatedAt: new Map([
          ['a', '1'],
          ['b', 'stale']
        ]),
        updatedAtByThreadId: new Map([
          ['a', '1'],
          ['b', '2'],
          ['c', '3']
        ])
      })
    ).toEqual(['b', 'c'])
  })

  test('keeps Board cards on preview until click or idle retain', () => {
    expect(
      planBoardTranscriptRetain({
        idleForId: null,
        interactionEnabled: false,
        nextId: 'agent:1',
        retainedId: null
      })
    ).toEqual({ id: 'agent:1', type: 'schedule' })
    expect(
      planBoardTranscriptRetain({
        idleForId: 'agent:1',
        interactionEnabled: false,
        nextId: 'agent:1',
        retainedId: null
      })
    ).toEqual({ type: 'keep' })
    expect(
      planBoardTranscriptRetain({
        idleForId: 'agent:1',
        interactionEnabled: true,
        nextId: 'agent:1',
        retainedId: null
      })
    ).toEqual({ id: 'agent:1', type: 'retain' })
    expect(
      planBoardTranscriptRetain({
        idleForId: null,
        interactionEnabled: false,
        nextId: null,
        retainedId: 'agent:1'
      })
    ).toEqual({ type: 'clear' })
  })
})
