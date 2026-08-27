import { describe, expect, test } from 'bun:test'

import { WorkMapStore } from '#mcp/agent-router/work-map'
import {
  WorkMapRoutineScheduler,
  type WorkMapRoutineRouter
} from '#mcp/agent-router/work-map-routine-scheduler'

describe('Work Map routine scheduler', () => {
  test('continues the Bot chat and records the completed run in Inbox', async () => {
    const prompts: string[] = []
    const selections: Array<Parameters<WorkMapRoutineRouter['followUp']>[2]> = []
    const conversation: NonNullable<ReturnType<WorkMapRoutineRouter['conversation']>> = {
      canFollowUp: true,
      createdAt: '2026-08-26T10:00:00.000Z',
      effort: 'medium',
      id: 'thread:bot',
      messages: [],
      model: 'test/model',
      recentUpdate: '',
      sessionId: 'session:bot',
      state: 'completed' as const,
      task: 'Daily reviewer',
      title: 'Morning review',
      toolScope: 'general',
      updatedAt: '2026-08-26T10:00:00.000Z',
      workerId: 'worker-1'
    }
    const router: WorkMapRoutineRouter = {
      conversation: () => structuredClone(conversation),
      followUp: async (_threadId: string, prompt: string, selection) => {
        prompts.push(prompt)
        selections.push(selection)
        conversation.messages.push({
          createdAt: '2026-08-26T12:00:00.000Z',
          id: 'message:routine-prompt',
          role: 'user',
          text: prompt
        })
        return {
          dispatchedAt: '2026-08-26T12:00:00.000Z',
          jobId: 'job:one',
          state: 'running',
          threadId: 'thread:bot'
        }
      },
      waitForJob: async () => ({
        createdAt: '2026-08-26T12:00:00.000Z',
        jobId: 'job:one',
        response: [
          '# Morning review',
          '',
          'Two tasks need attention.',
          '',
          '## Needs attention',
          '',
          '- **Insurance renewal** — Due Friday.',
          '- **Patient export** — Waiting for approval.'
        ].join('\n'),
        state: 'completed',
        threadId: 'thread:bot',
        updatedAt: '2026-08-26T12:01:00.000Z'
      })
    }
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:one',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:bot'
        },
        {
          bot_id: 'bot:one',
          create_briefing_object: true,
          every_minutes: 1_440,
          next_run_at: '2026-08-26T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review the work map',
          routine_id: 'routine:daily'
        }
      ]
    })
    const scheduler = new WorkMapRoutineScheduler(store, router, {
      autoStart: false
    })

    const started = scheduler.tick(new Date('2026-08-26T12:00:00.000Z'))
    expect(started).toHaveLength(1)
    expect(started[0]?.status).toBe('running')
    await scheduler.waitForIdle()

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toStartWith('Review the work map')
    expect(prompts[0]).toContain('Inbox briefing Code Object')
    expect(prompts[0]).toContain('## <section>')
    expect(selections).toEqual([
      {
        botId: 'bot:one',
        effort: 'medium',
        model: 'test/model',
        toolScope: 'general'
      }
    ])
    expect(store.snapshot().inbox[0]).toMatchObject({
      briefing: {
        content: expect.stringContaining('Two tasks need attention.'),
        id: expect.stringContaining('briefing:'),
        report: {
          sections: [
            {
              items: [
                { detail: 'Due Friday.', title: 'Insurance renewal' },
                { detail: 'Waiting for approval.', title: 'Patient export' }
              ],
              title: 'Needs attention',
              tone: 'attention'
            }
          ],
          summary: 'Two tasks need attention.',
          title: 'Morning review',
          version: 1
        },
        title: 'Morning review briefing'
      },
      messageId: 'message:routine-prompt',
      status: 'completed',
      summary: expect.stringContaining('Two tasks need attention.'),
      threadId: 'thread:bot'
    })
    expect(store.snapshot().routines[0]?.nextRunAt).toBe('2026-08-27T12:00:00.000Z')
  })

  test('runs only the latest missed occurrence after weeks of downtime', async () => {
    const prompts: string[] = []
    const router: WorkMapRoutineRouter = {
      conversation: (threadId: string) => ({
        canFollowUp: true,
        createdAt: '2026-08-01T12:00:00.000Z',
        effort: 'medium',
        id: threadId,
        messages: [],
        model: 'test/model',
        recentUpdate: '',
        sessionId: 'session:bot',
        state: 'completed',
        task: 'Daily reviewer',
        toolScope: 'general',
        updatedAt: '2026-08-01T12:00:00.000Z',
        workerId: 'worker-1'
      }),
      followUp: async (_threadId: string, prompt: string) => {
        prompts.push(prompt)
        return {
          dispatchedAt: '2026-08-26T12:00:00.000Z',
          jobId: 'job:catch-up',
          state: 'running',
          threadId: 'thread:bot'
        }
      },
      waitForJob: async () => ({
        createdAt: '2026-08-26T12:00:00.000Z',
        jobId: 'job:catch-up',
        response: 'Reviewed current state once.',
        state: 'completed',
        threadId: 'thread:bot',
        updatedAt: '2026-08-26T12:01:00.000Z'
      })
    }
    const store = new WorkMapStore()
    store.apply({
      actor: { kind: 'user' },
      expectedRevision: 0,
      operations: [
        {
          bot_id: 'bot:one',
          op: 'create_bot',
          project_id: null,
          thread_id: 'thread:bot'
        },
        {
          bot_id: 'bot:one',
          every_minutes: 1_440,
          next_run_at: '2026-08-01T12:00:00.000Z',
          op: 'create_routine',
          prompt: 'Review the work map',
          routine_id: 'routine:daily'
        }
      ]
    })
    const scheduler = new WorkMapRoutineScheduler(store, router, {
      autoStart: false
    })
    const restartTime = new Date('2026-08-26T12:00:00.000Z')

    expect(scheduler.tick(restartTime)).toHaveLength(1)
    expect(scheduler.tick(restartTime)).toHaveLength(0)
    await scheduler.waitForIdle()

    expect(prompts).toEqual(['Review the work map'])
    expect(store.snapshot()).toMatchObject({
      inbox: [{ status: 'completed', summary: 'Reviewed current state once.' }],
      routines: [{ nextRunAt: '2026-08-27T12:00:00.000Z' }]
    })
  })
})
