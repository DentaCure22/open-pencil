import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Context, Hono, Next } from 'hono'

import { bearerToken, isAuthorized } from '#mcp/auth'

import { isVisionImage } from './paths'
import { AgentAttachmentStore } from './store'
import { createVideoContactSheet, isVideoAttachment } from './video'

const ROUTE = '/agent-router/v1/attachments'
const MAX_ATTACHMENTS = 5
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 250 * 1024 * 1024

export function agentAttachmentLimitError(files: ReadonlyArray<{ size: number }>): string | null {
  if (!files.length || files.length > MAX_ATTACHMENTS) {
    return 'Attach between one and five files.'
  }
  if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
    return 'Each attachment must be 100 MB or smaller.'
  }
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    return 'Attachments must be 250 MB or smaller in total.'
  }
  return null
}

function safeFileName(name: string) {
  const cleaned = path.basename(name).replaceAll(/[^a-zA-Z0-9._-]/g, '-')
  return cleaned || 'attachment'
}

type AgentAttachmentVisual = {
  durationSeconds?: number
  frameCount?: number
  imagePaths: string[]
  intervalSeconds?: number
  kind: 'image' | 'video-frames'
  summary: string
}

async function prepareAttachmentVisual(input: {
  ffmpegExecutable?: string | null
  filePath: string
  id: string
  mimeType: string
  name: string
  outputDirectory: string
}): Promise<AgentAttachmentVisual | undefined> {
  if (isVisionImage(input.name, input.mimeType)) {
    return {
      imagePaths: [input.filePath],
      kind: 'image',
      summary: 'Image attached directly to the model.'
    }
  }
  if (!isVideoAttachment(input.name, input.mimeType)) return undefined
  if (!input.ffmpegExecutable) {
    return {
      imagePaths: [],
      kind: 'video-frames',
      summary:
        'Automatic frame sampling is unavailable. Inspect the original video before making visual claims.'
    }
  }
  const contactSheet = await createVideoContactSheet({
    ffmpegExecutable: input.ffmpegExecutable,
    outputPath: path.join(input.outputDirectory, `${input.id}-video-contact-sheet.jpg`),
    videoPath: input.filePath
  })
  if (!contactSheet) {
    return {
      imagePaths: [],
      kind: 'video-frames',
      summary:
        'Automatic frame sampling failed. Inspect the original video before making visual claims.'
    }
  }
  return {
    durationSeconds: contactSheet.durationSeconds,
    frameCount: contactSheet.frameCount,
    imagePaths: [contactSheet.path],
    intervalSeconds: contactSheet.intervalSeconds,
    kind: 'video-frames',
    summary: `${String(contactSheet.frameCount)} representative frames across ${contactSheet.durationSeconds.toFixed(1)} seconds, ordered left-to-right and top-to-bottom.`
  }
}

export function registerAgentAttachmentRoutes(
  app: Hono,
  options: {
    authorityRoot: string
    ffmpegExecutable?: string | null
    getAuthToken(): string | null
    store?: AgentAttachmentStore
  }
): void {
  const store = options.store ?? new AgentAttachmentStore(options.authorityRoot)
  app.use(`${ROUTE}/*`, async (c: Context, next: Next) => {
    const expected = options.getAuthToken()
    if (!expected) return c.json({ error: 'Router unavailable' }, 503)
    if (!isAuthorized(bearerToken(c.req.header('authorization')), expected)) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })

  app.post(ROUTE, async (c) => {
    const body = await c.req.parseBody({ all: true })
    const values = body.files
    const files = (Array.isArray(values) ? values : [values]).filter(
      (value): value is File => value instanceof File
    )
    const limitError = agentAttachmentLimitError(files)
    if (limitError) return c.json({ error: limitError }, 422)
    await store.prunePending()
    const directory = await store.createBatchDirectory()
    const attachments: Array<{
      name: string
      path: string
      size: number
      type: string
      visual?: AgentAttachmentVisual
    }> = []
    try {
      for (const file of files) {
        const id = randomUUID()
        const name = path.basename(file.name.replaceAll('\\', '/')) || 'attachment'
        const filePath = path.join(directory, `${id}-${safeFileName(name)}`)
        await writeFile(filePath, new Uint8Array(await file.arrayBuffer()))
        const visual = await prepareAttachmentVisual({
          ffmpegExecutable: options.ffmpegExecutable,
          filePath,
          id,
          mimeType: file.type,
          name,
          outputDirectory: directory
        })
        attachments.push({
          name,
          path: filePath,
          size: file.size,
          type: file.type,
          ...(visual ? { visual } : {})
        })
      }
      return c.json({ attachments }, 201)
    } catch (error) {
      await store.discardDirectory(directory)
      throw error
    }
  })
}
