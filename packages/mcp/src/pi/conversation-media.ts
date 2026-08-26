import { createHash, randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { link, lstat, mkdir, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { AgentConversationThread } from '#mcp/agent-router/contracts'
import { AGENT_MEDIA_ROUTE, agentMediaFileName, agentMediaMimeType } from '#mcp/agent-router/media'

const MEDIA_REFERENCE_PREFIX = 'openpencil-agent-media:'
const MAX_CONVERSATION_VIDEO_BYTES = 256 * 1024 * 1024

const MEDIA_EXTENSIONS: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
}

type MediaReference = { kind: 'image' | 'video'; value: { url: string } }

function mediaReferences(thread: AgentConversationThread): MediaReference[] {
  const references: MediaReference[] = []
  for (const message of thread.messages) {
    for (const part of message.parts ?? []) {
      if (part.type === 'image') references.push({ kind: 'image', value: part })
      if (part.type !== 'tool') continue
      references.push(
        ...(part.images ?? []).map((value) => ({
          kind: 'image' as const,
          value
        }))
      )
      references.push(
        ...(part.videos ?? []).map((value) => ({
          kind: 'video' as const,
          value
        }))
      )
    }
  }
  return references
}

function encodedImage(url: string): { data: Buffer; extension: string } | null {
  const match = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url)
  if (!match) return null
  const mimeType = match[1]
  const encoded = match[2]
  const extension = MEDIA_EXTENSIONS[mimeType]
  if (!extension || !encoded) return null
  return { data: Buffer.from(encoded, 'base64'), extension }
}

function localVideo(url: string): { extension: string; source: string } | null {
  if (!path.isAbsolute(url)) return null
  const extension = path.extname(url).slice(1).toLowerCase()
  const mimeType = agentMediaMimeType(`media.${extension}`)
  if (!mimeType?.startsWith('video/')) return null
  return { extension, source: url }
}

function referenceName(url: string): string | null {
  if (!url.startsWith(MEDIA_REFERENCE_PREFIX)) return null
  const name = url.slice(MEDIA_REFERENCE_PREFIX.length)
  return agentMediaFileName(name)
}

export class ConversationMediaStore {
  private readonly cache = new Map<string, string>()
  private readonly root: string | null

  constructor(historyPath?: string) {
    this.root = historyPath
      ? path.join(
          path.dirname(historyPath),
          `${path.basename(historyPath, path.extname(historyPath))}-media`
        )
      : null
  }

  externalize(thread: AgentConversationThread): boolean {
    if (!this.root) return false
    let changed = false
    for (const reference of mediaReferences(thread)) {
      if (reference.kind !== 'image') continue
      const media = encodedImage(reference.value.url)
      if (!media) continue
      const digest = createHash('sha256').update(media.data).digest('hex')
      const name = `${digest}.${media.extension}`
      const storedReference = `${MEDIA_REFERENCE_PREFIX}${name}`
      try {
        mkdirSync(this.root, { recursive: true })
        const destination = path.join(this.root, name)
        if (!existsSync(destination)) {
          const temporary = `${destination}.${randomUUID()}.tmp`
          try {
            writeFileSync(temporary, media.data, { flag: 'wx' })
            renameSync(temporary, destination)
          } finally {
            rmSync(temporary, { force: true })
          }
        }
        reference.value.url = storedReference
        changed = true
      } catch {
        continue
      }
    }
    return changed
  }

  async externalizeVideos(thread: AgentConversationThread): Promise<boolean> {
    if (!this.root) return false
    let changed = false
    const persisted = new Map<string, Promise<string | null>>()
    for (const reference of mediaReferences(thread)) {
      if (reference.kind !== 'video') continue
      const video = localVideo(reference.value.url)
      if (!video) continue
      const sourceUrl = reference.value.url
      let stored = persisted.get(sourceUrl)
      if (!stored) {
        stored = this.persistVideo(video)
        persisted.set(sourceUrl, stored)
      }
      const storedReference = await stored
      if (!storedReference || reference.value.url !== sourceUrl) continue
      reference.value.url = storedReference
      changed = true
    }
    return changed
  }

  async prune(threads: readonly AgentConversationThread[]): Promise<number> {
    if (!this.root) return 0
    const referenced = new Set(
      threads.flatMap((thread) =>
        mediaReferences(thread).flatMap((reference) => {
          const name = referenceName(reference.value.url)
          return name ? [name] : []
        })
      )
    )
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    let removed = 0
    for (const entry of entries) {
      if (!entry.isFile() || agentMediaFileName(entry.name) !== entry.name) continue
      if (referenced.has(entry.name)) continue
      await rm(path.join(this.root, entry.name), { force: true }).catch(() => undefined)
      this.cache.delete(`${MEDIA_REFERENCE_PREFIX}${entry.name}`)
      removed += 1
    }
    return removed
  }

  materialize(thread: AgentConversationThread): AgentConversationThread {
    const hydrated = structuredClone(thread)
    if (!this.root) return hydrated
    for (const reference of mediaReferences(hydrated)) {
      const name = referenceName(reference.value.url)
      if (!name) continue
      if (reference.kind === 'video') {
        reference.value.url = `${AGENT_MEDIA_ROUTE}/${name}`
        continue
      }
      const cached = this.cache.get(reference.value.url)
      if (cached) {
        reference.value.url = cached
        continue
      }
      const extension = path.extname(name).slice(1)
      const mimeType = Object.entries(MEDIA_EXTENSIONS).find(
        ([, value]) => value === extension
      )?.[0]
      if (!mimeType) continue
      try {
        const url = `data:${mimeType};base64,${readFileSync(path.join(this.root, name)).toString('base64')}`
        this.cache.set(reference.value.url, url)
        reference.value.url = url
      } catch {
        continue
      }
    }
    return hydrated
  }

  inputImagePaths(thread: AgentConversationThread): string[] {
    const root = this.root
    if (!root) return []
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index]
      if (message.role !== 'user') continue
      const paths = (message.parts ?? []).flatMap((part) => {
        if (part.type !== 'image') return []
        const name = referenceName(part.url)
        if (!name) return []
        const filePath = path.join(root, name)
        return existsSync(filePath) ? [filePath] : []
      })
      if (paths.length) return paths
    }
    return []
  }

  private async persistVideo(video: { extension: string; source: string }): Promise<string | null> {
    if (!this.root) return null
    const source = await lstat(video.source).catch(() => null)
    if (!source?.isFile() || source.size > MAX_CONVERSATION_VIDEO_BYTES) return null
    await mkdir(this.root, { recursive: true })
    const temporary = path.join(this.root, `.${randomUUID()}.tmp`)
    const digest = createHash('sha256')
    let bytes = 0
    try {
      await pipeline(
        createReadStream(video.source),
        async function* (chunks: AsyncIterable<Buffer | string>) {
          for await (const chunk of chunks) {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            bytes += data.byteLength
            if (bytes > MAX_CONVERSATION_VIDEO_BYTES) {
              throw new RangeError('Conversation video exceeds the persistence limit.')
            }
            digest.update(data)
            yield data
          }
        },
        createWriteStream(temporary, { flags: 'wx' })
      )
      const name = `${digest.digest('hex')}.${video.extension}`
      const destination = path.join(this.root, name)
      await link(temporary, destination).catch((error: unknown) => {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      })
      return `${MEDIA_REFERENCE_PREFIX}${name}`
    } catch {
      return null
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}
