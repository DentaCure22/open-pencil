import {
  createMermaidSceneSpec,
  type MermaidDiagram,
  type MermaidSceneSpec
} from '@open-pencil/core/diagram'
import { mermaidDiagramOwner, reconcileMermaidDiagramSource } from '@open-pencil/core/editor'
import {
  applyBoardTransactionChanges,
  boardBuildPlanCompositionCurrentBounds,
  boardBuildPlanCompositionGap,
  boardBuildPlanCompositionMembers,
  boardBuildPlanInboundReferences,
  boardBuildPlanLayoutMembers,
  boardBuildPlanReferenceKey,
  boardBuildPlanDigestInput,
  boardBuildTracedConnections,
  captureBoardTransactionState,
  compileBoardBuildPlanComposition,
  compileBoardBuildPlanLayout,
  diffBoardTransactionStates,
  resolveBoardBuildPlanOperations,
  type BoardBuildPlan,
  type BoardBuildPlanArtifact,
  type BoardBuildPlanBounds,
  type BoardBuildPlanCanonicalObjectOperation,
  type BoardBuildPlanCompositionCompilation,
  type BoardBuildPlanConnection,
  type BoardBuildPlanLayoutCompilation,
  type BoardBuildPlanOperation,
  type BoardBuildPlanReference,
  type BoardBuildPlanResolvedOperation,
  type BoardTransactionChange
} from '@open-pencil/core/rpc'
import {
  canonicalMemoryPeerNodes,
  forkCanonicalObject,
  materializeCanonicalObject
} from '@open-pencil/core/tools'
import type {
  ObjectGraphConnection,
  ObjectGraphPermission,
  ObjectGraphPortSide,
  Rect,
  SceneNode
} from '@open-pencil/scene-graph'
import { findEquivalentObjectGraphConnection } from '@open-pencil/scene-graph'

import {
  applyObjectEditOperationInBatch,
  assertObjectEditOperationReady,
  nativeCardPlan,
  parseNativeCardOperation,
  parseNativeTextOperation,
  parseObjectEditOperation,
  placementFor,
  type AgentCardReceipt,
  type BoardPlacementDirection
} from '@/app/automation/bridge/board-tools'
import { nativeCardNodeProps } from '@/app/automation/bridge/board-tools/native/card'
import { boardViewportFocusBounds } from '@/app/automation/bridge/board-tools/neighborhood'
import {
  requireVisibleBoardAnchor,
  resolveCenteredFreePlacement,
  resolveNearestFreePlacement,
  visibleBoardObstacles
} from '@/app/automation/bridge/board-tools/placement'
import { nodeBounds, nodeSummary } from '@/app/automation/bridge/board-tools/readback'
import { createLocalLegibleTextPlan } from '@/app/automation/bridge/board-tools/visual-context'
import {
  coalesceAutomationMutationRequest,
  enqueueAutomationMutation
} from '@/app/automation/bridge/mutation-queue'
import {
  assertMutationRequestIdFresh,
  mutationRequestLedgerError,
  mutationRequestLedgerSnapshot,
  mutationRequestLedgerState,
  mutationRequestReadback,
  mutationRequestSignature,
  recordMutationRequestReceipt,
  reserveMutationRequest,
  restoreMutationRequestLedger,
  type MutationRequestReceipt
} from '@/app/automation/bridge/request-receipts'
import type { AutomationTarget, UnknownRecord } from '@/app/automation/bridge/target'
import { parseMermaidInBrowser } from '@/app/diagram/mermaid/parse'
import { connectObjects } from '@/app/object-graph'
import {
  removeObjectGraphConnectionRecord,
  restoreObjectGraphConnectionRecord,
  snapshotObjectGraphConnectionRecord
} from '@/app/object-graph/records'

import {
  createPlanCodeObject,
  preparePlanCodeObjects,
  type PreparedPlanCodeObject
} from './plan-code-object'
import { planArtifactPluginData } from './plan-marker'
import type { BoardBuildPlanInput } from './types'

const PLAN_ROUTE = 'board_build:plan/v1' as const
const PLAN_HISTORY_LABEL = 'Agent: build Board plan'
const LIVE_TRANSACTION_HISTORY_LIMIT = 64
const DEFAULT_DIRECTIONS: BoardPlacementDirection[] = ['right', 'below', 'left', 'above']
type PreparedLiveTransactionRevert = {
  changes: BoardTransactionChange[]
  transactionId: string
}
const liveTransactionHistory = new WeakMap<
  object,
  Map<string, { changes: BoardTransactionChange[]; pageId: string }>
>()
type PlanBuildOptions = {
  context: (target: AutomationTarget) => Promise<unknown>
  parseMermaid?: (source: string) => Promise<MermaidDiagram>
}
type PlanArtifactResult = {
  allIds: string[]
  codeObjectReadback?: Record<string, unknown>
  codeObjectReceipt?: Record<string, unknown>
  owner: SceneNode
}
type PlanApplyResult = {
  aliases: Record<string, string>
  allObjectIds: string[]
  codeObjects: Record<string, Record<string, unknown>>
  codeObjectReceipts: Record<string, Record<string, unknown>>
  connections: ObjectGraphConnection[]
  connectionResults: Array<{
    connection_id: string
    effect: 'already_satisfied' | 'would_change'
    index: number
  }>
  owners: SceneNode[]
  operations: Array<
    | {
        after: UnknownRecord
        effect: 'already_satisfied' | 'would_change'
        kind: string
        object_id: string
        result_object_id: string | null
      }
    | {
        canonical_object_id: string
        derived_from_canonical_object_id: string
        kind: BoardBuildPlanCanonicalObjectOperation['kind']
        object_ids: string[]
        placement_id: string
      }
    | {
        connection_id: string
        effect: 'already_satisfied' | 'would_change'
        kind: 'connection.delete'
      }
    | {
        change_count: number
        effect: 'already_satisfied' | 'would_change'
        kind: 'transaction.revert'
        transaction_id: string
      }
  >
}
type PreparedPlanDiagram = {
  scene: MermaidSceneSpec
}
type PreparedPlanLayout = {
  compilation: BoardBuildPlanLayoutCompilation
  resolvedBounds?: Record<string, BoardBuildPlanBounds>
}
type PreparedPlanComposition = {
  compilation: BoardBuildPlanCompositionCompilation
  excludedObjectIds: Set<string>
  resolvedBounds?: Record<string, BoardBuildPlanBounds>
}

function rememberLiveTransaction(
  target: AutomationTarget,
  requestId: string,
  changes: BoardTransactionChange[]
): void {
  const history = liveTransactionHistory.get(target.store) ?? new Map()
  history.delete(requestId)
  history.set(requestId, { changes: structuredClone(changes), pageId: target.pageId })
  while (history.size > LIVE_TRANSACTION_HISTORY_LIMIT) {
    const oldest = history.keys().next().value
    if (typeof oldest !== 'string') break
    history.delete(oldest)
  }
  liveTransactionHistory.set(target.store, history)
}

function prepareLiveTransactionRevert(
  target: AutomationTarget,
  input: BoardBuildPlanInput
): PreparedLiveTransactionRevert | undefined {
  const operation = input.plan.operations?.find(
    (candidate) => candidate.kind === 'transaction.revert'
  )
  if (operation === undefined) return undefined
  if (operation.transaction_id === input.requestId) {
    throw new Error('transaction.revert must reference an earlier Board transaction.')
  }
  const source = liveTransactionHistory.get(target.store)?.get(operation.transaction_id)
  if (!source || source.pageId !== target.pageId) {
    throw new Error(
      `Board transaction "${operation.transaction_id}" is unavailable in this live session. Use its durable next_build_target. No mutation was applied.`
    )
  }
  return {
    changes: structuredClone(source.changes),
    transactionId: operation.transaction_id
  }
}

