type AgentJobState = 'completed' | 'failed' | 'queued' | 'running' | 'stopped'

export type AgentJobRecord = {
  createdAt: string
  jobId: string
  response: string
  state: AgentJobState
  threadId: string
  updatedAt: string
}

const MAX_TRACKED_JOBS = 200

export class AgentJobTracker {
  private readonly jobs = new Map<string, AgentJobRecord>()

  job(jobId: string): AgentJobRecord | null {
    const record = this.jobs.get(jobId)
    return record ? structuredClone(record) : null
  }

  register(jobId: string, threadId: string, state: 'queued' | 'running'): void {
    const now = new Date().toISOString()
    const existing = this.jobs.get(jobId)
    this.jobs.set(jobId, {
      createdAt: existing?.createdAt ?? now,
      jobId,
      response: '',
      state,
      threadId,
      updatedAt: now
    })
    if (this.jobs.size <= MAX_TRACKED_JOBS) return
    for (const key of this.jobs.keys()) {
      if (this.jobs.size <= MAX_TRACKED_JOBS) break
      this.jobs.delete(key)
    }
  }

  settle(jobId: string, state: 'completed' | 'failed' | 'stopped', response: string): void {
    const record = this.jobs.get(jobId)
    if (!record || (record.state !== 'queued' && record.state !== 'running')) return
    record.response = response
    record.state = state
    record.updatedAt = new Date().toISOString()
  }
}
