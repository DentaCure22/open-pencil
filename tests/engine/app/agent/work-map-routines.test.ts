import { describe, expect, test } from 'bun:test'

import type { AgentWorkMap } from '@/app/agent-chat/work-map'
import {
  isWorkMapRoutineRunning,
  workMapBotScheduleLabel,
  workMapRoutineCadence,
  workMapRoutineIntervalMinutes,
  workMapRoutinesForBot
} from '@/app/agent-chat/work-map-routines'

const workMap: AgentWorkMap = {
  bots: [
    {
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'bot-1',
      projectId: null,
      threadId: 'thread-1',
      updatedAt: '2026-08-26T12:00:00.000Z'
    }
  ],
  inbox: [
    {
      botId: 'bot-1',
      createdAt: '2026-08-26T12:00:00.000Z',
      id: 'inbox-1',
      projectId: null,
      routineId: 'routine-daily',
      status: 'running',
      summary: 'Running',
      threadId: 'thread-1',
      updatedAt: '2026-08-26T12:00:00.000Z'
    }
  ],
  placements: [],
  projects: [],
  revision: 1,
  routines: [
    {
      botId: 'bot-1',
      createdAt: '2026-08-26T12:00:00.000Z',
      enabled: true,
      everyMinutes: 1_440,
      id: 'routine-daily',
      nextRunAt: '2026-08-27T12:00:00.000Z',
      prompt: 'Daily review',
      updatedAt: '2026-08-26T12:00:00.000Z'
    },
    {
      botId: 'bot-1',
      createdAt: '2026-08-26T12:00:00.000Z',
      enabled: true,
      everyMinutes: 60,
      id: 'routine-hourly',
      nextRunAt: '2026-08-26T13:00:00.000Z',
      prompt: 'Hourly review',
      updatedAt: '2026-08-26T12:00:00.000Z'
    }
  ],
  todos: []
}

describe('Work Map routine presentation', () => {
  test('sorts schedules and reports the next active cadence', () => {
    const bot = workMap.bots[0]
    if (!bot) throw new Error('Bot fixture missing')
    expect(workMapRoutinesForBot(workMap, bot.id).map((routine) => routine.id)).toEqual([
      'routine-hourly',
      'routine-daily'
    ])
    expect(workMapBotScheduleLabel(workMap, bot)).toStartWith('Hourly · ')
  })

  test('keeps cadence and running-state rules in one place', () => {
    expect(isWorkMapRoutineRunning(workMap, 'routine-daily')).toBe(true)
    expect(isWorkMapRoutineRunning(workMap, 'routine-hourly')).toBe(false)
    const daily = workMap.routines.find((routine) => routine.id === 'routine-daily')
    if (!daily) throw new Error('Daily routine fixture missing')
    expect(workMapRoutineCadence(daily)).toBe('Daily')
    expect(workMapRoutineIntervalMinutes('once')).toBeUndefined()
    expect(workMapRoutineIntervalMinutes('weekly')).toBe(10_080)
  })
})
