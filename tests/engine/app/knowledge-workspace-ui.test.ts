import { beforeEach, describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  applyWorkspaceMutation,
  createDocumentBlock,
  createKnowledgeWorkspace,
  createLiveAppBlock,
  createWorkspaceRelation,
  createWorkspaceContext,
  createWorkspaceView,
  getKnowledgeWorkspace,
  replaceKnowledgeWorkspace,
  workspaceRegistry
} from '@/app/workspace'
import { syncExperienceRelationProjections } from '@/app/workspace-ui/experience-projection-scene'
import {
  ensureKnowledgeWorkspacesHydrated,
  persistKnowledgeWorkspacesToScene
} from '@/app/workspace-ui/persistence'
import {
  bindWorkspaceObjectToSceneNode,
  createWorkspaceObjectProjection,
  defaultWorkspaceProjectionGeometry,
  ensureWorkspaceProjectionPage,
  workspacePluginValue,
  workspaceObjectIdForSceneNode
} from '@/app/workspace-ui/projection'

function workspaceFixture() {
  const graph = new SceneGraph()
  const basePage = graph.getPages()[0]
  if (!basePage) throw new Error('fixture_page_missing')
  const workspace = createKnowledgeWorkspace({
    documentId: graph.rootId,
    name: 'Fixture workspace',
    pageId: basePage.id
  })
  const canvasView = createWorkspaceView({
    kind: 'canvas',
    name: 'Canvas',
    primary: true,
    workspaceId: workspace.id
  })
  const documentView = createWorkspaceView({
    kind: 'document',
    name: 'Document',
    workspaceId: workspace.id
  })
  const block = createDocumentBlock(createWorkspaceContext(workspace), {
    blockKind: 'heading',
    text: 'One object, many views'
  })
  const result = applyWorkspaceMutation(workspace, {
    dryRun: false,
    expectedRevision: 0,
    idempotencyKey: 'fixture-create',
    operations: [
      { type: 'create-view', view: canvasView },
      { type: 'create-view', view: documentView },
      { object: block, type: 'create-object' }
    ]
  })
  const createdBlock = result.workspace.objects[block.id]
  const createdCanvasView = result.workspace.views[canvasView.id]
  const createdDocumentView = result.workspace.views[documentView.id]
  if (!createdBlock || !createdCanvasView || !createdDocumentView) {
    throw new Error('fixture_workspace_creation_failed')
  }
  return {
    basePage,
    block: createdBlock,
    canvasView: createdCanvasView,
    documentView: createdDocumentView,
    graph,
    workspace: result.workspace
  }
}

beforeEach(() => workspaceRegistry.clear())

