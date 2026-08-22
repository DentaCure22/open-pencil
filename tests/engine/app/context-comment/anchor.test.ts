import { describe, expect, test } from 'bun:test'

import { CONTENT_SOURCE_REVISION, contentSourcePluginData } from '@open-pencil/core/io'
import { getWorldMatrix, TransformMatrix } from '@open-pencil/scene-graph'
import { assetReference } from '@open-pencil/scene-graph/images'

import {
  codeObjectPluginData,
  createAgentConversationTerminalDocument,
  createCodeObject,
  createPdfDocumentDocument
} from '@/app/code-object/model'
import {
  contextCommentAnnotationAnchorLabel,
  contextCommentAnnotationAnchorLines,
  resolveContextCommentAnnotationAnchor
} from '@/app/context-comment'
import type { ContextCommentDraft } from '@/app/context-comment/types'
import { createEditorStore, type EditorStore } from '@/app/editor/session'
import { spatialMediaPluginData } from '@/app/spatial-media/source'

const scope = {
  documentId: 'document-1',
  documentName: 'Document',
  pageId: 'page-1',
  pageName: 'Page 1',
  workspaceId: 'workspace-1'
}

function draft(overrides: Partial<ContextCommentDraft> = {}): ContextCommentDraft {
  return {
    annotations: [],
    capture: {
      annotation: {
        bounds: { height: 100, width: 100, x: 0, y: 0 },
        color: '#2563eb',
        kind: 'focus',
        points: [],
        strokeWidth: 2
      },
      capturedAtMs: 1_787_052_800_000,
      cropBounds: { height: 800, width: 1_000, x: 0, y: 0 },
      evidenceId: 'evidence-1',
      height: 800,
      mimeType: 'image/png',
      omissions: [],
      source: 'canvas',
      width: 1_000
    },
    captureContext: {
      boardBounds: { height: 800, width: 1_000, x: 0, y: 0 },
      screenBounds: { height: 800, width: 1_000, x: 0, y: 0 },
      viewport: { panX: 0, panY: 0, zoom: 1 }
    },
    captureSource: {
      capturedAtEpochMs: 1_787_052_800_123,
      canvasBounds: { height: 800, width: 1_000, x: 0, y: 0 },
      displaySurface: 'browser',
      height: 800,
      imageUrl: 'blob:capture',
      source: 'display-capture',
      viewport: { panX: 0, panY: 0, zoom: 1 },
      viewportHeight: 800,
      viewportWidth: 1_000,
      width: 1_000
    },
    flow: 'screenshot',
    id: 'draft-1',
    target: {
      kind: 'board',
      label: 'Page 1',
      path: ['Document', 'Page 1'],
      scope,
      stableIds: ['page-1']
    },
    text: '',
    ...overrides
  }
}

function select(store: EditorStore, nodeId: string) {
  store.select([nodeId])
}

