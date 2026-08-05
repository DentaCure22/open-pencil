import { randomBytes } from 'node:crypto'

import {
  createSmylrTrustedWebAppDocument,
  isCodeObjectViewportPresetId,
  serializeCodeObjectPluginData
} from '@open-pencil/core/code-object'
import {
  applyBoardTransactionChanges,
  boardBuildPlanCompositionCurrentBounds,
  boardBuildPlanCompositionGap,
  boardBuildPlanCompositionMembers,
  boardBuildPlanConvergenceAnchor,
  boardBuildPlanDigestInput,
  boardBuildPlanInboundReferences,
  boardBuildPlanLayoutMembers,
  boardBuildPlanReferenceKey,
  boardBuildTracedConnections,
  captureBoardTransactionState,
  compileBoardBuildPlanComposition,
  compileBoardBuildPlanLayout,
  diffBoardTransactionStates,
  inspectBoardTransactionChanges,
  parseBoardBuildPlan,
  resolveBoardBuildPlanOperations,
  type BoardBuildPlan,
  type BoardBuildPlanBounds,
  type BoardBuildPlanCanonicalObjectOperation,
  type BoardBuildPlanConnection,
  type BoardBuildPlanOperation,
  type BoardBuildPlanReference,
  type BoardBuildPlanResolvedOperation,
  type BoardTransactionChange
} from '@open-pencil/core/rpc'
import {
  canonicalMemoryDerivedFromId,
  canonicalMemoryPeerNodes,
  canonicalMemoryObjectId,
  forkCanonicalObject,
  materializeCanonicalObject,
  type CanonicalObjectForkResult
} from '@open-pencil/core/tools'
import {
  canAddObjectGraphConnection,
  findEquivalentObjectGraphConnection,
  OBJECT_GRAPH_SCHEMA_VERSION,
  objectGraphConnectionById,
  objectGraphConnectionsOnPage,
  setObjectGraphConnectionsOnPage,
  type ObjectGraphConnection,
  type ObjectGraphPermission,
  type ObjectGraphPortSide,
  type SceneNode,
  type Vector
} from '@open-pencil/scene-graph'

import {
  authorityCodeObjectReadback,
  authorityCodeObjectRequestMatches,
  createAuthorityCodeObject,
  type AuthorityCodeObjectCreateReceipt
} from './code-object'
import {
  readAuthorityBoardDocument,
  writeAuthorityBoardDocument,
  type AuthorityBoardDocument
} from './document'
import { compileHeadlessMermaidScenes } from './mermaid-compiler'
import {
  authorityBuildIntent,
  authorityNodeSummary,
  committedAuthorityReadback,
  createAuthorityArtifact,
  type AuthorityBuildIntent,
  type CreatedAuthorityArtifact
} from './native-artifact'
import { authorityNativeCardFootprint } from './native-card'
import {
  authorityDiagramOperation,
  createAuthorityNativeDiagram,
  readAuthorityMermaidSource,
  replaceAuthorityNativeDiagram,
  type CreatedAuthorityNativeDiagram
} from './native-diagram'
import { authorityNativeTextFootprint } from './native-text'
import {
  applyAuthorityObjectEdit,
  authorityObjectEditReadback,
  parseAuthorityObjectEditIntent,
  type AuthorityObjectEditReceipt
} from './object-edit'
import {
  AuthorityPlacementError,
  parseAuthorityPlacementDirections,
  requireAuthorityAnchor,
  resolveAuthorityAnchoredPlacement,
  resolveAuthorityFreePlacement,
  type AuthorityFreePlacementTarget
} from './placement'
import { authorityMutationInputDigest } from './request-digest'
import type { LocalWorkspaceAuthorityStore } from './store'
import type { LocalWorkspaceAuthorityHead } from './types'

const EXECUTION_SURFACE = 'local_workspace_authority'
const RECEIPT_PLUGIN_ID = 'openpencil.agent-tools'
const RECEIPT_KEY_PREFIX = 'authority-board-plan-request:'
const MAX_CONNECTIONS_PER_OBJECT = 64
const AUTHORITY_PLAN_ARTIFACT_KINDS = new Set<AuthorityPlanArtifactKind>([
  'canonical_object',
  'code_object',
  'native_card',
  'native_diagram',
  'native_text',
  'unknown'
])
export const AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX = '__openpencil_board_plan__:'
const PLAN_ARG_FIELDS = new Set([
  'content_document_id',
  'context_token',
  'contract',
  'document_id',
  'expected_revision',
  'intent',
  'page_id',
  'plan',
  'request_id',
  'runtime_instance_id',
  'task_id',
  'trace_id',
  'workspace_id'
])

type JsonRecord = Record<string, unknown>

type AuthorityBoardPlanReceipt = {
  aliases: Record<string, string>
  appliedRevision: number
  artifactDigests: Record<string, string>
  artifactKinds: Record<string, AuthorityPlanArtifactKind>
  baseRevision: number
  connectionIds: string[]
  connectionDigests: Record<string, string>
  connectionResults: AuthorityBoardPlanConnectionResult[]
  inputDigest: string
  operationResults: AuthorityBoardPlanOperationResult[]
  pageId: string
  requestId: string
  route: 'board_build:plan/v1'
  taskId?: string
  traceId?: string
  version: 1
}

type AuthorityBoardPlanObjectEditResult = {
  category: 'object_edit'
  digest: string | null
  effect: 'already_satisfied' | 'would_change'
  kind: string
  objectId: string
  receipt?: AuthorityObjectEditReceipt
  resultObjectId: string | null
}

type AuthorityBoardPlanConnectionResult = {
  connectionId: string
  effect: 'already_satisfied' | 'would_change'
  index: number
}

type AuthorityBoardPlanCanonicalObjectResult = {
  category: 'canonical_object'
  kind: BoardBuildPlanCanonicalObjectOperation['kind']
  result: CanonicalObjectForkResult
}

type AuthorityBoardPlanConnectionDeleteResult = {
  category: 'connection_delete'
  connectionId: string
  effect: 'already_satisfied' | 'would_change'
  kind: 'connection.delete'
}

type AuthorityBoardPlanTransactionRevertResult = {
  category: 'transaction_revert'
  changeCount: number
  effect: 'already_satisfied' | 'would_change'
  kind: 'transaction.revert'
  transactionId: string
}

type AuthorityBoardPlanOperationResult =
  | AuthorityBoardPlanCanonicalObjectResult
  | AuthorityBoardPlanConnectionDeleteResult
  | AuthorityBoardPlanTransactionRevertResult
  | AuthorityBoardPlanObjectEditResult

type PreparedAuthorityTransactionRevert = {
  changes: BoardTransactionChange[]
  transactionId: string
}

type AuthorityPlanArtifactKind =
  | 'canonical_object'
  | 'code_object'
  | 'native_card'
  | 'native_diagram'
  | 'native_text'
  | 'unknown'

type AuthorityPlanArtifact =
  | { alias: string; created: CreatedAuthorityArtifact }
  | { alias: string; created: { kind: 'canonical_object'; owner: SceneNode } }
  | { alias: string; created: CreatedAuthorityNativeDiagram }
  | {
      alias: string
      created: {
        kind: 'code_object'
        owner: SceneNode
        receipt: AuthorityCodeObjectCreateReceipt
      }
    }

type ResolvedAuthorityPlanContext = {
  current: boolean
  document: AuthorityBoardDocument
  head: LocalWorkspaceAuthorityHead
  page: SceneNode
}

type IssueAuthorityContext = (
  head: LocalWorkspaceAuthorityHead,
  page: SceneNode,
  document: AuthorityBoardDocument
) => unknown

type AuthorityBoardPlanTiming = {
  commit_ms?: number
  compile_ms?: number
  readback_ms?: number
  total_ms: number
}

type CanonicalPlacementStatus = 'current' | 'diverged' | 'missing' | 'moved'

function elapsed(started: number, finished: number): number {
  return Math.round(Math.max(0, finished - started) * 100) / 100
}

function canonicalPlacementStatus(
  document: AuthorityBoardDocument,
  pageId: string,
  expected: CanonicalObjectForkResult
): { actualCanonicalObjectId?: string; status: CanonicalPlacementStatus } {
  const node = document.graph.getNode(expected.placement_id)
  if (!node) return { status: 'missing' }
  const actualCanonicalObjectId = canonicalMemoryObjectId(node)
  if (!document.graph.isDescendant(node.id, pageId)) {
    return { actualCanonicalObjectId, status: 'moved' }
  }
  return {
    actualCanonicalObjectId,
    status:
      actualCanonicalObjectId === expected.canonical_object_id &&
      canonicalMemoryDerivedFromId(node) === expected.derived_from_canonical_object_id
        ? 'current'
        : 'diverged'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function requiredString(value: JsonRecord, field: string): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) throw new Error(`${field} is required.`)
  return result.trim()
}

function assertPlanArgs(value: JsonRecord): void {
  const unsupported = Object.keys(value).filter((field) => !PLAN_ARG_FIELDS.has(field))
  if (unsupported.length > 0) {
    throw new Error(
      `board build plan contains unsupported fields: ${unsupported.sort().join(', ')}.`
    )
  }
}

function optionalString(value: JsonRecord, field: string): string | undefined {
  const result = value[field]
  return typeof result === 'string' && result.trim() ? result.trim() : undefined
}

function operationResultsFrom(value: unknown): AuthorityBoardPlanOperationResult[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('invalid operation results')
  return value as AuthorityBoardPlanOperationResult[]
}