function completeDirections(
  directions: BoardPlacementDirection[] | undefined
): BoardPlacementDirection[] {
  const ordered = directions ? [...directions] : []
  return [...ordered, ...DEFAULT_DIRECTIONS.filter((direction) => !ordered.includes(direction))]
}

function referenceId(reference: BoardBuildPlanReference, aliases: Record<string, string>): string {
  if ('object_id' in reference) return reference.object_id
  const id = aliases[reference.alias]
  if (!id) throw new Error(`Plan alias "${reference.alias}" is unavailable during apply.`)
  return id
}

function assertPageObject(target: AutomationTarget, objectId: string, label: string): void {
  const node = target.store.graph.getNode(objectId)
  if (
    !node ||
    node.type === 'CANVAS' ||
    !target.store.graph.isDescendant(objectId, target.pageId)
  ) {
    throw new Error(`${label} object "${objectId}" is missing or outside the target Board.`)
  }
}

function isCanonicalObjectOperation(
  operation: BoardBuildPlanOperation
): operation is BoardBuildPlanCanonicalObjectOperation {
  return operation.kind === 'canonical_object.fork'
}

function externalReferences(
  input: BoardBuildPlanInput
): Array<{ label: string; objectId: string }> {
  const references: Array<{ label: string; objectId: string }> = []
  input.plan.artifacts.forEach((artifact, index) => {
    if (artifact.anchor && 'object_id' in artifact.anchor) {
      references.push({
        label: `plan.artifacts[${index}].anchor`,
        objectId: artifact.anchor.object_id
      })
    }
    const recipe = artifact.recipe
    if (recipe.placement?.target?.kind === 'relative') {
      references.push({
        label: `plan.artifacts[${index}].recipe.placement.target`,
        objectId: recipe.placement.target.object_id
      })
    }
  })
  input.plan.connections.forEach((connection, index) => {
    if ('object_id' in connection.source) {
      references.push({
        label: `plan.connections[${index}].source`,
        objectId: connection.source.object_id
      })
    }
    if ('object_id' in connection.target) {
      references.push({
        label: `plan.connections[${index}].target`,
        objectId: connection.target.object_id
      })
    }
  })
  ;(input.plan.operations ?? []).forEach((operation, index) => {
    if (operation.kind === 'connection.delete_traced') {
      operation.object_ids.forEach((objectId, objectIndex) => {
        references.push({
          label: `plan.operations[${index}].object_ids[${objectIndex}]`,
          objectId
        })
      })
      return
    }
    if ('object_id' in operation) {
      references.push({
        label: `plan.operations[${index}].object_id`,
        objectId: operation.object_id
      })
    }
    if (operation.kind === 'object.move' && 'relative_to' in operation) {
      references.push({
        label: `plan.operations[${index}].relative_to.object_id`,
        objectId: operation.relative_to.object_id
      })
    }
  })
  if (input.plan.layout && 'object_id' in input.plan.layout.anchor) {
    references.push({
      label: 'plan.layout.anchor',
      objectId: input.plan.layout.anchor.object_id
    })
  }
  if (input.plan.composition) {
    if (input.plan.composition.anchor && 'object_id' in input.plan.composition.anchor) {
      references.push({
        label: 'plan.composition.anchor',
        objectId: input.plan.composition.anchor.object_id
      })
    }
    input.plan.composition.members.forEach((member, index) => {
      if ('object_id' in member) {
        references.push({
          label: `plan.composition.members[${index}]`,
          objectId: member.object_id
        })
      }
    })
  }
  return references
}

export function isSelfContainedCreatePlan(input: BoardBuildPlanInput): boolean {
  if ((input.plan.operations?.length ?? 0) > 0) return false
  if (externalReferences(input).length > 0) return false
  const layoutMembers = new Set(boardBuildPlanLayoutMembers(input.plan.layout))
  const compositionMembers = new Set(
    boardBuildPlanCompositionMembers(input.plan.composition).flatMap((member) =>
      'alias' in member ? [member.alias] : []
    )
  )
  return input.plan.artifacts.every((artifact) => {
    if (artifact.recipe.kind === 'canonical_object') return false
    if (
      layoutMembers.has(artifact.alias) ||
      compositionMembers.has(artifact.alias) ||
      artifact.anchor
    )
      return true
    if (boardBuildPlanInboundReferences(input.plan, artifact.alias).length > 0) return true
    const target = artifact.recipe.placement?.target
    return target?.kind === 'auto' || target?.kind === 'region'
  })
}

function planTouchedProperties(target: AutomationTarget, input: BoardBuildPlanInput): string[] {
  return isSelfContainedCreatePlan(input)
    ? [`${target.pageId}:create:${input.requestId}`]
    : [`${target.pageId}:*`]
}

function prevalidatePlan(
  target: AutomationTarget,
  input: BoardBuildPlanInput
): BoardBuildPlanResolvedOperation[] {
  for (const reference of externalReferences(input)) {
    assertPageObject(target, reference.objectId, reference.label)
  }
  const operations = resolveBoardBuildPlanOperations(
    input.plan.operations,
    (objectId) => {
      const node = target.store.graph.getNode(objectId)
      return node && node.type !== 'CANVAS' ? nodeBounds(target, node) : undefined
    },
    (operation) =>
      boardBuildTracedConnections(target.store.graph, target.pageId, operation).map(
        (connection) => connection.id
      )
  )
  for (const operation of operations) {
    if (
      isCanonicalObjectOperation(operation) ||
      operation.kind === 'connection.delete' ||
      operation.kind === 'transaction.revert'
    ) {
      continue
    }
    assertObjectEditOperationReady(target, parseObjectEditOperation(operation))
  }
  for (const artifact of input.plan.artifacts) {
    if (artifact.recipe.kind !== 'canonical_object') continue
    const source = target.store.graph.getNode(artifact.recipe.source_object_id)
    if (!source || source.type === 'CANVAS') {
      throw new Error(
        `Canonical source object "${artifact.recipe.source_object_id}" does not exist.`
      )
    }
  }
  return operations
}

function artifactAnchorId(
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>
): string | undefined {
  return artifact.anchor ? referenceId(artifact.anchor, aliases) : undefined
}

function convergenceSourceBounds(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>
): Rect[] | undefined {
  if (artifact.recipe.placement?.relative_offset) return undefined
  const references = boardBuildPlanInboundReferences(input.plan, artifact.alias)
  if (references.length < 2) return undefined
  const bounds = references.flatMap((reference) => {
    const objectId = 'object_id' in reference ? reference.object_id : aliases[reference.alias]
    if (!objectId) return []
    const node = target.store.graph.getNode(objectId)
    return node ? [nodeBounds(target, node)] : []
  })
  return bounds.length === references.length ? bounds : undefined
}

