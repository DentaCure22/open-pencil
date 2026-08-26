import { readContentSource, type ContentSourceMetadata } from '@open-pencil/core/io'
import type { SceneNode } from '@open-pencil/scene-graph'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { agentBoardObjectDocument } from '@/app/agent-terminal/board-object'
import { codeObjectRegionHints } from '@/app/code-object/inspector'
import { codeObjectDocument, type CodeObjectDocument } from '@/app/code-object/model'
import type { EditorStore } from '@/app/editor/session'
import { mediaEvidenceSource } from '@/app/media-evidence/source'
import { spatialMediaSource } from '@/app/spatial-media/source'

import { compactContextCommentText } from '../text'
import type { ContextCommentAnnotationSelector, ContextCommentDraft } from '../types'

type ModalitySelectorInput = {
  clientPoint: Vector
  draft: ContextCommentDraft
  hit: SceneNode
  normalizedObjectPoint: Vector | null
  owner: SceneNode
  pagePoint: Vector
  store: EditorStore
}

export type ContextCommentSelectorResolution = {
  route?: string
  selectors: ContextCommentAnnotationSelector[]
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

function spatialSelector(owner: SceneNode): ContextCommentAnnotationSelector | null {
  const spatial = spatialMediaSource(owner)
  if (!spatial) return null
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

export function resolveContextCommentSelectors(
  input: ModalitySelectorInput
): ContextCommentSelectorResolution {
  const optional = [
    spatialSelector(input.owner),
    spatialMediaSource(input.owner) ? null : mediaSelector(input),
    genericDocumentSelector(input.owner),
    agentConversationSelector(input.owner),
    diagramSelector(input.store, input.owner, input.hit),
    liveElementSelector(input)
  ]
  return {
    route: sourceRoute(input.owner, input.draft) ?? undefined,
    selectors: [
      ...optional.flatMap((selector) => (selector ? [selector] : [])),
      ...codeObjectSelectors(input)
    ]
  }
}
