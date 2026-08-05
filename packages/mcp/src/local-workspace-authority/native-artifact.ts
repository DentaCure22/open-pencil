import type { Rect, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { parseAuthorityCodeObjectIntent, type AuthorityCodeObjectIntent } from './code-object'
import type { AuthorityBoardDocument } from './document'
import {
  authorityCardInputDigest,
  authorityCardMarker,
  authorityCardRequestMatches,
  createAuthorityNativeCard,
  parseAuthorityCardOperation,
  type AuthorityCardOperation
} from './native-card'
import {
  authorityTextInputDigest,
  authorityTextMarker,
  authorityTextReadback,
  authorityTextRequestMatches,
  createAuthorityNativeText,
  parseAuthorityTextOperation,
  type AuthorityTextOperation
} from './native-text'

type JsonRecord = Record<string, unknown>
export type AuthorityBuildIntent =
  | AuthorityCodeObjectIntent
  | { inputDigest: string; kind: 'native_card'; operation: AuthorityCardOperation }
  | { inputDigest: string; kind: 'native_text'; operation: AuthorityTextOperation }
export type CreatedAuthorityArtifact =
  | ({ kind: 'native_card' } & ReturnType<typeof createAuthorityNativeCard>)
  | ({ kind: 'native_text' } & ReturnType<typeof createAuthorityNativeText>)

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalString(value: JsonRecord, field: string): string | undefined {
  const result = value[field]
  return typeof result === 'string' && result.trim() ? result.trim() : undefined
}

export function authorityNodeSummary(graph: SceneGraph, node: SceneNode) {
  return {
    bounds: graph.getAbsoluteBounds(node.id),
    child_ids: [...node.childIds],
    id: node.id,
    name: node.name,
    parent_id: node.parentId,
    ...(node.type === 'TEXT' ? { text: node.text } : {}),
    type: node.type,
    visible: node.visible
  }
}

export async function authorityBuildIntent(
  args: JsonRecord,
  command: 'board_build' | 'board_change'
): Promise<AuthorityBuildIntent> {
  const operation = isRecord(args.operation) ? args.operation : null
  let recipe: unknown = args.recipe
  if (command === 'board_change') {
    recipe =
      operation && isRecord(operation.artifact)
        ? { ...operation.artifact, placement: operation.placement }
        : undefined
  }
  if (!isRecord(recipe)) throw new Error(`${command} requires one supported native recipe.`)
  const taskId = optionalString(args, 'task_id')
  const traceId = optionalString(args, 'trace_id')
  if (recipe.kind === 'code_object') {
    if (command !== 'board_build') {
      throw new Error('Local authority Code Object creation requires board_build.')
    }
    return parseAuthorityCodeObjectIntent(
      recipe,
      optionalString(args, 'anchor_id'),
      taskId,
      traceId
    )
  }
  if (recipe.kind === 'native_text') {
    const anchorId =
      command === 'board_change' && operation
        ? optionalString(operation, 'anchor_id')
        : optionalString(args, 'anchor_id')
    const textOperation = parseAuthorityTextOperation(recipe, anchorId)
    return {
      inputDigest: authorityTextInputDigest(textOperation, taskId, traceId),
      kind: 'native_text',
      operation: textOperation
    }
  }
  const cardOperation = parseAuthorityCardOperation(recipe)
  return {
    inputDigest: authorityCardInputDigest(cardOperation, taskId, traceId),
    kind: 'native_card',
    operation: cardOperation
  }
}

export function authorityArtifactRequestMatches(
  graph: SceneGraph,
  pageId: string,
  requestId: string
): SceneNode[] {
  return [
    ...authorityTextRequestMatches(graph, pageId, requestId),
    ...authorityCardRequestMatches(graph, pageId, requestId)
  ]
}

export function replayAuthorityArtifact(
  graph: SceneGraph,
  pageId: string,
  node: SceneNode,
  intent: AuthorityBuildIntent,
  requestId: string
): JsonRecord {
  if (intent.kind === 'native_card') {
    const marker = authorityCardMarker(node)
    if (!marker || marker.inputDigest !== intent.inputDigest) {
      throw new Error(`Request "${requestId}" was already used for a different mutation.`)
    }
    return { card: { owner: authorityNodeSummary(graph, node) } }
  }
  const marker = authorityTextMarker(node)
  if (!marker || marker.inputDigest !== intent.inputDigest) {
    throw new Error(`Request "${requestId}" was already used for a different mutation.`)
  }
  const readback = authorityTextReadback(graph, pageId, node, marker)
  if (readback.reconciliation.status !== 'current') {
    throw new Error(
      `Native text receipt readback diverged: ${readback.reconciliation.reasons.join(', ')}.`
    )
  }
  return readback
}

export function createAuthorityArtifact(
  document: AuthorityBoardDocument,
  pageId: string,
  intent: AuthorityBuildIntent,
  requestId: string,
  placementAnchor?: Rect
): CreatedAuthorityArtifact {
  if (intent.kind === 'code_object') {
    throw new Error('Code Object creation must use the staged authority path.')
  }
  return intent.kind === 'native_text'
    ? {
        kind: 'native_text',
        ...createAuthorityNativeText(
          document,
          pageId,
          intent.operation,
          intent.inputDigest,
          requestId,
          placementAnchor
        )
      }
    : {
        kind: 'native_card',
        ...createAuthorityNativeCard(
          document,
          pageId,
          intent.operation,
          intent.inputDigest,
          requestId,
          placementAnchor
        )
      }
}

export function committedAuthorityReadback(
  document: AuthorityBoardDocument,
  pageId: string,
  owner: SceneNode,
  created: CreatedAuthorityArtifact
): JsonRecord {
  if (created.kind === 'native_card') {
    const title = document.graph.getNode(created.title.id)
    const body = document.graph.getNode(created.body.id)
    if (!title || !body) {
      throw new Error('Committed native card children are missing from readback.')
    }
    return {
      card: {
        body: authorityNodeSummary(document.graph, body),
        owner: authorityNodeSummary(document.graph, owner),
        title: authorityNodeSummary(document.graph, title)
      }
    }
  }
  const marker = authorityTextMarker(owner)
  if (!marker) throw new Error('Committed native text receipt is missing from readback.')
  const readback = authorityTextReadback(document.graph, pageId, owner, marker)
  if (readback.reconciliation.status !== 'current') {
    throw new Error(
      `Committed native text readback diverged: ${readback.reconciliation.reasons.join(', ')}.`
    )
  }
  return readback
}