function planPlacement(
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  plan: BoardBuildPlan
) {
  const recipe = artifact.recipe
  const convergenceReference =
    !artifact.anchor && recipe.kind === 'native_card' && recipe.placement?.target === undefined
      ? boardBuildPlanInboundReferences(plan, artifact.alias)[0]
      : undefined
  const anchorId = artifact.anchor
    ? artifactAnchorId(artifact, aliases)
    : convergenceReference
      ? referenceId(convergenceReference, aliases)
      : undefined
  if (
    recipe.kind !== 'native_card' &&
    recipe.kind !== 'native_text' &&
    recipe.kind !== 'native_diagram'
  )
    return {}
  const placement = recipe.placement
  const target = placement?.target
  return {
    ...(anchorId ? { anchor_id: anchorId } : {}),
    placement: {
      ...(placement?.clearance === undefined ? {} : { clearance: placement.clearance }),
      preferred_directions: completeDirections(placement?.preferred_directions),
      ...(!anchorId && target
        ? {
            target:
              target.kind === 'relative'
                ? { kind: target.kind, object_id: target.object_id }
                : target
          }
        : {})
    }
  }
}

async function preparePlanDiagrams(
  input: BoardBuildPlanInput,
  parseMermaid: (source: string) => Promise<MermaidDiagram>
): Promise<Record<string, PreparedPlanDiagram>> {
  const prepared: Record<string, PreparedPlanDiagram> = {}
  for (const artifact of input.plan.artifacts) {
    if (artifact.recipe.kind !== 'native_diagram') continue
    prepared[artifact.alias] = {
      scene: createMermaidSceneSpec(await parseMermaid(artifact.recipe.source))
    }
  }
  return prepared
}

function gridMeasurementCenter(target: AutomationTarget): { x: number; y: number } {
  const obstacles = visibleBoardObstacles(target)
  return {
    x: Math.max(0, ...obstacles.map((bounds) => bounds.x + bounds.width)) + 10_000,
    y: 0
  }
}

function gridArtifactFootprint(
  target: AutomationTarget,
  artifact: BoardBuildPlanArtifact,
  preparedDiagrams: Record<string, PreparedPlanDiagram>
): Pick<BoardBuildPlanBounds, 'height' | 'width'> {
  const recipe = artifact.recipe
  if (recipe.kind === 'native_diagram') {
    const prepared = preparedDiagrams[artifact.alias]
    if (!prepared) throw new Error(`Plan diagram "${artifact.alias}" was not prepared.`)
    return { height: prepared.scene.height, width: prepared.scene.width }
  }
  if (recipe.kind === 'code_object' || recipe.kind === 'trusted_web_app') {
    return { height: recipe.height ?? 520, width: recipe.width ?? 720 }
  }
  if (recipe.kind === 'canonical_object') {
    const source = target.store.graph.getNode(recipe.source_object_id)
    if (!source || source.type === 'CANVAS') {
      throw new Error(`Canonical source object "${recipe.source_object_id}" does not exist.`)
    }
    return { height: source.height, width: source.width }
  }
  const center = gridMeasurementCenter(target)
  const placement = {
    clearance: 0,
    preferred_directions: DEFAULT_DIRECTIONS,
    target: { kind: 'point' as const, ...center }
  }
  if (recipe.kind === 'native_card') {
    const operation = parseNativeCardOperation({
      artifact: {
        body: recipe.body,
        ...(recipe.height === undefined ? {} : { height: recipe.height }),
        kind: 'native_card',
        ...(recipe.name ? { name: recipe.name } : {}),
        title: recipe.title,
        ...(recipe.width === undefined ? {} : { width: recipe.width })
      },
      kind: 'artifact.create',
      placement
    })
    const bounds = nativeCardPlan(target, operation).placement.bounds
    return { height: bounds.height, width: bounds.width }
  }
  const operation = parseNativeTextOperation({
    artifact: {
      ...(recipe.font_size === undefined ? {} : { font_size: recipe.font_size }),
      ...(recipe.height === undefined ? {} : { height: recipe.height }),
      kind: 'native_text',
      ...(recipe.max_width === undefined ? {} : { max_width: recipe.max_width }),
      ...(recipe.name ? { name: recipe.name } : {}),
      text: recipe.text
    },
    kind: 'artifact.create',
    placement
  })
  const visual = createLocalLegibleTextPlan(target, operation)
  const bounds = placementFor(
    target,
    { ...operation, fontSize: visual.nodeProps.fontSize },
    visual.nodeProps
  ).bounds
  return { height: bounds.height, width: bounds.width }
}

function resolveLayoutBounds(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  compilation: BoardBuildPlanLayoutCompilation,
  aliases: Record<string, string>
): Record<string, BoardBuildPlanBounds> {
  const layout = input.plan.layout
  if (!layout) return {}
  const common = {
    clearance: layout.placement?.clearance ?? 48,
    footprint: compilation.footprint,
    obstacles: visibleBoardObstacles(target),
    preferredDirections: completeDirections(layout.placement?.preferred_directions)
  }
  const placement =
    'kind' in layout.anchor
      ? layout.anchor.width >= compilation.footprint.width &&
        layout.anchor.height >= compilation.footprint.height
        ? resolveCenteredFreePlacement({
            ...common,
            center: {
              x: layout.anchor.x + layout.anchor.width / 2,
              y: layout.anchor.y + layout.anchor.height / 2
            },
            maxRings: 12,
            searchRegion: layout.anchor
          })
        : resolveNearestFreePlacement({ ...common, anchor: layout.anchor })
      : resolveNearestFreePlacement({
          ...common,
          anchor: nodeBounds(
            target,
            requireVisibleBoardAnchor(target, referenceId(layout.anchor, aliases))
          )
        })
  if (!placement) {
    throw new Error(
      `No collision-free placement was found for the plan ${input.plan.layout?.kind ?? 'layout'} group.`
    )
  }
  return Object.fromEntries(
    Object.entries(compilation.aliases).map(([alias, bounds]) => [
      alias,
      {
        ...bounds,
        x: placement.bounds.x + bounds.x,
        y: placement.bounds.y + bounds.y
      }
    ])
  )
}

function preparePlanLayout(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  preparedDiagrams: Record<string, PreparedPlanDiagram>
): PreparedPlanLayout | undefined {
  const layout = input.plan.layout
  if (!layout) return undefined
  const artifacts = new Map(input.plan.artifacts.map((artifact) => [artifact.alias, artifact]))
  const footprints = Object.fromEntries(
    boardBuildPlanLayoutMembers(layout).map((alias) => {
      const artifact = artifacts.get(alias)
      if (!artifact) throw new Error(`Layout member "${alias}" is unavailable during preflight.`)
      return [alias, gridArtifactFootprint(target, artifact, preparedDiagrams)]
    })
  )
  const compilation = compileBoardBuildPlanLayout(layout, footprints)
  return {
    compilation,
    ...('alias' in layout.anchor
      ? {}
      : { resolvedBounds: resolveLayoutBounds(target, input, compilation, {}) })
  }
}

function compositionExcludedObjectIds(
  target: AutomationTarget,
  input: BoardBuildPlanInput
): Set<string> {
  const excluded = new Set<string>()
  const excludeObjectTree = (objectId: string): void => {
    const node = target.store.graph.getNode(objectId)
    if (!node) return
    excluded.add(node.id)
    for (const descendant of target.store.graph.getDescendants(node.id)) {
      excluded.add(descendant.id)
    }
  }
  for (const member of boardBuildPlanCompositionMembers(input.plan.composition)) {
    if (!('object_id' in member)) continue
    const node = target.store.graph.getNode(member.object_id)
    if (!node || node.parentId !== target.pageId || node.type === 'CANVAS' || !node.visible) {
      throw new Error(
        `Composition member "${member.object_id}" is not a visible top-level object on the exact Board.`
      )
    }
    excludeObjectTree(node.id)
  }
  for (const operation of input.plan.operations ?? []) {
    if (operation.kind === 'object.delete') excludeObjectTree(operation.object_id)
  }
  return excluded
}

