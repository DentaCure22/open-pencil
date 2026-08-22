import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

import { LocalWorkspaceBoardRuntime } from '#mcp/local-workspace-authority/board-runtime'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []

function savedDocument(graph: SceneGraph) {
  return {
    activeMode: [...graph.activeMode],
    documentColorSpace: graph.documentColorSpace,
    figKiwiVersion: graph.figKiwiVersion,
    figSchemaDeflated: graph.figSchemaDeflated,
    images: [...graph.images],
    instanceIndex: [...graph.instanceIndex].map(([id, nodeIds]) => [id, [...nodeIds]]),
    nodes: [...graph.nodes],
    rootId: graph.rootId,
    variableCollections: [...graph.variableCollections],
    variables: [...graph.variables],
    version: 2
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('local workspace search index', () => {
  test('indexes Boards and objects compactly, then follows direct JSON revisions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-workspace-search-'))
    roots.push(root)
    const graph = new SceneGraph()
    const board = graph.getPages()[0]
    board.name = 'Dental Board'
    const card = graph.createNode('FRAME', board.id, {
      height: 240,
      name: 'Trace Beacon',
      pluginData: [
        {
          key: 'canonical-object-id',
          pluginId: 'openpencil.memory',
          value: 'canonical:trace-beacon'
        }
      ],
      width: 320,
      x: 120,
      y: 180
    })
    const summary = graph.createNode('TEXT', card.id, {
      name: 'Workflow summary',
      text: 'Capture intent and hand off to the Board editor'
    })
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-search-test',
      root
    })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-search',
      sourceWorkspaceId: 'workspace-search-test'
    })
    const runtime = new LocalWorkspaceBoardRuntime(store)

    const indexPath = path.join(root, 'workspace.index.jsonl')
    expect((await stat(indexPath)).isFile()).toBe(true)
    const historyFile = (await readdir(path.join(root, 'history')))[0]
    if (!historyFile) throw new Error('Expected initial workspace history snapshot')
    const workspaceBefore = await stat(path.join(root, 'workspace.json'), { bigint: true })
    const historyBefore = await stat(path.join(root, 'history', historyFile), { bigint: true })
    await unlink(indexPath)
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-search-unchanged',
      sourceWorkspaceId: 'workspace-search-test'
    })
    expect((await stat(indexPath)).isFile()).toBe(true)
    const workspaceAfter = await stat(path.join(root, 'workspace.json'), { bigint: true })
    const historyAfter = await stat(path.join(root, 'history', historyFile), { bigint: true })
    expect([workspaceAfter.ino, workspaceAfter.mtimeNs, workspaceAfter.size]).toEqual([
      workspaceBefore.ino,
      workspaceBefore.mtimeNs,
      workspaceBefore.size
    ])
    expect([historyAfter.ino, historyAfter.mtimeNs, historyAfter.size]).toEqual([
      historyBefore.ino,
      historyBefore.mtimeNs,
      historyBefore.size
    ])
    await unlink(indexPath)
    const restarted = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-search-test',
      root
    })
    await restarted.status()
    expect((await stat(indexPath)).isFile()).toBe(true)
    await expect(
      runtime.sendRpc({ args: { query: card.id }, command: 'workspace_search' })
    ).resolves.toMatchObject({
      ok: true,
      result: { results: [{ id: card.id }] }
    })
    const initialSearch = await store.searchWorkspace('Trace Beacon')
    expect(initialSearch).toMatchObject({
      contract: 'workspace-search/v1',
      indexed_revision: 1
    })
    expect(initialSearch.results[0]).toMatchObject({
      board: { id: board.id, name: 'Dental Board' },
      canonical_object_id: 'canonical:trace-beacon',
      id: card.id,
      kind: 'object',
      name: 'Trace Beacon',
      owner_id: card.id,
      type: 'FRAME'
    })
    expect(initialSearch.results.some(({ id }) => id === summary.id)).toBe(false)
    await expect(
      store.queueResolvedNavigationIntent({ query: 'Trace Beacon' })
    ).resolves.toMatchObject({
      objectIds: [card.id],
      pageId: board.id
    })
    expect((await store.searchWorkspace('hand off')).results[0]).toMatchObject({
      board: { id: board.id },
      id: summary.id,
      kind: 'object',
      name: 'Workflow summary',
      owner_id: card.id
    })

    const workspacePath = path.join(root, 'workspace.json')
    const workspace = JSON.parse(await readFile(workspacePath, 'utf8')) as {
      nodes: Array<[string, { name: string }]>
    }
    const cardEntry = workspace.nodes.find(([id]) => id === card.id)
    if (!cardEntry) throw new Error('Expected indexed card in canonical workspace JSON')
    cardEntry[1].name = 'Patient Journey Beacon'
    await writeFile(workspacePath, `${JSON.stringify(workspace)}\n`, 'utf8')

    const updatedSearch = await store.searchWorkspace('Patient Journey')
    expect(updatedSearch.indexed_revision).toBe(2)
    expect(updatedSearch.results[0]).toMatchObject({
      id: card.id,
      name: 'Patient Journey Beacon'
    })
    expect((await store.searchWorkspace('Trace Beacon')).results).toEqual([])
  })
})
