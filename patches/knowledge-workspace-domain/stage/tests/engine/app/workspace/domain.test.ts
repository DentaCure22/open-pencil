import { describe, expect, test } from 'bun:test'

import {
  WorkspaceDomainError,
  applyWorkspaceMutation,
  createCollection,
  createCollectionRecord,
  createDesignArtifact,
  createDocumentBlock,
  createGraphEdge,
  createGraphNode,
  createKnowledgeWorkspace,
  createSavedView,
  createWorkspaceContext,
  createWorkspaceId,
  createWorkspaceRelation,
  createWorkspaceView,
  getWorkspaceBacklinks,
  queryCollectionRecords,
  queryWorkspaceItems
} from '@/app/workspace'
import type { KnowledgeWorkspace, WorkspaceMutationEnvelope } from '@/app/workspace'

function workspace(): KnowledgeWorkspace {
  return createKnowledgeWorkspace({
    documentId: 'document-one',
    id: 'workspace-one',
    name: 'Product workspace',
    now: '2026-07-12T12:00:00.000Z',
    pageId: 'page-one'
  })
}

function mutate(
  current: KnowledgeWorkspace,
  idempotencyKey: string,
  operations: WorkspaceMutationEnvelope['operations'],
  dryRun = false
) {
  return applyWorkspaceMutation(current, {
    dryRun,
    expectedRevision: current.revision,
    idempotencyKey,
    operations
  })
}