function resolveCompositionBounds(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  prepared: PreparedPlanComposition,
  aliases: Record<string, string>
): Record<string, BoardBuildPlanBounds> {
  const composition = input.plan.composition
  if (!composition) return {}
  const preferred =
    composition.placement ?? (composition.preferences?.direction === 'vertical' ? 'below' : 'right')
  const common = {
    clearance: boardBuildPlanCompositionGap(composition),
    footprint: prepared.compilation.footprint,
    obstacles: visibleBoardObstacles(target, prepared.excludedObjectIds),
    preferredDirections: completeDirections([preferred])
  }
  const anchor = composition.anchor
  let placement: ReturnType<typeof resolveCenteredFreePlacement>
  if (!anchor) {
    const currentBounds = boardBuildPlanCompositionCurrentBounds(composition, (objectId) => {
      const node = target.store.graph.getNode(objectId)
      return node ? nodeBounds(target, node) : undefined
    })
    const focus = currentBounds ?? boardViewportFocusBounds(target)
    placement = resolveCenteredFreePlacement({
      ...common,
      center: { x: focus.x + focus.width / 2, y: focus.y + focus.height / 2 },
      maxRings: 12
    })
  } else if ('kind' in anchor) {
    placement =
      anchor.kind === 'region' &&
      anchor.width >= prepared.compilation.footprint.width &&
      anchor.height >= prepared.compilation.footprint.height
        ? resolveCenteredFreePlacement({
            ...common,
            center: { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 },
            maxRings: 12,
            searchRegion: anchor
          })
        : resolveNearestFreePlacement({ ...common, anchor })
  } else {
    placement = resolveNearestFreePlacement({
      ...common,
      anchor: nodeBounds(target, requireVisibleBoardAnchor(target, referenceId(anchor, aliases)))
    })
  }
  if (!placement) {
    throw new Error('No collision-free placement was found for the semantic composition.')
  }
  return Object.fromEntries(
    Object.entries(prepared.compilation.members).map(([key, bounds]) => [
      key,
      { ...bounds, x: placement.bounds.x + bounds.x, y: placement.bounds.y + bounds.y }
    ])
  )
}

function preparePlanComposition(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  preparedDiagrams: Record<string, PreparedPlanDiagram>
): PreparedPlanComposition | undefined {
  const composition = input.plan.composition
  if (!composition) return undefined
  const artifacts = new Map(input.plan.artifacts.map((artifact) => [artifact.alias, artifact]))
  const footprints = Object.fromEntries(
    composition.members.map((member) => {
      const key = boardBuildPlanReferenceKey(member)
      if ('object_id' in member) {
        const node = target.store.graph.getNode(member.object_id)
        if (!node || node.type === 'CANVAS') {
          throw new Error(`Composition member "${member.object_id}" is unavailable.`)
        }
        const bounds = nodeBounds(target, node)
        return [key, { height: bounds.height, width: bounds.width }]
      }
      const artifact = artifacts.get(member.alias)
      if (!artifact) throw new Error(`Composition member "${member.alias}" is unavailable.`)
      return [key, gridArtifactFootprint(target, artifact, preparedDiagrams)]
    })
  )
  const prepared: PreparedPlanComposition = {
    compilation: compileBoardBuildPlanComposition(composition, footprints, input.plan.connections),
    excludedObjectIds: compositionExcludedObjectIds(target, input)
  }
  return {
    ...prepared,
    ...(composition.anchor && 'alias' in composition.anchor
      ? {}
      : { resolvedBounds: resolveCompositionBounds(target, input, prepared, {}) })
  }
}

function compositionMoveOperations(
  input: BoardBuildPlanInput,
  bounds: Readonly<Record<string, BoardBuildPlanBounds>>
): BoardBuildPlanResolvedOperation[] {
  return boardBuildPlanCompositionMembers(input.plan.composition).flatMap((member) => {
    if (!('object_id' in member)) return []
    const target = bounds[boardBuildPlanReferenceKey(member)]
    if (!target) throw new Error(`Composition target for "${member.object_id}" is unavailable.`)
    return [{ kind: 'object.move' as const, object_id: member.object_id, x: target.x, y: target.y }]
  })
}

function artifactAtExactBounds(
  artifact: BoardBuildPlanArtifact,
  bounds: BoardBuildPlanBounds
): BoardBuildPlanArtifact {
  const placement = {
    clearance: 0,
    preferred_directions: DEFAULT_DIRECTIONS,
    target: {
      kind: 'point' as const,
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2
    }
  }
  const recipe = artifact.recipe
  return {
    alias: artifact.alias,
    recipe:
      recipe.kind === 'native_card'
        ? { ...recipe, height: bounds.height, placement, width: bounds.width }
        : recipe.kind === 'native_text'
          ? { ...recipe, height: bounds.height, max_width: bounds.width, placement }
          : recipe.kind === 'code_object' || recipe.kind === 'trusted_web_app'
            ? { ...recipe, height: bounds.height, placement, width: bounds.width }
            : { ...recipe, placement }
  }
}

function planArtifactPlacement(
  target: AutomationTarget,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  footprint: Pick<Rect, 'height' | 'width'>
) {
  const placement = artifact.recipe.placement
  const anchorId = artifactAnchorId(artifact, aliases)
  const targetPlacement = placement?.target
  const common = {
    clearance: placement?.clearance ?? 48,
    footprint,
    obstacles: visibleBoardObstacles(target),
    preferredDirections: completeDirections(placement?.preferred_directions)
  }
  const resolved = anchorId
    ? resolveNearestFreePlacement({
        ...common,
        anchor: nodeBounds(target, requireVisibleBoardAnchor(target, anchorId)),
        ...(placement?.relative_offset ? { relativeOffset: placement.relative_offset } : {})
      })
    : targetPlacement?.kind === 'relative'
      ? resolveNearestFreePlacement({
          ...common,
          anchor: nodeBounds(target, requireVisibleBoardAnchor(target, targetPlacement.object_id)),
          ...(placement?.relative_offset ? { relativeOffset: placement.relative_offset } : {})
        })
      : targetPlacement
        ? resolveCenteredFreePlacement({
            ...common,
            center:
              targetPlacement.kind === 'point'
                ? { x: targetPlacement.x, y: targetPlacement.y }
                : (() => {
                    const region =
                      targetPlacement.kind === 'region'
                        ? targetPlacement
                        : boardViewportFocusBounds(target)
                    return {
                      x: region.x + region.width / 2,
                      y: region.y + region.height / 2
                    }
                  })(),
            maxRings: targetPlacement.kind === 'point' ? 0 : 12,
            ...(targetPlacement.kind === 'region'
              ? { searchRegion: targetPlacement }
              : targetPlacement.kind === 'auto'
                ? { searchRegion: boardViewportFocusBounds(target) }
                : {})
          })
        : null
  if (!resolved) {
    throw new Error('No collision-free placement was found within the bounded search region.')
  }
  return resolved
}

