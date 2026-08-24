import { describe, expect, test } from 'bun:test'

import {
  boardConversationStatusLabel,
  liveWorkingLabel,
  matchesAgentBoardConversation,
  threadLiveWorkingLabel
} from '@/app/agent-chat/board-conversation'

const NOW = Date.parse('2026-08-16T00:01:00.000Z')

describe('board conversation live status', () => {
  test('uses exact native thread identity', () => {
    const thread = { nativeThreadId: 'native-thread-1' }
    expect(matchesAgentBoardConversation(thread, 'native-thread-1')).toBeTrue()
    expect(matchesAgentBoardConversation(thread, 'native-thread-2')).toBeFalse()
  })

  test('keeps a heartbeat suffix and continues it from updatedAt', () => {
    expect(
      liveWorkingLabel({
        now: NOW,
        recentUpdate: 'Run command… · 48s',
        state: 'running',
        updatedAt: '2026-08-16T00:01:00.000Z'
      })
    ).toBe('Run command… · 48s')
    expect(
      liveWorkingLabel({
        now: NOW + 12_000,
        recentUpdate: 'Run command… · 48s',
        state: 'running',
        updatedAt: '2026-08-16T00:01:00.000Z'
      })
    ).toBe('Run command… · 60s')
  })

  test('does not reset the timer when updatedAt churns on a prose update', () => {
    expect(
      liveWorkingLabel({
        lastMessageAt: '2026-08-16T00:00:48.000Z',
        now: NOW,
        recentUpdate: 'The selected chat header now has a New task button.',
        state: 'running',
        updatedAt: '2026-08-16T00:01:00.000Z'
      })
    ).toBe('The selected chat header now has a New task button. · 12s')
  })

  test('does not put a long streaming answer into the working line', () => {
    expect(
      liveWorkingLabel({
        lastMessageAt: '2026-08-16T00:00:48.000Z',
        now: NOW,
        recentUpdate:
          'The selected chat header now has a New task button, and the same treatment is on Board chat cards.',
        state: 'running',
        updatedAt: '2026-08-16T00:00:48.000Z'
      })
    ).toBe('Working · 12s')
  })

  test('appends elapsed seconds when a running update has no suffix', () => {
    expect(
      liveWorkingLabel({
        lastMessageAt: '2026-08-16T00:00:48.000Z',
        now: NOW,
        recentUpdate: 'Run command…',
        state: 'running',
        updatedAt: '2026-08-16T00:00:48.000Z'
      })
    ).toBe('Run command… · 12s')
  })

  test('falls back to the last message time and does not stack suffixes', () => {
    expect(
      liveWorkingLabel({
        lastMessageAt: '2026-08-16T00:00:50.000Z',
        now: NOW,
        recentUpdate: 'Read…',
        state: 'running'
      })
    ).toBe('Read… · 10s')
    expect(
      liveWorkingLabel({
        now: NOW + 8_000,
        recentUpdate: 'Still working… 48s',
        state: 'running',
        updatedAt: '2026-08-16T00:01:00.000Z'
      })
    ).toBe('Still working… · 56s')
  })

  test('uses the conversation state when recentUpdate is blank', () => {
    expect(
      liveWorkingLabel({
        now: NOW,
        recentUpdate: '   ',
        state: 'running',
        updatedAt: '2026-08-16T00:00:55.000Z'
      })
    ).toBe('running · 5s')
  })

  test('does not invent a ticking line after the turn ends', () => {
    expect(
      liveWorkingLabel({
        now: NOW,
        recentUpdate: 'Pi completed the task.',
        state: 'completed',
        updatedAt: '2026-08-16T00:01:00.000Z'
      })
    ).toBeUndefined()
    expect(
      boardConversationStatusLabel({
        now: NOW,
        recentUpdate: 'Pi completed the task.',
        state: 'completed'
      })
    ).toBe('idle')
  })

  test('thread helper keeps idle recaps and fills a blank running line', () => {
    expect(
      threadLiveWorkingLabel(
        {
          recentUpdate: 'Pi completed the task.',
          state: 'completed',
          updatedAt: '2026-08-16T00:01:00.000Z'
        },
        NOW
      )
    ).toBe('Pi completed the task.')
    expect(
      threadLiveWorkingLabel(
        {
          messages: [{ createdAt: '2026-08-16T00:00:40.000Z' }],
          recentUpdate: '',
          state: 'running'
        },
        NOW
      )
    ).toBe('running · 20s')
  })
})
