import { describe, expect, test } from 'bun:test'

import { BOARD_WORKER_TOOL_SCOPE, boardWorkerLaunchFields } from '@/app/agent-chat/board-worker'

describe('OpenPencil Board worker launch', () => {
  test('marks a new in-app task as a Board worker without changing the visible prompt', () => {
    expect(BOARD_WORKER_TOOL_SCOPE).toBe('board-worker')
    expect(boardWorkerLaunchFields('Make a cool object.')).toEqual({
      prompt: 'Make a cool object.',
      toolScope: 'board-worker'
    })
  })
})