function connectionResultsFrom(
  value: unknown,
  connectionIds: readonly string[]
): AuthorityBoardPlanConnectionResult[] {
  if (value === undefined) {
    return connectionIds.map((connectionId, index) => ({
      connectionId,
      effect: 'would_change',
      index
    }))
  }
  if (!Array.isArray(value)) throw new Error('invalid connection results')
  const results = value as AuthorityBoardPlanConnectionResult[]
  if (
    results.some(
      (result) =>
        !isRecord(result) ||
        typeof result.connectionId !== 'string' ||
        !Number.isInteger(result.index) ||
        (result.effect !== 'already_satisfied' && result.effect !== 'would_change')
    )
  ) {
    throw new Error('invalid connection results')
  }
  return results
}

function receiptFromEntry(entry: { key: string; value: string }): AuthorityBoardPlanReceipt {
  try {
    const parsed: unknown = JSON.parse(entry.value)
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.aliases) ||
      !isRecord(parsed.artifactDigests) ||
      !Array.isArray(parsed.connectionIds) ||
      !isRecord(parsed.connectionDigests)
    ) {
      throw new Error('invalid shape')
    }
    if (
      parsed.version !== 1 ||
      parsed.route !== 'board_build:plan/v1' ||
      typeof parsed.appliedRevision !== 'number' ||
      typeof parsed.baseRevision !== 'number' ||
      typeof parsed.inputDigest !== 'string' ||
      typeof parsed.pageId !== 'string' ||
      typeof parsed.requestId !== 'string' ||
      Object.values(parsed.aliases).some((value) => typeof value !== 'string') ||
      Object.values(parsed.artifactDigests).some((value) => typeof value !== 'string') ||
      (parsed.artifactKinds !== undefined &&
        (!isRecord(parsed.artifactKinds) ||
          Object.values(parsed.artifactKinds).some(
            (value) => !AUTHORITY_PLAN_ARTIFACT_KINDS.has(value as AuthorityPlanArtifactKind)
          ))) ||
      Object.values(parsed.connectionDigests).some((value) => typeof value !== 'string') ||
      parsed.connectionIds.some((value) => typeof value !== 'string')
    ) {
      throw new Error('invalid fields')
    }
    return {
      aliases: parsed.aliases as Record<string, string>,
      appliedRevision: parsed.appliedRevision,
      artifactDigests: parsed.artifactDigests as Record<string, string>,
      artifactKinds: isRecord(parsed.artifactKinds)
        ? (parsed.artifactKinds as Record<string, AuthorityPlanArtifactKind>)
        : Object.fromEntries(Object.keys(parsed.aliases).map((alias) => [alias, 'unknown'])),
      baseRevision: parsed.baseRevision,
      connectionIds: parsed.connectionIds as string[],
      connectionDigests: parsed.connectionDigests as Record<string, string>,
      connectionResults: connectionResultsFrom(
        parsed.connectionResults,
        parsed.connectionIds as string[]
      ),
      inputDigest: parsed.inputDigest,
      operationResults: operationResultsFrom(parsed.operationResults),
      pageId: parsed.pageId,
      requestId: parsed.requestId,
      route: 'board_build:plan/v1',
      ...(typeof parsed.taskId === 'string' ? { taskId: parsed.taskId } : {}),
      ...(typeof parsed.traceId === 'string' ? { traceId: parsed.traceId } : {}),
      version: 1
    }
  } catch {
    throw new Error(`Board plan receipt "${entry.key}" is unreadable.`)
  }
}

function planReceiptsOnPage(page: SceneNode): AuthorityBoardPlanReceipt[] {
  return page.pluginData
    .filter(
      (entry) => entry.pluginId === RECEIPT_PLUGIN_ID && entry.key.startsWith(RECEIPT_KEY_PREFIX)
    )
    .map(receiptFromEntry)
}

export function authorityBoardPlanHistory(page: SceneNode) {
  return planReceiptsOnPage(page)
    .slice(-8)
    .reverse()
    .map((receipt) => ({
      applied_revision: receipt.appliedRevision,
      base_revision: receipt.baseRevision,
      request_id: receipt.requestId,
      route: receipt.route,
      ...(receipt.taskId ? { task_id: receipt.taskId } : {}),
      ...(receipt.traceId ? { trace_id: receipt.traceId } : {})
    }))
}

function planRequestMatches(
  document: AuthorityBoardDocument,
  requestId: string
): Array<{ page: SceneNode; receipt: AuthorityBoardPlanReceipt }> {
  return document.graph.getPages(true).flatMap((page) =>
    planReceiptsOnPage(page)
      .filter((receipt) => receipt.requestId === requestId)
      .map((receipt) => ({ page, receipt }))
  )
}

async function prepareTransactionRevert(options: {
  document: AuthorityBoardDocument
  pageId: string
  plan: BoardBuildPlan
  requestId: string
  store: LocalWorkspaceAuthorityStore
}): Promise<PreparedAuthorityTransactionRevert | undefined> {
  const operation = options.plan.operations?.find(
    (candidate) => candidate.kind === 'transaction.revert'
  )
  if (operation === undefined) return undefined
  if (operation.transaction_id === options.requestId) {
    throw new Error('transaction.revert must reference an earlier Board transaction.')
  }
  const matches = planRequestMatches(options.document, operation.transaction_id)
  if (matches.length > 1) {
    throw new Error(
      `Board transaction "${operation.transaction_id}" is missing or ambiguous. No mutation was applied.`
    )
  }
  const persistedMatches =
    matches.length === 0 ? await options.store.transactionReceipts(operation.transaction_id) : []
  if (matches.length === 0 && persistedMatches.length !== 1) {
    throw new Error(
      `Board transaction "${operation.transaction_id}" is missing or ambiguous. No mutation was applied.`
    )
  }
  let source: { appliedRevision: number; baseRevision: number; pageId: string } | null = null
  if (matches.length === 1) {
    const planSource = matches[0]
    source = {
      appliedRevision: planSource.receipt.appliedRevision,
      baseRevision: planSource.receipt.baseRevision,
      pageId: planSource.page.id
    }
  } else if (persistedMatches.length === 1) {
    const persistedSource = persistedMatches[0]
    if (persistedSource.transaction) {
      source = {
        appliedRevision: persistedSource.appliedRevision,
        baseRevision: persistedSource.baseRevision,
        pageId: persistedSource.transaction.pageId
      }
    }
  }
  if (!source) {
    throw new Error(
      `Board transaction "${operation.transaction_id}" is missing or ambiguous. No mutation was applied.`
    )
  }
  if (source.pageId !== options.pageId) {
    throw new Error('transaction.revert cannot cross Board pages. No mutation was applied.')
  }
  const [beforeHead, afterHead] = await Promise.all([
    options.store.headAtRevision(source.baseRevision),
    options.store.headAtRevision(source.appliedRevision)
  ])
  if (!beforeHead || !afterHead) {
    throw new Error(
      `Board transaction "${operation.transaction_id}" is outside retained history. No mutation was applied.`
    )
  }
  const beforeDocument = readAuthorityBoardDocument(beforeHead.document)
  const afterDocument = readAuthorityBoardDocument(afterHead.document)
  const beforePage = beforeDocument.graph.getNode(options.pageId)
  const afterPage = afterDocument.graph.getNode(options.pageId)
  if (beforePage?.type !== 'CANVAS' || afterPage?.type !== 'CANVAS') {
    throw new Error('Board transaction history no longer contains the exact page.')
  }
  return {
    changes: diffBoardTransactionStates(
      captureBoardTransactionState(beforeDocument.graph, options.pageId),
      captureBoardTransactionState(afterDocument.graph, options.pageId)
    ),
    transactionId: operation.transaction_id
  }
}

function addPlanReceipt(page: SceneNode, receipt: AuthorityBoardPlanReceipt): void {
  page.pluginData.push({
    key: `${RECEIPT_KEY_PREFIX}${receipt.requestId}`,
    pluginId: RECEIPT_PLUGIN_ID,
    value: JSON.stringify(receipt)
  })
}

function artifactDigest(document: AuthorityBoardDocument, ownerId: string): string | null {
  const owner = document.graph.getNode(ownerId)
  if (!owner) return null
  const nodes = [owner, ...document.graph.getDescendants(owner.id)]
    .map((node) => authorityNodeSummary(document.graph, node))
    .sort((left, right) => left.id.localeCompare(right.id))
  return authorityMutationInputDigest('board_build:plan-artifact-state/v1', { nodes })
}

function connectionDigest(connection: ObjectGraphConnection): string {
  return authorityMutationInputDigest('board_build:plan-connection-state/v1', connection)
}

function referenceId(
  reference: BoardBuildPlanReference,
  aliases: Readonly<Record<string, string>>
): string {
  if ('object_id' in reference) return reference.object_id
  const value = aliases[reference.alias]
  if (!value) throw new Error(`Board plan alias "${reference.alias}" was not resolved.`)
  return value
}

function convergencePlacementAnchor(
  document: AuthorityBoardDocument,
  plan: BoardBuildPlan,
  artifact: BoardBuildPlan['artifacts'][number],
  aliases: Readonly<Record<string, string>>,
  intent: Awaited<ReturnType<typeof authorityBuildIntent>>
) {
  if (artifact.recipe.kind === 'native_diagram') return undefined
  if (artifact.recipe.placement?.relative_offset) return undefined
  const references = boardBuildPlanInboundReferences(plan, artifact.alias)
  if (references.length < 2) return undefined
  const sourceBounds = references.flatMap((reference) => {
    const objectId = 'object_id' in reference ? reference.object_id : aliases[reference.alias]
    if (!objectId) return []
    const node = document.graph.getNode(objectId)
    return node ? [document.graph.getAbsoluteBounds(node.id)] : []
  })
  if (sourceBounds.length !== references.length) return undefined
  const footprint =
    intent.kind === 'native_card'
      ? authorityNativeCardFootprint(intent.operation)
      : intent.kind === 'native_text'
        ? authorityNativeTextFootprint(intent.operation)
        : intent.operation.operation === 'create'
          ? { height: intent.operation.height, width: intent.operation.width }
          : undefined
  if (!footprint) return undefined
  const direction = artifact.recipe.placement?.preferred_directions?.[0] ?? 'right'
  return boardBuildPlanConvergenceAnchor(sourceBounds, footprint, direction)
}

