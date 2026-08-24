import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import {
  compactForkEffectiveContext,
  compactForkMessages,
  compactForkPrompt,
  resolvePiForkLaunch
} from '#mcp/pi/compact-fork'

function thread(): AgentConversationThread {
  const messages: AgentConversationThread['messages'] = []
  for (let index = 1; index <= 6; index += 1) {
    messages.push(
      {
        createdAt: `2026-08-23T12:0${String(index)}:00.000Z`,
        id: `user-${String(index)}`,
        role: 'user',
        text: `Prompt ${String(index)}`
      },
      {
        createdAt: `2026-08-23T12:0${String(index)}:10.000Z`,
        id: `assistant-${String(index)}`,
        parts: [
          {
            name: 'read',
            output: `tool dump ${String(index)} ${'x'.repeat(2_000)}`,
            state: 'success',
            type: 'tool'
          }
        ],
        role: 'assistant',
        text: `Answer ${String(index)}`
      }
    )
  }
  return {
    canFollowUp: true,
    createdAt: '2026-08-23T12:00:00.000Z',
    effort: 'high',
    id: 'thread-parent',
    messages,
    model: 'xai-auth/grok-4.6',
    recentUpdate: 'Done.',
    sessionId: 'session-parent',
    state: 'completed',
    task: 'Rewrite the header',
    updatedAt: '2026-08-23T12:06:00.000Z',
    workerId: 'worker-1'
  }
}

describe('compact-fork', () => {
  test('seeds the child from the stored tail and drops old tool dumps', () => {
    const source = thread()
    const context = compactForkEffectiveContext(source)

    expect(context).toContain('Parent task: Rewrite the header')
    expect(context).toContain('User: Prompt 4')
    expect(context).toContain('Assistant: Answer 6')
    expect(context).not.toContain('Prompt 3')
    expect(context).not.toContain('tool dump')
  })

  test('menu compact-fork stays idle and does not invent a continue prompt', () => {
    const source = thread()
    const plan = resolvePiForkLaunch(source, { prompt: '' })
    const seeded = compactForkMessages(source)

    expect(plan.idle).toBe(true)
    expect(plan.mode).toEqual({ forkedFromId: 'thread-parent', kind: 'new' })
    expect(plan.request.prompt).toBe('')
    expect(seeded.map((message) => message.text)).toEqual([
      'Prompt 4',
      'Answer 4',
      'Prompt 5',
      'Answer 5',
      'Prompt 6',
      'Answer 6'
    ])
    expect(seeded.some((message) => message.parts?.some((part) => part.type === 'tool'))).toBe(
      false
    )
  })

  test('default fork launches a new session with the visible ask kept short', () => {
    const source = thread()
    const plan = resolvePiForkLaunch(source, {
      displayPrompt: 'Try the alternate layout.',
      prompt: '/skill:openpencil Try the alternate layout.'
    })

    expect(plan.idle).toBe(false)
    expect(plan.mode).toEqual({ forkedFromId: 'thread-parent', kind: 'new' })
    expect(plan.request.displayPrompt).toBe('Try the alternate layout.')
    expect(plan.request.prompt).toBe(
      compactForkPrompt(source, '/skill:openpencil Try the alternate layout.')
    )
    expect(plan.request.prompt).toContain('Try the alternate layout.')
    expect(plan.request.prompt).toContain('User: Prompt 6')
    expect(plan.request.prompt).not.toContain('tool dump 6')
  })

  test('full history scope keeps the native Pi fork', () => {
    const source = thread()
    const plan = resolvePiForkLaunch(source, {
      historyScope: 'full',
      prompt: 'Keep the whole parent.'
    })

    expect(plan.mode).toEqual({
      forkedFromId: 'thread-parent',
      kind: 'fork',
      sessionId: 'session-parent'
    })
    expect(plan.request.prompt).toBe('Keep the whole parent.')
  })
})
