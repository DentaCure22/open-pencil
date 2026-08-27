import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'

import { botCharterKey, botCharterPath } from './bot-charter'
import type { AgentConversationRouter } from './contracts'
import type { WorkMapStore } from './work-map'

const BACKUP_CONTRACT = 'openpencil-bot-backup/v1'
const BACKUP_DIRECTORY = path.join('backups', 'bot-routine-history-v1')
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1_000
const DEFAULT_RETENTION_SNAPSHOTS = 30
const SNAPSHOT_DIRECTORY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

type BackupFileRecord = {
  bytes: number
  path: string
  sha256: string
}

type BackupBotRecord = {
  botId: string
  sessionId?: string
  threadId: string
}

type BotBackupManifest = {
  bots: BackupBotRecord[]
  contract: typeof BACKUP_CONTRACT
  createdAt: string
  date: string
  files: BackupFileRecord[]
  missing: string[]
}

export type BotBackupResult = {
  botCount: number
  date: string
  fileCount: number
  path: string
}

type BotBackupRouter = Pick<AgentConversationRouter, 'conversation'>

type BotBackupOptions = {
  autoStart?: boolean
  checkIntervalMs?: number
  retentionSnapshots?: number
}

function localDateKey(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function completeJsonLines(source: string): string {
  const complete: string[] = []
  for (const line of source.split('\n')) {
    if (!line.trim()) continue
    try {
      JSON.parse(line)
      complete.push(line)
    } catch {
      break
    }
  }
  return complete.length ? `${complete.join('\n')}\n` : ''
}

function latestSessionFile(authorityRoot: string, sessionId: string): string | null {
  const directory = path.join(authorityRoot, 'pi-sessions')
  try {
    return (
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`))
        .map((entry) => entry.name)
        .sort()
        .at(-1) ?? null
    )
  } catch {
    return null
  }
}

function writeBackupFile(
  snapshotRoot: string,
  relativePath: string,
  content: string
): BackupFileRecord {
  const destination = path.join(snapshotRoot, relativePath)
  mkdirSync(path.dirname(destination), { mode: 0o700, recursive: true })
  writeFileSync(destination, content, { mode: 0o600 })
  const bytes = Buffer.from(content)
  return { bytes: bytes.byteLength, path: relativePath, sha256: sha256(bytes) }
}

function verifyBackupFiles(snapshotRoot: string, files: readonly BackupFileRecord[]): void {
  for (const file of files) {
    const bytes = readFileSync(path.join(snapshotRoot, file.path))
    if (bytes.byteLength !== file.bytes || sha256(bytes) !== file.sha256) {
      throw new Error(`Bot backup verification failed for "${file.path}".`)
    }
  }
}

export class BotBackupService {
  private readonly backupRoot: string
  private readonly retentionSnapshots: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly authorityRoot: string,
    private readonly workMap: Pick<WorkMapStore, 'snapshot'>,
    private readonly router: BotBackupRouter,
    options: BotBackupOptions = {}
  ) {
    this.backupRoot = path.join(authorityRoot, BACKUP_DIRECTORY)
    this.retentionSnapshots = Math.max(
      1,
      Math.min(365, Math.trunc(options.retentionSnapshots ?? DEFAULT_RETENTION_SNAPSHOTS))
    )
    if (options.autoStart === false) return
    this.snapshotWithoutThrowing()
    this.timer = setInterval(
      () => this.snapshotWithoutThrowing(),
      Math.max(60_000, options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS)
    )
    this.timer.unref()
  }

  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  snapshotIfDue(now = new Date()): BotBackupResult | null {
    const snapshot = this.workMap.snapshot()
    if (!snapshot.bots.length) return null
    const date = localDateKey(now)
    const destination = path.join(this.backupRoot, date)
    if (existsSync(destination)) return null
    mkdirSync(this.backupRoot, { mode: 0o700, recursive: true })
    const temporary = path.join(this.backupRoot, `.${date}.${randomUUID()}.tmp`)
    mkdirSync(temporary, { mode: 0o700 })

    try {
      const files = new Map<string, BackupFileRecord>()
      const missing: string[] = []
      const bots: BackupBotRecord[] = []
      const workMapContent = `${JSON.stringify({ ...snapshot, requests: [] }, null, 2)}\n`
      const workMapFile = writeBackupFile(temporary, 'work-map.json', workMapContent)
      files.set(workMapFile.path, workMapFile)

      for (const bot of snapshot.bots) {
        const charterSource = botCharterPath(this.authorityRoot, bot.id)
        if (existsSync(charterSource)) {
          const charterPath = path.posix.join('bot-charters', botCharterKey(bot.id), 'AGENTS.md')
          const charterFile = writeBackupFile(
            temporary,
            charterPath,
            readFileSync(charterSource, 'utf8')
          )
          files.set(charterFile.path, charterFile)
        } else {
          missing.push(`charter:${bot.id}`)
        }
        const thread = this.router.conversation(bot.threadId)
        if (!thread) {
          bots.push({ botId: bot.id, threadId: bot.threadId })
          missing.push(`conversation:${bot.threadId}`)
          continue
        }
        const botRecord: BackupBotRecord = {
          botId: bot.id,
          ...(thread.sessionId ? { sessionId: thread.sessionId } : {}),
          threadId: bot.threadId
        }
        bots.push(botRecord)
        const conversationPath = path.posix.join(
          'conversations',
          `${encodeURIComponent(bot.threadId)}.json`
        )
        if (!files.has(conversationPath)) {
          const conversationFile = writeBackupFile(
            temporary,
            conversationPath,
            `${JSON.stringify(thread, null, 2)}\n`
          )
          files.set(conversationFile.path, conversationFile)
        }
        if (!thread.sessionId) continue
        const sessionFileName = latestSessionFile(this.authorityRoot, thread.sessionId)
        if (!sessionFileName) {
          missing.push(`session:${thread.sessionId}`)
          continue
        }
        const sessionPath = path.posix.join('sessions', sessionFileName)
        if (files.has(sessionPath)) continue
        const sessionContent = completeJsonLines(
          readFileSync(path.join(this.authorityRoot, 'pi-sessions', sessionFileName), 'utf8')
        )
        if (!sessionContent) {
          missing.push(`session:${thread.sessionId}`)
          continue
        }
        const sessionFile = writeBackupFile(temporary, sessionPath, sessionContent)
        files.set(sessionFile.path, sessionFile)
      }

      const fileRecords = [...files.values()].sort((left, right) =>
        left.path.localeCompare(right.path)
      )
      verifyBackupFiles(temporary, fileRecords)
      const manifest: BotBackupManifest = {
        bots,
        contract: BACKUP_CONTRACT,
        createdAt: now.toISOString(),
        date,
        files: fileRecords,
        missing
      }
      writeBackupFile(temporary, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
      renameSync(temporary, destination)
      this.pruneSnapshots()
      return {
        botCount: bots.length,
        date,
        fileCount: fileRecords.length,
        path: destination
      }
    } catch (error) {
      rmSync(temporary, { force: true, recursive: true })
      throw error
    }
  }

  private pruneSnapshots(): void {
    const snapshots = readdirSync(this.backupRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && SNAPSHOT_DIRECTORY_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse()
    for (const name of snapshots.slice(this.retentionSnapshots)) {
      rmSync(path.join(this.backupRoot, name), { force: true, recursive: true })
    }
  }

  private snapshotWithoutThrowing(): void {
    try {
      this.snapshotIfDue()
    } catch (error) {
      console.warn('Daily Bot backup failed.', error)
    }
  }
}