function assertPageObject(
  document: AuthorityBoardDocument,
  pageId: string,
  objectId: string
): void {
  const node = document.graph.getNode(objectId)
  if (
    !node ||
    node.type === 'CANVAS' ||
    !document.graph.isDescendant(node.id, pageId) ||
    node.visible === false
  ) {
    throw new Error(`Board plan object "${objectId}" is not a visible object on the exact page.`)
  }
}

function artifactArgs(
  plan: BoardBuildPlan,
  index: number,
  aliases: Readonly<Record<string, string>>,
  taskId: string | undefined,
  traceId: string | undefined,
  exactPoint?: Vector
): JsonRecord {
  const artifact = plan.artifacts[index]
  if (!artifact) throw new Error(`Board plan artifact ${index} is missing.`)
  const convergenceReference =
    !exactPoint &&
    !artifact.anchor &&
    artifact.recipe.kind === 'native_card' &&
    artifact.recipe.placement?.target === undefined
      ? boardBuildPlanInboundReferences(plan, artifact.alias)[0]
      : undefined
  const anchorReference = artifact.anchor ?? convergenceReference
  const anchorId = anchorReference ? referenceId(anchorReference, aliases) : undefined
  const recipe = structuredClone(artifact.recipe) as JsonRecord
  if (exactPoint) {
    recipe.placement = {
      clearance: 0,
      target: { kind: 'point', x: exactPoint.x, y: exactPoint.y }
    }
  } else if (
    (recipe.kind === 'native_card' ||
      recipe.kind === 'code_object' ||
      recipe.kind === 'trusted_web_app') &&
    anchorId
  ) {
    const placement = isRecord(recipe.placement) ? recipe.placement : {}
    recipe.placement = {
      ...placement,
      target: { kind: 'relative', object_id: anchorId }
    }
  }
  const loweredRecipe =
    recipe.kind === 'trusted_web_app'
      ? (() => {
          const document = createSmylrTrustedWebAppDocument({
            label: String(recipe.name),
            route: String(recipe.route),
            ...(isCodeObjectViewportPresetId(recipe.viewport_preset)
              ? { viewportPreset: recipe.viewport_preset }
              : {})
          })
          return {
            height: recipe.height,
            initial_state: document.state,
            kind: 'code_object',
            name: document.name,
            object_key: document.definitionId,
            operation: 'create',
            placement: recipe.placement,
            props: document.props,
            source: document.source,
            source_format: 'tsx',
            width: recipe.width
          }
        })()
      : recipe
  return {
    ...(anchorId && (recipe.kind === 'native_text' || recipe.kind === 'native_diagram')
      ? { anchor_id: anchorId }
      : {}),
    recipe: loweredRecipe,
    ...(taskId ? { task_id: taskId } : {}),
    ...(traceId ? { trace_id: traceId } : {})
  }
}

function validationAliases(plan: BoardBuildPlan): Record<string, string> {
  return Object.fromEntries(
    plan.artifacts.map((artifact) => [artifact.alias, `__board_plan_alias__:${artifact.alias}`])
  )
}

async function prevalidatePlanArtifacts(options: {
  document: AuthorityBoardDocument
  pageId: string
  plan: BoardBuildPlan
  taskId?: string
  traceId?: string
}): Promise<{
  diagrams: Record<string, Awaited<ReturnType<typeof compileHeadlessMermaidScenes>>[number]>
  footprints: Record<string, Pick<BoardBuildPlanBounds, 'height' | 'width'>>
}> {
  const placeholders = validationAliases(options.plan)
  const layoutMembers = new Set(boardBuildPlanLayoutMembers(options.plan.layout))
  const compositionAliasMembers = new Set(
    boardBuildPlanCompositionMembers(options.plan.composition).flatMap((member) =>
      'alias' in member ? [member.alias] : []
    )
  )
  const needsFootprint = (alias: string): boolean =>
    layoutMembers.has(alias) || compositionAliasMembers.has(alias)
  const footprints: Record<string, Pick<BoardBuildPlanBounds, 'height' | 'width'>> = {}
  const diagramArtifacts = options.plan.artifacts.filter(
    (artifact) => artifact.recipe.kind === 'native_diagram'
  )
  const compiledDiagrams = await compileHeadlessMermaidScenes(
    diagramArtifacts.map((artifact) => artifact.recipe.source)
  )
  const diagrams = Object.fromEntries(
    diagramArtifacts.map((artifact, index) => {
      const scene = compiledDiagrams[index]
      if (!scene) throw new Error(`Plan diagram "${artifact.alias}" was not compiled.`)
      return [artifact.alias, scene]
    })
  )
  for (const [index, artifact] of options.plan.artifacts.entries()) {
    if (artifact.recipe.kind === 'native_diagram') {
      const scene = diagrams[artifact.alias]
      if (!scene) throw new Error(`Plan diagram "${artifact.alias}" was not prepared.`)
      if (artifact.recipe.owner_id) {
        const readback = readAuthorityMermaidSource(
          options.document,
          options.pageId,
          artifact.recipe.owner_id
        )
        if (readback.reconciliation.status !== 'current') {
          throw new Error(
            `Plan diagram "${artifact.alias}" cannot be regenerated because source reconciliation is "${readback.reconciliation.status}".`
          )
        }
      }
      if (needsFootprint(artifact.alias)) {
        footprints[artifact.alias] = { height: scene.height, width: scene.width }
      }
      continue
    }
    if (artifact.recipe.kind === 'canonical_object') {
      const source = options.document.graph.getNode(artifact.recipe.source_object_id)
      if (!source || source.type === 'CANVAS') {
        throw new TypeError(
          `Canonical source object "${artifact.recipe.source_object_id}" does not exist.`
        )
      }
      if (needsFootprint(artifact.alias)) {
        footprints[artifact.alias] = { height: source.height, width: source.width }
      }
      continue
    }
    const intent = await authorityBuildIntent(
      artifactArgs(
        options.plan,
        index,
        placeholders,
        options.taskId,
        options.traceId,
        needsFootprint(artifact.alias) ? { x: 0, y: 0 } : undefined
      ),
      'board_build'
    )
    if (intent.kind === 'code_object' && intent.operation.operation !== 'create') {
      throw new Error('board-build-plan/v1 supports Code Object creation only.')
    }
    if (needsFootprint(artifact.alias)) footprints[artifact.alias] = placementFootprint(intent)
  }
  for (const alias of compositionAliasMembers) {
    const footprint = footprints[alias]
    if (!footprint) throw new Error(`Composition member "${alias}" has no measured footprint.`)
    footprints[`alias:${alias}`] = footprint
  }
  for (const member of boardBuildPlanCompositionMembers(options.plan.composition)) {
    if (!('object_id' in member)) continue
    const node = options.document.graph.getNode(member.object_id)
    if (!node || node.parentId !== options.pageId || node.type === 'CANVAS' || !node.visible) {
      throw new Error(
        `Composition member "${member.object_id}" is not a visible top-level object on the exact Board.`
      )
    }
    const bounds = options.document.graph.getAbsoluteBounds(node.id)
    footprints[boardBuildPlanReferenceKey(member)] = {
      height: bounds.height,
      width: bounds.width
    }
  }
  return { diagrams, footprints }
}

function permissions(kind: BoardBuildPlanConnection['kind']): ObjectGraphPermission[] {
  if (kind === 'action') return ['target.action.execute']
  if (kind === 'data') return ['target.data.write']
  return []
}

function planConnectionPort(port: string | undefined): {
  id?: string
  side: ObjectGraphPortSide
} {
  if (
    port === undefined ||
    port === 'auto' ||
    port === 'bottom' ||
    port === 'left' ||
    port === 'right' ||
    port === 'top'
  ) {
    return { side: port ?? 'auto' }
  }
  return { id: port, side: 'auto' }
}

function createConnection(
  input: BoardBuildPlanConnection,
  aliases: Readonly<Record<string, string>>
): ObjectGraphConnection {
  const sourcePort = planConnectionPort(input.source_port)
  const targetPort = planConnectionPort(input.target_port)
  return {
    automatic: input.automatic ?? input.kind !== 'visual',
    id: `object-connection:${randomBytes(8).toString('hex')}`,
    kind: input.kind,
    label: input.label ?? input.kind,
    permissions: permissions(input.kind),
    schemaVersion: OBJECT_GRAPH_SCHEMA_VERSION,
    sourceNodeId: referenceId(input.source, aliases),
    sourcePort: sourcePort.side,
    ...(sourcePort.id ? { sourcePortId: sourcePort.id } : {}),
    targetNodeId: referenceId(input.target, aliases),
    targetPort: targetPort.side,
    ...(targetPort.id ? { targetPortId: targetPort.id } : {})
  }
}

function connectionMatchesRequestedState(
  existing: ObjectGraphConnection,
  requested: ObjectGraphConnection
): boolean {
  return (
    existing.automatic === requested.automatic &&
    existing.label === requested.label &&
    JSON.stringify(existing.permissions) === JSON.stringify(requested.permissions)
  )
}

