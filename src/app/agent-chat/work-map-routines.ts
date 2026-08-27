import type { AgentWorkMap, AgentWorkMapBot, AgentWorkMapRoutine } from './work-map'

export type WorkMapRoutineRepeat = 'daily' | 'hourly' | 'once' | 'weekly'

export function workMapRoutinesForBot(
  workMap: AgentWorkMap | null,
  botId: string
): AgentWorkMapRoutine[] {
  return (workMap?.routines ?? [])
    .filter((routine) => routine.botId === botId)
    .sort((left, right) => (left.nextRunAt ?? '').localeCompare(right.nextRunAt ?? ''))
}

export function isWorkMapRoutineRunning(workMap: AgentWorkMap | null, routineId: string): boolean {
  return (workMap?.inbox ?? []).some(
    (item) => item.routineId === routineId && item.status === 'running'
  )
}

export function workMapRoutineCadence(routine: AgentWorkMapRoutine): string {
  if (!routine.everyMinutes) return 'Once'
  if (routine.everyMinutes === 60) return 'Hourly'
  if (routine.everyMinutes === 1_440) return 'Daily'
  if (routine.everyMinutes === 10_080) return 'Weekly'
  return `Every ${String(routine.everyMinutes)} min`
}

export function formatWorkMapRoutineTime(value: string | undefined): string {
  if (!value) return 'No next run'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Invalid time'
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short'
  }).format(date)
}

export function workMapBotScheduleLabel(
  workMap: AgentWorkMap | null,
  bot: AgentWorkMapBot
): string {
  const next = workMapRoutinesForBot(workMap, bot.id).find(
    (routine) => routine.enabled && routine.nextRunAt
  )
  return next
    ? `${workMapRoutineCadence(next)} · ${formatWorkMapRoutineTime(next.nextRunAt)}`
    : 'No schedule'
}

export function defaultWorkMapRoutineFirstRun(now = Date.now()): string {
  const date = new Date(now + 60 * 60 * 1_000)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function workMapRoutineIntervalMinutes(repeat: WorkMapRoutineRepeat): number | undefined {
  if (repeat === 'hourly') return 60
  if (repeat === 'daily') return 1_440
  if (repeat === 'weekly') return 10_080
  return undefined
}