describe('context comment modality anchors', () => {
  test('records a generated-image pin in media coordinates without inventing Board context', () => {
    const store = createEditorStore()
    const anchor = resolveContextCommentAnnotationAnchor(
      store,
      draft({ captureContext: null, captureSource: null, target: null }),
      { x: 0.25, y: 0.75 }
    )

    expect(anchor.source).toEqual({
      id: 'evidence-1',
      kind: 'generated-image',
      label: 'Generated image'
    })
    expect(anchor.selectors).toEqual([
      {
        coordinateSpace: 'media',
        kind: 'media-fragment',
        mediaKind: 'image',
        mimeType: 'image/png',
        spatial: { x: 0.25, y: 0.75 }
      }
    ])
  })

  test('keeps both absolute Board position and exact rotation-aware object position', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      height: 100,
      name: 'Rotated card',
      rotation: 30,
      width: 200,
      x: 180,
      y: 120
    })
    select(store, node.id)
    const pagePoint = TransformMatrix.mapPoint(getWorldMatrix(node, store.graph), {
      x: 50,
      y: 75
    })
    const anchor = resolveContextCommentAnnotationAnchor(store, draft(), {
      x: pagePoint.x / 1_000,
      y: pagePoint.y / 800
    })

    expect(anchor.source.id).toBe(node.id)
    expect(anchor.selectors.find((selector) => selector.kind === 'board-position')).toMatchObject({
      kind: 'board-position',
      point: pagePoint
    })
    const relative = anchor.selectors.find((selector) => selector.kind === 'node-relative')
    expect(relative).toMatchObject({ kind: 'node-relative', nodeId: node.id })
    if (relative?.kind !== 'node-relative') throw new Error('Expected object-relative selector')
    expect(relative.localPoint.x).toBeCloseTo(50)
    expect(relative.localPoint.y).toBeCloseTo(75)
    expect(relative.normalizedPoint.x).toBeCloseTo(0.25)
    expect(relative.normalizedPoint.y).toBeCloseTo(0.75)
  })

  test('records video object coordinates and the playback time from the captured frame', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 200,
      name: 'Walkthrough',
      pluginData: contentSourcePluginData({
        fileName: 'walkthrough.mp4',
        format: 'mp4',
        mimeType: 'video/mp4',
        revision: CONTENT_SOURCE_REVISION,
        source: assetReference('video-hash')
      }),
      width: 400,
      x: 100,
      y: 100
    })
    select(store, node.id)
    const currentDraft = draft()
    if (!currentDraft.captureSource) throw new Error('Expected capture source')
    currentDraft.captureSource.mediaPlayback = {
      [node.id]: { currentTimeSeconds: 12.4, durationSeconds: 61.2, paused: false }
    }

    const anchor = resolveContextCommentAnnotationAnchor(store, currentDraft, {
      x: 0.3,
      y: 0.25
    })
    const media = anchor.selectors.find((selector) => selector.kind === 'media-fragment')

    expect(media).toMatchObject({
      coordinateSpace: 'object',
      durationSeconds: 61.2,
      fileName: 'walkthrough.mp4',
      kind: 'media-fragment',
      mediaKind: 'video',
      paused: false,
      spatial: { x: 0.5, y: 0.5 },
      timeSeconds: 12.4
    })
    expect(contextCommentAnnotationAnchorLabel(anchor)).toBe('Video · 0:12')
    expect(contextCommentAnnotationAnchorLines(anchor)).toContain(
      'Media: video "walkthrough.mp4"; t 12.4s of 61.2s (playing at capture); xy 50%,50% in object space'
    )
  })

  test('records the Code Object identity and active PDF page', () => {
    const store = createEditorStore()
    const document = createPdfDocumentDocument()
    document.state.activePage = 4
    const node = createCodeObject(store, {
      document,
      height: 520,
      name: 'Clinical reference',
      width: 720,
      x: 80,
      y: 60
    })
    store.graph.updateNode(node.id, {
      pluginData: [
        ...codeObjectPluginData(node, document),
        ...contentSourcePluginData({
          fileName: 'reference.pdf',
          format: 'pdf',
          mimeType: 'application/pdf',
          revision: CONTENT_SOURCE_REVISION,
          source: assetReference('pdf-hash')
        })
      ]
    })
    select(store, node.id)

    const anchor = resolveContextCommentAnnotationAnchor(store, draft(), { x: 0.44, y: 0.4 })

    expect(anchor.selectors.find((selector) => selector.kind === 'code-object')).toMatchObject({
      component: 'pdf-document',
      definitionId: 'openpencil.pdf-document',
      frameId: node.id,
      kind: 'code-object'
    })
    expect(
      anchor.selectors.find((selector) => selector.kind === 'document-position')
    ).toMatchObject({
      fileName: 'reference.pdf',
      format: 'pdf',
      kind: 'document-position',
      page: 4,
      revision: CONTENT_SOURCE_REVISION
    })
    expect(contextCommentAnnotationAnchorLabel(anchor)).toBe('PDF · page 4')
  })

  test('records native images in object coordinates', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
      fills: [
        {
          color: { a: 1, b: 0, g: 0, r: 0 },
          imageHash: 'image-hash',
          imageScaleMode: 'FILL',
          opacity: 1,
          type: 'IMAGE',
          visible: true
        }
      ],
      height: 200,
      name: 'Clinical photo',
      pluginData: contentSourcePluginData({
        fileName: 'clinical-photo.png',
        format: 'png',
        mimeType: 'image/png',
        revision: CONTENT_SOURCE_REVISION,
        source: assetReference('image-hash')
      }),
      width: 300,
      x: 100,
      y: 100
    })
    select(store, node.id)

    const anchor = resolveContextCommentAnnotationAnchor(store, draft(), { x: 0.25, y: 0.25 })

    expect(anchor.selectors.find((selector) => selector.kind === 'media-fragment')).toMatchObject({
      coordinateSpace: 'object',
      fileName: 'clinical-photo.png',
      kind: 'media-fragment',
      mediaKind: 'image',
      spatial: { x: 0.5, y: 0.5 }
    })
  })

  test('records semantic diagram elements and revisions', () => {
    const store = createEditorStore()
    const owner = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 300,
      name: 'Care flow',
      pluginData: [
        { key: 'mermaid/diagram-id', pluginId: 'open-pencil', value: 'diagram-care-flow' },
        { key: 'mermaid/revision', pluginId: 'open-pencil', value: '7' }
      ],
      width: 500,
      x: 100,
      y: 100
    })
    const step = store.graph.createNode('RECTANGLE', owner.id, {
      height: 80,
      name: 'Review step',
      pluginData: [{ key: 'mermaid/semantic-id', pluginId: 'open-pencil', value: 'review-node' }],
      width: 140,
      x: 40,
      y: 50
    })
    select(store, step.id)

    const anchor = resolveContextCommentAnnotationAnchor(store, draft(), { x: 0.21, y: 0.19 })

    expect(anchor.source.id).toBe(owner.id)
    expect(anchor.selectors.find((selector) => selector.kind === 'diagram-element')).toEqual({
      diagramId: 'diagram-care-flow',
      kind: 'diagram-element',
      ownerId: owner.id,
      revision: 7,
      semanticId: 'review-node'
    })
  })

  test('labels 3D annotations as projected-only until a real raycast exists', () => {
    const store = createEditorStore()
    const node = store.graph.createNode('FRAME', store.state.currentPageId, {
      height: 360,
      name: 'Scanner model',
      pluginData: [
        ...contentSourcePluginData({
          fileName: 'scanner.glb',
          format: 'glb',
          mimeType: 'model/gltf-binary',
          revision: CONTENT_SOURCE_REVISION,
          source: assetReference('spatial-hash')
        }),
        ...spatialMediaPluginData([], {
          camera: { position: [1, 2, 3], target: [0, 0, 0] },
          format: 'glb'
        })
      ],
      width: 540,
      x: 80,
      y: 60
    })
    select(store, node.id)

    const anchor = resolveContextCommentAnnotationAnchor(store, draft(), { x: 0.35, y: 0.3 })

    expect(anchor.selectors.find((selector) => selector.kind === 'spatial-projection')).toEqual({
      camera: { position: [1, 2, 3], target: [0, 0, 0] },
      fileName: 'scanner.glb',
      format: 'glb',
      kind: 'spatial-projection',
      precision: 'projected-only'
    })
    expect(contextCommentAnnotationAnchorLabel(anchor)).toBe('3D · projected')
  })

  test('records live-element and agent-conversation identities', () => {
    const store = createEditorStore()
    const node = createCodeObject(store, {
      document: createAgentConversationTerminalDocument({
        name: 'Review chart',
        workerConversationId: 'conversation-42'
      }),
      height: 300,
      name: 'Review chart',
      width: 500,
      x: 100,
      y: 100
    })
    const currentDraft = draft({
      target: {
        bounds: { height: 40, width: 120, x: 180, y: 160 },
        frameId: node.id,
        kind: 'live-container',
        label: 'Approve',
        live: {
          attrs: { 'data-slot': 'approve-action' },
          localRect: { height: 40, width: 120, x: 80, y: 60 },
          role: 'button',
          tagName: 'button',
          text: 'Approve'
        },
        path: ['Document', 'Page 1', 'Review chart', 'Approve'],
        scope,
        stableIds: ['approve-action']
      }
    })

    const anchor = resolveContextCommentAnnotationAnchor(store, currentDraft, {
      x: 0.2,
      y: 0.225
    })

    expect(anchor.selectors.find((selector) => selector.kind === 'live-element')).toMatchObject({
      frameId: node.id,
      kind: 'live-element',
      role: 'button',
      stableId: 'approve-action',
      text: 'Approve'
    })
    expect(anchor.selectors.find((selector) => selector.kind === 'agent-conversation')).toEqual({
      conversationId: 'conversation-42',
      frameId: node.id,
      kind: 'agent-conversation'
    })
  })

  test('falls back to an auditable Board-only anchor when no object is under the pin', () => {
    const store = createEditorStore()
    const anchor = resolveContextCommentAnnotationAnchor(store, draft(), { x: 0.8, y: 0.625 })

    expect(anchor.source).toEqual({
      id: store.state.currentPageId,
      kind: 'board',
      label: 'Page 1'
    })
    expect(anchor.selectors).toMatchObject([
      {
        kind: 'board-position',
        point: { x: 800, y: 500 }
      }
    ])
  })
})
