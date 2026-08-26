import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  assembleIncrementalSmylrProductionDocument,
  omitUnchangedAuthorityImages,
  omitUnchangedAuthorityPages,
  planSmylrProductionDocumentPersistence,
  type CachedSmylrProductionDocument
} from '@/app/smylr-production/document-persistence/plan'

function createWorkspaceGraph() {
  const graph = new SceneGraph()
  const firstBoard = graph.getPages()[0]
  if (!firstBoard) throw new Error('First Board missing')
  graph.updateNode(firstBoard.id, {
    name: 'Board A',
    pluginData: [{ key: 'kind', pluginId: 'smylr-production', value: 'smylr-production-page' }]
  })
  const firstNode = graph.createNode('RECTANGLE', firstBoard.id, { name: 'A marker' })
  const secondBoard = graph.addPage('Board B')
  const secondNode = graph.createNode('RECTANGLE', secondBoard.id, { name: 'B marker' })
  return { firstBoard, firstNode, graph, secondBoard, secondNode }
}

describe('Smylr production incremental document persistence', () => {
  test('rewrites only a dirty Board and reuses the other Board snapshot', () => {
    const { firstBoard, firstNode, graph, secondBoard } = createWorkspaceGraph()
    const initial = planSmylrProductionDocumentPersistence(
      graph,
      null,
      new Set([firstBoard.id, secondBoard.id])
    )

    graph.updateNode(firstNode.id, { name: 'A marker updated' })
    const next = planSmylrProductionDocumentPersistence(
      graph,
      initial.manifest,
      new Set([firstBoard.id])
    )

    expect(initial.boardSnapshots).toHaveLength(2)
    expect(next.boardSnapshots).toHaveLength(1)
    expect(next.boardSnapshots[0]?.boardId).toBe(firstBoard.id)
    expect(next.manifest.boardRefs.find((ref) => ref.boardId === firstBoard.id)?.revision).toBe(2)
    expect(next.manifest.boardRefs.find((ref) => ref.boardId === secondBoard.id)).toEqual(
      initial.manifest.boardRefs.find((ref) => ref.boardId === secondBoard.id)
    )
  })

  test('assembles a complete document from new and reused Board snapshots', () => {
    const { firstBoard, firstNode, graph, secondBoard, secondNode } = createWorkspaceGraph()
    const initial = planSmylrProductionDocumentPersistence(
      graph,
      null,
      new Set([firstBoard.id, secondBoard.id])
    )
    graph.updateNode(firstNode.id, { name: 'Persisted update' })
    const next = planSmylrProductionDocumentPersistence(
      graph,
      initial.manifest,
      new Set([firstBoard.id])
    )
    const snapshotsByBoard = new Map(
      [...initial.boardSnapshots, ...next.boardSnapshots].map((snapshot) => [
        snapshot.boardId,
        snapshot
      ])
    )
    const snapshots = next.manifest.boardRefs.flatMap((ref) => {
      const snapshot = snapshotsByBoard.get(ref.boardId)
      return snapshot ? [snapshot] : []
    })
    const cached = assembleIncrementalSmylrProductionDocument(next.manifest, snapshots, [], 2)

    expect(cached?.nodes.find(([id]) => id === firstNode.id)?.[1].name).toBe('Persisted update')
    expect(cached?.nodes.find(([id]) => id === secondNode.id)?.[1].name).toBe('B marker')
    expect(cached?.nodes.map(([id]) => id)).toContain(firstBoard.id)
    expect(cached?.nodes.map(([id]) => id)).toContain(secondBoard.id)
  })

  test('writes assets once and reuses their two-slot reference until content changes', () => {
    const { firstBoard, graph, secondBoard } = createWorkspaceGraph()
    graph.images.set('asset-a', new Uint8Array([1, 2, 3]))
    const initial = planSmylrProductionDocumentPersistence(
      graph,
      null,
      new Set([firstBoard.id, secondBoard.id])
    )
    const unchanged = planSmylrProductionDocumentPersistence(
      graph,
      initial.manifest,
      new Set([firstBoard.id])
    )
    graph.images.set('asset-b', new Uint8Array([4, 5]))
    const changed = planSmylrProductionDocumentPersistence(
      graph,
      unchanged.manifest,
      new Set([secondBoard.id])
    )

    expect(initial.assetsToWrite).toHaveLength(1)
    expect(unchanged.assetsToWrite).toBeNull()
    expect(unchanged.manifest.assetRef).toEqual(initial.manifest.assetRef)
    expect(changed.assetsToWrite).toHaveLength(2)
    expect(changed.manifest.assetRef?.revision).toBe(2)
    expect(changed.manifest.assetRef?.key).not.toBe(initial.manifest.assetRef?.key)
  })

  test('keeps a one-Board edit proportional across a 50-Board workspace', () => {
    const graph = new SceneGraph()
    const firstBoard = graph.getPages()[0]
    if (!firstBoard) throw new Error('First Board missing')
    const boardIds = [firstBoard.id]
    for (let boardIndex = 1; boardIndex < 50; boardIndex += 1) {
      boardIds.push(graph.addPage(`Scale Board ${boardIndex + 1}`).id)
    }
    for (const boardId of boardIds) {
      for (let nodeIndex = 0; nodeIndex < 20; nodeIndex += 1) {
        graph.createNode('RECTANGLE', boardId, { name: `Node ${nodeIndex + 1}` })
      }
    }
    const initial = planSmylrProductionDocumentPersistence(graph, null, new Set(boardIds))
    const dirtyBoardId = boardIds[24]
    if (!dirtyBoardId) throw new Error('Dirty Board missing')
    const dirtyNode = graph.getChildren(dirtyBoardId)[0]
    if (!dirtyNode) throw new Error('Dirty Board node missing')
    graph.updateNode(dirtyNode.id, { name: 'Only this Board changed' })

    const next = planSmylrProductionDocumentPersistence(
      graph,
      initial.manifest,
      new Set([dirtyBoardId])
    )

    expect(initial.boardSnapshots).toHaveLength(50)
    expect(next.boardSnapshots).toHaveLength(1)
    expect(next.boardSnapshots[0]?.nodes).toHaveLength(21)
    expect(next.manifest.boardRefs).toHaveLength(50)
  })

  test('omits unchanged Board images on later authority saves', () => {
    const document = Object.assign(Object.create(null) as CachedSmylrProductionDocument, {
      images: [['asset', new Uint8Array([1, 2, 3])]]
    })
    expect(omitUnchangedAuthorityImages(document, null, '1:asset:3|')).toBe(document)
    expect(omitUnchangedAuthorityImages(document, '1:asset:3|', '1:asset:3|')).toEqual({
      images: [],
      imagesUnchanged: true
    })
    expect(omitUnchangedAuthorityImages(document, '1:asset:3|', '1:asset:4|')).toBe(document)
  })

  test('omits unchanged Board pages on later authority saves', () => {
    const { firstBoard, firstNode, graph, secondBoard, secondNode } = createWorkspaceGraph()
    const document = Object.assign(Object.create(null) as CachedSmylrProductionDocument, {
      nodes: [...graph.nodes],
      rootId: graph.rootId
    })

    expect(omitUnchangedAuthorityPages(document, graph, new Set([firstBoard.id]), false)).toBe(
      document
    )
    const omitted = omitUnchangedAuthorityPages(document, graph, new Set([firstBoard.id]), true)
    const ids = new Set(omitted.nodes.map(([id]) => id))
    expect(omitted.retainedPageIds).toEqual([secondBoard.id])
    expect(ids.has(firstBoard.id)).toBe(true)
    expect(ids.has(firstNode.id)).toBe(true)
    expect(ids.has(secondBoard.id)).toBe(false)
    expect(ids.has(secondNode.id)).toBe(false)
    expect(ids.has(graph.rootId)).toBe(true)
  })
})