function createNativeDiagram(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  inputDigest: string,
  prepared: PreparedPlanDiagram
): PlanArtifactResult {
  if (artifact.recipe.kind !== 'native_diagram') {
    throw new Error('Internal plan artifact mismatch for native diagram.')
  }
  const existingOwnerId = artifact.recipe.owner_id
  const allIds = existingOwnerId
    ? (() => {
        const owner = mermaidDiagramOwner(target.store.graph, existingOwnerId)
        if (!owner || owner.id !== existingOwnerId || owner.parentId !== target.pageId) {
          throw new Error(
            `Plan diagram "${artifact.alias}" owner "${existingOwnerId}" was not found on the current Board.`
          )
        }
        const reconciliation = reconcileMermaidDiagramSource(target.store.graph, owner.id)
        if (reconciliation?.status !== 'current') {
          throw new Error(
            `Plan diagram "${artifact.alias}" cannot be regenerated because source reconciliation is "${reconciliation?.status ?? 'unknown'}".`
          )
        }
        return target.store.replaceMermaidDiagram(owner.id, prepared.scene)
      })()
    : (() => {
        const placement = planArtifactPlacement(target, artifact, aliases, {
          height: prepared.scene.height,
          width: prepared.scene.width
        })
        return target.store.insertMermaidDiagram(prepared.scene, {
          x: placement.bounds.x,
          y: placement.bounds.y
        })
      })()
  const ownerId = existingOwnerId ?? [...target.store.state.selectedIds][0]
  if (!ownerId) throw new Error(`Plan diagram "${artifact.alias}" returned no owner.`)
  const owner = target.store.graph.getNode(ownerId)
  if (!owner || owner.parentId !== target.pageId) {
    throw new Error(`Plan diagram "${artifact.alias}" disappeared during apply.`)
  }
  target.store.updateNodeWithUndo(
    owner.id,
    {
      pluginData: [
        ...owner.pluginData.map((entry) => structuredClone(entry)),
        ...planArtifactPluginData(input, artifact.alias, inputDigest, PLAN_ROUTE)
      ]
    },
    PLAN_HISTORY_LABEL
  )
  const updatedOwner = target.store.graph.getNode(owner.id)
  if (!updatedOwner) throw new Error(`Plan diagram "${artifact.alias}" disappeared during apply.`)
  return { allIds: [owner.id, ...allIds], owner: updatedOwner }
}

function createNativeText(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  inputDigest: string
): PlanArtifactResult {
  if (artifact.recipe.kind !== 'native_text') {
    throw new Error('Internal plan artifact mismatch for native text.')
  }
  const anchorId = artifactAnchorId(artifact, aliases)
  const operation = {
    ...parseNativeTextOperation({
      ...(anchorId ? { anchor_id: anchorId } : {}),
      artifact: {
        ...(artifact.recipe.font_size === undefined
          ? {}
          : { font_size: artifact.recipe.font_size }),
        ...(artifact.recipe.height === undefined ? {} : { height: artifact.recipe.height }),
        kind: 'native_text',
        ...(artifact.recipe.max_width === undefined
          ? {}
          : { max_width: artifact.recipe.max_width }),
        ...(artifact.recipe.name ? { name: artifact.recipe.name } : {}),
        text: artifact.recipe.text
      },
      kind: 'artifact.create',
      ...planPlacement(artifact, aliases, input.plan)
    }),
    ...(artifact.recipe.placement?.relative_offset
      ? { relativeOffset: artifact.recipe.placement.relative_offset }
      : {})
  }
  const visual = createLocalLegibleTextPlan(target, operation)
  const effectiveOperation = { ...operation, fontSize: visual.nodeProps.fontSize }
  const placement = placementFor(
    target,
    effectiveOperation,
    visual.nodeProps,
    convergenceSourceBounds(target, input, artifact, aliases)
  )
  const ownerId = target.store.createShape(
    'TEXT',
    placement.bounds.x,
    placement.bounds.y,
    placement.bounds.width,
    placement.bounds.height,
    target.pageId
  )
  target.store.updateNodeWithUndo(
    ownerId,
    {
      ...visual.nodeProps,
      height: placement.bounds.height,
      name: operation.name,
      pluginData: planArtifactPluginData(input, artifact.alias, inputDigest, PLAN_ROUTE),
      text: operation.text,
      textAutoResize: 'NONE',
      width: placement.bounds.width
    },
    PLAN_HISTORY_LABEL
  )
  const owner = target.store.graph.getNode(ownerId)
  if (!owner) throw new Error(`Plan artifact "${artifact.alias}" disappeared during apply.`)
  return { allIds: [ownerId], owner }
}

function createNativeCard(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  inputDigest: string
): PlanArtifactResult {
  if (artifact.recipe.kind !== 'native_card') {
    throw new Error('Internal plan artifact mismatch for native card.')
  }
  const operation = {
    ...parseNativeCardOperation({
      artifact: {
        body: artifact.recipe.body,
        ...(artifact.recipe.height === undefined ? {} : { height: artifact.recipe.height }),
        kind: 'native_card',
        ...(artifact.recipe.name ? { name: artifact.recipe.name } : {}),
        title: artifact.recipe.title,
        ...(artifact.recipe.width === undefined ? {} : { width: artifact.recipe.width })
      },
      kind: 'artifact.create',
      ...planPlacement(artifact, aliases, input.plan)
    }),
    ...(artifact.recipe.placement?.relative_offset
      ? { relativeOffset: artifact.recipe.placement.relative_offset }
      : {})
  }
  const plan = nativeCardPlan(
    target,
    operation,
    convergenceSourceBounds(target, input, artifact, aliases)
  )
  const ownerId = target.store.createShape(
    'FRAME',
    plan.placement.bounds.x,
    plan.placement.bounds.y,
    plan.placement.bounds.width,
    plan.placement.bounds.height,
    target.pageId
  )
  const titleId = target.store.createShape('TEXT', 0, 0, 1, 1, ownerId)
  const bodyId = target.store.createShape('TEXT', 0, 0, 1, 1, ownerId)
  const fakeMarker: AgentCardReceipt =
    operation.placementTarget.kind === 'anchor'
      ? {
          algorithm: plan.placement.algorithm,
          anchorId: operation.placementTarget.anchorId,
          artifactKind: 'native_card',
          body: operation.body,
          bodyId,
          bounds: plan.placement.bounds,
          inputDigest,
          requestId: `${input.requestId}:${artifact.alias}`,
          route: 'board_change',
          title: operation.title,
          titleId,
          version: 1
        }
      : {
          algorithm: plan.placement.algorithm,
          artifactKind: 'native_card',
          body: operation.body,
          bodyId,
          bounds: plan.placement.bounds,
          inputDigest,
          placementTarget: operation.placementTarget,
          requestId: `${input.requestId}:${artifact.alias}`,
          route: 'board_change',
          title: operation.title,
          titleId,
          version: 2
        }
  const props = nativeCardNodeProps(operation, plan, fakeMarker)
  target.store.updateNodeWithUndo(
    ownerId,
    {
      ...props.owner,
      pluginData: planArtifactPluginData(input, artifact.alias, inputDigest, PLAN_ROUTE)
    },
    PLAN_HISTORY_LABEL
  )
  target.store.updateNodeWithUndo(titleId, props.title, PLAN_HISTORY_LABEL)
  target.store.updateNodeWithUndo(bodyId, props.body, PLAN_HISTORY_LABEL)
  const owner = target.store.graph.getNode(ownerId)
  if (!owner) throw new Error(`Plan artifact "${artifact.alias}" disappeared during apply.`)
  return { allIds: [ownerId, titleId, bodyId], owner }
}

