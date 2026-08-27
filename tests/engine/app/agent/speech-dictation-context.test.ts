import { describe, expect, test } from 'bun:test'

import type { AgentConversationThread } from '@/app/agent-chat/conversations'
import type { AgentWorkMap } from '@/app/agent-chat/work-map'
import {
  buildSpeechDictationContext,
  contextualizeSpeechDictation
} from '@/app/speech-dictation-context'

const now = '2026-08-26T12:00:00.000Z'

function workMap(): AgentWorkMap {
  return {
    bots: [],
    inbox: [],
    placements: [{ manual: true, projectId: 'sub', threadId: 'native-1', updatedAt: now }],
    projects: [
      { createdAt: now, id: 'root', name: 'Dental', updatedAt: now },
      { createdAt: now, id: 'sub', name: 'Patient portal', parentId: 'root', updatedAt: now },
      { createdAt: now, id: 'child', name: 'Billing', parentId: 'sub', updatedAt: now },
      { createdAt: now, id: 'other', name: 'Marketing', updatedAt: now }
    ],
    revision: 1,
    routines: [],
    todos: [
      {
        createdAt: now,
        id: 'todo-1',
        projectId: 'sub',
        status: 'todo',
        threadId: 'native-1',
        title: 'Ship the Smylr intake flow',
        updatedAt: now
      },
      {
        createdAt: now,
        id: 'todo-2',
        projectId: 'other',
        status: 'todo',
        title: 'Unrelated campaign',
        updatedAt: now
      }
    ]
  }
}

function thread(): AgentConversationThread {
  return {
    canFollowUp: true,
    createdAt: now,
    effort: 'medium',
    id: 'thread-1',
    messages: [
      { createdAt: now, id: 'm1', role: 'user', text: 'Open the intake Code Object.' },
      { createdAt: now, id: 'm2', role: 'assistant', text: 'Done.' },
      { createdAt: now, id: 'm3', role: 'user', text: 'Keep Smylr capitalized.' }
    ],
    model: 'gpt-5.6-sol',
    nativeThreadId: 'native-1',
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task: 'Patient intake implementation',
    title: 'Intake polish',
    updatedAt: now
  }
}

describe('speech dictation context', () => {
  test('translates Work Map hierarchy into global, project, and active layers', () => {
    const context = buildSpeechDictationContext({
      composerText: 'Also fix the Smylr header',
      thread: thread(),
      workMap: workMap()
    })

    expect(context.global?.projectPaths).toEqual([
      'Dental',
      'Dental / Patient portal',
      'Dental / Patient portal / Billing',
      'Marketing'
    ])
    expect(context.project).toEqual({
      childNames: ['Billing'],
      path: ['Dental', 'Patient portal'],
      todoTitles: ['Ship the Smylr intake flow']
    })
    expect(context.active).toEqual({
      composerText: 'Also fix the Smylr header',
      conversationTitle: 'Intake polish',
      recentPhrases: ['Open the intake Code Object.', 'Keep Smylr capitalized.'],
      terms: ['Patient portal', 'Dental', 'Smylr'],
      todoTitle: 'Ship the Smylr intake flow'
    })
  })

  test('keeps the global catalog bounded and honors an explicit project focus', () => {
    const map = workMap()
    map.projects.push(
      ...Array.from({ length: 70 }, (_, index) => ({
        createdAt: now,
        id: `extra-${index}`,
        name: `Extra ${index}`,
        updatedAt: now
      }))
    )

    const context = buildSpeechDictationContext({ projectId: 'other', workMap: map })

    expect(context.global?.projectPaths).toHaveLength(60)
    expect(context.project?.path).toEqual(['Marketing'])
    expect(context.project?.todoTitles).toEqual(['Unrelated campaign'])
  })

  test('restores exact active spellings while preserving the rest of the transcript', () => {
    const context = {
      active: {
        conversationTitle: 'Smylr patient intake',
        terms: ['Smylr', 'OpenPencil'],
        todoTitle: 'Open the OpenPencil intake board'
      },
      global: { projectPaths: ['Dental / Smylr', 'OpenPencil'] },
      project: { path: ['Dental', 'Smylr'] }
    }

    expect(
      contextualizeSpeechDictation('Open the Smiler patient intake board in Open Dental.', context)
    ).toBe('Open the Smylr patient intake board in OpenPencil.')
    expect(
      contextualizeSpeechDictation('Continue the Altered Bird Image plan.', {
        active: { conversationTitle: 'Alter a bird image' }
      })
    ).toBe('Continue the Alter a bird image plan.')
    expect(contextualizeSpeechDictation('Leave ordinary wording alone.', undefined)).toBe(
      'Leave ordinary wording alone.'
    )
  })
})
