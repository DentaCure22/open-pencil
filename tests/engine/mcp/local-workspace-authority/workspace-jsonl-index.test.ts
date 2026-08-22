import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  buildWorkspaceJsonlIndex,
  parseWorkspaceJsonlIndexMetadata,
  serializeWorkspaceJsonlIndex,
  WORKSPACE_JSONL_INDEX_FILE,
  workspaceJsonlIndexIsCurrent,
  writeWorkspaceJsonlIndex
} from '#mcp/local-workspace-authority/workspace-jsonl-index'

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

function indexSource(graph: SceneGraph, revision = 7, contentHash = 'content-hash-7') {
  return {
    contentHash,
    document: savedDocument(graph),
    identity: {
      documentId: 'document-index-test',
      documentName: 'Index Test',
      roomId: 'room-index-test',
      schemaVersion: 1,
      workspaceId: 'workspace-index-test'
    },
    revision
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('workspace JSONL index', () => {
  test('indexes root-listed pages and reachable nodes in canonical child order', () => {
    const graph = new SceneGraph()
    const firstPage = graph.getPages()[0]
    firstPage.name = 'First Board'
    const firstFrame = graph.createNode('FRAME', firstPage.id, {
      height: 200,
      name: 'Patient Handoff',
      width: 300,
      x: 100,
      y: 200
    })
    const longText = `Patient   handoff\n${'🤖'.repeat(400)}`
    const firstText = graph.createNode('TEXT', firstFrame.id, {
      height: 10,
      name: 'Handoff details',
      text: longText,
      width: 20,
      x: 10,
      y: 15
    })
    const unreachable = graph.createNode('FRAME', firstPage.id, { name: 'Detached object' })
    firstPage.childIds = firstPage.childIds.filter((id) => id !== unreachable.id)

    const secondPage = graph.addPage('Second Board')
    const secondFrame = graph.createNode('FRAME', secondPage.id, {
      height: 80,
      name: 'Second object',
      width: 120,
      x: -40,
      y: 25
    })
    const rootDecoration = graph.createNode('FRAME', graph.rootId, { name: 'Not a Board' })
    const root = graph.getNode(graph.rootId)
    if (!root) throw new Error('Expected SceneGraph root')
    root.childIds = [secondPage.id, rootDecoration.id, firstPage.id]

    const index = buildWorkspaceJsonlIndex(indexSource(graph))

    expect(index.metadata).toEqual({
      contentHash: 'content-hash-7',
      contract: 'workspace-jsonl-index/v1',
      documentId: 'document-index-test',
      kind: 'meta',
      pageCount: 2,
      projectionVersion: 2,
      recordCount: 5,
      revision: 7,
      rootId: graph.rootId,
      workspaceId: 'workspace-index-test'
    })
    expect(index.records.map(({ id }) => id)).toEqual([
      secondPage.id,
      secondFrame.id,
      firstPage.id,
      firstFrame.id,
      firstText.id
    ])
    expect(index.records.some(({ id }) => id === unreachable.id)).toBe(false)
    expect(index.records.some(({ id }) => id === rootDecoration.id)).toBe(false)
    expect(index.records.find(({ id }) => id === secondPage.id)).toMatchObject({
      bounds: { height: 80, width: 120, x: -40, y: 25 },
      canonicalObjectId: secondPage.id,
      kind: 'page',
      ownerId: secondPage.id,
      pageId: secondPage.id,
      pageName: 'Second Board',
      parentId: graph.rootId,
      prototypeIds: { FRAME: secondFrame.id }
    })
    expect(index.records.find(({ id }) => id === firstPage.id)?.prototypeIds).toEqual({
      FRAME: firstFrame.id,
      TEXT: firstText.id
    })
    const textRecord = index.records.find(({ id }) => id === firstText.id)
    expect(textRecord).toMatchObject({
      bounds: { height: 10, width: 20, x: 110, y: 215 },
      kind: 'node',
      ownerId: firstFrame.id,
      pageId: firstPage.id,
      pageName: 'First Board',
      parentId: firstFrame.id
    })
    expect(textRecord?.searchable).toContain('patient handoff')
    const indexedText = textRecord?.text
    expect(indexedText).toBeDefined()
    expect(new TextEncoder().encode(indexedText).length).toBeLessThanOrEqual(512)
    expect(serializeWorkspaceJsonlIndex(index)).toBe(
      serializeWorkspaceJsonlIndex(buildWorkspaceJsonlIndex(indexSource(graph)))
    )
  })

  test('keeps one canonical prototype cue per native type and page', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const firstFrame = graph.createNode('FRAME', page.id, { name: 'First frame' })
    graph.createNode('FRAME', page.id, { name: 'Second frame' })
    const firstText = graph.createNode('TEXT', firstFrame.id, {
      name: 'First text',
      text: 'Prototype'
    })
    graph.createNode('TEXT', firstFrame.id, { name: 'Second text', text: 'Other' })

    const index = buildWorkspaceJsonlIndex(indexSource(graph))
    const pageRecord = index.records.find(({ id }) => id === page.id)

    expect(pageRecord?.prototypeIds).toEqual({ FRAME: firstFrame.id, TEXT: firstText.id })
    expect(Object.keys(pageRecord?.prototypeIds ?? {})).toHaveLength(2)
    expect(serializeWorkspaceJsonlIndex(index)).toContain(
      `"prototypeIds":{"FRAME":"${firstFrame.id}","TEXT":"${firstText.id}"}`
    )
  })

  test('exposes first-line metadata that detects stale revisions and content', () => {
    const graph = new SceneGraph()
    const source = indexSource(graph)
    const serialized = serializeWorkspaceJsonlIndex(buildWorkspaceJsonlIndex(source))
    const metadata = parseWorkspaceJsonlIndexMetadata(serialized)

    expect(metadata).not.toBeNull()
    expect(workspaceJsonlIndexIsCurrent(metadata, source)).toBe(true)
    expect(
      workspaceJsonlIndexIsCurrent(metadata, { ...source, contentHash: 'different-content' })
    ).toBe(false)
    expect(workspaceJsonlIndexIsCurrent(metadata, { ...source, revision: 8 })).toBe(false)
    expect(
      workspaceJsonlIndexIsCurrent(metadata, {
        ...source,
        identity: { ...source.identity, workspaceId: 'different-workspace' }
      })
    ).toBe(false)
    expect(parseWorkspaceJsonlIndexMetadata('{not-json}\n')).toBeNull()
  })

  test('atomically replaces the disposable JSONL file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-workspace-jsonl-index-'))
    roots.push(root)
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('FRAME', page.id, {
      height: 100,
      name: 'Initial name',
      width: 100
    })
    const indexPath = path.join(root, WORKSPACE_JSONL_INDEX_FILE)
    await writeFile(indexPath, `${'stale'.repeat(10_000)}\n`, 'utf8')

    const firstSource = indexSource(graph)
    await writeWorkspaceJsonlIndex(root, firstSource)
    expect(await readFile(indexPath, 'utf8')).toBe(
      serializeWorkspaceJsonlIndex(buildWorkspaceJsonlIndex(firstSource))
    )

    node.name = 'Replacement name'
    const secondSource = indexSource(graph, 8, 'content-hash-8')
    const metadata = await writeWorkspaceJsonlIndex(root, secondSource)
    const written = await readFile(indexPath, 'utf8')
    expect(written).toBe(serializeWorkspaceJsonlIndex(buildWorkspaceJsonlIndex(secondSource)))
    expect(written).not.toContain('Initial name')
    expect(parseWorkspaceJsonlIndexMetadata(written)).toEqual(metadata)
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})