function addPlanConnections(
  document: AuthorityBoardDocument,
  pageId: string,
  plan: BoardBuildPlan,
  aliases: Readonly<Record<string, string>>
): {
  connections: ObjectGraphConnection[]
  results: AuthorityBoardPlanConnectionResult[]
} {
  const existing = objectGraphConnectionsOnPage(document.graph, pageId)
  const created: ObjectGraphConnection[] = []
  const satisfied: ObjectGraphConnection[] = []
  const results: AuthorityBoardPlanConnectionResult[] = []
  for (const [index, input] of plan.connections.entries()) {
    const connection = createConnection(input, aliases)
    assertPageObject(document, pageId, connection.sourceNodeId)
    assertPageObject(document, pageId, connection.targetNodeId)
    const allConnections = [...existing, ...created]
    setObjectGraphConnectionsOnPage(document.graph, pageId, allConnections)
    const equivalent = findEquivalentObjectGraphConnection(document.graph, pageId, connection)
    if (equivalent) {
      if (!connectionMatchesRequestedState(equivalent, connection)) {
        throw new Error(
          `Board plan connection ${index} conflicts with existing connection "${equivalent.id}".`
        )
      }
      satisfied.push(equivalent)
      results.push({ connectionId: equivalent.id, effect: 'already_satisfied', index })
      continue
    }
    const sourceCount = allConnections.filter(
      (candidate) =>
        candidate.sourceNodeId === connection.sourceNodeId ||
        candidate.targetNodeId === connection.sourceNodeId
    ).length
    if (sourceCount >= MAX_CONNECTIONS_PER_OBJECT) {
      throw new Error('The Board plan source endpoint has reached its connection limit.')
    }
    const targetCount = allConnections.filter(
      (candidate) =>
        candidate.sourceNodeId === connection.targetNodeId ||
        candidate.targetNodeId === connection.targetNodeId
    ).length
    if (targetCount >= MAX_CONNECTIONS_PER_OBJECT) {
      throw new Error('The Board plan target endpoint has reached its connection limit.')
    }
    if (!canAddObjectGraphConnection(document.graph, pageId, connection)) {
      throw new Error(
        `Board plan connection ${index} is invalid for the current page, endpoints, or ports.`
      )
    }
    created.push(connection)
    satisfied.push(connection)
    results.push({ connectionId: connection.id, effect: 'would_change', index })
  }
  setObjectGraphConnectionsOnPage(document.graph, pageId, [...existing, ...created])
  return { connections: satisfied, results }
}

function placementFootprint(intent: AuthorityBuildIntent): { height: number; width: number } {
  if (intent.kind === 'native_card') return authorityNativeCardFootprint(intent.operation)
  if (intent.kind === 'native_text') return authorityNativeTextFootprint(intent.operation)
  if (intent.operation.operation !== 'create') {
    throw new Error('Board plan placement diagnostics require Code Object creation.')
  }
  return { height: intent.operation.height, width: intent.operation.width }
}

function placementClearance(intent: AuthorityBuildIntent): number {
  if (intent.kind !== 'code_object') return intent.operation.clearance
  if (intent.operation.operation !== 'create') {
    throw new Error('Board plan placement diagnostics require Code Object creation.')
  }
  return intent.operation.clearance
}

function requestedPlacementTarget(
  plan: BoardBuildPlan,
  artifact: BoardBuildPlan['artifacts'][number]
): unknown {
  if (artifact.anchor) return { anchor: artifact.anchor, kind: 'relative' }
  if (artifact.recipe.placement?.target) return artifact.recipe.placement.target
  const inbound = boardBuildPlanInboundReferences(plan, artifact.alias)
  if (inbound.length >= 2) return { kind: 'convergence', sources: inbound }
  if (inbound[0]) return { anchor: inbound[0], kind: 'relative' }
  return { kind: 'unspecified' }
}

function placementFailureMessage(options: {
  aliases: Readonly<Record<string, string>>
  artifact: BoardBuildPlan['artifacts'][number]
  error: AuthorityPlacementError
  index: number
  intent: AuthorityBuildIntent
  plan: BoardBuildPlan
}): string {
  const footprint = placementFootprint(options.intent)
  const conflict = options.error.details.conflict
  const conflictingAlias = conflict
    ? Object.entries(options.aliases).find(([, objectId]) => objectId === conflict.id)?.[0]
    : undefined
  const conflictDetail = conflict
    ? `; conflict=${JSON.stringify({
        ...(conflictingAlias ? { alias: conflictingAlias } : {}),
        bounds: conflict.bounds,
        name: conflict.name,
        object_id: conflict.id
      })}`
    : ''
  return `No collision-free placement for Board plan artifact "${options.artifact.alias}" at index ${options.index}: target=${JSON.stringify(requestedPlacementTarget(options.plan, options.artifact))}; footprint=${footprint.width}x${footprint.height}; clearance=${placementClearance(options.intent)}${conflictDetail}. No mutation was applied.`
}

function createCompiledArtifact(options: {
  artifact: BoardBuildPlan['artifacts'][number]
  baseRevision: number
  childRequestId: string
  document: AuthorityBoardDocument
  intent: AuthorityBuildIntent
  pageId: string
  placementAnchor?: Vector
}): AuthorityPlanArtifact['created'] {
  const { artifact, baseRevision, childRequestId, document, intent, pageId, placementAnchor } =
    options
  if (intent.kind === 'code_object') {
    const codeObject = createAuthorityCodeObject(
      document,
      pageId,
      intent,
      childRequestId,
      baseRevision,
      placementAnchor
    )
    if (artifact.recipe.kind === 'trusted_web_app') {
      const trustedDocument = createSmylrTrustedWebAppDocument({
        label: artifact.recipe.name,
        route: artifact.recipe.route,
        ...(artifact.recipe.viewport_preset
          ? { viewportPreset: artifact.recipe.viewport_preset }
          : {})
      })
      document.graph.updateNode(codeObject.owner.id, {
        pluginData: serializeCodeObjectPluginData(codeObject.owner, trustedDocument)
      })
      codeObject.owner = document.graph.getNode(codeObject.owner.id) ?? codeObject.owner
    }
    return {
      kind: 'code_object',
      owner: codeObject.owner,
      receipt: codeObject.receipt
    }
  }
  return createAuthorityArtifact(document, pageId, intent, childRequestId, placementAnchor)
}

function canonicalArtifactPlacementTarget(
  artifact: BoardBuildPlan['artifacts'][number],
  aliases: Readonly<Record<string, string>>,
  exactPoint: Vector | undefined
): AuthorityFreePlacementTarget | undefined {
  if (exactPoint) return { kind: 'point', ...exactPoint }
  if (artifact.anchor) {
    return { kind: 'relative', objectId: referenceId(artifact.anchor, aliases) }
  }
  const target = artifact.recipe.placement?.target
  if (target?.kind === 'relative') return { kind: 'relative', objectId: target.object_id }
  return target
}

function createCanonicalAuthorityArtifact(options: {
  aliases: Readonly<Record<string, string>>
  artifact: BoardBuildPlan['artifacts'][number]
  document: AuthorityBoardDocument
  exactPoint?: Vector
  pageId: string
}): { kind: 'canonical_object'; owner: SceneNode } {
  const { artifact, document, pageId } = options
  if (artifact.recipe.kind !== 'canonical_object') {
    throw new Error('Internal Board plan artifact mismatch for canonical object.')
  }
  const source = document.graph.getNode(artifact.recipe.source_object_id)
  if (!source || source.type === 'CANVAS') {
    throw new Error(`Canonical source object "${artifact.recipe.source_object_id}" does not exist.`)
  }
  const target = canonicalArtifactPlacementTarget(artifact, options.aliases, options.exactPoint)
  if (!target) throw new Error(`Canonical object artifact "${artifact.alias}" needs placement.`)
  const placement = resolveAuthorityFreePlacement({
    clearance: options.exactPoint ? 0 : (artifact.recipe.placement?.clearance ?? 48),
    footprint: { height: source.height, width: source.width },
    graph: document.graph,
    pageId,
    preferredDirections: parseAuthorityPlacementDirections(
      artifact.recipe.placement?.preferred_directions
    ),
    ...(artifact.recipe.placement?.relative_offset
      ? { relativeOffset: artifact.recipe.placement.relative_offset }
      : {}),
    target
  })
  const materialized = materializeCanonicalObject(document.graph, pageId, {
    sourceObjectId: source.id,
    x: placement.bounds.x,
    y: placement.bounds.y
  })
  const owner = document.graph.getNode(materialized.placement_id)
  if (!owner) throw new Error(`Canonical object artifact "${artifact.alias}" disappeared.`)
  return { kind: 'canonical_object', owner }
}

