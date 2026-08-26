import { afterEach, describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  captureTurnWorkspaceSnapshot,
  parseGitNameStatus,
  parseGitNumstat,
  resolveTurnWorkspaceChanges
} from '#mcp/pi/turn-changes'

const temporaryDirectories: string[] = []

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  )
})

describe('turn changes', () => {
  test('parses nul-delimited Git status and rename stats', () => {
    expect(parseGitNameStatus('M\0src/a.ts\0R100\0src/old.ts\0src/new.ts\0')).toEqual([
      { path: 'src/a.ts', status: 'modified' },
      { path: 'src/new.ts', previousPath: 'src/old.ts', status: 'renamed' }
    ])
    expect(
      parseGitNumstat(['2\t1\tsrc/a.ts', '0\t0\t', 'src/old.ts', 'src/new.ts', ''].join('\0'))
    ).toEqual(
      new Map([
        ['src/a.ts', { additions: 2, deletions: 1 }],
        ['src/new.ts', { additions: 0, deletions: 0 }]
      ])
    )
  })

  test('captures only the files changed during one turn', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openpencil-turn-changes-test-'))
    temporaryDirectories.push(directory)
    await git(directory, ['init', '--quiet'])
    await git(directory, ['config', 'user.email', 'openpencil@example.com'])
    await git(directory, ['config', 'user.name', 'OpenPencil Test'])
    await writeFile(join(directory, 'app.ts'), 'const one = 1\n')
    await writeFile(join(directory, 'deleted.ts'), 'remove me\n')
    await writeFile(join(directory, 'old-name.ts'), 'export const stableName = true\n')
    await git(directory, ['add', '.'])
    await git(directory, ['commit', '--quiet', '-m', 'baseline'])

    // Pre-existing dirt must not be attributed to the agent turn.
    await writeFile(join(directory, 'before.ts'), 'already dirty\n')
    const snapshot = await captureTurnWorkspaceSnapshot(directory)
    expect(snapshot).not.toBeNull()

    await writeFile(join(directory, 'app.ts'), 'const one = 1\nconst two = 2\n')
    await writeFile(join(directory, 'added.ts'), 'first\nsecond\n')
    await unlink(join(directory, 'deleted.ts'))
    await rename(join(directory, 'old-name.ts'), join(directory, 'new-name.ts'))

    const changes = snapshot
      ? await resolveTurnWorkspaceChanges(snapshot, '2026-08-25T12:00:00.000Z')
      : null
    expect(changes).not.toBeNull()
    expect(changes?.capturedAt).toBe('2026-08-25T12:00:00.000Z')
    expect(changes?.additions).toBe(3)
    expect(changes?.deletions).toBe(1)
    expect(changes?.files.map((file) => file.path)).not.toContain('before.ts')
    expect(changes?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ additions: 2, path: 'added.ts', status: 'added' }),
        expect.objectContaining({ additions: 1, path: 'app.ts', status: 'modified' }),
        expect.objectContaining({ deletions: 1, path: 'deleted.ts', status: 'deleted' }),
        expect.objectContaining({
          path: 'new-name.ts',
          previousPath: 'old-name.ts',
          status: 'renamed'
        })
      ])
    )
    expect(changes?.files.find((file) => file.path === 'app.ts')?.patch).toContain('+const two')
  })
})
