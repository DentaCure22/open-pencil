import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BATCH_PREFIX = 'batch-'
const LEASE_FILE = '.lease.json'
const PENDING_ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1_000

type AttachmentLease = {
  createdAt: string
  ownerThreadIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function attachmentPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(attachmentPaths)
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(attachmentPaths)
}

function parseLease(value: unknown): AttachmentLease | null {
  if (!isRecord(value) || typeof value.createdAt !== 'string') return null
  if (!Array.isArray(value.ownerThreadIds)) return null
  const ownerThreadIds = value.ownerThreadIds.filter(
    (candidate): candidate is string => typeof candidate === 'string' && Boolean(candidate.trim())
  )
  return { createdAt: value.createdAt, ownerThreadIds: [...new Set(ownerThreadIds)] }
}

export class AgentAttachmentStore {
  readonly root: string

  constructor(authorityRoot: string) {
    this.root = path.resolve(authorityRoot, 'agent-attachments')
  }

  async createBatchDirectory(createdAt = new Date().toISOString()): Promise<string> {
    const directory = path.join(this.root, `${BATCH_PREFIX}${randomUUID()}`)
    await mkdir(directory, { recursive: true })
    await this.writeLease(directory, { createdAt, ownerThreadIds: [] })
    return directory
  }

  async claim(threadId: string, value: unknown): Promise<void> {
    if (!threadId.trim()) return
    for (const directory of this.batchDirectories(value)) {
      const lease = await this.readLease(directory)
      if (!lease || lease.ownerThreadIds.includes(threadId)) continue
      await this.writeLease(directory, {
        ...lease,
        ownerThreadIds: [...lease.ownerThreadIds, threadId]
      })
    }
  }

  async discardPending(value: unknown): Promise<void> {
    for (const directory of this.batchDirectories(value)) {
      const lease = await this.readLease(directory)
      if (lease?.ownerThreadIds.length === 0) {
        await rm(directory, { force: true, recursive: true })
      }
    }
  }

  async discardDirectory(directory: string): Promise<void> {
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== this.root || !path.basename(resolved).startsWith(BATCH_PREFIX)) {
      return
    }
    await rm(resolved, { force: true, recursive: true })
  }

  async releaseThread(threadId: string): Promise<void> {
    for (const directory of await this.directories()) {
      const lease = await this.readLease(directory)
      if (!lease?.ownerThreadIds.includes(threadId)) continue
      const ownerThreadIds = lease.ownerThreadIds.filter((candidate) => candidate !== threadId)
      if (ownerThreadIds.length) {
        await this.writeLease(directory, { ...lease, ownerThreadIds })
      } else {
        await rm(directory, { force: true, recursive: true })
      }
    }
  }

  async prunePending(now = Date.now(), maximumAgeMs = PENDING_ATTACHMENT_TTL_MS): Promise<number> {
    return this.prune(null, now, maximumAgeMs)
  }

  async reconcile(
    activeThreadIds: readonly string[],
    now = Date.now(),
    maximumAgeMs = PENDING_ATTACHMENT_TTL_MS
  ): Promise<number> {
    return this.prune(new Set(activeThreadIds), now, maximumAgeMs)
  }

  private async prune(
    activeThreadIds: ReadonlySet<string> | null,
    now: number,
    maximumAgeMs: number
  ): Promise<number> {
    let removed = 0
    for (const directory of await this.directories()) {
      const lease = await this.readLease(directory)
      if (lease?.ownerThreadIds.length) {
        if (!activeThreadIds) continue
        const ownerThreadIds = lease.ownerThreadIds.filter((threadId) =>
          activeThreadIds.has(threadId)
        )
        if (ownerThreadIds.length === lease.ownerThreadIds.length) continue
        if (ownerThreadIds.length) {
          await this.writeLease(directory, { ...lease, ownerThreadIds })
          continue
        }
        await rm(directory, { force: true, recursive: true })
        removed += 1
        continue
      }
      const directoryStat = await lstat(directory).catch(() => null)
      const createdAt = lease ? Date.parse(lease.createdAt) : directoryStat?.mtimeMs
      if (createdAt === undefined || !Number.isFinite(createdAt)) continue
      if (now - createdAt < maximumAgeMs) continue
      await rm(directory, { force: true, recursive: true })
      removed += 1
    }
    return removed
  }

  private batchDirectories(value: unknown): string[] {
    const directories = attachmentPaths(value).flatMap((candidate) => {
      const relative = path.relative(this.root, path.resolve(candidate))
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return []
      const batchName = relative.split(path.sep)[0]
      if (!batchName?.startsWith(BATCH_PREFIX)) return []
      return [path.join(this.root, batchName)]
    })
    return [...new Set(directories)]
  }

  private async directories(): Promise<string[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(BATCH_PREFIX))
      .map((entry) => path.join(this.root, entry.name))
  }

  private async readLease(directory: string): Promise<AttachmentLease | null> {
    try {
      return parseLease(
        JSON.parse(await readFile(path.join(directory, LEASE_FILE), 'utf8')) as unknown
      )
    } catch {
      return null
    }
  }

  private async writeLease(directory: string, lease: AttachmentLease): Promise<void> {
    const target = path.join(directory, LEASE_FILE)
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(lease, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    await rename(temporary, target)
  }
}
