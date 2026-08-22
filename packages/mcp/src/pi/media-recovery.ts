import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import type { AgentConversationMessage, AgentConversationThread } from '#mcp/agent-router/contracts'

import { imagePreviewFromPath } from './image-preview'

type MediaKind = 'image' | 'video'

type CompletedMediaJob = {
  createdAt: number
  finishedAt?: string
  id: string
  kind: MediaKind
  paths: string[]
  prompt: string
  serialized: string
}

type RecoverableMediaTool = {
  jobId: string
  kind: MediaKind
  message: AgentConversationMessage
  part: Extract<NonNullable<AgentConversationMessage['parts']>[number], { type: 'tool' }>
  prompt: string
}

type RecoveryTarget = RecoverableMediaTool

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function jobIdFromValue(value: unknown): string {
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const id = jobIdFromValue(candidate)
      if (id) return id
    }
    return ''
  }
  if (!isRecord(value)) return ''
  const direct = stringField(value.jobId)
  if (direct) return direct
  for (const candidate of Object.values(value)) {
    const id = jobIdFromValue(candidate)
    if (id) return id
  }
  return ''
}

function serializedJobId(value?: string): string {
  if (!value?.trim()) return ''
  try {
    return jobIdFromValue(JSON.parse(value) as unknown)
  } catch {
    return /"jobId"\s*:\s*"(?<id>[^"\\]+)"/.exec(value)?.groups?.id.trim() ?? ''
  }
}

function mediaToolPrompt(input?: string): string {
  if (!input?.trim()) return ''
  try {
    const parsed: unknown = JSON.parse(input)
    if (!isRecord(parsed)) return ''
    const source = isRecord(parsed.Arguments) ? parsed.Arguments : parsed
    return stringField(source.prompt)
  } catch {
    return ''
  }
}

function mediaToolKind(name: string): MediaKind | null {
  const normalized = name.trim().replaceAll('_', ' ').toLowerCase()
  if (normalized.includes('generate image') || normalized.includes('edit image')) return 'image'
  if (
    normalized.includes('generate video') ||
    normalized.includes('edit video') ||
    normalized.includes('extend video') ||
    normalized.includes('video gen') ||
    normalized.includes('grok video')
  ) {
    return 'video'
  }
  return null
}

function imagePaths(value: unknown): string[] {
  if (Array.isArray(value)) return [...new Set(value.flatMap(imagePaths))]
  if (!isRecord(value)) return []
  const paths = typeof value.path === 'string' && value.path.trim() ? [value.path.trim()] : []
  paths.push(...imagePaths(value.images))
  return [...new Set(paths)]
}

function videoPaths(value: unknown): string[] {
  if (!isRecord(value)) return []
  const candidates = [value.path, value.videoPath, value.outputPath]
  const paths = candidates.flatMap((candidate) =>
    typeof candidate === 'string' && /\.(?:mp4|ogv|webm)$/i.test(candidate.trim())
      ? [candidate.trim()]
      : []
  )
  paths.push(...videoPaths(value.video), ...videoPaths(value.result))
  return [...new Set(paths)]
}

function jobKind(value: unknown, result: Record<string, unknown>): MediaKind {
  const normalized = stringField(value).replaceAll('_', ' ').toLowerCase()
  return normalized.includes('video') || videoPaths(result).length ? 'video' : 'image'
}

function completedMediaJobs(jobDirectory: string): CompletedMediaJob[] {
  let names: string[]
  try {
    names = readdirSync(jobDirectory).filter((name) => name.endsWith('.json'))
  } catch {
    return []
  }
  return names
    .flatMap((name): CompletedMediaJob[] => {
      const filePath = path.join(jobDirectory, name)
      try {
        const serialized = readFileSync(filePath, 'utf8')
        const parsed: unknown = JSON.parse(serialized)
        if (!isRecord(parsed) || parsed.status !== 'completed') return []
        const prompt = stringField(parsed.prompt)
        const id = stringField(parsed.jobId)
        const result = isRecord(parsed.result) ? parsed.result : null
        if (!result) return []
        const kind = jobKind(parsed.kind, result)
        const paths = kind === 'video' ? videoPaths(result) : imagePaths(result)
        const createdAt = Date.parse(stringField(parsed.createdAt))
        if (!id || !prompt || !paths.length || !Number.isFinite(createdAt)) return []
        return [
          {
            createdAt,
            ...(typeof parsed.finishedAt === 'string' ? { finishedAt: parsed.finishedAt } : {}),
            id,
            kind,
            paths,
            prompt,
            serialized
          }
        ]
      } catch {
        return []
      }
    })
    .sort((left, right) => right.createdAt - left.createdAt)
}