describe('OpenPencil knowledge workspace domain', () => {
  test('uses crypto-backed stable IDs with typed prefixes', () => {
    const first = createWorkspaceId('document-block')
    const second = createWorkspaceId('document-block')

    expect(first).toStartWith('document-block_')
    expect(second).toStartWith('document-block_')
    expect(first).not.toBe(second)
    expect(first).not.toContain('undefined')
  })

  test('creates nested document blocks while keeping per-view geometry independent', () => {
    const initial = workspace()
    const context = createWorkspaceContext(initial, { now: '2026-07-12T12:01:00.000Z' })
    const documentView = createWorkspaceView({
      id: 'view-document',
      kind: 'document',
      name: 'Document',
      primary: true,
      workspaceId: initial.id
    })
    const canvasView = createWorkspaceView({
      id: 'view-canvas',
      kind: 'canvas',
      name: 'Canvas',
      workspaceId: initial.id
    })
    const heading = createDocumentBlock(context, {
      blockKind: 'heading',
      id: 'heading',
      order: 0,
      text: 'Treatment planning'
    })
    const paragraph = createDocumentBlock(context, {
      blockKind: 'paragraph',
      id: 'paragraph',
      order: 0,
      parentId: heading.id,
      text: 'Use the live state as evidence.'
    })
    const created = mutate(initial, 'create-document', [
      { type: 'create-view', view: documentView },
      { type: 'create-view', view: canvasView },
      { type: 'create-object', object: heading },
      { type: 'create-object', object: paragraph }
    ]).workspace
    const storedHeading = created.objects[heading.id]
    const storedParagraph = created.objects[paragraph.id]
    expect(storedHeading?.type).toBe('document-block')
    expect(storedHeading?.type === 'document-block' ? storedHeading.childIds : []).toEqual([
      paragraph.id
    ])
    expect(storedParagraph?.parentId).toBe(heading.id)

    const paragraphRevision = storedParagraph?.revision ?? -1
    const projected = mutate(created, 'project-paragraph', [
      {
        expectedObjectRevision: paragraphRevision,
        objectId: paragraph.id,
        projection: { geometry: { height: 160, width: 320, x: 900, y: 180 }, order: 7 },
        type: 'set-projection',
        viewId: canvasView.id
      }
    ]).workspace
    const moved = projected.objects[paragraph.id]
    expect(moved?.projections[canvasView.id]?.geometry?.x).toBe(900)
    expect(moved?.type === 'document-block' ? moved.order : -1).toBe(0)
    expect(
      projected.objects[heading.id]?.type === 'document-block'
        ? projected.objects[heading.id].childIds
        : []
    ).toEqual([paragraph.id])
  })

  test('supports dry runs, optimistic revisions, and durable idempotent replay', () => {
    const initial = workspace()
    const block = createDocumentBlock(createWorkspaceContext(initial), {
      blockKind: 'paragraph',
      id: 'safe-block',
      text: 'Preview this mutation'
    })
    const envelope: WorkspaceMutationEnvelope = {
      dryRun: true,
      expectedRevision: 0,
      idempotencyKey: 'safe-create',
      operations: [{ type: 'create-object', object: block }]
    }
    const preview = applyWorkspaceMutation(initial, envelope)
    expect(preview.result.dryRun).toBe(true)
    expect(preview.result.revision).toBe(0)
    expect(preview.workspace.objects).toEqual({})
    expect(initial.objects).toEqual({})

    const committed = applyWorkspaceMutation(initial, { ...envelope, dryRun: false })
    expect(committed.result.revision).toBe(1)
    expect(committed.workspace.objects[block.id]?.revision).toBe(1)
    const replay = applyWorkspaceMutation(committed.workspace, { ...envelope, dryRun: false })
    expect(replay.result.idempotentReplay).toBe(true)
    expect(replay.result.mutationId).toBe(committed.result.mutationId)
    expect(replay.workspace.revision).toBe(1)

    const differentBlock = createDocumentBlock(createWorkspaceContext(initial), {
      blockKind: 'paragraph',
      id: 'different',
      text: 'Different request'
    })
    expect(() =>
      applyWorkspaceMutation(committed.workspace, {
        ...envelope,
        dryRun: false,
        operations: [{ type: 'create-object', object: differentBlock }]
      })
    ).toThrow('idempotency_conflict')
    expect(() =>
      applyWorkspaceMutation(committed.workspace, {
        dryRun: false,
        expectedRevision: 0,
        idempotencyKey: 'stale-revision',
        operations: [{ type: 'create-object', object: differentBlock }]
      })
    ).toThrow('revision_conflict')
  })

  test('archives without deleting identity and enforces per-object revisions', () => {
    const initial = workspace()
    const block = createDocumentBlock(createWorkspaceContext(initial), {
      blockKind: 'paragraph',
      id: 'archive-me',
      text: 'Keep my stable identity'
    })
    const created = mutate(initial, 'create-archive-target', [
      { type: 'create-object', object: block }
    ]).workspace
    expect(() =>
      mutate(created, 'bad-object-revision', [
        { expectedObjectRevision: 0, objectId: block.id, type: 'archive-object' }
      ])
    ).toThrow(WorkspaceDomainError)
    const archived = mutate(created, 'archive-target', [
      { expectedObjectRevision: 1, objectId: block.id, type: 'archive-object' }
    ]).workspace
    expect(archived.objects[block.id]?.id).toBe(block.id)
    expect(archived.objects[block.id]?.lifecycle).toBe('archived')
    expect(queryWorkspaceItems(archived).items).toHaveLength(0)
    expect(queryWorkspaceItems(archived, { includeArchived: true }).items[0]?.id).toBe(block.id)
  })
})

