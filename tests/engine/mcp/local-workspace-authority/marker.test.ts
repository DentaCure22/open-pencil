import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace authority change marker', () => {
  test('detects direct workspace JSON edits and derives their revision', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-marker-'))
    roots.push(root)
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-marker',
      root
    })
    await store.initialize({
      document: { nodes: ['initial'] },
      requestId: 'request:initialize-marker',
      sourceWorkspaceId: 'workspace-marker'
    })
    const markerBeforeExternalChange = await store.externalStateMarker()

    const workspacePath = path.join(root, 'workspace.json')
    const document = JSON.parse(await readFile(workspacePath, 'utf8')) as { nodes: string[] }
    document.nodes.push('direct-json-edit')
    await writeFile(workspacePath, `${JSON.stringify(document, null, 2)}\n`)

    expect(await store.externalStateMarker()).not.toBe(markerBeforeExternalChange)
    expect(await store.head()).toMatchObject({
      document: { nodes: ['initial', 'direct-json-edit'] },
      revision: 2
    })
    expect(await store.headAtRevision(1)).toMatchObject({
      document: { nodes: ['initial'] },
      revision: 1
    })
  })
})
