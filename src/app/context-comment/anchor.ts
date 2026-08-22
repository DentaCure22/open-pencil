import { readContentSource, type ContentSourceMetadata } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import { getWorldMatrix, TransformMatrix } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { agentBoardObjectDocument } from '@/app/agent-terminal/board-object'
import { codeObjectRegionHints } from '@/app/code-object/inspector'
import { codeObjectDocument, type CodeObjectDocument } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { resolveNarratedTraceSceneTargets } from '@/app/narrated-trace'
import { spatialMediaSource } from '@/app/spatial-media/source'

import { contextCommentNodePath } from './scene-path'
import { compactContextCommentText } from './text'
import type {
  ContextCommentAnnotationAnchor,
  ContextCommentAnnotationSelector,
  ContextCommentDraft
} from './types'

const MAX_CANDIDATE_TARGETS = 8

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback
}

function normalizedPoint(point: Vector): Vector {
  return {
    x: Math.min(1, Math.max(0, finite(point.x))),
    y: Math.min(1, Math.max(0, finite(point.y)))
  }
}

function containsPoint(bounds: Rect | undefined, point: Vector) {
  return Boolean(
    bounds &&
    point.x >= bounds.x &&
    point.y >= bounds.y &&
    point.x <= bounds.x + bounds.width &&
    point.y <= bounds.y + bounds.height
  )
}

function pluginValue(node: SceneNode, key: string) {
  return (
    node.pluginData.find((entry) => entry.pluginId === 'open-pencil' && entry.key === key)?.value ??
    null
  )
}

function nodeAncestry(store: EditorStore, node: SceneNode) {
  const ancestry: SceneNode[] = []
  const visited = new Set<string>()
  let current: SceneNode | undefined = node
  while (current && ancestry.length < 32 && !visited.has(current.id)) {
    visited.add(current.id)
    ancestry.push(current)
    current = current.parentId ? store.graph.getNode(current.parentId) : undefined
  }
  return ancestry
}

function localPointForNode(store: EditorStore, node: SceneNode, pagePoint: Vector) {
  const inverse = TransformMatrix.invert(getWorldMatrix(node, store.graph))
  return inverse ? TransformMatrix.mapPoint(inverse, pagePoint) : null
}

function pointIsInsideNode(store: EditorStore, node: SceneNode, pagePoint: Vector) {
  const localPoint = localPointForNode(store, node, pagePoint)
  return Boolean(
    localPoint &&
    node.width > 0 &&
    node.height > 0 &&
    localPoint.x >= 0 &&
    localPoint.y >= 0 &&
    localPoint.x <= node.width &&
    localPoint.y <= node.height
  )
}

function annotationOwner(store: EditorStore, hit: SceneNode) {
  return (
    nodeAncestry(store, hit).find(
      (node) =>
        codeObjectDocument(node) !== null ||
        mediaEvidenceSource(node) !== null ||
        spatialMediaSource(node) !== null ||
        pluginValue(node, 'mermaid/diagram-id') !== null ||
        readContentSource(node) !== null
    ) ?? hit
  )
}

function selectedHit(store: EditorStore, pagePoint: Vector) {
  for (const id of store.state.selectedIds) {
    const node = store.graph.getNode(id)
    if (node && pointIsInsideNode(store, node, pagePoint)) return node
  }
  return null
}

function boardSelector(draft: ContextCommentDraft, pagePoint: Vector) {
  const captureContext = draft.captureContext
  if (!captureContext) return null
  const size = 1 / Math.max(captureContext.viewport.zoom, 0.01)
  return {
    kind: 'board-position' as const,
    point: pagePoint,
    region: {
      height: size,
      width: size,
      x: pagePoint.x - size / 2,
      y: pagePoint.y - size / 2
    },
    viewport: { ...captureContext.viewport }
  }
}

function nodeRelativeSelector(
  store: EditorStore,
  node: SceneNode,
  pagePoint: Vector
): ContextCommentAnnotationSelector | null {
  const localPoint = localPointForNode(store, node, pagePoint)
  if (!localPoint || node.width <= 0 || node.height <= 0) return null
  return {
    bounds: store.graph.getAbsoluteBounds(node.id),
    kind: 'node-relative',
    localPoint,
    nodeId: node.id,
    normalizedPoint: {
      x: localPoint.x / node.width,
      y: localPoint.y / node.height
    }
  }
}

function sourceRoute(node: SceneNode, draft: ContextCommentDraft) {
  return pluginValue(node, 'route') ?? draft.target?.route
}

function codeObjectRoute(document: NonNullable<ReturnType<typeof codeObjectDocument>>) {
  const route = Reflect.get(document, 'route')
  return typeof route === 'string' ? route : undefined
}

