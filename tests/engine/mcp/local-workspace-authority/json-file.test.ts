import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  readSerializedJsonFile,
  writeJsonFile,
  writeJsonHistory,
  writeSerializedJsonFile
} from '#mcp/local-workspace-authority/json-file'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace JSON files', () => {
  test('writes compact JSON when space is 0 and pretty JSON by default', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-json-file-'))
    roots.push(root)
    const compactPath = path.join(root, 'compact.json')
    const prettyPath = path.join(root, 'pretty.json')
    const value = { nodes: [{ id: 'a', name: 'Card' }], revision: 1 }

    await writeJsonFile(compactPath, value, { space: 0 })
    await writeJsonFile(prettyPath, value)

    expect(await readFile(compactPath, 'utf8')).toBe(`${JSON.stringify(value)}\n`)
    expect(await readFile(prettyPath, 'utf8')).toBe(`${JSON.stringify(value, null, 2)}\n`)
  })

  test('saves Board documents and authority ledgers as compact JSON', async () => {
    const store = await Bun.file('packages/mcp/src/local-workspace-authority/store.ts').text()
    expect(store).toContain('writeJsonFile(filePath, value, { space: 0 })')
    expect(store).toContain('function serializeDocument')
    expect(store).toContain('function hashSerializedDocument')
    expect(store).toContain('readSerializedJsonFile(this.documentPath)')
    expect(store).toContain('writeSerializedJsonFile(this.documentPath, serializedDocument)')
    expect(store).toContain('serializeAuthorityState(state, serializedDocument)')
  })

  test('reads saved JSON bytes without re-stringifying them', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-json-file-'))
    roots.push(root)
    const filePath = path.join(root, 'workspace.json')
    const serialized = '{\n  "id": "a",\n  "name": "Card"\n}'
    await writeSerializedJsonFile(filePath, serialized)

    const saved = await readSerializedJsonFile(filePath)
    expect(saved).toEqual({
      serialized,
      value: { id: 'a', name: 'Card' }
    })
    expect(JSON.stringify(saved?.value)).not.toBe(serialized)
  })

  test('writes a pre-serialized payload once and reuses it for history', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-json-file-'))
    roots.push(root)
    const serialized = '{"nodes":[{"id":"a"}]}'
    const filePath = path.join(root, 'workspace.json')
    const historyPath = path.join(root, 'history')

    await writeSerializedJsonFile(filePath, serialized)
    await writeJsonHistory(historyPath, 3, 'abc', serialized)

    expect(await readFile(filePath, 'utf8')).toBe(`${serialized}\n`)
    expect(await readFile(path.join(historyPath, '0000000003-abc.json'), 'utf8')).toBe(
      `${serialized}\n`
    )
  })
})
