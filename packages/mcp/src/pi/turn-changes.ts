import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  AgentConversationFileChange,
  AgentConversationTurnChanges
} from '#mcp/agent-router/contracts'

const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024
const MAX_CHANGED_FILES = 100
const MAX_FILE_PATCH_CHARS = 64 * 1024
const MAX_TOTAL_PATCH_CHARS = 192 * 1024

export type TurnWorkspaceSnapshot = {
  root: string
  tree: string
}

type NameStatusEntry = {
  path: string
  previousPath?: string
  status: AgentConversationFileChange['status']
}

type NumericStat = {
  additions: number
  deletions: number
}

function runGit(
  cwd: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {
        encoding: 'utf8',
        env: environment,
        maxBuffer: GIT_OUTPUT_LIMIT,
        windowsHide: true
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve(stdout)
      }
    )
  })
}

function normalizedStatus(value: string): AgentConversationFileChange['status'] {
  if (value.startsWith('A')) return 'added'
  if (value.startsWith('C')) return 'copied'
  if (value.startsWith('D')) return 'deleted'
  if (value.startsWith('R')) return 'renamed'
  return 'modified'
}

export function parseGitNameStatus(output: string): NameStatusEntry[] {
  const fields = output.split('\0')
  const entries: NameStatusEntry[] = []
  for (let index = 0; index < fields.length; ) {
    const rawStatus = fields[index++]
    if (!rawStatus) continue
    const status = normalizedStatus(rawStatus)
    if (status === 'renamed' || status === 'copied') {
      const previousPath = fields[index++]
      const path = fields[index++]
      if (path) entries.push({ path, ...(previousPath ? { previousPath } : {}), status })
      continue
    }
    const path = fields[index++]
    if (path) entries.push({ path, status })
  }
  return entries
}

function numericValue(value: string): number {
  if (value === '-') return 0
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function parseGitNumstat(output: string): Map<string, NumericStat> {
  const fields = output.split('\0')
  const stats = new Map<string, NumericStat>()
  for (let index = 0; index < fields.length; ) {
    const field = fields[index++]
    if (!field) continue
    const [rawAdditions = '0', rawDeletions = '0', inlinePath = ''] = field.split('\t')
    let path = inlinePath
    if (!path) {
      index += 1 // The pre-image path is not the path shown in the final tree.
      path = fields[index++] ?? ''
    }
    if (!path) continue
    stats.set(path, {
      additions: numericValue(rawAdditions),
      deletions: numericValue(rawDeletions)
    })
  }
  return stats
}

function clippedPatch(value: string, remaining: number): { patch?: string; truncated: boolean } {
  const maximum = Math.min(MAX_FILE_PATCH_CHARS, remaining)
  if (maximum <= 0) return { truncated: Boolean(value) }
  if (value.length <= maximum) {
    return value ? { patch: value, truncated: false } : { truncated: false }
  }
  const suffix = '\n… diff truncated'
  return {
    patch: `${value.slice(0, Math.max(0, maximum - suffix.length)).trimEnd()}${suffix}`,
    truncated: true
  }
}

async function filePatch(
  snapshot: TurnWorkspaceSnapshot,
  nextTree: string,
  entry: NameStatusEntry
): Promise<string> {
  const paths = entry.previousPath ? [entry.previousPath, entry.path] : [entry.path]
  const patch = await runGit(snapshot.root, [
    'diff-tree',
    '--no-commit-id',
    '--no-color',
    '--no-ext-diff',
    '--find-renames',
    '--patch',
    '--unified=3',
    '-r',
    snapshot.tree,
    nextTree,
    '--',
    ...paths
  ])
  return patch
}

export async function captureTurnWorkspaceSnapshot(
  workspaceRoot: string
): Promise<TurnWorkspaceSnapshot | null> {
  let scratchDirectory: string | null = null
  try {
    const root = (await runGit(workspaceRoot, ['rev-parse', '--show-toplevel'])).trim()
    if (!root) return null
    scratchDirectory = await mkdtemp(join(tmpdir(), 'openpencil-turn-'))
    const indexFile = join(scratchDirectory, 'index')
    const environment = { ...process.env, GIT_INDEX_FILE: indexFile }
    await runGit(root, ['read-tree', 'HEAD'], environment)
    await runGit(root, ['add', '-A', '--', '.'], environment)
    const tree = (await runGit(root, ['write-tree'], environment)).trim()
    return tree ? { root, tree } : null
  } catch {
    return null
  } finally {
    if (scratchDirectory) await rm(scratchDirectory, { force: true, recursive: true })
  }
}

export async function resolveTurnWorkspaceChanges(
  snapshot: TurnWorkspaceSnapshot,
  capturedAt = new Date().toISOString()
): Promise<AgentConversationTurnChanges | null> {
  const next = await captureTurnWorkspaceSnapshot(snapshot.root)
  if (!next || next.root !== snapshot.root || next.tree === snapshot.tree) return null
  try {
    const [nameStatus, numstat] = await Promise.all([
      runGit(snapshot.root, [
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        snapshot.tree,
        next.tree,
        '--'
      ]),
      runGit(snapshot.root, [
        'diff',
        '--numstat',
        '-z',
        '--find-renames',
        snapshot.tree,
        next.tree,
        '--'
      ])
    ])
    const entries = parseGitNameStatus(nameStatus)
    const stats = parseGitNumstat(numstat)
    const visibleEntries = entries.slice(0, MAX_CHANGED_FILES)
    let remainingPatchChars = MAX_TOTAL_PATCH_CHARS
    let truncated = entries.length > visibleEntries.length
    const files: AgentConversationFileChange[] = []
    for (const entry of visibleEntries) {
      const patchResult = clippedPatch(
        await filePatch(snapshot, next.tree, entry),
        remainingPatchChars
      )
      if (patchResult.patch) remainingPatchChars -= patchResult.patch.length
      truncated ||= patchResult.truncated
      const stat = stats.get(entry.path) ?? { additions: 0, deletions: 0 }
      files.push({
        ...entry,
        ...stat,
        ...(patchResult.patch ? { patch: patchResult.patch } : {})
      })
    }
    if (!files.length) return null
    return {
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      capturedAt,
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      files,
      ...(truncated ? { truncated: true } : {})
    }
  } catch {
    return null
  }
}
