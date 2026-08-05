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
    variables: [...graph.variables]
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('persisted Board memory search', () => {
  test('serves cross-Board retrieval without a live editor', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-board-memory-'))
    roots.push(root)
    const graph = new SceneGraph()
    const first = graph.getPages()[0]
    first.name = 'Research'
    graph.createNode('TEXT', first.id, {
      name: 'Recall note',
      text: 'Controlled chaos spatial memory'
    })
    const second = graph.addPage('Architecture')
    graph.createNode('TEXT', second.id, {
      name: 'Memory backend',
      text: 'Canonical objects and Board placements'
    })
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-memory',
      root
    })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'seed-memory',
      sourceWorkspaceId: 'workspace-memory'
    })
    const head = await store.head()
    if (!head) throw new Error('Expected initialized memory authority')
    const runtime = new LocalWorkspaceBoardRuntime(store)

    const response = (await runtime.sendRpc({
      command: 'tool',
      args: {
        args: { query: 'canonical objects' },
        content_document_id: head.identity.documentId,
        document_id: head.identity.documentId,
        name: 'search_board_memory',
        page_id: first.id,
        runtime_instance_id: `local-authority:${head.authorityId}`,
        workspace_id: head.identity.workspaceId
      }
    })) as {
      result: {
        boards: Array<{ board_id: string }>
        execution_surface: string
        index_revision: number
        objects: Array<{ title: string }>
      }
    }

    expect(response.result).toMatchObject({
      execution_surface: 'local_workspace_authority',
      index_revision: 1
    })
    expect(response.result.boards[0]?.board_id).toBe(second.id)
    expect(response.result.objects[0]?.title).toBe('Memory backend')
  })
})
