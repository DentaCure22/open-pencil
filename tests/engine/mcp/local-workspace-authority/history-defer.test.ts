import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

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

describe('deferred workspace history', () => {
  test('returns a commit receipt before the history snapshot is required', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-history-defer-'))
    roots.push(root)
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const card = graph.createNode('FRAME', page.id, {
      height: 80,
      name: 'Patient card',
      width: 120,
      x: 40,
      y: 60
    })
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-history-defer',
      root
    })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-history-defer',
      sourceWorkspaceId: 'workspace-history-defer'
    })
    const head = await store.head()
    if (!head) throw new Error('Expected seeded Board head')

    card.x = 180
    const receipt = await store.commit({
      document: savedDocument(graph),
      expectedContentHash: head.contentHash,
      expectedRevision: head.revision,
      requestId: 'move-patient-card',
      workspaceId: 'workspace-history-defer'
    })

    expect(receipt.status).toBe('committed')
    expect((await store.head())?.revision).toBe(receipt.appliedRevision)
    expect((await store.head())?.document).toMatchObject({
      nodes: expect.arrayContaining([
        expect.arrayContaining([card.id, expect.objectContaining({ x: 180 })])
      ])
    })
    await store.flushHistoryWrites()
    const workspace = await Bun.file(path.join(root, 'workspace.json')).text()
    expect(workspace).toContain('"x":180')
    const history = await readdir(path.join(root, 'history'))
    expect(history.some((name) => name.includes(receipt.contentHash))).toBe(true)
    expect(await store.headAtRevision(head.revision)).toMatchObject({
      contentHash: head.contentHash,
      revision: head.revision
    })
  })
})