function createCanonicalObject(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  inputDigest: string
): PlanArtifactResult {
  if (artifact.recipe.kind !== 'canonical_object') {
    throw new Error('Internal plan artifact mismatch for canonical object.')
  }
  const source = target.store.graph.getNode(artifact.recipe.source_object_id)
  if (!source || source.type === 'CANVAS') {
    throw new Error(`Canonical source object "${artifact.recipe.source_object_id}" does not exist.`)
  }
  const placement = planArtifactPlacement(target, artifact, aliases, {
    height: source.height,
    width: source.width
  })
  const materialized = materializeCanonicalObject(
    target.store.graph,
    target.pageId,
    {
      sourceObjectId: source.id,
      x: placement.bounds.x,
      y: placement.bounds.y
    },
    (sourceId, parentId, overrides) =>
      target.store.duplicateNodeToParent(sourceId, parentId, overrides, PLAN_HISTORY_LABEL),
    (node, pluginData) => {
      target.store.updateNodeWithUndo(node.id, { pluginData }, PLAN_HISTORY_LABEL)
    }
  )
  const owner = target.store.graph.getNode(materialized.placement_id)
  if (!owner) throw new Error(`Plan artifact "${artifact.alias}" disappeared during apply.`)
  target.store.updateNodeWithUndo(
    owner.id,
    {
      pluginData: [
        ...owner.pluginData,
        ...planArtifactPluginData(input, artifact.alias, inputDigest, PLAN_ROUTE)
      ]
    },
    PLAN_HISTORY_LABEL
  )
  const updatedOwner = target.store.graph.getNode(owner.id)
  if (!updatedOwner) throw new Error(`Plan artifact "${artifact.alias}" disappeared during apply.`)
  return { allIds: materialized.object_ids, owner: updatedOwner }
}