describe('Knowledge workspace native UI projections', () => {
  test('keeps the same stable object identity across Canvas and Document views', () => {
    const fixture = workspaceFixture()
    const { block, canvasView, documentView } = fixture

    const canvasPage = ensureWorkspaceProjectionPage(fixture.graph, {
      basePageId: fixture.basePage.id,
      basePageName: fixture.basePage.name,
      kind: 'canvas',
      viewId: canvasView.id,
      workspaceId: fixture.workspace.id
    })
    const documentPage = ensureWorkspaceProjectionPage(fixture.graph, {
      basePageId: fixture.basePage.id,
      basePageName: fixture.basePage.name,
      kind: 'document',
      viewId: documentView.id,
      workspaceId: fixture.workspace.id
    })
    const canvasProjection = createWorkspaceObjectProjection(
      fixture.graph,
      canvasPage.id,
      block,
      canvasView,
      defaultWorkspaceProjectionGeometry(block, 'canvas', 0)
    )
    const documentProjection = createWorkspaceObjectProjection(
      fixture.graph,
      documentPage.id,
      block,
      documentView,
      defaultWorkspaceProjectionGeometry(block, 'document', 0)
    )

    expect(canvasProjection.id).not.toBe(documentProjection.id)
    expect(workspaceObjectIdForSceneNode(fixture.graph, canvasProjection.id)).toBe(block.id)
    expect(workspaceObjectIdForSceneNode(fixture.graph, documentProjection.id)).toBe(block.id)
  })

  test('keys generated pages by exact view id and renders ordered, directed lineage', () => {
    const fixture = workspaceFixture()
    const secondReviewView = createWorkspaceView({
      kind: 'review',
      name: 'Review B',
      workspaceId: fixture.workspace.id
    })
    const firstPage = ensureWorkspaceProjectionPage(fixture.graph, {
      basePageId: fixture.basePage.id,
      basePageName: fixture.basePage.name,
      kind: 'review',
      purpose: 'review',
      viewId: 'view-review-a',
      workspaceId: fixture.workspace.id
    })
    const secondPage = ensureWorkspaceProjectionPage(fixture.graph, {
      basePageId: fixture.basePage.id,
      basePageName: fixture.basePage.name,
      kind: 'review',
      purpose: 'review',
      viewId: secondReviewView.id,
      workspaceId: fixture.workspace.id
    })
    expect(secondPage.id).not.toBe(firstPage.id)
    expect(workspacePluginValue(firstPage, 'viewId')).toBe('view-review-a')
    expect(workspacePluginValue(secondPage, 'viewId')).toBe(secondReviewView.id)

    const target = createDocumentBlock(createWorkspaceContext(fixture.workspace), {
      blockKind: 'paragraph',
      text: 'Evidence used by this surface'
    })
    const relation = createWorkspaceRelation({
      label: 'uses evidence',
      relationType: 'uses-evidence',
      sourceId: fixture.block.id,
      targetId: target.id,
      workspaceId: fixture.workspace.id
    })
    const outcome = applyWorkspaceMutation(fixture.workspace, {
      dryRun: false,
      expectedRevision: fixture.workspace.revision,
      idempotencyKey: 'fixture-lineage',
      operations: [
        { object: target, type: 'create-object' },
        { relation, type: 'connect-relation' }
      ]
    })
    const source = outcome.workspace.objects[fixture.block.id]
    const createdTarget = outcome.workspace.objects[target.id]
    if (!source || !createdTarget) throw new Error('lineage objects missing')
    const sourceCard = createWorkspaceObjectProjection(
      fixture.graph,
      secondPage.id,
      source,
      secondReviewView,
      { height: 140, width: 320, x: 96, y: 240 },
      { order: 0, role: 'root-surface' }
    )
    const targetCard = createWorkspaceObjectProjection(
      fixture.graph,
      secondPage.id,
      createdTarget,
      secondReviewView,
      { height: 140, width: 320, x: 560, y: 240 },
      { order: 1, role: 'evidence-manifest' }
    )
    syncExperienceRelationProjections(
      fixture.graph,
      secondPage.id,
      outcome.workspace,
      secondReviewView,
      new Set([source.id, createdTarget.id])
    )

    expect(workspacePluginValue(sourceCard, 'experienceRole')).toBe('root-surface')
    expect(workspacePluginValue(sourceCard, 'experienceOrder')).toBe('0')
    const connector = fixture.graph
      .getChildren(secondPage.id)
      .find((node) => workspacePluginValue(node, 'kind') === 'workspace-relation-projection')
    if (!connector) throw new Error('lineage connector missing')
    expect(fixture.graph.getChildren(secondPage.id)[0]?.id).toBe(connector.id)
    expect(connector.x + connector.width / 2).toBeCloseTo(
      (sourceCard.x + sourceCard.width / 2 + targetCard.x + targetCard.width / 2) / 2
    )
    expect(connector.y + connector.height / 2).toBeCloseTo(
      (sourceCard.y + sourceCard.height / 2 + targetCard.y + targetCard.height / 2) / 2
    )
    expect(
      fixture.graph
        .getChildren(connector.id)
        .find((node) => workspacePluginValue(node, 'role') === 'relation-label')?.text
    ).toBe('uses evidence')
    expect(
      fixture.graph
        .getChildren(connector.id)
        .find((node) => workspacePluginValue(node, 'role') === 'relation-direction')?.text
    ).toBe('→')
  })

  test('round-trips the workspace registry through scene metadata', () => {
    const fixture = workspaceFixture()
    replaceKnowledgeWorkspace(fixture.workspace)
    persistKnowledgeWorkspacesToScene(fixture.graph)
    workspaceRegistry.clear()

    expect(ensureKnowledgeWorkspacesHydrated(fixture.graph)).toBe(true)
    const restored = getKnowledgeWorkspace(fixture.workspace.documentId, fixture.workspace.pageId)
    expect(restored?.id).toBe(fixture.workspace.id)
    expect(Object.keys(restored?.objects ?? {})).toContain(fixture.block.id)
  })

  test('binds a Live App Block to the existing runtime frame without duplicating it', () => {
    const fixture = workspaceFixture()
    const context = createWorkspaceContext(fixture.workspace)
    const liveBlock = createLiveAppBlock(context, {
      applicationId: 'smylr-production',
      environment: 'test',
      route: '/dental-chart',
      sourceRevision: 'fixture',
      viewport: { height: 900, width: 1280 }
    })
    const frame = fixture.graph.createNode('FRAME', fixture.basePage.id, {
      fills: [],
      height: 900,
      name: 'Dental Chart / Current',
      pluginData: [
        { key: 'kind', pluginId: 'smylr-production', value: 'live-app-frame' },
        { key: 'route', pluginId: 'smylr-production', value: '/dental-chart' }
      ],
      strokes: [],
      width: 1280
    })
    const childrenBefore = fixture.graph.getChildren(fixture.basePage.id).length

    const bound = bindWorkspaceObjectToSceneNode(
      fixture.graph,
      frame,
      liveBlock,
      fixture.canvasView
    )

    expect(bound.id).toBe(frame.id)
    expect(fixture.graph.getChildren(fixture.basePage.id)).toHaveLength(childrenBefore)
    expect(workspaceObjectIdForSceneNode(fixture.graph, frame.id)).toBe(liveBlock.id)
  })
})
