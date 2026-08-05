import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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

    expect((await stat(path.join(root, 'workspace-search.sqlite3'))).isFile()).toBe(true)
    expect((await stat(path.join(root, 'authority.sqlite3'))).isFile()).toBe(true)
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
    expect((await store.searchWorkspace('hand off')).results[0]).toMatchObject({
      board: { id: board.id },
      id: card.id,
      kind: 'object',
      name: 'Trace Beacon'
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