describe('OpenPencil collections and relationships', () => {
  function collectionWorkspace(): {
    collectionId: string
    savedViewId: string
    workspace: KnowledgeWorkspace
  } {
    const initial = workspace()
    const context = createWorkspaceContext(initial)
    const collection = createCollection(context, {
      id: 'projects',
      name: 'Projects',
      properties: [
        { id: 'status', label: 'Status', type: 'status' },
        { id: 'priority', label: 'Priority', type: 'number' }
      ]
    })
    const first = createCollectionRecord(context, {
      collectionId: collection.id,
      id: 'project-a',
      properties: { priority: 1, status: 'active' },
      title: 'Patient header cleanup'
    })
    const second = createCollectionRecord(context, {
      collectionId: collection.id,
      id: 'project-b',
      properties: { priority: 3, status: 'active' },
      title: 'Chart workspace'
    })
    const third = createCollectionRecord(context, {
      collectionId: collection.id,
      id: 'project-c',
      properties: { priority: 2, status: 'done' },
      title: 'Archived experiment'
    })
    const table = createSavedView(context, {
      collectionId: collection.id,
      filters: [{ operator: 'equals', propertyId: 'status', value: 'active' }],
      id: 'active-table',
      name: 'Active projects',
      sorts: [{ direction: 'descending', propertyId: 'priority' }],
      viewKind: 'table',
      visiblePropertyIds: ['status', 'priority']
    })
    const board = createSavedView(context, {
      collectionId: collection.id,
      groupByPropertyId: 'status',
      id: 'status-board',
      name: 'Status board',
      viewKind: 'board'
    })
    const next = mutate(initial, 'create-collection', [
      { type: 'create-object', object: collection },
      { type: 'create-object', object: first },
      { type: 'create-object', object: second },
      { type: 'create-object', object: third },
      { type: 'create-object', object: table },
      { type: 'create-object', object: board }
    ]).workspace
    return { collectionId: collection.id, savedViewId: table.id, workspace: next }
  }

  test('keeps one Record identity across multiple Saved Views and paginates filters', () => {
    const fixture = collectionWorkspace()
    const collection = fixture.workspace.objects[fixture.collectionId]
    expect(collection?.type === 'collection' ? collection.recordIds : []).toEqual([
      'project-a',
      'project-b',
      'project-c'
    ])
    expect(collection?.type === 'collection' ? collection.savedViewIds : []).toEqual([
      'active-table',
      'status-board'
    ])
    const firstPage = queryCollectionRecords(fixture.workspace, {
      limit: 1,
      savedViewId: fixture.savedViewId
    })
    expect(firstPage.records.map((record) => record.id)).toEqual(['project-b'])
    expect(firstPage.totalMatched).toBe(2)
    expect(firstPage.nextCursor).toBeDefined()
    const secondPage = queryCollectionRecords(fixture.workspace, {
      cursor: firstPage.nextCursor,
      limit: 1,
      savedViewId: fixture.savedViewId
    })
    expect(secondPage.records.map((record) => record.id)).toEqual(['project-a'])
  })

  test('queries full text, metadata, changed revisions, relation traversal, and backlinks', () => {
    const fixture = collectionWorkspace()
    const context = createWorkspaceContext(fixture.workspace)
    const note = createDocumentBlock(context, {
      blockKind: 'callout',
      id: 'note',
      tags: ['dental', 'decision'],
      text: 'Use the patient header as runtime evidence.'
    })
    const target = createDesignArtifact(context, {
      artifactKind: 'component',
      id: 'header-design',
      label: 'Patient header',
      sourceRef: 'src/components/HeaderCard.vue'
    })
    const relation = createWorkspaceRelation({
      id: 'relation-note-header',
      relationType: 'documents',
      sourceId: note.id,
      targetId: target.id,
      workspaceId: fixture.workspace.id
    })
    const graphNode = createGraphNode(context, {
      graphId: 'architecture',
      graphKind: 'architecture',
      id: 'graph-source',
      label: 'Live runtime'
    })
    const graphEdge = createGraphEdge(context, {
      graphId: 'architecture',
      graphKind: 'architecture',
      id: 'graph-edge',
      relationshipType: 'renders',
      sourceId: graphNode.id,
      targetId: target.id
    })
    const augmented = mutate(fixture.workspace, 'add-relations', [
      { type: 'create-object', object: note },
      { type: 'create-object', object: target },
      { type: 'create-object', object: graphNode },
      { type: 'create-object', object: graphEdge },
      { relation, type: 'connect-relation' }
    ]).workspace

    expect(
      queryWorkspaceItems(augmented, {
        tags: ['dental'],
        text: 'runtime evidence',
        types: ['document-block']
      }).items.map((hit) => hit.id)
    ).toEqual([note.id])
    expect(
      queryWorkspaceItems(augmented, { sourceTarget: 'src/components/HeaderCard.vue' }).items[0]?.id
    ).toBe(target.id)
    expect(
      queryWorkspaceItems(augmented, {
        changedSinceRevision: fixture.workspace.revision,
        relation: { direction: 'incoming', objectId: target.id }
      }).items.map((hit) => hit.id)
    ).toEqual([graphNode.id, note.id])
    expect(
      getWorkspaceBacklinks(augmented, target.id)
        .map((item) => item.kind)
        .sort()
    ).toEqual(['graph-edge', 'relation'])
  })
})
