import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  readAgentWorkspaceFile,
  searchAgentWorkspaceFiles
} from '#mcp/agent-router/workspace-files'

test('workspace file search is bounded, ranked, and skips generated directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-workspace-search-'))
  try {
    await mkdir(path.join(root, 'src', 'components'), { recursive: true })
    await mkdir(path.join(root, 'node_modules', 'hidden'), { recursive: true })
    await writeFile(path.join(root, 'src', 'components', 'ChatComposer.vue'), 'export {}')
    await writeFile(path.join(root, 'src', 'chat.ts'), 'export {}')
    await writeFile(path.join(root, 'node_modules', 'hidden', 'chat.js'), 'ignored')

    const files = await searchAgentWorkspaceFiles(root, 'chat', 10)
    expect(files.map((file) => file.path)).toEqual([
      'src/chat.ts',
      'src/components/ChatComposer.vue'
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('workspace file reads stay inside the workspace and reject binary content', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'openpencil-workspace-read-'))
  try {
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(path.join(root, 'src', 'app.ts'), 'export const ready = true\n')
    await writeFile(path.join(root, 'binary.dat'), new Uint8Array([1, 0, 2]))

    expect(await readAgentWorkspaceFile(root, 'src/app.ts')).toMatchObject({
      content: 'export const ready = true\n',
      path: 'src/app.ts',
      truncated: false
    })
    await expect(readAgentWorkspaceFile(root, '../outside.ts')).rejects.toThrow()
    await expect(readAgentWorkspaceFile(root, 'binary.dat')).rejects.toThrow(
      'Binary files cannot be previewed'
    )
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
