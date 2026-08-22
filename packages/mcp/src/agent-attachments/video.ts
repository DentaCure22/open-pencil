import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'

const MAX_CONTACT_SHEET_FRAMES = 20
const MIN_CONTACT_SHEET_FRAMES = 4
const CONTACT_SHEET_COLUMNS = 5
const FFMPEG_TIMEOUT_MS = 90_000
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm'])

export type VideoContactSheet = {
  durationSeconds: number
  frameCount: number
  intervalSeconds: number
  path: string
}

type ProcessResult = {
  code: number | null
  stderr: string
  timedOut: boolean
}

export function isVideoAttachment(name: string, mimeType: string): boolean {
  if (mimeType.toLowerCase().startsWith('video/')) return true
  const extension = path.extname(name).slice(1).toLowerCase()
  return VIDEO_EXTENSIONS.has(extension)
}

export function parseVideoDuration(value: string): number | null {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(value)
  if (!match) return null
  const hours = Number.parseInt(match[1], 10)
  const minutes = Number.parseInt(match[2], 10)
  const seconds = Number.parseFloat(match[3])
  const duration = hours * 3_600 + minutes * 60 + seconds
  return Number.isFinite(duration) && duration > 0 ? duration : null
}

export function videoContactSheetPlan(durationSeconds: number): {
  columns: number
  fps: number
  frameCount: number
  intervalSeconds: number
  rows: number
} {
  const frameCount = Math.min(
    MAX_CONTACT_SHEET_FRAMES,
    Math.max(MIN_CONTACT_SHEET_FRAMES, Math.ceil(durationSeconds * 2))
  )
  const columns = Math.min(CONTACT_SHEET_COLUMNS, frameCount)
  return {
    columns,
    fps: frameCount / durationSeconds,
    frameCount,
    intervalSeconds: durationSeconds / frameCount,
    rows: Math.ceil(frameCount / columns)
  }
}

export function resolveFfmpegExecutable(
  env: NodeJS.ProcessEnv = process.env,
  agentExecutable?: string
): string | null {
  const explicit = env.OPENPENCIL_FFMPEG_PATH?.trim()
  const candidates = [
    explicit,
    agentExecutable && path.isAbsolute(agentExecutable)
      ? path.join(path.dirname(agentExecutable), 'ffmpeg')
      : null,
    path.join(path.dirname(process.execPath), 'ffmpeg'),
    ...(env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((directory) => path.join(directory, 'ffmpeg'))
  ]
  return (
    candidates.find((candidate): candidate is string =>
      Boolean(candidate && existsSync(candidate))
    ) ?? null
  )
}

async function runProcess(executable: string, arguments_: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(executable, arguments_, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill()
    }, FFMPEG_TIMEOUT_MS)
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 256 * 1_024) stderr += chunk.toString('utf8')
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      resolve({ code: null, stderr: error.message, timedOut })
    })
    child.once('close', (code) => {
      clearTimeout(timeout)
      resolve({ code, stderr, timedOut })
    })
  })
}

export async function createVideoContactSheet(input: {
  ffmpegExecutable: string
  outputPath: string
  videoPath: string
}): Promise<VideoContactSheet | null> {
  const probe = await runProcess(input.ffmpegExecutable, ['-hide_banner', '-i', input.videoPath])
  if (probe.timedOut) return null
  const durationSeconds = parseVideoDuration(probe.stderr)
  if (!durationSeconds) return null
  const plan = videoContactSheetPlan(durationSeconds)
  const filter = [
    `fps=${String(plan.fps)}`,
    'scale=320:-2',
    `tile=${String(plan.columns)}x${String(plan.rows)}:nb_frames=${String(plan.frameCount)}:padding=4:margin=4:color=black`
  ].join(',')
  const result = await runProcess(input.ffmpegExecutable, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input.videoPath,
    '-vf',
    filter,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    '-y',
    input.outputPath
  ])
  if (result.code !== 0 || result.timedOut) return null
  const output = await stat(input.outputPath).catch(() => null)
  if (!output?.isFile() || output.size === 0) return null
  return {
    durationSeconds,
    frameCount: plan.frameCount,
    intervalSeconds: plan.intervalSeconds,
    path: input.outputPath
  }
}
