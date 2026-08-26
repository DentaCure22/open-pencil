import { describe, expect, test } from 'bun:test'

import type { AiMessage } from '@/app/agent-chat/types'
import { conversationRuns } from '@/components/ai-elements/conversation-runs'

function message(
  id: string,
  role: AiMessage['role'],
  text: string,
  overrides: Partial<AiMessage> = {}
): AiMessage {
  return {
    createdAt: '2026-08-23T13:30:00.000Z',
    id,
    role,
    text,
    ...overrides
  }
}

describe('conversation runs', () => {
  test('keeps workspace changes attached to the turn that produced them', () => {
    const changes = {
      additions: 4,
      capturedAt: '2026-08-25T12:00:02.000Z',
      deletions: 1,
      files: [
        {
          additions: 4,
          deletions: 1,
          patch: 'diff --git a/app.ts b/app.ts',
          path: 'app.ts',
          status: 'modified' as const
        }
      ]
    }
    const [run] = conversationRuns([
      message('user-1', 'user', 'Update the app.', { changes }),
      message('assistant-1', 'assistant', 'Updated the app.')
    ])

    expect(run?.changes).toEqual(changes)
  })

  test('does not lift commentary into a visible answer', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'Add a spinner.'),
      message('tool-1', 'assistant', '', {
        parts: [{ name: 'edit', state: 'success', type: 'tool' }]
      }),
      message('note-1', 'assistant', '', {
        parts: [
          {
            state: 'complete',
            text: 'The spinner is on the open chat and the thread list.',
            type: 'commentary'
          }
        ]
      })
    ])

    expect(run?.missingResponse).toBe(true)
    expect(run?.visible).toEqual([])
    expect(run?.activity.map((item) => item.id)).toEqual(['tool-1', 'note-1'])
  })

  test('keeps reasoning in the activity lane and commentary off the answer', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'check mail'),
      message('reason-1', 'assistant', '', {
        parts: [{ state: 'complete', text: 'Looking at the inbox query.', type: 'reasoning' }]
      }),
      message('note-1', 'assistant', '', {
        parts: [{ state: 'complete', text: 'I’ll read Gmail next.', type: 'commentary' }]
      }),
      message('asst-1', 'assistant', 'Inbox is quiet.')
    ])

    expect(run?.visible).toEqual([
      expect.objectContaining({ id: 'asst-1', text: 'Inbox is quiet.' })
    ])
    expect(run?.activity.map((item) => item.id)).toEqual(['reason-1', 'note-1'])
  })

  test('keeps commentary in activity when the same message also has visible text', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'Add a spinner.'),
      message('asst-1', 'assistant', 'The spinner is in.', {
        parts: [
          { state: 'complete', text: 'Checking the header.', type: 'commentary' },
          { name: 'edit', state: 'success', type: 'tool' }
        ]
      })
    ])

    expect(run?.visible).toEqual([
      expect.objectContaining({ id: 'asst-1', text: 'The spinner is in.' })
    ])
    expect(run?.activity).toEqual([expect.objectContaining({ id: 'asst-1' })])
  })

  test('keeps the last answer visible when it also has commentary and sibling tools', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'whats todays emails'),
      message('asst-1', 'assistant', 'Here are today’s emails.', {
        parts: [
          { state: 'complete', text: 'Checking Gmail.', type: 'commentary' },
          { name: 'read', state: 'success', type: 'tool' }
        ]
      })
    ])

    expect(run?.missingResponse).toBe(false)
    expect(run?.visible).toEqual([
      expect.objectContaining({ id: 'asst-1', text: 'Here are today’s emails.' })
    ])
    expect(run?.activity).toEqual([expect.objectContaining({ id: 'asst-1' })])
  })

  test('parks earlier answer text as commentary and keeps the last text visible', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'check my emails'),
      message(
        'asst-1',
        'assistant',
        "I'll check your inbox now — first I'll look up the Gmail tools.",
        {
          parts: [
            {
              state: 'complete',
              text: 'A few messages look like they need attention.',
              type: 'commentary'
            }
          ]
        }
      ),
      message('tool-1', 'assistant', '', {
        parts: [{ name: 'read', state: 'success', type: 'tool' }]
      }),
      message('asst-2', 'assistant', 'Saturday was quiet.')
    ])

    expect(run?.visible).toEqual([
      expect.objectContaining({ id: 'asst-2', text: 'Saturday was quiet.' })
    ])
    expect(run?.activity[0]).toEqual(
      expect.objectContaining({
        id: 'asst-1',
        parts: [
          expect.objectContaining({
            text: "I'll check your inbox now — first I'll look up the Gmail tools.",
            type: 'commentary'
          }),
          expect.objectContaining({
            text: 'A few messages look like they need attention.',
            type: 'commentary'
          })
        ],
        text: ''
      })
    )
    expect(run?.activity.some((item) => item.parts?.some((part) => part.type === 'tool'))).toBe(
      true
    )
  })

  test('hides retired memory tickets from the activity lane', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'yesterdays emails'),
      message('mem-1', 'assistant', '', {
        parts: [
          { input: '{"query":"inbox"}', name: 'memory_search', state: 'success', type: 'tool' }
        ]
      }),
      message('mail-1', 'assistant', '', {
        parts: [
          {
            input: '{"query":"after:2026/08/22"}',
            name: 'codex_apps_gmail_search_emails',
            state: 'success',
            type: 'tool'
          }
        ]
      }),
      message('asst-1', 'assistant', 'Saturday was quiet.')
    ])

    expect(run?.activity.map((item) => item.id)).toEqual(['mail-1'])
    expect(run?.visible).toEqual([expect.objectContaining({ id: 'asst-1' })])
  })

  test('does not invent a closing message while the turn is still running', () => {
    const [run] = conversationRuns([
      message('user-1', 'user', 'Add a spinner.'),
      message('note-1', 'assistant', '', {
        parts: [{ state: 'streaming', text: 'Checking the header.', type: 'commentary' }]
      })
    ])

    expect(run?.missingResponse).toBe(true)
    expect(run?.visible).toEqual([])
  })

  test('keeps an unfinished tool preamble out of the answer lane', () => {
    const [run] = conversationRuns(
      [
        message('user-1', 'user', 'Run the checks.'),
        message('preamble-1', 'assistant', 'Running the type checks now.'),
        message('tool-1', 'assistant', '', {
          parts: [{ name: 'bash', state: 'running', type: 'tool' }]
        })
      ],
      { active: true }
    )

    expect(run?.visible).toEqual([])
    expect(run?.activity).toEqual([
      expect.objectContaining({
        id: 'preamble-1',
        parts: [
          expect.objectContaining({ text: 'Running the type checks now.', type: 'commentary' })
        ],
        text: ''
      }),
      expect.objectContaining({ id: 'tool-1' })
    ])
  })

  test('keeps a short unfinished preamble in the live lane before its tool arrives', () => {
    const [run] = conversationRuns(
      [
        message('user-1', 'user', 'Run the checks.'),
        message('preamble-1', 'assistant', 'Running the type checks now.')
      ],
      { active: true }
    )

    expect(run?.visible).toEqual([])
    expect(run?.activity).toEqual([
      expect.objectContaining({
        id: 'preamble-1',
        parts: [expect.objectContaining({ type: 'commentary' })],
        text: ''
      })
    ])
  })

  test('keeps a completed final answer visible when no tool follows it', () => {
    const [run] = conversationRuns(
      [
        message('user-1', 'user', 'Explain the renderer.'),
        message('answer-1', 'assistant', 'The renderer keeps completed blocks stable.', {
          completedAt: '2026-08-23T13:30:01.000Z'
        })
      ],
      { active: true }
    )

    expect(run?.visible).toEqual([
      expect.objectContaining({
        id: 'answer-1',
        text: 'The renderer keeps completed blocks stable.'
      })
    ])
  })

  test('streams a substantive unfinished answer in the answer lane', () => {
    const text = '### Stable blocks\nCompleted Markdown stays mounted while the live tail grows.'
    const [run] = conversationRuns(
      [message('user-1', 'user', 'Explain the renderer.'), message('answer-1', 'assistant', text)],
      { active: true }
    )

    expect(run?.visible).toEqual([expect.objectContaining({ id: 'answer-1', text })])
  })
})
