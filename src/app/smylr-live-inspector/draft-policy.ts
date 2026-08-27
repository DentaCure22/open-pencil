import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerOwner,
  SmylrLiveContainerSource
} from '../smylr-live-container/types'
import type { LiveInspectorPatchDraft } from './patch'
import { createLiveInspectorTreeIndex, findLiveInspectorNode } from './tree'

function sanitizedOwner(owner: SmylrLiveContainerOwner): SmylrLiveContainerOwner {
  return {
    componentName: owner.componentName,
    filePath: owner.filePath,
    lineNumber: owner.lineNumber,
    sourceKind: owner.sourceKind
  }
}

function sanitizedSource(
  source: SmylrLiveContainerSource | undefined
): SmylrLiveContainerSource | undefined {
  if (!source) return undefined
  const ownerPath = source.ownerPath?.map(sanitizedOwner)
  return {
    ...sanitizedOwner(source),
    ownerPath: ownerPath?.length ? ownerPath : undefined
  }
}

function sourceIdentity(source: SmylrLiveContainerSource | undefined) {
  if (!source) return ''
  const ownerPath = (source.ownerPath ?? [])
    .map((owner) =>
      [
        owner.componentName,
        owner.filePath ?? '',
        owner.lineNumber ?? '',
        owner.sourceKind ?? ''
      ].join(':')
    )
    .join('>')
  return [
    source.componentName,
    source.filePath ?? '',
    source.lineNumber ?? '',
    source.sourceKind ?? '',
    ownerPath
  ].join('|')
}

export function copyLiveInspectorPatchDraft(
  draft: LiveInspectorPatchDraft
): LiveInspectorPatchDraft {
  return {
    add: [...draft.add],
    nodeId: draft.nodeId,
    note: draft.note,
    remove: [...draft.remove],
    source: sanitizedSource(draft.source),
    styles: draft.styles ? { ...draft.styles } : undefined
  }
}

export function copyLiveInspectorDraftMap(source: Map<string, LiveInspectorPatchDraft>) {
  return new Map([...source].map(([id, draft]) => [id, copyLiveInspectorPatchDraft(draft)]))
}

export function liveInspectorDraftMapsEqual(
  left: Map<string, LiveInspectorPatchDraft>,
  right: Map<string, LiveInspectorPatchDraft>
) {
  if (left.size !== right.size) return false
  for (const [id, draft] of left) {
    const other = right.get(id)
    if (!other || JSON.stringify(draft) !== JSON.stringify(other)) return false
  }
  return true
}

function remapLiveInspectorDraft(
  draft: LiveInspectorPatchDraft,
  document: SmylrLiveContainerDocument
) {
  if (findLiveInspectorNode(document.tree, draft.nodeId)) return copyLiveInspectorPatchDraft(draft)

  const sourceKey = sourceIdentity(draft.source)
  const sourceMatches: SmylrLiveContainerNode[] = []
  const labelMatches: SmylrLiveContainerNode[] = []
  for (const { node } of createLiveInspectorTreeIndex(document.tree).flatNodes) {
    if (sourceKey && sourceIdentity(node.source) === sourceKey) sourceMatches.push(node)
    if (draft.note && node.label === draft.note) labelMatches.push(node)
  }
  let match: SmylrLiveContainerNode | undefined
  if (sourceMatches.length === 1) match = sourceMatches[0]
  else if (labelMatches.length === 1) match = labelMatches[0]
  return match
    ? copyLiveInspectorPatchDraft({
        ...draft,
        nodeId: match.id,
        note: match.label,
        source: match.source
      })
    : null
}

export function remapLiveInspectorDrafts(
  drafts: readonly LiveInspectorPatchDraft[],
  document: SmylrLiveContainerDocument
) {
  return drafts
    .map((draft) => remapLiveInspectorDraft(draft, document))
    .filter((draft): draft is LiveInspectorPatchDraft => draft !== null)
}
