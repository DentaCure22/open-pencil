import type { SceneNode } from '@open-pencil/scene-graph'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import type { EditorStore } from '@/app/editor/session'

import { resolveContextCommentSelectors } from './anchor/selectors'
import { resolveContextCommentSceneTarget, type SceneTargetResolution } from './anchor/target'
import { contextCommentNodePath } from './scene-path'
import type {
  ContextCommentAnnotationAnchor,
  ContextCommentAnnotationSelector,
  ContextCommentDraft
} from './types'

const MAX_CANDIDATE_TARGETS = 8

function normalizedPoint(point: Vector): Vector {
  const finite = (value: number) => (Number.isFinite(value) ? value : 0)
  return {
    x: Math.min(1, Math.max(0, finite(point.x))),
    y: Math.min(1, Math.max(0, finite(point.y)))
  }
}

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
  draft: ContextCommentDraft
  owner: SceneNode
  resolution: SceneTargetResolution
  route?: string
  selectors: ContextCommentAnnotationSelector[]
  store: EditorStore
}): ContextCommentAnnotationAnchor {
  const { draft, owner, resolution, route, selectors, store } = input
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

/** Resolve one screenshot pin to the durable Board source and modality selectors beneath it. */
export function resolveContextCommentAnnotationAnchor(
  store: EditorStore,
  draft: ContextCommentDraft,
  imagePoint: Vector
): ContextCommentAnnotationAnchor {
  const point = normalizedPoint(imagePoint)
  if (!draft.captureContext) return generatedImageAnchor(draft, point)

  const target = resolveContextCommentSceneTarget(store, draft, point)
  const selectors: ContextCommentAnnotationSelector[] = target.boardSelector
    ? [target.boardSelector]
    : []
  if (!target.hit || !target.owner) {
    return boardOnlyAnchor(store, draft, target.resolution, selectors)
  }

  if (target.relativeSelector) selectors.push(target.relativeSelector)
  const normalizedObjectPoint =
    target.relativeSelector?.kind === 'node-relative'
      ? target.relativeSelector.normalizedPoint
      : null
  const modality = resolveContextCommentSelectors({
    clientPoint: target.clientPoint,
    draft,
    hit: target.hit,
    normalizedObjectPoint,
    owner: target.owner,
    pagePoint: target.pagePoint,
    store
  })
  selectors.push(...modality.selectors)

  return sceneNodeAnchor({
    draft,
    owner: target.owner,
    resolution: target.resolution,
    route: modality.route,
    selectors,
    store
  })
}