function stateSummary(value: unknown) {
  try {
    return compactContextCommentText(JSON.stringify(value), 800)
  } catch {
    return undefined
  }
}

function diagramSelector(
  store: EditorStore,
  node: SceneNode,
  hit: SceneNode
): ContextCommentAnnotationSelector | null {
  const owner = nodeAncestry(store, node).find(
    (candidate) => pluginValue(candidate, 'mermaid/diagram-id') !== null
  )
  if (!owner) return null
  const diagramId = pluginValue(owner, 'mermaid/diagram-id')
  if (!diagramId) return null
  const revisionText = pluginValue(owner, 'mermaid/revision')
  const revision = revisionText === null ? undefined : Number.parseInt(revisionText, 10)
  const semanticId = pluginValue(hit, 'mermaid/semantic-id')
  return {
    diagramId,
    kind: 'diagram-element',
    ownerId: owner.id,
    ...(Number.isSafeInteger(revision) ? { revision } : {}),
    ...(semanticId ? { semanticId } : {})
  }
}

type ModalitySelectorInput = {
  clientPoint: Vector
  draft: ContextCommentDraft
  hit: SceneNode
  normalizedObjectPoint: Vector | null
  owner: SceneNode
  pagePoint: Vector
  store: EditorStore
}

function spatialSelector(owner: SceneNode): ContextCommentAnnotationSelector | null {
  const spatial = spatialMediaSource(owner)
  if (spatial) {
    return {
      ...(spatial.camera
        ? {
            camera: {
              position: [...spatial.camera.position],
              target: [...spatial.camera.target]
            }
          }
        : {}),
      fileName: spatial.fileName,
      format: spatial.format,
      kind: 'spatial-projection',
      precision: 'projected-only'
    }
  }
  return null
}

function mediaSelector(input: ModalitySelectorInput): ContextCommentAnnotationSelector | null {
  const { draft, normalizedObjectPoint, owner } = input
  const media = mediaEvidenceSource(owner)
  const contentSource = readContentSource(owner)
  if (media?.kind === 'video' || media?.kind === 'audio') {
    const playback = draft.captureSource?.mediaPlayback?.[owner.id]
    return {
      coordinateSpace: 'object',
      ...(playback?.durationSeconds !== undefined
        ? { durationSeconds: playback.durationSeconds }
        : {}),
      fileName: media.fileName,
      kind: 'media-fragment',
      mediaKind: media.kind,
      mimeType: media.metadata.mimeType,
      ...(playback ? { paused: playback.paused, timeSeconds: playback.currentTimeSeconds } : {}),
      ...(media.kind === 'video' && normalizedObjectPoint ? { spatial: normalizedObjectPoint } : {})
    }
  }
  if (
    contentSource?.mimeType.toLowerCase().startsWith('image/') ||
    owner.fills.some((fill) => fill.type === 'IMAGE')
  ) {
    return {
      coordinateSpace: 'object',
      ...(contentSource?.fileName ? { fileName: contentSource.fileName } : {}),
      kind: 'media-fragment',
      mediaKind: 'image',
      ...(contentSource?.mimeType ? { mimeType: contentSource.mimeType } : {}),
      ...(normalizedObjectPoint ? { spatial: normalizedObjectPoint } : {})
    }
  }
  return null
}

function documentSourceFields(contentSource: ContentSourceMetadata | null) {
  if (!contentSource) return {}
  return {
    ...(contentSource.fileName ? { fileName: contentSource.fileName } : {}),
    revision: contentSource.revision
  }
}

function documentFormat(contentSource: ContentSourceMetadata | null, fallback: string) {
  return contentSource?.format ?? fallback
}

function documentSelectorForCodeObject(
  document: CodeObjectDocument,
  contentSource: ContentSourceMetadata | null
): ContextCommentAnnotationSelector | null {
  switch (document.component) {
    case 'pdf-document':
      return {
        ...documentSourceFields(contentSource),
        format: documentFormat(contentSource, 'pdf'),
        kind: 'document-position',
        page: document.state.activePage
      }
    case 'pptx-deck':
      return {
        ...documentSourceFields(contentSource),
        format: documentFormat(contentSource, 'pptx'),
        kind: 'document-position',
        slide: document.state.activeSlide + 1
      }
    case 'office-document':
    case 'office-spreadsheet':
      return {
        ...documentSourceFields(contentSource),
        format: documentFormat(contentSource, document.component),
        kind: 'document-position',
        revision: contentSource?.revision ?? document.state.revision
      }
    default:
      return null
  }
}

