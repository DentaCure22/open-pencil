import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
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

describe('local authority Board screenshots', () => {
  test('renders exact saved objects into a fitted PNG without changing the Board', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-board-screenshot-'))
    roots.push(root)
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const card = graph.createNode('RECTANGLE', page.id, {
      height: 2_000,
      name: 'Large visual card',
      width: 4_000,
      x: 120,
      y: 160
    })
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-screenshot-test',
      root
    })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-screenshot',
      sourceWorkspaceId: 'workspace-screenshot-test'
    })
    const before = await store.head()
    if (!before) throw new Error('Expected authority head')
    const response = (await new LocalWorkspaceBoardRuntime(store).sendRpc({
      args: { object_ids: [card.id], page_id: page.id, scale: 2 },
      command: 'board_screenshot'
    })) as { result: Record<string, unknown> }

    expect(response.result).toMatchObject({
      byteLength: expect.any(Number),
      mimeType: 'image/png',
      objectIds: [card.id],
      pixelHeight: 800,
      pixelWidth: 1600,
      scale: 0.4
    })
    expect(response.result.base64).toStartWith('iVBOR')
    expect((await store.head())?.contentHash).toBe(before.contentHash)
    await expect(
      new LocalWorkspaceBoardRuntime(store).sendRpc({
        args: { object_ids: ['missing'], page_id: page.id },
        command: 'board_screenshot'
      })
    ).rejects.toThrow('missing or outside the target page')
  })
})