async function createAuthorityPlanArtifactAtPoint(options: {
  alias: string
  aliases: Readonly<Record<string, string>>
  artifact: BoardBuildPlan['artifacts'][number]
  artifactIndex: number
  baseRevision: number
  diagram?: Awaited<ReturnType<typeof compileHeadlessMermaidScenes>>[number]
  document: AuthorityBoardDocument
  exactPoint: Vector
  pageId: string
  plan: BoardBuildPlan
  requestId: string
  taskId?: string
  traceId?: string
}): Promise<AuthorityPlanArtifact['created']> {
  if (options.artifact.recipe.kind === 'canonical_object') {
    return createCanonicalAuthorityArtifact({
      aliases: options.aliases,
      artifact: options.artifact,
      document: options.document,
      exactPoint: options.exactPoint,
      pageId: options.pageId
    })
  }
  if (options.artifact.recipe.kind === 'native_diagram') {
    if (!options.diagram) throw new Error(`Plan diagram "${options.alias}" was not prepared.`)
    return createAuthorityNativeDiagram({
      document: options.document,
      operation: authorityDiagramOperation({
        exactPoint: options.exactPoint,
        recipe: options.artifact.recipe
      }),
      pageId: options.pageId,
      scene: options.diagram
    })
  }
  const intent = await authorityBuildIntent(
    artifactArgs(
      options.plan,
      options.artifactIndex,
      options.aliases,
      options.taskId,
      options.traceId,
      options.exactPoint
    ),
    'board_build'
  )
  return createCompiledArtifact({
    artifact: options.artifact,
    baseRevision: options.baseRevision,
    childRequestId: `${AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX}${options.requestId}:${options.alias}`,
    document: options.document,
    intent,
    pageId: options.pageId
  })
}

async function createLayoutArtifacts(options: {
  aliases: Record<string, string>
  artifacts: AuthorityPlanArtifact[]
  baseRevision: number
  document: AuthorityBoardDocument
  diagrams: Readonly<
    Record<string, Awaited<ReturnType<typeof compileHeadlessMermaidScenes>>[number]>
  >
  footprints: Readonly<Record<string, Pick<BoardBuildPlanBounds, 'height' | 'width'>>>
  pageId: string
  plan: BoardBuildPlan
  requestId: string
  taskId?: string
  traceId?: string
}): Promise<void> {
  const layout = options.plan.layout
  if (!layout) return
  const compiled = compileBoardBuildPlanLayout(layout, options.footprints)
  let groupPlacement
  try {
    const common = {
      clearance: layout.placement?.clearance ?? 48,
      footprint: compiled.footprint,
      graph: options.document.graph,
      pageId: options.pageId,
      preferredDirections: parseAuthorityPlacementDirections(layout.placement?.preferred_directions)
    }
    if ('kind' in layout.anchor) {
      groupPlacement =
        layout.anchor.width >= compiled.footprint.width &&
        layout.anchor.height >= compiled.footprint.height
          ? resolveAuthorityFreePlacement({ ...common, target: layout.anchor })
          : resolveAuthorityAnchoredPlacement({ ...common, anchor: layout.anchor })
    } else {
      const anchorId = referenceId(layout.anchor, options.aliases)
      assertPageObject(options.document, options.pageId, anchorId)
      const anchor = requireAuthorityAnchor(options.document.graph, options.pageId, anchorId)
      groupPlacement = resolveAuthorityAnchoredPlacement({
        ...common,
        anchor: options.document.graph.getAbsoluteBounds(anchor.id)
      })
    }
  } catch (error) {
    if (error instanceof AuthorityPlacementError) {
      const conflict = error.details.conflict
      throw new Error(
        `No collision-free placement for Board plan layout: anchor=${JSON.stringify(layout.anchor)}; footprint=${compiled.footprint.width}x${compiled.footprint.height}; clearance=${layout.placement?.clearance ?? 48}${conflict ? `; conflict=${JSON.stringify(conflict)}` : ''}. No mutation was applied.`
      )
    }
    throw error
  }
  const artifactIndexes = new Map(
    options.plan.artifacts.map((artifact, index) => [artifact.alias, index])
  )
  for (const alias of boardBuildPlanLayoutMembers(layout)) {
    const index = artifactIndexes.get(alias)
    const localBounds = compiled.aliases[alias]
    if (index === undefined || !localBounds) {
      throw new Error(`Compiled Board plan layout member "${alias}" is missing.`)
    }
    const artifact = options.plan.artifacts[index]
    if (!artifact) throw new Error(`Board plan artifact ${index} is missing.`)
    const exactPoint = {
      x: groupPlacement.bounds.x + localBounds.x + localBounds.width / 2,
      y: groupPlacement.bounds.y + localBounds.y + localBounds.height / 2
    }
    let created: AuthorityPlanArtifact['created']
    try {
      created = await createAuthorityPlanArtifactAtPoint({
        alias,
        aliases: options.aliases,
        artifact,
        artifactIndex: index,
        baseRevision: options.baseRevision,
        diagram: options.diagrams[alias],
        document: options.document,
        exactPoint,
        pageId: options.pageId,
        plan: options.plan,
        requestId: options.requestId,
        ...(options.taskId ? { taskId: options.taskId } : {}),
        ...(options.traceId ? { traceId: options.traceId } : {})
      })
    } catch (error) {
      if (error instanceof AuthorityPlacementError) {
        throw new TypeError(
          `Compiled Board plan layout member "${alias}" could not use its exact precomputed cell. No mutation was applied.`
        )
      }
      throw error
    }
    options.aliases[alias] = created.owner.id
    options.artifacts.push({ alias, created })
  }
}

function authorityCompositionExcludedIds(
  document: AuthorityBoardDocument,
  pageId: string,
  plan: BoardBuildPlan
): Set<string> {
  const excluded = new Set<string>()
  const excludeObjectTree = (objectId: string): void => {
    const node = document.graph.getNode(objectId)
    if (!node) return
    excluded.add(node.id)
    for (const descendant of document.graph.getDescendants(node.id)) {
      excluded.add(descendant.id)
    }
  }
  for (const member of boardBuildPlanCompositionMembers(plan.composition)) {
    if (!('object_id' in member)) continue
    const node = document.graph.getNode(member.object_id)
    if (!node || node.parentId !== pageId || node.type === 'CANVAS' || !node.visible) {
      throw new Error(
        `Composition member "${member.object_id}" is not a visible top-level object on the exact Board.`
      )
    }
    excludeObjectTree(node.id)
  }
  for (const operation of plan.operations ?? []) {
    if (operation.kind === 'object.delete') excludeObjectTree(operation.object_id)
  }
  return excluded
}

function compositionPlacementDirections(
  plan: BoardBuildPlan
): Array<'above' | 'below' | 'left' | 'right'> {
  const composition = plan.composition
  if (!composition) throw new Error('Semantic composition is unavailable.')
  const preferred =
    composition.placement ?? (composition.preferences?.direction === 'vertical' ? 'below' : 'right')
  const defaults = ['right', 'below', 'left', 'above'] as const
  return [preferred, ...defaults.filter((direction) => direction !== preferred)]
}

async function createCompositionArtifacts(options: {
  aliases: Record<string, string>
  artifacts: AuthorityPlanArtifact[]
  baseRevision: number
  document: AuthorityBoardDocument
  diagrams: Readonly<
    Record<string, Awaited<ReturnType<typeof compileHeadlessMermaidScenes>>[number]>
  >
  footprints: Readonly<Record<string, Pick<BoardBuildPlanBounds, 'height' | 'width'>>>
  pageId: string
  plan: BoardBuildPlan
  requestId: string
  taskId?: string
  traceId?: string
  transactionRevert: PreparedAuthorityTransactionRevert | undefined
}): Promise<AuthorityBoardPlanOperationResult[]> {
  const composition = options.plan.composition
  if (!composition) return []
  const compiled = compileBoardBuildPlanComposition(
    composition,
    options.footprints,
    options.plan.connections
  )
  const excludedObjectIds = authorityCompositionExcludedIds(
    options.document,
    options.pageId,
    options.plan
  )
  let groupPlacement
  try {
    const common = {
      clearance: boardBuildPlanCompositionGap(composition),
      excludedObjectIds,
      footprint: compiled.footprint,
      graph: options.document.graph,
      pageId: options.pageId,
      preferredDirections: compositionPlacementDirections(options.plan)
    }
    if (!composition.anchor) {
      const currentBounds = boardBuildPlanCompositionCurrentBounds(composition, (objectId) => {
        const node = options.document.graph.getNode(objectId)
        return node ? options.document.graph.getAbsoluteBounds(node.id) : undefined
      })
      groupPlacement = resolveAuthorityFreePlacement({
        ...common,
        target: currentBounds ? { ...currentBounds, kind: 'near_region' } : { kind: 'auto' }
      })
    } else if ('kind' in composition.anchor) {
      groupPlacement = resolveAuthorityFreePlacement({ ...common, target: composition.anchor })
    } else {
      const anchorId = referenceId(composition.anchor, options.aliases)
      const anchor = requireAuthorityAnchor(options.document.graph, options.pageId, anchorId)
      groupPlacement = resolveAuthorityAnchoredPlacement({
        ...common,
        anchor: options.document.graph.getAbsoluteBounds(anchor.id)
      })
    }
  } catch (error) {
    if (error instanceof AuthorityPlacementError) {
      throw new Error(
        `No collision-free placement for semantic Board composition${composition.anchor ? ` near ${JSON.stringify(composition.anchor)}` : ''}. No mutation was applied.`
      )
    }
    throw error
  }

  const absoluteBounds = Object.fromEntries(
    Object.entries(compiled.members).map(([key, bounds]) => [
      key,
      {
        ...bounds,
        x: groupPlacement.bounds.x + bounds.x,
        y: groupPlacement.bounds.y + bounds.y
      }
    ])
  )
  const moves: BoardBuildPlanResolvedOperation[] = composition.members.flatMap((member) => {
    if (!('object_id' in member)) return []
    const bounds = absoluteBounds[boardBuildPlanReferenceKey(member)]
    if (!bounds) throw new Error(`Composition target for "${member.object_id}" is unavailable.`)
    return [{ kind: 'object.move' as const, object_id: member.object_id, x: bounds.x, y: bounds.y }]
  })
  const movePlan: BoardBuildPlan = {
    artifacts: [],
    connections: [],
    contract: options.plan.contract,
    ...(moves.length > 0 ? { operations: moves } : {})
  }
  const operationResults = applyPlanOperations(options.document, {
    baseRevision: options.baseRevision,
    pageId: options.pageId,
    plan: movePlan,
    requestId: `${options.requestId}:composition`,
    ...(options.taskId ? { taskId: options.taskId } : {}),
    ...(options.traceId ? { traceId: options.traceId } : {}),
    transactionRevert: options.transactionRevert
  })

  const artifactIndexes = new Map(
    options.plan.artifacts.map((artifact, index) => [artifact.alias, index])
  )
  for (const member of composition.members) {
    if (!('alias' in member)) continue
    const index = artifactIndexes.get(member.alias)
    const bounds = absoluteBounds[boardBuildPlanReferenceKey(member)]
    const artifact = index === undefined ? undefined : options.plan.artifacts[index]
    if (!artifact || index === undefined || !bounds) {
      throw new Error(`Compiled Board composition member "${member.alias}" is missing.`)
    }
    const created = await createAuthorityPlanArtifactAtPoint({
      alias: member.alias,
      aliases: options.aliases,
      artifact,
      artifactIndex: index,
      baseRevision: options.baseRevision,
      diagram: options.diagrams[member.alias],
      document: options.document,
      exactPoint: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      pageId: options.pageId,
      plan: options.plan,
      requestId: options.requestId,
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.traceId ? { traceId: options.traceId } : {})
    })
    options.aliases[member.alias] = created.owner.id
    options.artifacts.push({ alias: member.alias, created })
  }
  return operationResults
}

