import { open, readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

const IGNORED_DIRECTORIES = new Set([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'outputs',
  'target'
])
const MAX_SCANNED_ENTRIES = 20_000
const MAX_FILE_BYTES = 1_000_000

export type AgentWorkspaceFile = {
  path: string
}

export type AgentWorkspaceFileContents = {
  bytes: number
  content: string
  path: string
  truncated: boolean
}

async function resolvedWorkspaceFile(workspaceRoot: string, relativePath: string): Promise<string> {
  if (!relativePath.trim() || path.isAbsolute(relativePath))
    throw new Error('Invalid workspace path')
  const root = await realpath(workspaceRoot)
  const candidate = await realpath(path.resolve(root, relativePath))
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw new Error('Workspace path escapes the workspace')
  }
  const details = await stat(candidate)
  if (!details.isFile()) throw new Error('Workspace path is not a file')
  return candidate
}

export async function readAgentWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  maxBytes = MAX_FILE_BYTES
): Promise<AgentWorkspaceFileContents> {
  const filePath = await resolvedWorkspaceFile(workspaceRoot, relativePath)
  const details = await stat(filePath)
  const boundedBytes = Math.max(1, Math.min(MAX_FILE_BYTES, Math.floor(maxBytes)))
  const bytesToRead = Math.min(details.size, boundedBytes)
  const handle = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytesToRead)
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0)
    const contents = buffer.subarray(0, bytesRead)
    if (contents.includes(0)) throw new Error('Binary files cannot be previewed')
    return {
      bytes: details.size,
      content: contents.toString('utf8'),
      path: relativePath.split(path.sep).join('/'),
      truncated: details.size > bytesRead
    }
  } finally {
    await handle.close()
  }
}

function pathScore(value: string, query: string): number {
  if (!query) return value.split('/').length * 20 + value.length
  const lower = value.toLowerCase()
  const base = path.basename(lower)
  if (base === query) return 0
  if (base.startsWith(query)) return 1
  if (lower.startsWith(query)) return 2
  const baseIndex = base.indexOf(query)
  if (baseIndex !== -1) return 10 + baseIndex
  const pathIndex = lower.indexOf(query)
  return pathIndex !== -1 ? 40 + pathIndex : Number.POSITIVE_INFINITY
}

export async function searchAgentWorkspaceFiles(
  workspaceRoot: string,
  queryInput: string,
  limitInput = 24
): Promise<AgentWorkspaceFile[]> {
  const query = queryInput.trim().toLowerCase()
  const limit = Math.max(1, Math.min(250, Math.floor(limitInput)))
  const queue = ['']
  const matches: Array<{ path: string; score: number }> = []
  let scanned = 0

  while (queue.length && scanned < MAX_SCANNED_ENTRIES) {
    const relativeDirectory = queue.shift() ?? ''
    const directory = path.join(workspaceRoot, relativeDirectory)
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      scanned += 1
      if (scanned > MAX_SCANNED_ENTRIES) break
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory.split(path.sep).join('/'), entry.name)
        : entry.name
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) queue.push(relativePath)
        continue
      }
      if (!entry.isFile() || entry.name === '.DS_Store') continue
      const score = pathScore(relativePath, query)
      if (Number.isFinite(score)) matches.push({ path: relativePath, score })
    }
  }

  return matches
    .sort((left, right) => left.score - right.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map(({ path: relativePath }) => ({ path: relativePath }))
}
