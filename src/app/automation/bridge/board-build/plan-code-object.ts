import {
  boardBuildPlanConvergenceAnchor,
  type BoardBuildPlanArtifact,
  type BoardBuildPlanCodeObjectRecipe,
  type BoardBuildPlanReference,
  type BoardBuildPlanRelativeOffset,
  type BoardBuildPlanTrustedWebAppRecipe
} from '@open-pencil/core/rpc'
import {
  readObjectGraphPorts,
  setObjectGraphPorts,
  type Rect,
  type SceneNode
} from '@open-pencil/scene-graph'

import { boardViewportFocusBounds } from '@/app/automation/bridge/board-tools/neighborhood'
import {
  requireVisibleBoardAnchor,
  resolveCenteredFreePlacement,
  resolveNearestFreePlacement,
  visibleBoardObstacles,
  type BoardFreePlacementTarget,
  type BoardPlacementDirection,
  type BoardPlacementResult
} from '@/app/automation/bridge/board-tools/placement'
import { nodeBounds, nodeSummary } from '@/app/automation/bridge/board-tools/readback'
import {
  assertSafeCodeObjectCreateSource,
  codeObjectSourceHash
} from '@/app/automation/bridge/code-object/create/contract'
import type { AutomationTarget } from '@/app/automation/bridge/target'
import { compileCodeObjectSource } from '@/app/code-object/compiler'
import {
  codeObjectDocument,
  createCodeObject,
  createSmylrProductionAppDocument,
  createUserCodeObjectDocument,
  type CodeObjectDocument
} from '@/app/code-object/model'

import type { BoardBuildPlanInput } from './types'

const DEFAULT_CLEARANCE = 48
const DEFAULT_DIRECTIONS: BoardPlacementDirection[] = ['right', 'below', 'left', 'above']
const DEFAULT_SIZE = { height: 520, width: 720 } as const

export type PreparedPlanCodeObject = {
  alias: string
  recipe: BoardBuildPlanCodeObjectRecipe | BoardBuildPlanTrustedWebAppRecipe
  sourceHash?: string
}

export type PlanCodeObjectResult = {
  owner: SceneNode
  readback: Record<string, unknown>
  receipt: Record<string, unknown>
}

function createPlacedCodeObject(
  target: AutomationTarget,
  document: CodeObjectDocument,
  name: string,
  placement: BoardPlacementResult
): SceneNode {
  return createCodeObject(target.store, {
    document,
    height: placement.bounds.height,
    name,
    width: placement.bounds.width,
    x: placement.bounds.x,
    y: placement.bounds.y
  })
}

function existingCodeObjectByKey(target: AutomationTarget, objectKey: string): SceneNode | null {
  const matches = target.store.graph.getChildren(target.pageId).filter((node) => {
    const document = codeObjectDocument(node)
    return document?.definitionId === objectKey
  })
  if (matches.length > 1) {
    throw new Error(`Code Object key "${objectKey}" is duplicated on Board "${target.pageName}".`)
  }
  return matches[0] ?? null
}