function isCanonicalObjectOperation(
  operation: BoardBuildPlanOperation
): operation is BoardBuildPlanCanonicalObjectOperation {
  return operation.kind === 'canonical_object.fork'
}

function authoritySharedObjectPatch(
  operation: BoardBuildPlanOperation
): Partial<Pick<SceneNode, 'name' | 'text'>> | undefined {
  if (operation.kind !== 'object.update') return undefined
  const patch: Partial<Pick<SceneNode, 'name' | 'text'>> = {}
  if (operation.patch.name !== undefined) patch.name = operation.patch.name
  if (operation.patch.text !== undefined) patch.text = operation.patch.text
  return Object.keys(patch).length > 0 ? patch : undefined
}

function applyTransactionRevert(
  document: AuthorityBoardDocument,
  pageId: string,
  operation: Extract<BoardBuildPlanOperation, { kind: 'transaction.revert' }>,
  prepared: PreparedAuthorityTransactionRevert | undefined
): AuthorityBoardPlanTransactionRevertResult {
  if (!prepared || prepared.transactionId !== operation.transaction_id) {
    throw new Error('Board transaction restore context is unavailable.')
  }
  const inspection = applyBoardTransactionChanges(
    document.graph,
    pageId,
    prepared.changes,
    'before'
  )
  return {
    category: 'transaction_revert',
    changeCount: prepared.changes.length,
    effect: inspection.applicable > 0 ? 'would_change' : 'already_satisfied',
    kind: operation.kind,
    transactionId: operation.transaction_id
  }
}

function applyPlanOperations(
  document: AuthorityBoardDocument,
  options: {
    baseRevision: number
    pageId: string
    plan: BoardBuildPlan
    requestId: string
    taskId?: string
    traceId?: string
    transactionRevert: PreparedAuthorityTransactionRevert | undefined
  }
): AuthorityBoardPlanOperationResult[] {
  const operations = resolveBoardBuildPlanOperations(
    options.plan.operations,
    (objectId) => {
      const node = document.graph.getNode(objectId)
      return node && node.type !== 'CANVAS' ? document.graph.getAbsoluteBounds(objectId) : undefined
    },
    (operation) =>
      boardBuildTracedConnections(document.graph, options.pageId, operation).map(
        (connection) => connection.id
      )
  )
  const transactionRevert = operations.find((operation) => operation.kind === 'transaction.revert')
  if (transactionRevert) {
    return [
      applyTransactionRevert(document, options.pageId, transactionRevert, options.transactionRevert)
    ]
  }
  const normalOperations = operations.filter(
    (
      operation
    ): operation is Exclude<BoardBuildPlanResolvedOperation, { kind: 'transaction.revert' }> =>
      operation.kind !== 'transaction.revert'
  )
  return normalOperations.flatMap<AuthorityBoardPlanOperationResult>(
    (operation, index): AuthorityBoardPlanOperationResult | AuthorityBoardPlanOperationResult[] => {
      if (operation.kind === 'connection.delete') {
        const existing = objectGraphConnectionById(
          document.graph,
          options.pageId,
          operation.connection_id
        )
        if (existing) {
          setObjectGraphConnectionsOnPage(
            document.graph,
            options.pageId,
            objectGraphConnectionsOnPage(document.graph, options.pageId).filter(
              ({ id }) => id !== operation.connection_id
            )
          )
        }
        return [
          {
            category: 'connection_delete' as const,
            connectionId: operation.connection_id,
            effect: existing ? ('would_change' as const) : ('already_satisfied' as const),
            kind: operation.kind
          }
        ]
      }
      if (isCanonicalObjectOperation(operation)) {
        return [
          {
            category: 'canonical_object' as const,
            kind: operation.kind,
            result: forkCanonicalObject(document.graph, options.pageId, operation.object_id)
          }
        ]
      }
      const existing = document.graph.getNode(operation.object_id)
      const peerNodes = existing ? canonicalMemoryPeerNodes(document.graph, existing) : []
      const sharedPatch = authoritySharedObjectPatch(operation)
      const endpointIds = new Set(
        existing
          ? [existing.id, ...[...document.graph.getDescendants(existing.id)].map(({ id }) => id)]
          : []
      )
      const childRequestId = `${AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX}${options.requestId}:operation:${index}`
      const intent = parseAuthorityObjectEditIntent(operation, options.taskId, options.traceId)
      const applied = applyAuthorityObjectEdit(
        document,
        options.pageId,
        intent,
        childRequestId,
        options.baseRevision
      )
      if (sharedPatch) {
        for (const peer of peerNodes) {
          if (peer.id !== operation.object_id) document.graph.updateNode(peer.id, sharedPatch)
        }
      }
      if (operation.kind === 'object.delete' && endpointIds.size > 0) {
        setObjectGraphConnectionsOnPage(
          document.graph,
          options.pageId,
          objectGraphConnectionsOnPage(document.graph, options.pageId).filter(
            (connection) =>
              !endpointIds.has(connection.sourceNodeId) && !endpointIds.has(connection.targetNodeId)
          )
        )
      }
      const resultObjectId =
        applied.outcome === 'applied'
          ? (applied.receipt?.resultObjectId ?? null)
          : operation.object_id
      return {
        category: 'object_edit' as const,
        digest: resultObjectId ? artifactDigest(document, resultObjectId) : null,
        effect: applied.outcome === 'no_change' ? 'already_satisfied' : 'would_change',
        kind: operation.kind,
        objectId: operation.object_id,
        ...(applied.receipt ? { receipt: applied.receipt } : {}),
        resultObjectId
      }
    }
  )
}