function codeObjectSelectors(input: ModalitySelectorInput) {
  const { clientPoint, draft, owner } = input
  const document = codeObjectDocument(owner)
  if (!document) return []
  const route = codeObjectRoute(document) ?? sourceRoute(owner, draft)
  const summary = stateSummary(document.state)
  const selectors: ContextCommentAnnotationSelector[] = [
    {
      component: document.component,
      definitionId: document.definitionId,
      frameId: owner.id,
      kind: 'code-object',
      ...(route ? { route } : {}),
      schemaVersion: document.schemaVersion,
      ...(summary ? { stateSummary: summary } : {})
    }
  ]
  const htmlElementConstructor: unknown = Reflect.get(globalThis, 'HTMLElement')
  const hint =
    typeof htmlElementConstructor === 'function'
      ? codeObjectRegionHints(
          owner.id,
          { height: 4, width: 4, x: clientPoint.x - 2, y: clientPoint.y - 2 },
          1
        ).at(0)
      : undefined
  if (hint) {
    selectors.push({
      boundsNormalized: hint.boundsNormalized,
      css: hint.selector,
      frameId: owner.id,
      kind: 'dom-element',
      name: hint.name,
      ...(hint.role ? { role: hint.role } : {}),
      tagName: hint.tagName,
      ...(hint.text ? { text: hint.text } : {})
    })
  }
  const documentSelector = documentSelectorForCodeObject(document, readContentSource(owner))
  if (documentSelector) selectors.push(documentSelector)
  return selectors
}

function genericDocumentSelector(owner: SceneNode): ContextCommentAnnotationSelector | null {
  if (codeObjectDocument(owner) || spatialMediaSource(owner)) return null
  const media = mediaEvidenceSource(owner)
  const contentSource = readContentSource(owner)
  if (!contentSource || media?.kind === 'video' || media?.kind === 'audio') return null
  if (contentSource.mimeType.toLowerCase().startsWith('image/')) return null
  return {
    ...(contentSource.fileName ? { fileName: contentSource.fileName } : {}),
    format: contentSource.format,
    kind: 'document-position',
    revision: contentSource.revision
  }
}

function agentConversationSelector(owner: SceneNode): ContextCommentAnnotationSelector | null {
  const document = agentBoardObjectDocument(owner)
  return document
    ? {
        conversationId: document.workerConversationId,
        frameId: owner.id,
        kind: 'agent-conversation'
      }
    : null
}

function liveElementSelector(
  input: ModalitySelectorInput
): ContextCommentAnnotationSelector | null {
  const { draft, owner, pagePoint } = input
  if (
    draft.target?.kind === 'live-container' &&
    draft.target.frameId === owner.id &&
    containsPoint(draft.target.bounds, pagePoint)
  ) {
    const live = draft.target.live
    if (!live) return null
    return {
      ...(live.attrs ? { attrs: { ...live.attrs } } : {}),
      frameId: owner.id,
      kind: 'live-element',
      localRect: { ...live.localRect },
      ...(live.role ? { role: live.role } : {}),
      stableId: draft.target.stableIds[0] ?? draft.target.label,
      ...(live.tagName ? { tagName: live.tagName } : {}),
      ...(live.text ? { text: live.text } : {})
    }
  }
  return null
}

function modalitySelectors(input: ModalitySelectorInput) {
  const optional = [
    spatialSelector(input.owner),
    spatialMediaSource(input.owner) ? null : mediaSelector(input),
    genericDocumentSelector(input.owner),
    agentConversationSelector(input.owner),
    diagramSelector(input.store, input.owner, input.hit),
    liveElementSelector(input)
  ]
  return [
    ...optional.flatMap((selector) => (selector ? [selector] : [])),
    ...codeObjectSelectors(input)
  ]
}

type SceneTargetResolution = ReturnType<typeof resolveNarratedTraceSceneTargets>

function capturedAtEpochMs(draft: ContextCommentDraft) {
  return draft.captureSource?.capturedAtEpochMs ?? draft.capture?.capturedAtMs ?? Date.now()
}

function generatedImageAnchor(
  draft: ContextCommentDraft,
  point: Vector
): ContextCommentAnnotationAnchor {
  return {
    candidateTargets: [],
    capturedAtEpochMs: capturedAtEpochMs(draft),
    selectors: [
      {
        coordinateSpace: 'media',
        kind: 'media-fragment',
        mediaKind: 'image',
        mimeType: draft.capture?.mimeType,
        spatial: point
      }
    ],
    source: {
      id: draft.capture?.evidenceId ?? draft.id,
      kind: 'generated-image',
      label: 'Generated image'
    }
  }
}

function candidateTargets(resolution: SceneTargetResolution, excludedId?: string) {
  return resolution.candidates
    .filter((candidate) => candidate.stableId !== excludedId)
    .slice(0, MAX_CANDIDATE_TARGETS)
    .map((candidate) => ({
      id: candidate.stableId,
      label: candidate.name,
      nodeType: candidate.nodeType
    }))
}

