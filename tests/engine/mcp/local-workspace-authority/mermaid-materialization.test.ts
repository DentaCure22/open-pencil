import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument
} from '#mcp/local-workspace-authority/document'
import { readAuthorityMermaidSource } from '#mcp/local-workspace-authority/mermaid-readback'
import { LocalWorkspaceAuthorityStore } from '#mcp/local-workspace-authority/store'

const roots: string[] = []

type JsonRecord = Record<string, unknown>

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

function savedDocument(graph: SceneGraph): unknown {
  return writeAuthorityBoardDocument({
    graph,
    source: {
      activeMode: [],
      documentColorSpace: graph.documentColorSpace,
      figKiwiVersion: graph.figKiwiVersion,
      figSchemaDeflated: graph.figSchemaDeflated,
      images: [],
      instanceIndex: [],
      nodes: [],
      rootId: graph.rootId,
      variableCollections: [],
      variables: []
    }
  })
}

function documentNodes(value: unknown): Array<[string, JsonRecord]> {
  if (!value || typeof value !== 'object' || !('nodes' in value)) {
    throw new TypeError('Expected workspace document nodes.')
  }
  const nodes = value.nodes
  if (!Array.isArray(nodes)) throw new TypeError('Expected workspace document node pairs.')
  return nodes as Array<[string, JsonRecord]>
}

describe('declarative Mermaid workspace materialization', () => {
  test('turns one compact file owner into one SVG-backed frame and applies direct source edits', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-mermaid-file-'))
    roots.push(root)
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-mermaid-file',
      root
    })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'request:initialize-mermaid-file',
      sourceWorkspaceId: 'workspace-mermaid-file'
    })

    const workspacePath = path.join(root, 'workspace.json')
    const directDocument = JSON.parse(await readFile(workspacePath, 'utf8')) as unknown
    documentNodes(directDocument).push([
      'workflow-owner',
      {
        childIds: [],
        id: 'workflow-owner',
        mermaidSource: 'flowchart LR\n  Observe --> Decide --> Improve',
        parentId: page.id,
        type: 'GROUP',
        x: 720,
        y: 180
      }
    ])
    await writeFile(workspacePath, `${JSON.stringify(directDocument, null, 2)}\n`)

    const createdHead = await store.head()
    expect(createdHead?.revision).toBe(2)
    if (!createdHead) throw new Error('Expected materialized Mermaid authority head.')
    const createdDocument = readAuthorityBoardDocument(createdHead.document)
    const createdOwner = createdDocument.graph.getNode('workflow-owner')
    expect(createdOwner).toMatchObject({
      childIds: [],
      height: 480,
      parentId: page.id,
      type: 'FRAME',
      width: 720,
      x: 720,
      y: 180
    })
    expect(readAuthorityMermaidSource(createdDocument, page.id, 'workflow-owner')).toMatchObject({
      editable_layers: 0,
      owner_id: 'workflow-owner',
      parser: 'mermaid@11.16.0/svg',
      reconciliation: { status: 'current' },
      source: 'flowchart LR\n  Observe --> Decide --> Improve'
    })
    const savedAfterCreate = JSON.parse(await readFile(workspacePath, 'utf8')) as unknown
    expect(
      documentNodes(savedAfterCreate).find(([id]) => id === 'workflow-owner')?.[1]
    ).not.toHaveProperty('mermaidSource')

    const sourceAfterEdit = 'flowchart TD\n  Observe --> Shape --> Ship'
    const ownerPair = documentNodes(savedAfterCreate).find(([id]) => id === 'workflow-owner')
    if (!ownerPair) throw new Error('Expected materialized Mermaid owner.')
    ownerPair[1].mermaidSource = sourceAfterEdit
    await writeFile(workspacePath, `${JSON.stringify(savedAfterCreate, null, 2)}\n`)

    const editedHead = await store.head()
    expect(editedHead?.revision).toBe(3)
    if (!editedHead) throw new Error('Expected recompiled Mermaid authority head.')
    const editedDocument = readAuthorityBoardDocument(editedHead.document)
    const editedOwner = editedDocument.graph.getNode('workflow-owner')
    expect(editedOwner).toMatchObject({
      childIds: [],
      parentId: page.id,
      type: 'FRAME',
      x: 720,
      y: 180
    })
    expect(readAuthorityMermaidSource(editedDocument, page.id, 'workflow-owner')).toMatchObject({
      owner_id: 'workflow-owner',
      reconciliation: { status: 'current' },
      source: sourceAfterEdit
    })
  })

  test('keeps one invalid Mermaid owner from blocking unrelated valid materialization', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openpencil-authority-mermaid-isolation-'))
    roots.push(root)
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const store = new LocalWorkspaceAuthorityStore({
      preferredWorkspaceId: 'workspace-mermaid-isolation',
      root
    })
    await store.initialize({
      document: savedDocument(graph),
      requestId: 'request:initialize-mermaid-isolation',
      sourceWorkspaceId: 'workspace-mermaid-isolation'
    })

    const workspacePath = path.join(root, 'workspace.json')
    const directDocument = JSON.parse(await readFile(workspacePath, 'utf8')) as unknown
    const nodes = documentNodes(directDocument)
    const pagePair = nodes.find(([id]) => id === page.id)
    if (!pagePair) throw new Error('Expected workspace page pair.')
    pagePair[1].childIds = ['invalid-owner', 'valid-owner']
    nodes.push(
      [
        'invalid-owner',
        {
          childIds: [],
          id: 'invalid-owner',
          mermaidSource: 'architecture-beta\n  service data(disk)[workspace.json]',
          parentId: page.id,
          type: 'FRAME',
          x: 0,
          y: 0
        }
      ],
      [
        'valid-owner',
        {
          childIds: [],
          id: 'valid-owner',
          mermaidSource: 'flowchart LR\n  Read --> Edit --> Render',
          parentId: page.id,
          type: 'FRAME',
          x: 800,
          y: 0
        }
      ]
    )
    await writeFile(workspacePath, `${JSON.stringify(directDocument, null, 2)}\n`)

    const head = await store.head()
    expect(head?.revision).toBe(2)
    if (!head) throw new Error('Expected authority head after direct Mermaid edit.')
    const materializedDocument = readAuthorityBoardDocument(head.document)
    expect(materializedDocument.graph.getNode('invalid-owner')).toMatchObject({
      mermaidSource: 'architecture-beta\n  service data(disk)[workspace.json]'
    })
    expect(readAuthorityMermaidSource(materializedDocument, page.id, 'valid-owner')).toMatchObject({
      reconciliation: { status: 'current' },
      source: 'flowchart LR\n  Read --> Edit --> Render'
    })
  })
})