async function compilePlan(options: {
  document: AuthorityBoardDocument
  pageId: string
  plan: BoardBuildPlan
  baseRevision: number
  requestId: string
  taskId?: string
  traceId?: string
  transactionRevert: PreparedAuthorityTransactionRevert | undefined
}): Promise<{
  aliases: Record<string, string>
  artifacts: AuthorityPlanArtifact[]
  connections: ObjectGraphConnection[]
  connectionResults: AuthorityBoardPlanConnectionResult[]
  document: AuthorityBoardDocument
  operationResults: AuthorityBoardPlanOperationResult[]
}> {
  const prevalidated = await prevalidatePlanArtifacts(options)
  const working = readAuthorityBoardDocument(writeAuthorityBoardDocument(options.document))
  const aliases: Record<string, string> = {}
  const artifacts: AuthorityPlanArtifact[] = []
  const operationResults = applyPlanOperations(working, options)
  const layoutMembers = new Set(boardBuildPlanLayoutMembers(options.plan.layout))
  const compositionMembers = new Set(
    boardBuildPlanCompositionMembers(options.plan.composition).flatMap((member) =>
      'alias' in member ? [member.alias] : []
    )
  )
  let layoutCreated = false
  let compositionCreated = false
  const createCompositionWhenReady = async (): Promise<boolean> => {
    if (!options.plan.composition || compositionCreated) return compositionCreated
    const anchor = options.plan.composition.anchor
    if (anchor && 'alias' in anchor && !aliases[anchor.alias]) return false
    operationResults.push(
      ...(await createCompositionArtifacts({
        aliases,
        artifacts,
        baseRevision: options.baseRevision,
        document: working,
        diagrams: prevalidated.diagrams,
        footprints: prevalidated.footprints,
        pageId: options.pageId,
        plan: options.plan,
        requestId: options.requestId,
        ...(options.taskId ? { taskId: options.taskId } : {}),
        ...(options.traceId ? { traceId: options.traceId } : {}),
        transactionRevert: options.transactionRevert
      }))
    )
    compositionCreated = true
    return true
  }
  await createCompositionWhenReady()
  for (const [index, artifact] of options.plan.artifacts.entries()) {
    if (layoutMembers.has(artifact.alias)) {
      if (!layoutCreated) {
        await createLayoutArtifacts({
          aliases,
          artifacts,
          baseRevision: options.baseRevision,
          document: working,
          diagrams: prevalidated.diagrams,
          footprints: prevalidated.footprints,
          pageId: options.pageId,
          plan: options.plan,
          requestId: options.requestId,
          ...(options.taskId ? { taskId: options.taskId } : {}),
          ...(options.traceId ? { traceId: options.traceId } : {})
        })
        layoutCreated = true
      }
      continue
    }
    if (compositionMembers.has(artifact.alias)) {
      if (!(await createCompositionWhenReady())) {
        throw new Error('Composition anchor must be created before every member.')
      }
      continue
    }
    if (artifact.anchor) {
      assertPageObject(working, options.pageId, referenceId(artifact.anchor, aliases))
    }
    let created: AuthorityPlanArtifact['created']
    let placementIntent: AuthorityBuildIntent | undefined
    try {
      if (artifact.recipe.kind === 'canonical_object') {
        created = createCanonicalAuthorityArtifact({
          aliases,
          artifact,
          document: working,
          pageId: options.pageId
        })
      } else if (artifact.recipe.kind === 'native_diagram') {
        const scene = prevalidated.diagrams[artifact.alias]
        if (!scene) throw new Error(`Plan diagram "${artifact.alias}" was not prepared.`)
        created = artifact.recipe.owner_id
          ? replaceAuthorityNativeDiagram({
              document: working,
              ownerId: artifact.recipe.owner_id,
              pageId: options.pageId,
              scene
            })
          : createAuthorityNativeDiagram({
              document: working,
              operation: authorityDiagramOperation({
                ...(artifact.anchor ? { anchorId: referenceId(artifact.anchor, aliases) } : {}),
                recipe: artifact.recipe
              }),
              pageId: options.pageId,
              scene
            })
      } else {
        const intent = await authorityBuildIntent(
          artifactArgs(options.plan, index, aliases, options.taskId, options.traceId),
          'board_build'
        )
        placementIntent = intent
        const placementAnchor = convergencePlacementAnchor(
          working,
          options.plan,
          artifact,
          aliases,
          intent
        )
        created = createCompiledArtifact({
          artifact,
          baseRevision: options.baseRevision,
          childRequestId: `${AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX}${options.requestId}:${artifact.alias}`,
          document: working,
          intent,
          pageId: options.pageId,
          ...(placementAnchor ? { placementAnchor } : {})
        })
      }
    } catch (error) {
      if (error instanceof AuthorityPlacementError) {
        throw new TypeError(
          placementIntent
            ? placementFailureMessage({
                aliases,
                artifact,
                error,
                index,
                intent: placementIntent,
                plan: options.plan
              })
            : `No collision-free placement for Board plan artifact "${artifact.alias}".`
        )
      }
      throw error
    }
    aliases[artifact.alias] = created.owner.id
    artifacts.push({ alias: artifact.alias, created })
    await createCompositionWhenReady()
  }
  if (options.plan.composition && !(await createCompositionWhenReady())) {
    throw new Error('Composition anchor was unavailable during atomic compile.')
  }
  const connectionCompilation = addPlanConnections(working, options.pageId, options.plan, aliases)
  return {
    aliases,
    artifacts,
    connections: connectionCompilation.connections,
    connectionResults: connectionCompilation.results,
    document: working,
    operationResults
  }
}

function transactionRevertReadback(
  document: AuthorityBoardDocument,
  pageId: string,
  operation: AuthorityBoardPlanTransactionRevertResult,
  prepared: PreparedAuthorityTransactionRevert | undefined
): { current: boolean; operation: JsonRecord } {
  if (!prepared || prepared.transactionId !== operation.transactionId) {
    return {
      current: false,
      operation: {
        change_count: operation.changeCount,
        effect: operation.effect,
        operation: operation.kind,
        status: 'history_unavailable',
        transaction_id: operation.transactionId
      }
    }
  }
  const inspection = inspectBoardTransactionChanges(
    document.graph,
    pageId,
    prepared.changes,
    'before'
  )
  const current = inspection.status === 'already_satisfied'
  return {
    current,
    operation: {
      change_count: operation.changeCount,
      effect: operation.effect,
      operation: operation.kind,
      status: current ? 'current' : 'diverged',
      transaction_id: operation.transactionId
    }
  }
}

async function currentPlanReadback(
  document: AuthorityBoardDocument,
  pageId: string,
  receipt: AuthorityBoardPlanReceipt,
  transactionRevert: PreparedAuthorityTransactionRevert | undefined
): Promise<{
  aliases: Record<string, ReturnType<typeof authorityNodeSummary>>
  artifact_kinds: Record<string, AuthorityPlanArtifactKind>
  code_objects: Record<string, Awaited<ReturnType<typeof authorityCodeObjectReadback>>>
  connections: ObjectGraphConnection[]
  current: boolean
  operations: JsonRecord[]
}> {
  const transactionOperation = receipt.operationResults.find(
    (operation): operation is AuthorityBoardPlanTransactionRevertResult =>
      operation.category === 'transaction_revert'
  )
  if (transactionOperation) {
    const readback = transactionRevertReadback(
      document,
      pageId,
      transactionOperation,
      transactionRevert
    )
    return {
      aliases: {},
      artifact_kinds: {},
      code_objects: {},
      connections: [],
      current: readback.current,
      operations: [readback.operation]
    }
  }
  const aliases: Record<string, ReturnType<typeof authorityNodeSummary>> = {}
  const codeObjects: Record<string, Awaited<ReturnType<typeof authorityCodeObjectReadback>>> = {}
  const replacementAliasByOwner = new Map(
    Object.entries(receipt.aliases).map(([alias, ownerId]) => [ownerId, alias])
  )
  let current = true
  const nonTransactionOperations = receipt.operationResults.filter(
    (
      operation
    ): operation is Exclude<
      AuthorityBoardPlanOperationResult,
      AuthorityBoardPlanTransactionRevertResult
    > => operation.category !== 'transaction_revert'
  )
  const operations = nonTransactionOperations.map((operation, index, allOperations) => {
    if (operation.category === 'canonical_object') {
      const { actualCanonicalObjectId, status } = canonicalPlacementStatus(
        document,
        pageId,
        operation.result
      )
      if (status !== 'current') current = false
      return {
        ...(actualCanonicalObjectId ? { actual_canonical_object_id: actualCanonicalObjectId } : {}),
        canonical_object_id: operation.result.canonical_object_id,
        derived_from_canonical_object_id: operation.result.derived_from_canonical_object_id,
        operation: operation.kind,
        placement_id: operation.result.placement_id,
        status
      }
    }
    if (operation.category === 'connection_delete') {
      const exists = Boolean(
        objectGraphConnectionById(document.graph, pageId, operation.connectionId)
      )
      if (exists) current = false
      return {
        connection_id: operation.connectionId,
        effect: operation.effect,
        operation: operation.kind,
        status: exists ? 'diverged' : 'current'
      }
    }
    const isFinalForObject =
      allOperations.findLastIndex(
        (candidate) =>
          candidate.category === 'object_edit' && candidate.objectId === operation.objectId
      ) === index
    if (!isFinalForObject) {
      return {
        effect: operation.effect,
        object_id: operation.objectId,
        operation: operation.kind,
        result_object_id: operation.resultObjectId,
        status: 'superseded_by_later_operation'
      }
    }
    const replacementAlias = replacementAliasByOwner.get(operation.objectId)
    if (operation.kind === 'object.delete' && operation.receipt && replacementAlias) {
      return {
        effect: operation.effect,
        expected: operation.receipt.after,
        reconciliation: { reasons: [], status: 'current' },
        replacement: { alias: replacementAlias, object_id: operation.objectId }
      }
    }
    if (operation.receipt) {
      const readback = authorityObjectEditReadback(document, pageId, operation.receipt)
      if ((readback.reconciliation as { status: string }).status !== 'current') current = false
      return { effect: operation.effect, ...readback }
    }
    const digest = operation.resultObjectId
      ? artifactDigest(document, operation.resultObjectId)
      : null
    if (digest !== operation.digest) current = false
    return {
      effect: operation.effect,
      object_id: operation.objectId,
      operation: operation.kind,
      result_object_id: operation.resultObjectId,
      status: digest === operation.digest ? 'current' : 'diverged'
    }
  })
  for (const [alias, ownerId] of Object.entries(receipt.aliases)) {
    const owner = document.graph.getNode(ownerId)
    if (!owner || !document.graph.isDescendant(owner.id, pageId)) {
      current = false
      continue
    }
    aliases[alias] = authorityNodeSummary(document.graph, owner)
    if (artifactDigest(document, ownerId) !== receipt.artifactDigests[alias]) current = false
    if (receipt.artifactKinds[alias] === 'code_object') {
      const childRequestId = `${AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX}${receipt.requestId}:${alias}`
      const childReceipts = authorityCodeObjectRequestMatches(document, pageId, childRequestId)
      if (childReceipts.length !== 1) {
        current = false
        continue
      }
      const readback = await authorityCodeObjectReadback(document, pageId, childReceipts[0])
      codeObjects[alias] = readback
      if (readback.reconciliation.status !== 'current') current = false
    }
  }
  const connections = receipt.connectionIds.flatMap((connectionId) => {
    const connection = objectGraphConnectionById(document.graph, pageId, connectionId)
    if (!connection) {
      current = false
      return []
    }
    if (
      !document.graph.getNode(connection.sourceNodeId) ||
      !document.graph.getNode(connection.targetNodeId) ||
      connectionDigest(connection) !== receipt.connectionDigests[connectionId]
    ) {
      current = false
    }
    return [connection]
  })
  return {
    aliases,
    artifact_kinds: structuredClone(receipt.artifactKinds),
    code_objects: codeObjects,
    connections,
    current,
    operations
  }
}