function scopeFields(draft: ContextCommentDraft) {
  const scope = draft.target?.scope
  if (!scope) return {}
  return {
    scope: {
      documentId: scope.documentId,
      ...(scope.documentName ? { documentName: scope.documentName } : {}),
      pageId: scope.pageId,
      ...(scope.pageName ? { pageName: scope.pageName } : {}),
      ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {})
    }
  }
}

function boardOnlyAnchor(
  store: EditorStore,
  draft: ContextCommentDraft,
  resolution: SceneTargetResolution,
  selectors: ContextCommentAnnotationSelector[]
): ContextCommentAnnotationAnchor {
  const page = store.graph.getNode(store.state.currentPageId)
  return {
    candidateTargets: candidateTargets(resolution),
    capturedAtEpochMs: capturedAtEpochMs(draft),
    sceneVersion: store.state.sceneVersion,
    ...scopeFields(draft),
    selectors,
    source: {
      id: store.state.currentPageId,
      kind: 'board',
      label: page?.name || 'Current Board'
    }
  }
}

function sceneNodeAnchor(input: {
  clientPoint: Vector
  draft: ContextCommentDraft
  hit: SceneNode
  owner: SceneNode
  pagePoint: Vector
  resolution: SceneTargetResolution
  selectors: ContextCommentAnnotationSelector[]
  store: EditorStore
}): ContextCommentAnnotationAnchor {
  const { clientPoint, draft, hit, owner, pagePoint, resolution, selectors, store } = input
  const relative = nodeRelativeSelector(store, owner, pagePoint)
  if (relative) selectors.push(relative)
  const objectPoint = relative?.kind === 'node-relative' ? relative.normalizedPoint : null
  selectors.push(
    ...modalitySelectors({
      clientPoint,
      draft,
      hit,
      normalizedObjectPoint: objectPoint,
      owner,
      pagePoint,
      store
    })
  )
  const route = sourceRoute(owner, draft)
  return {
    candidateTargets: candidateTargets(resolution, owner.id),
    capturedAtEpochMs: capturedAtEpochMs(draft),
    sceneVersion: store.state.sceneVersion,
    ...scopeFields(draft),
    selectors,
    source: {
      bounds: store.graph.getAbsoluteBounds(owner.id),
      id: owner.id,
      kind: 'scene-node',
      label: owner.name || owner.type,
      nodeType: owner.type,
      path: contextCommentNodePath(store, owner),
      ...(route ? { route } : {})
    }
  }
}

function liveFrameAtPoint(store: EditorStore, draft: ContextCommentDraft, pagePoint: Vector) {
  if (draft.target?.kind !== 'live-container') return null
  if (!containsPoint(draft.target.bounds, pagePoint) || !draft.target.frameId) return null
  return store.graph.getNode(draft.target.frameId) ?? null
}

/** Resolve one screenshot pin to the durable Board source and modality selectors beneath it. */
export function resolveContextCommentAnnotationAnchor(
  store: EditorStore,
  draft: ContextCommentDraft,
  imagePoint: Vector
): ContextCommentAnnotationAnchor {
  const point = normalizedPoint(imagePoint)
  if (!draft.captureContext) return generatedImageAnchor(draft, point)

  const pagePoint = {
    x: draft.captureContext.boardBounds.x + point.x * draft.captureContext.boardBounds.width,
    y: draft.captureContext.boardBounds.y + point.y * draft.captureContext.boardBounds.height
  }
  const screenPoint = {
    x: draft.captureContext.screenBounds.x + point.x * draft.captureContext.screenBounds.width,
    y: draft.captureContext.screenBounds.y + point.y * draft.captureContext.screenBounds.height
  }
  const clientPoint = {
    x: (draft.captureSource?.canvasBounds.x ?? 0) + screenPoint.x,
    y: (draft.captureSource?.canvasBounds.y ?? 0) + screenPoint.y
  }
  const resolution = resolveNarratedTraceSceneTargets(store, {
    height: 1,
    width: 1,
    x: screenPoint.x - 0.5,
    y: screenPoint.y - 0.5
  })
  const liveFrame = liveFrameAtPoint(store, draft, pagePoint)
  const selected = selectedHit(store, pagePoint)
  const resolved = resolution.target ? store.graph.getNode(resolution.target.stableId) : null
  const hit = liveFrame ?? selected ?? resolved
  const board = boardSelector(draft, pagePoint)
  const selectors: ContextCommentAnnotationSelector[] = board ? [board] : []
  if (!hit) return boardOnlyAnchor(store, draft, resolution, selectors)
  return sceneNodeAnchor({
    clientPoint,
    draft,
    hit,
    owner: annotationOwner(store, hit),
    pagePoint,
    resolution,
    selectors,
    store
  })
}