export async function preparePlanCodeObjects(
  target: AutomationTarget,
  input: BoardBuildPlanInput
): Promise<Record<string, PreparedPlanCodeObject>> {
  const prepared: Record<string, PreparedPlanCodeObject> = {}
  const objectKeys = new Set<string>()
  for (const artifact of input.plan.artifacts) {
    if (artifact.recipe.kind !== 'code_object' && artifact.recipe.kind !== 'trusted_web_app') {
      continue
    }
    const objectKey =
      artifact.recipe.kind === 'code_object'
        ? artifact.recipe.object_key
        : createSmylrProductionAppDocument({
            label: artifact.recipe.name,
            route: artifact.recipe.route
          }).definitionId
    if (objectKeys.has(objectKey)) {
      throw new Error(`Plan Code Object key "${objectKey}" is duplicated.`)
    }
    objectKeys.add(objectKey)
    if (existingCodeObjectByKey(target, objectKey)) {
      throw new Error(`Code Object "${objectKey}" already exists; plan creation is create-only.`)
    }
    if (artifact.recipe.kind === 'code_object') {
      assertSafeCodeObjectCreateSource(artifact.recipe.source)
      const compiled = compileCodeObjectSource(artifact.recipe.source)
      if (!compiled.component) {
        throw new Error(
          `Plan Code Object "${artifact.alias}" failed trusted compile preflight: ${compiled.error}`
        )
      }
      prepared[artifact.alias] = {
        alias: artifact.alias,
        recipe: artifact.recipe,
        sourceHash: await codeObjectSourceHash(artifact.recipe.source)
      }
      continue
    }
    prepared[artifact.alias] = {
      alias: artifact.alias,
      recipe: artifact.recipe
    }
  }
  return prepared
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

function placementTarget(
  recipe: BoardBuildPlanCodeObjectRecipe | BoardBuildPlanTrustedWebAppRecipe
): BoardFreePlacementTarget | null {
  const target = recipe.placement?.target
  if (!target) return null
  return target.kind === 'relative'
    ? { kind: target.kind, objectId: target.object_id }
    : structuredClone(target)
}

function freePlacement(
  target: AutomationTarget,
  placement: BoardFreePlacementTarget,
  footprint: { height: number; width: number },
  clearance: number,
  preferredDirections: BoardPlacementDirection[],
  relativeOffset: BoardBuildPlanRelativeOffset | undefined
): BoardPlacementResult | null {
  const common = {
    clearance,
    footprint,
    obstacles: visibleBoardObstacles(target),
    preferredDirections
  }
  if (placement.kind === 'relative') {
    return resolveNearestFreePlacement({
      ...common,
      anchor: nodeBounds(target, requireVisibleBoardAnchor(target, placement.objectId)),
      ...(relativeOffset ? { relativeOffset } : {})
    })
  }
  if (placement.kind === 'point') {
    return resolveCenteredFreePlacement({
      ...common,
      center: { x: placement.x, y: placement.y },
      maxRings: 0
    })
  }
  const region =
    placement.kind === 'auto'
      ? boardViewportFocusBounds(target)
      : {
          height: placement.height,
          width: placement.width,
          x: placement.x,
          y: placement.y
        }
  return resolveCenteredFreePlacement({
    ...common,
    center: { x: region.x + region.width / 2, y: region.y + region.height / 2 },
    maxRings: 12,
    ...(placement.kind === 'near_region' ? {} : { searchRegion: region })
  })
}

function codeObjectPlacement(
  target: AutomationTarget,
  artifact: BoardBuildPlanArtifact,
  recipe: BoardBuildPlanCodeObjectRecipe | BoardBuildPlanTrustedWebAppRecipe,
  aliases: Record<string, string>,
  convergenceSources?: Rect[]
): BoardPlacementResult {
  const footprint = {
    height: recipe.height ?? DEFAULT_SIZE.height,
    width: recipe.width ?? DEFAULT_SIZE.width
  }
  const clearance = recipe.placement?.clearance ?? DEFAULT_CLEARANCE
  const preferredDirections = completeDirections(recipe.placement?.preferred_directions)
  const relativeOffset = recipe.placement?.relative_offset
  const anchorId = artifact.anchor ? referenceId(artifact.anchor, aliases) : null
  const freeTarget = placementTarget(recipe)
  const convergenceAnchor = convergenceSources
    ? boardBuildPlanConvergenceAnchor(
        convergenceSources,
        footprint,
        preferredDirections[0] ?? 'right'
      )
    : undefined
  let placement: BoardPlacementResult | null = null
  if (convergenceAnchor) {
    placement = resolveNearestFreePlacement({
      anchor: convergenceAnchor,
      clearance,
      footprint,
      obstacles: visibleBoardObstacles(target),
      preferredDirections
    })
  } else if (anchorId) {
    placement = resolveNearestFreePlacement({
      anchor: nodeBounds(target, requireVisibleBoardAnchor(target, anchorId)),
      clearance,
      footprint,
      obstacles: visibleBoardObstacles(target),
      preferredDirections,
      ...(relativeOffset ? { relativeOffset } : {})
    })
  } else if (freeTarget) {
    placement = freePlacement(
      target,
      freeTarget,
      footprint,
      clearance,
      preferredDirections,
      relativeOffset
    )
  }
  if (!placement) {
    throw new Error(
      `No collision-free placement was found for plan Code Object "${artifact.alias}".`
    )
  }
  return placement
}

export function createPlanCodeObject(
  target: AutomationTarget,
  artifact: BoardBuildPlanArtifact,
  aliases: Record<string, string>,
  prepared: PreparedPlanCodeObject,
  convergenceSources?: Rect[]
): PlanCodeObjectResult {
  const recipe = prepared.recipe
  if (recipe.kind === 'trusted_web_app') {
    const document = createSmylrProductionAppDocument({
      label: recipe.name,
      route: recipe.route,
      ...(recipe.viewport_preset ? { viewportPreset: recipe.viewport_preset } : {})
    })
    if (existingCodeObjectByKey(target, document.definitionId)) {
      throw new Error(`Trusted web app "${document.definitionId}" appeared before plan apply.`)
    }
    const placement = codeObjectPlacement(target, artifact, recipe, aliases, convergenceSources)
    const owner = createPlacedCodeObject(target, document, recipe.name, placement)
    const current = codeObjectDocument(owner)
    if (
      current?.component !== 'smylr-production-app' ||
      current.definitionId !== document.definitionId ||
      current.route !== recipe.route
    ) {
      throw new Error(`Trusted web app "${artifact.alias}" failed immediate semantic readback.`)
    }
    return {
      owner,
      readback: {
        component: {
          app_id: recipe.app_id,
          definition_id: current.definitionId,
          name: current.name,
          route: current.route,
          ...(current.viewport ? { viewport_preset: current.viewport.preset } : {})
        },
        frame: nodeSummary(target, owner),
        placement
      },
      receipt: {
        app_id: recipe.app_id,
        name: current.name,
        object_key: current.definitionId,
        owner_id: owner.id,
        route: current.route,
        ...(current.viewport ? { viewport_preset: current.viewport.preset } : {})
      }
    }
  }
  if (existingCodeObjectByKey(target, recipe.object_key)) {
    throw new Error(`Code Object "${recipe.object_key}" appeared before plan apply.`)
  }
  const placement = codeObjectPlacement(target, artifact, recipe, aliases, convergenceSources)
  const document = createUserCodeObjectDocument({
    definitionId: recipe.object_key,
    name: recipe.name,
    props: recipe.props ?? {},
    source: recipe.source,
    state: recipe.initial_state ?? {}
  })
  const owner = createPlacedCodeObject(target, document, recipe.name, placement)
  if (recipe.ports && !setObjectGraphPorts(target.store.graph, owner.id, recipe.ports)) {
    throw new Error(`Plan Code Object "${artifact.alias}" failed to persist named ports.`)
  }
  const current = codeObjectDocument(owner)
  if (!prepared.sourceHash) {
    throw new Error(`Plan Code Object "${artifact.alias}" is missing its prepared source hash.`)
  }
  if (
    current?.component !== 'user-code' ||
    current.definitionId !== recipe.object_key ||
    current.source !== recipe.source
  ) {
    throw new Error(`Plan Code Object "${artifact.alias}" failed immediate semantic readback.`)
  }
  return {
    owner,
    readback: {
      component: {
        definition_id: current.definitionId,
        name: current.name,
        props: structuredClone(current.props),
        source_hash: prepared.sourceHash,
        source_length: current.source.length,
        state: structuredClone(current.state)
      },
      ports: readObjectGraphPorts(owner),
      frame: nodeSummary(target, owner),
      placement
    },
    receipt: {
      name: current.name,
      object_key: current.definitionId,
      owner_id: owner.id,
      ports: readObjectGraphPorts(owner),
      source_hash: prepared.sourceHash,
      source_length: current.source.length
    }
  }
}