function persistence(head: LocalWorkspaceAuthorityHead) {
  return {
    authority_id: head.authorityId,
    authority_revision: head.revision,
    content_hash: head.contentHash,
    status: 'durable',
    target: EXECUTION_SURFACE
  }
}

async function resultForReceipt(options: {
  document: AuthorityBoardDocument
  head: LocalWorkspaceAuthorityHead
  issueContext: IssueAuthorityContext
  page: SceneNode
  receipt: AuthorityBoardPlanReceipt
  replay: boolean
  timing: AuthorityBoardPlanTiming
  transactionRevert: PreparedAuthorityTransactionRevert | undefined
}): Promise<JsonRecord> {
  const readback = await currentPlanReadback(
    options.document,
    options.page.id,
    options.receipt,
    options.transactionRevert
  )
  const hasCodeObjects = Object.values(options.receipt.artifactKinds).includes('code_object')
  return {
    context: options.issueContext(options.head, options.page, options.document),
    execution_surface: EXECUTION_SURFACE,
    final_revision: options.head.revision,
    owner_ids: structuredClone(options.receipt.aliases),
    persistence: persistence(options.head),
    presentation: { reason: 'no_live_runtime', status: 'unavailable' },
    proof: {
      durable_readback: readback.current ? 'passed' : 'historical_only',
      normal_editor_undo: 'unavailable',
      pixels: 'not_evaluated',
      ...(hasCodeObjects
        ? {
            code_object_interaction: 'unavailable',
            code_object_runtime: 'unavailable',
            code_object_static_preflight: 'passed',
            code_objects: 'staged'
          }
        : {}),
      reason: readback.current ? 'no_live_runtime' : 'historical_receipt_only'
    },
    readback: { plan: readback },
    receipt: {
      appliedRevision: options.receipt.appliedRevision,
      baseRevision: options.receipt.baseRevision,
      connection_ids: [...options.receipt.connectionIds],
      connection_results: options.receipt.connectionResults.map((result) => ({
        connection_id: result.connectionId,
        effect: result.effect,
        index: result.index
      })),
      idempotent_replay: options.replay,
      input_digest: options.receipt.inputDigest,
      owner_ids: structuredClone(options.receipt.aliases),
      requestId: options.receipt.requestId,
      reversible: true,
      status: 'applied',
      transaction_id: options.receipt.requestId
    },
    status: {
      attention_required: !readback.current,
      command: readback.current ? 'completed' : 'unavailable',
      mutation: options.replay ? 'replayed' : 'applied',
      ...(readback.current ? {} : { reason: 'historical_receipt_only' })
    },
    timing: options.timing
  }
}

function pageFrom(document: AuthorityBoardDocument, pageId: string): SceneNode {
  const page = document.graph.getNode(pageId)
  if (page?.type !== 'CANVAS') throw new Error('Committed Board plan page is missing.')
  return page
}

export async function buildAuthorityBoardPlan(options: {
  args: JsonRecord
  issueContext: IssueAuthorityContext
  resolved: ResolvedAuthorityPlanContext
  store: LocalWorkspaceAuthorityStore
}): Promise<{ head: LocalWorkspaceAuthorityHead; page: SceneNode; result: JsonRecord }> {
  const { args, issueContext, resolved, store } = options
  const started = performance.now()
  assertPlanArgs(args)
  const { current, document, head, page } = resolved
  const requestId = requiredString(args, 'request_id')
  if (requestId.startsWith(AUTHORITY_BOARD_PLAN_INTERNAL_REQUEST_PREFIX)) {
    throw new Error('request_id uses a reserved internal Board plan prefix.')
  }
  const taskId = optionalString(args, 'task_id')
  const traceId = optionalString(args, 'trace_id')
  const plan = parseBoardBuildPlan(args.plan)
  const transactionRevert = await prepareTransactionRevert({
    document,
    pageId: page.id,
    plan,
    requestId,
    store
  })
  const inputDigest = authorityMutationInputDigest(
    'board_build:plan/v1',
    boardBuildPlanDigestInput(plan, {
      intent: requiredString(args, 'intent'),
      target: {
        content_document_id: requiredString(args, 'content_document_id'),
        document_id: requiredString(args, 'document_id'),
        page_id: requiredString(args, 'page_id'),
        runtime_instance_id: requiredString(args, 'runtime_instance_id'),
        workspace_id: requiredString(args, 'workspace_id')
      },
      ...(taskId ? { task_id: taskId } : {}),
      ...(traceId ? { trace_id: traceId } : {})
    })
  )
  const matches = planRequestMatches(document, requestId)
  if (matches.length > 1) throw new Error(`Request "${requestId}" is ambiguous.`)
  if (matches.length === 1) {
    const match = matches[0]
    if (match.page.id !== page.id || match.receipt.inputDigest !== inputDigest) {
      throw new Error(`Request "${requestId}" was already used for a different mutation.`)
    }
    return {
      head,
      page,
      result: await resultForReceipt({
        document,
        head,
        issueContext,
        page,
        receipt: match.receipt,
        replay: true,
        timing: { total_ms: elapsed(started, performance.now()) },
        transactionRevert
      })
    }
  }
  if (!current) {
    throw new Error('Board context is stale. Reacquire context; do not retarget the operation.')
  }
  if (args.expected_revision !== head.revision) {
    throw new Error(
      `Expected revision ${String(args.expected_revision)}, current revision is ${head.revision}.`
    )
  }
  const compileStarted = performance.now()
  const compiled = await compilePlan({
    baseRevision: head.revision,
    document,
    pageId: page.id,
    plan,
    requestId,
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {}),
    transactionRevert
  })
  const compileFinished = performance.now()
  const workingPage = pageFrom(compiled.document, page.id)
  const receipt: AuthorityBoardPlanReceipt = {
    aliases: compiled.aliases,
    appliedRevision: head.revision + 1,
    artifactDigests: Object.fromEntries(
      Object.entries(compiled.aliases).map(([alias, ownerId]) => {
        const digest = artifactDigest(compiled.document, ownerId)
        if (!digest) throw new Error(`Compiled Board plan alias "${alias}" is missing.`)
        return [alias, digest]
      })
    ),
    artifactKinds: Object.fromEntries(
      compiled.artifacts.map((artifact) => [artifact.alias, artifact.created.kind])
    ),
    baseRevision: head.revision,
    connectionIds: compiled.connections.map(({ id }) => id),
    connectionDigests: Object.fromEntries(
      compiled.connections.map((connection) => [connection.id, connectionDigest(connection)])
    ),
    connectionResults: compiled.connectionResults,
    inputDigest,
    operationResults: compiled.operationResults,
    pageId: page.id,
    requestId,
    route: 'board_build:plan/v1',
    ...(taskId ? { taskId } : {}),
    ...(traceId ? { traceId } : {}),
    version: 1
  }
  addPlanReceipt(workingPage, receipt)
  const commitStarted = performance.now()
  await store.commit({
    document: writeAuthorityBoardDocument(compiled.document),
    expectedContentHash: head.contentHash,
    expectedRevision: head.revision,
    requestId,
    workspaceId: head.identity.workspaceId
  })
  const commitFinished = performance.now()
  const nextHead = await store.head()
  if (!nextHead) throw new Error('Committed Board plan authority head is missing.')
  const nextDocument = readAuthorityBoardDocument(nextHead.document)
  const nextPage = pageFrom(nextDocument, page.id)
  const committedReceipt = planReceiptsOnPage(nextPage).find(
    (candidate) => candidate.requestId === requestId
  )
  if (!committedReceipt) throw new Error('Committed Board plan receipt is missing.')
  const readback = await currentPlanReadback(
    nextDocument,
    nextPage.id,
    committedReceipt,
    transactionRevert
  )
  if (!readback.current) throw new Error('Committed Board plan readback diverged.')
  for (const artifact of compiled.artifacts) {
    const owner = nextDocument.graph.getNode(compiled.aliases[artifact.alias] ?? '')
    if (!owner) throw new Error(`Committed Board plan alias "${artifact.alias}" is missing.`)
    if (artifact.created.kind === 'code_object') {
      const codeObjectReadback = await authorityCodeObjectReadback(
        nextDocument,
        nextPage.id,
        artifact.created.receipt
      )
      if (codeObjectReadback.reconciliation.status !== 'current') {
        throw new Error(`Committed Board plan Code Object "${artifact.alias}" readback diverged.`)
      }
    } else if (artifact.created.kind === 'native_diagram') {
      const mermaid = readAuthorityMermaidSource(nextDocument, nextPage.id, owner.id)
      if (mermaid.reconciliation.status !== 'current') {
        throw new Error(`Committed Board plan Mermaid "${artifact.alias}" readback diverged.`)
      }
    } else if (artifact.created.kind !== 'canonical_object') {
      committedAuthorityReadback(nextDocument, nextPage.id, owner, artifact.created)
    }
  }
  const readbackFinished = performance.now()
  return {
    head: nextHead,
    page: nextPage,
    result: await resultForReceipt({
      document: nextDocument,
      head: nextHead,
      issueContext,
      page: nextPage,
      receipt: committedReceipt,
      replay: false,
      timing: {
        commit_ms: elapsed(commitStarted, commitFinished),
        compile_ms: elapsed(compileStarted, compileFinished),
        readback_ms: elapsed(commitFinished, readbackFinished),
        total_ms: elapsed(started, readbackFinished)
      },
      transactionRevert
    })
  }
}