function createArtifact(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  inputDigest: string,
  preparedCodeObjects: Record<string, PreparedPlanCodeObject>,
  preparedDiagrams: Record<string, PreparedPlanDiagram>,
  exactBounds?: BoardBuildPlanBounds
): PlanArtifactResult {
  const effectiveArtifact = exactBounds ? artifactAtExactBounds(artifact, exactBounds) : artifact
  if (effectiveArtifact.recipe.kind === 'canonical_object') {
    return createCanonicalObject(target, input, effectiveArtifact, aliases, inputDigest)
  }
  if (effectiveArtifact.recipe.kind === 'native_text') {
    return createNativeText(target, input, effectiveArtifact, aliases, inputDigest)
  }
  if (effectiveArtifact.recipe.kind === 'native_card') {
    return createNativeCard(target, input, effectiveArtifact, aliases, inputDigest)
  }
  if (effectiveArtifact.recipe.kind === 'native_diagram') {
    const prepared = preparedDiagrams[artifact.alias]
    if (!prepared) throw new Error(`Plan diagram "${artifact.alias}" was not prepared.`)
    return createNativeDiagram(target, input, effectiveArtifact, aliases, inputDigest, prepared)
  }
  const prepared = preparedCodeObjects[artifact.alias]
  if (!prepared) throw new Error(`Plan Code Object "${artifact.alias}" was not prepared.`)
  const effectivePrepared = exactBounds
    ? { ...prepared, recipe: effectiveArtifact.recipe }
    : prepared
  const created = createPlanCodeObject(
    target,
    effectiveArtifact,
    aliases,
    effectivePrepared,
    convergenceSourceBounds(target, input, effectiveArtifact, aliases)
  )
  return {
    allIds: [created.owner.id],
    codeObjectReadback: created.readback,
    codeObjectReceipt: created.receipt,
    owner: created.owner
  }
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

function connectionPermissions(kind: BoardBuildPlanConnection['kind']): ObjectGraphPermission[] {
  if (kind === 'action') return ['target.action.execute']
  if (kind === 'data') return ['target.data.write']
  return []
}

function createConnection(
  target: AutomationTarget,
  connection: BoardBuildPlanConnection,
  aliases: Record<string, string>,
  index: number
): {
  connection: ObjectGraphConnection
  result: PlanApplyResult['connectionResults'][number]
} {
  const sourcePort = planConnectionPort(connection.source_port)
  const targetPort = planConnectionPort(connection.target_port)
  const input = {
    ...(connection.automatic === undefined ? {} : { automatic: connection.automatic }),
    kind: connection.kind,
    ...(connection.label ? { label: connection.label } : {}),
    sourceNodeId: referenceId(connection.source, aliases),
    sourcePort: sourcePort.side,
    ...(sourcePort.id ? { sourcePortId: sourcePort.id } : {}),
    targetNodeId: referenceId(connection.target, aliases),
    targetPort: targetPort.side,
    ...(targetPort.id ? { targetPortId: targetPort.id } : {})
  }
  const equivalent = findEquivalentObjectGraphConnection(target.store.graph, target.pageId, input)
  if (equivalent) {
    const expectedAutomatic = connection.automatic ?? connection.kind !== 'visual'
    const expectedLabel = (connection.label?.trim() || connection.kind).slice(0, 80)
    if (
      equivalent.automatic !== expectedAutomatic ||
      equivalent.label !== expectedLabel ||
      JSON.stringify(equivalent.permissions) !==
        JSON.stringify(connectionPermissions(connection.kind))
    ) {
      throw new Error(
        `Plan connection ${index} conflicts with existing connection "${equivalent.id}".`
      )
    }
    return {
      connection: equivalent,
      result: { connection_id: equivalent.id, effect: 'already_satisfied', index }
    }
  }
  const result = connectObjects(target.store, input)
  if (!result) {
    throw new Error(
      `Plan connection ${index} is invalid for the current page, endpoints, or ports.`
    )
  }
  return {
    connection: result,
    result: { connection_id: result.id, effect: 'would_change', index }
  }
}

function sharedObjectPatch(
  operation: BoardBuildPlanOperation
): Partial<Pick<SceneNode, 'name' | 'text'>> | undefined {
  if (operation.kind !== 'object.update') return undefined
  const patch: Partial<Pick<SceneNode, 'name' | 'text'>> = {}
  if (operation.patch.name !== undefined) patch.name = operation.patch.name
  if (operation.patch.text !== undefined) patch.text = operation.patch.text
  return Object.keys(patch).length > 0 ? patch : undefined
}

function applyLivePlanOperations(
  target: AutomationTarget,
  planOperations: readonly BoardBuildPlanResolvedOperation[],
  operationResults: PlanApplyResult['operations'],
  owners: SceneNode[],
  allObjectIds: string[],
  transactionRevert?: PreparedLiveTransactionRevert
): void {
  for (const operation of planOperations) {
    if (operation.kind === 'transaction.revert') {
      if (!transactionRevert || transactionRevert.transactionId !== operation.transaction_id) {
        throw new Error('Board transaction restore context is unavailable.')
      }
      const changes = transactionRevert.changes
      const inspection = applyBoardTransactionChanges(
        target.store.graph,
        target.pageId,
        changes,
        'before'
      )
      target.store.undo.push({
        forward: () => {
          applyBoardTransactionChanges(target.store.graph, target.pageId, changes, 'before')
          target.store.requestRender()
        },
        inverse: () => {
          applyBoardTransactionChanges(target.store.graph, target.pageId, changes, 'after')
          target.store.requestRender()
        },
        label: PLAN_HISTORY_LABEL
      })
      target.store.requestRender()
      operationResults.push({
        change_count: changes.length,
        effect: inspection.applicable > 0 ? 'would_change' : 'already_satisfied',
        kind: operation.kind,
        transaction_id: operation.transaction_id
      })
      continue
    }
    if (operation.kind === 'connection.delete') {
      const snapshot = snapshotObjectGraphConnectionRecord(
        target.store.graph,
        target.pageId,
        operation.connection_id
      )
      if (!snapshot) {
        operationResults.push({
          connection_id: operation.connection_id,
          effect: 'already_satisfied',
          kind: operation.kind
        })
        continue
      }
      removeObjectGraphConnectionRecord(target.store.graph, target.pageId, operation.connection_id)
      target.store.undo.push({
        forward: () => {
          removeObjectGraphConnectionRecord(
            target.store.graph,
            target.pageId,
            operation.connection_id
          )
          target.store.requestRender()
        },
        inverse: () => {
          restoreObjectGraphConnectionRecord(target.store.graph, target.pageId, snapshot)
          target.store.requestRender()
        },
        label: PLAN_HISTORY_LABEL
      })
      target.store.requestRender()
      operationResults.push({
        connection_id: operation.connection_id,
        effect: 'would_change',
        kind: operation.kind
      })
      continue
    }
    if (isCanonicalObjectOperation(operation)) {
      const forked = forkCanonicalObject(
        target.store.graph,
        target.pageId,
        operation.object_id,
        (node, pluginData) => {
          target.store.updateNodeWithUndo(node.id, { pluginData }, PLAN_HISTORY_LABEL)
        }
      )
      operationResults.push({ kind: operation.kind, ...forked })
      for (const objectId of forked.object_ids) {
        if (!allObjectIds.includes(objectId)) allObjectIds.push(objectId)
      }
      continue
    }
    const targetNode = target.store.graph.getNode(operation.object_id)
    const peerNodes = targetNode ? canonicalMemoryPeerNodes(target.store.graph, targetNode) : []
    const sharedPatch = sharedObjectPatch(operation)
    const parsed = parseObjectEditOperation(operation)
    const applied = applyObjectEditOperationInBatch(target, parsed, PLAN_HISTORY_LABEL)
    if (sharedPatch) {
      for (const peer of peerNodes) {
        if (peer.id === operation.object_id) continue
        target.store.updateNodeWithUndo(peer.id, sharedPatch, PLAN_HISTORY_LABEL)
        if (!allObjectIds.includes(peer.id)) allObjectIds.push(peer.id)
      }
    }
    operationResults.push({
      after: applied.after,
      effect: applied.effect,
      kind: operation.kind,
      object_id: operation.object_id,
      result_object_id: applied.resultObjectId
    })
    if (!applied.resultObjectId) continue
    const resultNode = target.store.graph.getNode(applied.resultObjectId)
    if (!resultNode) continue
    owners.push(resultNode)
    allObjectIds.push(resultNode.id)
  }
}

function applyPlan(
  target: AutomationTarget,
  input: BoardBuildPlanInput,
  inputDigest: string,
  preparedOperations: readonly BoardBuildPlanResolvedOperation[],
  preparedCodeObjects: Record<string, PreparedPlanCodeObject>,
  preparedDiagrams: Record<string, PreparedPlanDiagram>,
  transactionRevert?: PreparedLiveTransactionRevert,
  preparedLayout?: PreparedPlanLayout,
  preparedComposition?: PreparedPlanComposition
): PlanApplyResult {
  const page = target.store.graph.getNode(target.pageId)
  if (!page) throw new Error(`Board "${target.pageId}" disappeared before plan apply.`)
  const ledgerBefore = mutationRequestLedgerSnapshot(page)
  let ledgerAfter = ledgerBefore
  const aliases: Record<string, string> = {}
  const codeObjects: Record<string, Record<string, unknown>> = {}
  const codeObjectReceipts: Record<string, Record<string, unknown>> = {}
  const owners: SceneNode[] = []
  const allObjectIds: string[] = []
  const connections: ObjectGraphConnection[] = []
  const connectionResults: PlanApplyResult['connectionResults'] = []
  const operations: PlanApplyResult['operations'] = []
  let layoutBounds = preparedLayout?.resolvedBounds
  const layoutMembers = new Set(boardBuildPlanLayoutMembers(input.plan.layout))
  let compositionBounds = preparedComposition?.resolvedBounds
  let compositionApplied = false
  const compositionAliasMembers = new Set(
    boardBuildPlanCompositionMembers(input.plan.composition).flatMap((member) =>
      'alias' in member ? [member.alias] : []
    )
  )
  const transactionBefore = captureBoardTransactionState(target.store.graph, target.pageId)

  target.store.undo.runBatch(PLAN_HISTORY_LABEL, () => {
    assertMutationRequestIdFresh(target, input.requestId)
    reserveMutationRequest(target, {
      inputDigest,
      requestId: input.requestId,
      route: PLAN_ROUTE,
      version: 1
    })
    target.store.undo.push({
      forward: () => restoreMutationRequestLedger(target, ledgerAfter),
      inverse: () => restoreMutationRequestLedger(target, ledgerBefore),
      label: PLAN_HISTORY_LABEL
    })

    applyLivePlanOperations(
      target,
      preparedOperations,
      operations,
      owners,
      allObjectIds,
      transactionRevert
    )

    const applyComposition = (): boolean => {
      if (!preparedComposition || compositionApplied) return compositionApplied
      const anchor = input.plan.composition?.anchor
      if (anchor && 'alias' in anchor && !aliases[anchor.alias]) return false
      compositionBounds ??= resolveCompositionBounds(target, input, preparedComposition, aliases)
      applyLivePlanOperations(
        target,
        compositionMoveOperations(input, compositionBounds),
        operations,
        owners,
        allObjectIds
      )
      compositionApplied = true
      return true
    }

    applyComposition()

    for (const artifact of input.plan.artifacts) {
      if (preparedLayout && layoutMembers.has(artifact.alias) && !layoutBounds) {
        layoutBounds = resolveLayoutBounds(target, input, preparedLayout.compilation, aliases)
      }
      const created = createArtifact(
        target,
        input,
        artifact,
        aliases,
        inputDigest,
        preparedCodeObjects,
        preparedDiagrams,
        layoutBounds?.[artifact.alias] ??
          (compositionAliasMembers.has(artifact.alias)
            ? compositionBounds?.[`alias:${artifact.alias}`]
            : undefined)
      )
      aliases[artifact.alias] = created.owner.id
      if (created.codeObjectReadback) {
        codeObjects[artifact.alias] = created.codeObjectReadback
      }
      if (created.codeObjectReceipt) {
        codeObjectReceipts[artifact.alias] = created.codeObjectReceipt
      }
      owners.push(created.owner)
      allObjectIds.push(...created.allIds)
      applyComposition()
    }
    if (preparedComposition && !applyComposition()) {
      throw new Error('Composition anchor was unavailable during atomic apply.')
    }
    for (const [index, connection] of input.plan.connections.entries()) {
      const resolved = createConnection(target, connection, aliases, index)
      connections.push(resolved.connection)
      connectionResults.push(resolved.result)
    }

    recordMutationRequestReceipt(target, {
      inputDigest,
      mutationReceipt: {
        appliedRevision: target.store.state.sceneVersion + 1,
        enqueuedRevision: input.expectedRevision,
        expectedRevision: input.expectedRevision,
        requestId: input.requestId,
        status: 'applied',
        ...(input.taskId ? { taskId: input.taskId } : {}),
        touchedProperties: planTouchedProperties(target, input),
        ...(input.traceId ? { traceId: input.traceId } : {})
      },
      objectIds: allObjectIds,
      requestId: input.requestId,
      result: {
        aliases,
        code_objects: codeObjectReceipts,
        connection_ids: connections.map(({ id }) => id),
        connection_results: connectionResults,
        object_ids: allObjectIds,
        operations,
        owner_ids: owners.map(({ id }) => id)
      },
      route: PLAN_ROUTE,
      semanticIds: connections.map(({ id }) => id),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      version: 1
    })
    const currentPage = target.store.graph.getNode(target.pageId)
    if (!currentPage) throw new Error(`Board "${target.pageId}" disappeared after plan apply.`)
    ledgerAfter = mutationRequestLedgerSnapshot(currentPage)
  })

  rememberLiveTransaction(
    target,
    input.requestId,
    diffBoardTransactionStates(
      transactionBefore,
      captureBoardTransactionState(target.store.graph, target.pageId)
    )
  )

  return {
    aliases,
    allObjectIds,
    codeObjectReceipts,
    codeObjects,
    connections,
    connectionResults,
    operations,
    owners
  }
}

function replayResult(
  input: BoardBuildPlanInput,
  receipt: MutationRequestReceipt,
  target: AutomationTarget,
  context: unknown
): UnknownRecord {
  const readback = mutationRequestReadback(target, receipt)
  const nodes = Array.isArray(readback.nodes) ? readback.nodes : []
  const hasMissingNode = nodes.some(
    (node) => typeof node === 'object' && node !== null && 'missing' in node
  )
  const connections = Array.isArray(readback.object_graph_connections)
    ? readback.object_graph_connections
    : []
  const hasMissingConnection = connections.some(
    (connection) => typeof connection === 'object' && connection !== null && 'missing' in connection
  )
  const historicalOnly = hasMissingNode || hasMissingConnection
  return {
    build: {
      contract: 'board-build/v1',
      intent: input.intent,
      recipe_kind: 'plan',
      route: { id: PLAN_ROUTE, semantic_owner: 'board_build plan' }
    },
    context,
    readback,
    receipt: {
      ...receipt.mutationReceipt,
      history_label: PLAN_HISTORY_LABEL,
      historical_only: historicalOnly,
      idempotent_replay: true,
      input_digest: receipt.inputDigest,
      product_grade_path: true,
      reversible: true,
      transaction_id: receipt.requestId
    },
    status: {
      attention_required: historicalOnly,
      command: historicalOnly ? 'unavailable' : 'completed',
      mutation: 'replayed',
      ...(historicalOnly ? { reason: 'historical_receipt_only' } : {})
    }
  }
}

export async function buildBoardPlan(
  options: PlanBuildOptions,
  target: AutomationTarget,
  input: BoardBuildPlanInput
): Promise<UnknownRecord> {
  if (!target.contentDocumentId || !target.runtimeInstanceId || !target.workspaceId) {
    throw new Error(
      'Live board build plan requires exact workspace, content document, and runtime identity.'
    )
  }
  const inputDigest = await mutationRequestSignature(
    PLAN_ROUTE,
    boardBuildPlanDigestInput(input.plan, {
      intent: input.intent,
      target: {
        content_document_id: target.contentDocumentId,
        document_id: target.documentId,
        page_id: target.pageId,
        runtime_instance_id: target.runtimeInstanceId,
        workspace_id: target.workspaceId
      },
      ...(input.taskId ? { task_id: input.taskId } : {}),
      ...(input.traceId ? { trace_id: input.traceId } : {})
    })
  )

  return coalesceAutomationMutationRequest({
    inputDigest,
    requestId: input.requestId,
    target,
    run: async () => {
      const state = mutationRequestLedgerState(target, input.requestId)
      if (state.status === 'stored') {
        if (state.receipt.route !== PLAN_ROUTE || state.receipt.inputDigest !== inputDigest) {
          throw new Error(`Request "${input.requestId}" was already used for a different mutation.`)
        }
        return replayResult(input, state.receipt, target, await options.context(target))
      }
      if (state.status !== 'missing') {
        throw mutationRequestLedgerError(input.requestId, state.status)
      }

      const transactionRevert = prepareLiveTransactionRevert(target, input)
      const preparedOperations = prevalidatePlan(target, input)
      const preparedDiagrams = await preparePlanDiagrams(
        input,
        options.parseMermaid ?? parseMermaidInBrowser
      )
      const preparedCodeObjects = await preparePlanCodeObjects(target, input)
      const preparedLayout = preparePlanLayout(target, input, preparedDiagrams)
      const preparedComposition = preparePlanComposition(target, input, preparedDiagrams)

      const outcome = await enqueueAutomationMutation({
        metadata: {
          expectedRevision: input.expectedRevision,
          requestId: input.requestId,
          ...(input.taskId ? { taskId: input.taskId } : {}),
          ...(input.traceId ? { traceId: input.traceId } : {})
        },
        run: () =>
          applyPlan(
            target,
            input,
            inputDigest,
            preparedOperations,
            preparedCodeObjects,
            preparedDiagrams,
            transactionRevert,
            preparedLayout,
            preparedComposition
          ),
        target,
        ...(isSelfContainedCreatePlan(input)
          ? {
              revisionPolicy: 'rebase_create_only' as const,
              touchedProperties: planTouchedProperties(target, input)
            }
          : {}),
        toolArgs: { plan: input.plan },
        toolName: 'board_build'
      })
      if (outcome.status === 'rejected') {
        return {
          receipt: outcome.receipt,
          status: { attention_required: true, command: 'refused', mutation: 'not_applied' }
        }
      }
      const context = await options.context(target)
      const stateAfter = mutationRequestLedgerState(target, input.requestId)
      if (stateAfter.status !== 'stored') {
        throw new Error('The plan receipt disappeared after apply.')
      }
      return {
        build: {
          contract: 'board-build/v1',
          intent: input.intent,
          recipe_kind: 'plan',
          route: { id: PLAN_ROUTE, semantic_owner: 'board_build plan' }
        },
        connection_ids: outcome.value.connections.map(({ id }) => id),
        connection_results: outcome.value.connectionResults,
        context,
        object_ids: outcome.value.allObjectIds,
        owner_ids: outcome.value.owners.map(({ id }) => id),
        aliases: outcome.value.aliases,
        operations: outcome.value.operations,
        readback: {
          code_objects: outcome.value.codeObjects,
          nodes: outcome.value.owners.map((node) => nodeSummary(target, node)),
          object_graph_connections: outcome.value.connections,
          result: stateAfter.receipt.result
        },
        receipt: {
          ...outcome.receipt,
          history_label: PLAN_HISTORY_LABEL,
          idempotent_replay: false,
          input_digest: inputDigest,
          product_grade_path: true,
          reversible: true,
          semantic_owner: {
            connection_ids: outcome.value.connections.map(({ id }) => id),
            owner_ids: outcome.value.owners.map(({ id }) => id),
            root_object_id: target.pageId
          },
          transaction_id: input.requestId
        },
        status: { attention_required: false, command: 'completed', mutation: 'applied' }
      }
    }
  })
}