function videoMimeType(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4':
      return 'video/mp4'
    case '.ogv':
      return 'video/ogg'
    case '.webm':
      return 'video/webm'
    default:
      return undefined
  }
}

function toolHasMedia(tool: RecoverableMediaTool): boolean {
  return tool.kind === 'image'
    ? Boolean(tool.part.images?.length)
    : Boolean(tool.part.videos?.length)
}

function recoveryTargets(threads: readonly AgentConversationThread[]): RecoveryTarget[] {
  const targets: RecoveryTarget[] = []
  for (const thread of threads) {
    for (const message of thread.messages) {
      if (message.role === 'user') continue
      for (const part of message.parts ?? []) {
        if (part.type !== 'tool') continue
        const kind = mediaToolKind(part.name)
        if (!kind) continue
        const prompt = mediaToolPrompt(part.input)
        if (!prompt) continue
        const target = {
          jobId: serializedJobId(part.output) || serializedJobId(part.input),
          kind,
          message,
          part,
          prompt
        }
        if (!toolHasMedia(target)) targets.push(target)
      }
    }
  }
  return targets
}

function claimedJobIds(threads: readonly AgentConversationThread[]): Set<string> {
  const claimed = new Set<string>()
  for (const thread of threads) {
    for (const message of thread.messages) {
      for (const part of message.parts ?? []) {
        if (part.type !== 'tool') continue
        const kind = mediaToolKind(part.name)
        if (!kind) continue
        const prompt = mediaToolPrompt(part.input)
        if (!prompt) continue
        const tool: RecoverableMediaTool = {
          jobId: serializedJobId(part.output) || serializedJobId(part.input),
          kind,
          message,
          part,
          prompt
        }
        if (tool.jobId && toolHasMedia(tool)) claimed.add(tool.jobId)
      }
    }
  }
  return claimed
}

function matchingJob(
  target: RecoveryTarget,
  jobs: readonly CompletedMediaJob[],
  claimed: ReadonlySet<string>
): CompletedMediaJob | null {
  if (!target.jobId || claimed.has(target.jobId)) return null
  return (
    jobs.find(
      (job) => job.id === target.jobId && job.kind === target.kind && job.prompt === target.prompt
    ) ?? null
  )
}

function attachRecoveredJob(target: RecoveryTarget, job: CompletedMediaJob): boolean {
  const { kind } = target
  if (kind === 'image') {
    const previews = job.paths.flatMap((imagePath) => {
      const preview = imagePreviewFromPath(imagePath, 'Generated image')
      return preview ? [preview] : []
    })
    if (!previews.length) return false
    target.part.images = previews
  } else {
    target.part.videos = job.paths.map((videoPath) => ({
      ...(videoMimeType(videoPath) ? { mimeType: videoMimeType(videoPath) } : {}),
      name: path.basename(videoPath),
      url: videoPath
    }))
  }
  target.part.output = job.serialized
  target.part.state = 'success'
  if (!target.message.completedAt && job.finishedAt) target.message.completedAt = job.finishedAt
  return true
}

function recoverTargets(
  targets: readonly RecoveryTarget[],
  jobs: readonly CompletedMediaJob[],
  claimed: Set<string>
): boolean {
  let changed = false
  for (const target of targets) {
    const job = matchingJob(target, jobs, claimed)
    if (!job) continue
    if (!attachRecoveredJob(target, job)) continue
    claimed.add(job.id)
    changed = true
  }
  return changed
}

export function recoverDurableMediaResults(
  value: AgentConversationThread | readonly AgentConversationThread[],
  jobDirectory = process.env.IMA2_JOB_DIR?.trim() || path.join(homedir(), '.ima2', 'codex-jobs')
): boolean {
  const jobs = completedMediaJobs(jobDirectory)
  if (!jobs.length) return false
  const threads = Array.isArray(value) ? value : [value]
  return recoverTargets(recoveryTargets(threads), jobs, claimedJobIds(threads))
}
