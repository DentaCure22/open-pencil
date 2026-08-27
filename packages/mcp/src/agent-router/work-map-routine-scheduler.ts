import { createInboxBriefingReport } from '@open-pencil/core/code-object'

import type { AgentConversationRouter } from './contracts'
import type { AgentJobRecord } from './jobs'
import type { WorkMapInboxItem, WorkMapStore } from './work-map'

const DEFAULT_INTERVAL_MS = 30_000
const RUN_TIMEOUT_MS = 24 * 60 * 60 * 1_000

export const INBOX_BRIEFING_RUN_INSTRUCTIONS = `

This successful run will become a read-only Inbox briefing Code Object. Structure the final response so it can be rendered as a useful document:
# <specific briefing title>
<one or two sentence summary>
## <section>
- **<item title>** — <short factual detail>
Use only the sections the result needs. Keep exact names, dates, amounts, statuses, and sources. Do not return JSON, HTML, or a table.`

function routineRunPrompt(prompt: string, briefingObject: boolean | undefined): string {
  return briefingObject ? `${prompt.trim()}${INBOX_BRIEFING_RUN_INSTRUCTIONS}` : prompt
}

function inboxSummary(job: AgentJobRecord | null): string {
  if (!job) return 'The scheduled run ended without a job result.'
  const response = job.response.trim()
  if (response) return response
  if (job.state === 'completed') return 'Scheduled work completed. Open the Bot chat for details.'
  if (job.state === 'stopped') return 'Scheduled work was stopped.'
  return 'Scheduled work failed before producing a response.'
}

function terminalInboxStatus(job: AgentJobRecord | null): 'completed' | 'failed' | 'stopped' {
  if (job?.state === 'completed') return 'completed'
  if (job?.state === 'stopped') return 'stopped'
  return 'failed'
}

function latestUserMessageId(
  messages: readonly { id: string; role: string }[]
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user') return message.id
  }
  return undefined
}

export type WorkMapRoutineRouter = Pick<
  AgentConversationRouter,
  'conversation' | 'followUp' | 'waitForJob'
>

export class WorkMapRoutineScheduler {
  private readonly active = new Map<string, Promise<void>>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly workMap: WorkMapStore,
    private readonly router: WorkMapRoutineRouter,
    options: { autoStart?: boolean; intervalMs?: number } = {}
  ) {
    if (options.autoStart === false) return
    this.timer = setInterval(() => void this.tick(), options.intervalMs ?? DEFAULT_INTERVAL_MS)
    this.timer.unref()
    void this.tick()
  }

  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  tick(now = new Date()): WorkMapInboxItem[] {
    return this.workMap.dueRoutineIds(now).flatMap((routineId) => {
      try {
        return [this.trigger(routineId, { now })]
      } catch {
        return []
      }
    })
  }

  runNow(routineId: string): WorkMapInboxItem {
    return this.trigger(routineId, { force: true })
  }

  async waitForIdle(): Promise<void> {
    await Promise.all(this.active.values())
  }

  private trigger(routineId: string, options: { force?: boolean; now?: Date }): WorkMapInboxItem {
    if (this.active.has(routineId)) throw new Error('This Bot routine is already running.')
    const item = this.workMap.beginRoutineRun(routineId, options)
    const execution = this.execute(item)
      .catch(() => undefined)
      .finally(() => this.active.delete(routineId))
    this.active.set(routineId, execution)
    return item
  }

  private async execute(item: WorkMapInboxItem): Promise<void> {
    let messageId: string | undefined
    try {
      const snapshot = this.workMap.snapshot()
      const routine = snapshot.routines.find((candidate) => candidate.id === item.routineId)
      const thread = this.router.conversation(item.threadId)
      if (!routine) throw new Error('The Bot routine was removed before it could run.')
      if (!thread) throw new Error('The Bot chat is no longer available.')
      if (thread.state === 'running') throw new Error('The Bot chat is already working.')
      const receipt = await this.router.followUp(
        thread.id,
        routineRunPrompt(routine.prompt, routine.briefingObject),
        {
          botId: routine.botId,
          effort: thread.effort,
          model: thread.model,
          toolScope: thread.toolScope
        }
      )
      messageId = latestUserMessageId(this.router.conversation(item.threadId)?.messages ?? [])
      const job = await this.router.waitForJob(receipt.jobId, RUN_TIMEOUT_MS)
      const summary = inboxSummary(job)
      const completedThread = this.router.conversation(item.threadId) ?? thread
      const completedAt = new Date()
      const briefingTitle = `${completedThread.title?.trim() || completedThread.task.trim() || 'Scheduled check'} briefing`
      const briefing =
        routine.briefingObject && job?.state === 'completed'
          ? {
              content: job.response.trim() || summary,
              id: `briefing:${item.id.slice('inbox:'.length)}`,
              report: createInboxBriefingReport(job.response.trim() || summary, {
                generatedAt: completedAt.toISOString(),
                title: briefingTitle.replace(/\s+briefing$/i, '')
              }),
              title: briefingTitle
            }
          : undefined
      this.workMap.completeRoutineRun(item.id, terminalInboxStatus(job), summary, completedAt, {
        ...(briefing ? { briefing } : {}),
        ...(messageId ? { messageId } : {})
      })
    } catch (error) {
      this.workMap.completeRoutineRun(
        item.id,
        'failed',
        error instanceof Error ? error.message : String(error),
        new Date(),
        messageId ? { messageId } : {}
      )
    }
  }
}
