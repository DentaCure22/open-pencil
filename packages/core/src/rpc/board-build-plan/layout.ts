import {
  boardBuildPlanReferenceKey,
  boundedInteger,
  boundedNumber,
  exactFields,
  isRecord,
  parseAlias,
  parseDirections,
  parseLayoutAnchor,
  parseReference
} from './parsing'
import type {
  BoardBuildPlanArtifact,
  BoardBuildPlanComposition,
  BoardBuildPlanCompositionDensity,
  BoardBuildPlanCompositionDirection,
  BoardBuildPlanCompositionGeography,
  BoardBuildPlanCompositionPreferences,
  BoardBuildPlanDirection,
  BoardBuildPlanFlowDirection,
  BoardBuildPlanFlowLayout,
  BoardBuildPlanGridAlign,
  BoardBuildPlanGridLayout,
  BoardBuildPlanGridPlacement,
  BoardBuildPlanLayout,
  BoardBuildPlanLayoutAnchor,
  BoardBuildPlanReference
} from './types'

function parseLayoutMember(value: unknown, label: string): string {
  if (typeof value === 'string') return parseAlias(value, label)
  if (!isRecord(value)) throw new Error(`${label} must be an alias string or object.`)
  exactFields(value, ['alias'], label)
  return parseAlias(value.alias, `${label}.alias`)
}

function parseGridPlacement(
  value: unknown,
  label: string
): BoardBuildPlanGridPlacement | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, ['clearance', 'preferred_directions'], label)
  const clearance =
    value.clearance === undefined
      ? undefined
      : boundedNumber(value.clearance, `${label}.clearance`, 0, 1_024)
  const preferredDirections = parseDirections(
    value.preferred_directions,
    `${label}.preferred_directions`
  )
  return {
    ...(clearance === undefined ? {} : { clearance }),
    ...(preferredDirections ? { preferred_directions: preferredDirections } : {})
  }
}

function layoutAnchorArtifactIndex(
  artifactIndexes: ReadonlyMap<string, number>,
  members: readonly string[],
  anchor: BoardBuildPlanLayoutAnchor,
  label: string,
  memberKind: 'flow' | 'grid'
): number | undefined {
  if (!('alias' in anchor)) return undefined
  const anchorIndex = artifactIndexes.get(anchor.alias)
  if (anchorIndex === undefined) {
    throw new Error(`${label}.anchor references unknown alias "${anchor.alias}".`)
  }
  if (members.includes(anchor.alias)) {
    throw new Error(`${label}.anchor cannot reference a ${memberKind} member.`)
  }
  return anchorIndex
}

function parseGridMembers(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error(`${label}.members must contain at least two aliases.`)
  }
  const members = value.map((member, index) =>
    parseLayoutMember(member, `${label}.members[${index}]`)
  )
  if (new Set(members).size !== members.length) {
    throw new Error(`${label}.members must contain unique aliases with one membership each.`)
  }
  return members
}

function assertGridArtifacts(
  artifacts: readonly BoardBuildPlanArtifact[],
  members: readonly string[],
  anchor: BoardBuildPlanLayoutAnchor,
  label: string
): void {
  const artifactIndexes = new Map(artifacts.map((artifact, index) => [artifact.alias, index]))
  for (const member of members) {
    if (!artifactIndexes.has(member)) {
      throw new Error(`${label}.members references unknown alias "${member}".`)
    }
  }
  const anchorIndex = layoutAnchorArtifactIndex(artifactIndexes, members, anchor, label, 'grid')
  if (anchorIndex !== undefined) {
    const memberIndexes = members.flatMap((member) => {
      const index = artifactIndexes.get(member)
      return index === undefined ? [] : [index]
    })
    if (anchorIndex >= Math.min(...memberIndexes)) {
      throw new Error(`${label}.anchor alias must be created before every grid member.`)
    }
  }
  for (const member of members) {
    const artifactIndex = artifactIndexes.get(member)
    const artifact = artifactIndex === undefined ? undefined : artifacts[artifactIndex]
    if (!artifact) throw new Error(`${label}.members references unknown alias "${member}".`)
    if (artifact.anchor || artifact.recipe.placement) {
      throw new Error(`Grid member "${member}" may not declare anchor or recipe placement fields.`)
    }
  }
}

function parseGridAlign(value: unknown, label: string): BoardBuildPlanGridAlign {
  const align = value ?? 'start'
  if (align !== 'start' && align !== 'center' && align !== 'end') {
    throw new Error(`${label}.align must be start, center, or end.`)
  }
  return align
}

function parseGridLayout(
  value: unknown,
  artifacts: readonly BoardBuildPlanArtifact[]
): BoardBuildPlanGridLayout | undefined {
  if (value === undefined) return undefined
  const label = 'plan.layout'
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(
    value,
    ['align', 'anchor', 'column_gap', 'columns', 'kind', 'members', 'placement', 'row_gap'],
    label
  )
  if (value.kind !== 'grid') throw new Error(`${label}.kind must be grid.`)
  const members = parseGridMembers(value.members, label)
  const anchor = parseLayoutAnchor(value.anchor, `${label}.anchor`)
  assertGridArtifacts(artifacts, members, anchor, label)
  return {
    align: parseGridAlign(value.align, label),
    anchor,
    column_gap:
      value.column_gap === undefined
        ? 48
        : boundedNumber(value.column_gap, `${label}.column_gap`, 0, 1_024),
    columns: boundedInteger(value.columns, `${label}.columns`, 1, 12),
    kind: 'grid',
    members,
    ...(value.placement === undefined
      ? {}
      : { placement: parseGridPlacement(value.placement, `${label}.placement`) }),
    row_gap:
      value.row_gap === undefined ? 48 : boundedNumber(value.row_gap, `${label}.row_gap`, 0, 1_024)
  }
}

function parseFlowRanks(value: unknown, label: string): string[][] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 12) {
    throw new Error(`${label}.ranks must contain 2 to 12 non-empty ranks.`)
  }
  const ranks = value.map((rank, rankIndex) => {
    if (!Array.isArray(rank) || rank.length < 1 || rank.length > 12) {
      throw new Error(`${label}.ranks[${rankIndex}] must contain 1 to 12 aliases.`)
    }
    return rank.map((member, memberIndex) =>
      parseLayoutMember(member, `${label}.ranks[${rankIndex}][${memberIndex}]`)
    )
  })
  const members = ranks.flat()
  if (new Set(members).size !== members.length) {
    throw new Error(`${label}.ranks must contain unique aliases with one membership each.`)
  }
  return ranks
}

function assertFlowArtifacts(
  artifacts: readonly BoardBuildPlanArtifact[],
  members: readonly string[],
  anchor: BoardBuildPlanLayoutAnchor,
  label: string
): void {
  const artifactIndexes = new Map(artifacts.map((artifact, index) => [artifact.alias, index]))
  for (const member of members) {
    if (!artifactIndexes.has(member)) {
      throw new Error(`${label}.ranks references unknown alias "${member}".`)
    }
  }
  const anchorIndex = layoutAnchorArtifactIndex(artifactIndexes, members, anchor, label, 'flow')
  if (anchorIndex !== undefined) {
    const memberIndexes = members.flatMap((member) => {
      const index = artifactIndexes.get(member)
      return index === undefined ? [] : [index]
    })
    if (anchorIndex >= Math.min(...memberIndexes)) {
      throw new Error(`${label}.anchor alias must be created before every flow member.`)
    }
  }
  for (const member of members) {
    const artifactIndex = artifactIndexes.get(member)
    const artifact = artifactIndex === undefined ? undefined : artifacts[artifactIndex]
    if (!artifact) throw new Error(`${label}.ranks references unknown alias "${member}".`)
    if (artifact.anchor || artifact.recipe.placement) {
      throw new Error(`Flow member "${member}" may not declare anchor or recipe placement fields.`)
    }
  }
}

function parseFlowDirection(value: unknown, label: string): BoardBuildPlanFlowDirection {
  const direction = value ?? 'right'
  if (direction !== 'right' && direction !== 'left' && direction !== 'down' && direction !== 'up') {
    throw new Error(`${label}.direction must be right, left, down, or up.`)
  }
  return direction
}

function parseFlowLayout(
  value: unknown,
  artifacts: readonly BoardBuildPlanArtifact[]
): BoardBuildPlanFlowLayout | undefined {
  if (value === undefined) return undefined
  const label = 'plan.layout'
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(
    value,
    ['align', 'anchor', 'direction', 'kind', 'node_gap', 'placement', 'rank_gap', 'ranks'],
    label
  )
  if (value.kind !== 'flow') throw new Error(`${label}.kind must be flow.`)
  const ranks = parseFlowRanks(value.ranks, label)
  const members = ranks.flat()
  const anchor = parseLayoutAnchor(value.anchor, `${label}.anchor`)
  assertFlowArtifacts(artifacts, members, anchor, label)
  const align = value.align ?? 'center'
  if (align !== 'start' && align !== 'center' && align !== 'end') {
    throw new Error(`${label}.align must be start, center, or end.`)
  }
  return {
    align,
    anchor,
    direction: parseFlowDirection(value.direction, label),
    kind: 'flow',
    node_gap:
      value.node_gap === undefined
        ? 72
        : boundedNumber(value.node_gap, `${label}.node_gap`, 0, 1_024),
    ...(value.placement === undefined
      ? {}
      : { placement: parseGridPlacement(value.placement, `${label}.placement`) }),
    rank_gap:
      value.rank_gap === undefined
        ? 160
        : boundedNumber(value.rank_gap, `${label}.rank_gap`, 0, 1_024),
    ranks
  }
}

function parseCompositionReferences(
  value: unknown,
  label: string,
  minimum = 1
): BoardBuildPlanReference[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 32) {
    throw new Error(`${label} must contain ${minimum} to 32 references.`)
  }
  const references = value.map((reference, index) =>
    parseReference(reference, `${label}[${index}]`)
  )
  const keys = references.map(boardBuildPlanReferenceKey)
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${label} must contain unique references.`)
  }
  return references
}

function assertCompositionPreferenceMembers(
  references: readonly BoardBuildPlanReference[],
  members: ReadonlySet<string>,
  label: string
): void {
  for (const reference of references) {
    if (!members.has(boardBuildPlanReferenceKey(reference))) {
      throw new Error(`${label} references an object outside plan.composition.members.`)
    }
  }
}

function parseCompositionDensity(value: unknown, label: string): BoardBuildPlanCompositionDensity {
  const density = value ?? 'balanced'
  if (density !== 'airy' && density !== 'balanced' && density !== 'compact') {
    throw new Error(`${label}.density must be airy, balanced, or compact.`)
  }
  return density
}

function parseCompositionDirection(
  value: unknown,
  label: string
): BoardBuildPlanCompositionDirection | undefined {
  if (value === undefined) return undefined
  if (value !== 'horizontal' && value !== 'vertical') {
    throw new Error(`${label}.direction must be horizontal or vertical.`)
  }
  return value
}

function parseCompositionPreferenceReferences(
  value: unknown,
  label: string,
  memberKeys: ReadonlySet<string>
): BoardBuildPlanReference[] | undefined {
  if (value === undefined) return undefined
  const references = parseCompositionReferences(value, label)
  assertCompositionPreferenceMembers(references, memberKeys, label)
  return references
}

function parseCompositionGroups(
  value: unknown,
  label: string,
  memberKeys: ReadonlySet<string>
): BoardBuildPlanReference[][] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    throw new Error(`${label}.groups must contain 1 to 12 groups.`)
  }
  const groups = value.map((group, index) =>
    parseCompositionReferences(group, `${label}.groups[${index}]`)
  )
  const grouped = groups.flat()
  assertCompositionPreferenceMembers(grouped, memberKeys, `${label}.groups`)
  const groupedKeys = grouped.map(boardBuildPlanReferenceKey)
  if (new Set(groupedKeys).size !== groupedKeys.length) {
    throw new Error(`${label}.groups may assign each member at most once.`)
  }
  return groups
}

function parseCompositionPreferences(
  value: unknown,
  members: readonly BoardBuildPlanReference[]
): BoardBuildPlanCompositionPreferences | undefined {
  if (value === undefined) return undefined
  const label = 'plan.composition.preferences'
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, ['density', 'direction', 'emphasis', 'groups', 'reading_order'], label)
  const memberKeys = new Set(members.map(boardBuildPlanReferenceKey))
  const density = parseCompositionDensity(value.density, label)
  const direction = parseCompositionDirection(value.direction, label)
  const emphasis = parseCompositionPreferenceReferences(
    value.emphasis,
    `${label}.emphasis`,
    memberKeys
  )
  const readingOrder = parseCompositionPreferenceReferences(
    value.reading_order,
    `${label}.reading_order`,
    memberKeys
  )
  const groups = parseCompositionGroups(value.groups, label, memberKeys)
  return {
    density,
    ...(direction ? { direction } : {}),
    ...(emphasis ? { emphasis } : {}),
    ...(groups ? { groups } : {}),
    ...(readingOrder ? { reading_order: readingOrder } : {})
  }
}

function parseCompositionGeography(
  value: unknown,
  members: readonly BoardBuildPlanReference[],
  label: string
): BoardBuildPlanCompositionGeography {
  const geography = value ?? 'preserve'
  if (geography !== 'preserve' && geography !== 'recompose') {
    throw new Error(`${label}.geography must be preserve or recompose.`)
  }
  if (geography === 'preserve' && members.some((member) => 'object_id' in member)) {
    throw new Error(`${label} requires geography recompose to move existing Board objects.`)
  }
  return geography
}

function parseCompositionPlacement(
  value: unknown,
  label: string
): BoardBuildPlanDirection | undefined {
  if (value === undefined) return undefined
  if (value !== 'above' && value !== 'below' && value !== 'left' && value !== 'right') {
    throw new Error(`${label}.placement must be above, below, left, or right.`)
  }
  return value
}

function parseCompositionAnchor(
  value: unknown,
  placement: BoardBuildPlanDirection | undefined,
  memberKeys: ReadonlySet<string>,
  label: string
): BoardBuildPlanLayoutAnchor | undefined {
  const anchor = value === undefined ? undefined : parseLayoutAnchor(value, `${label}.anchor`)
  if (!anchor && placement) {
    throw new Error(`${label}.anchor is required when relative placement is requested.`)
  }
  if (anchor && !('kind' in anchor) && memberKeys.has(boardBuildPlanReferenceKey(anchor))) {
    throw new Error(`${label}.anchor cannot also be a composition member.`)
  }
  return anchor
}

type AliasReference = Extract<BoardBuildPlanReference, { alias: string }>

function assertCompositionArtifacts(
  artifacts: readonly BoardBuildPlanArtifact[],
  aliasMembers: readonly AliasReference[],
  anchor: BoardBuildPlanLayoutAnchor | undefined,
  label: string
): void {
  const artifactIndexes = new Map(artifacts.map((artifact, index) => [artifact.alias, index]))
  for (const member of aliasMembers) {
    const artifactIndex = artifactIndexes.get(member.alias)
    const artifact = artifactIndex === undefined ? undefined : artifacts[artifactIndex]
    if (!artifact) throw new Error(`${label}.members references unknown alias "${member.alias}".`)
    if (artifact.anchor || artifact.recipe.placement) {
      throw new Error(
        `Composition member "${member.alias}" may not declare anchor or recipe placement fields.`
      )
    }
  }
  if (!anchor || !('alias' in anchor)) return
  const anchorIndex = artifactIndexes.get(anchor.alias)
  if (anchorIndex === undefined) {
    throw new Error(`${label}.anchor references unknown alias "${anchor.alias}".`)
  }
  const memberIndexes = aliasMembers.flatMap((member) => {
    const index = artifactIndexes.get(member.alias)
    return index === undefined ? [] : [index]
  })
  if (memberIndexes.length > 0 && anchorIndex >= Math.min(...memberIndexes)) {
    throw new Error(`${label}.anchor alias must be created before every alias member.`)
  }
}

export function parseComposition(
  value: unknown,
  artifacts: readonly BoardBuildPlanArtifact[]
): BoardBuildPlanComposition | undefined {
  if (value === undefined) return undefined
  const label = 'plan.composition'
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, ['anchor', 'geography', 'members', 'placement', 'preferences'], label)
  const members = parseCompositionReferences(value.members, `${label}.members`, 2)
  const memberKeys = new Set(members.map(boardBuildPlanReferenceKey))
  const geography = parseCompositionGeography(value.geography, members, label)
  const placement = parseCompositionPlacement(value.placement, label)
  const anchor = parseCompositionAnchor(value.anchor, placement, memberKeys, label)
  const aliasMembers = members.filter((member): member is AliasReference => 'alias' in member)
  assertCompositionArtifacts(artifacts, aliasMembers, anchor, label)
  return {
    ...(anchor ? { anchor } : {}),
    geography,
    members,
    ...(placement ? { placement } : {}),
    ...(value.preferences === undefined
      ? {}
      : { preferences: parseCompositionPreferences(value.preferences, members) })
  }
}

export function parseLayout(
  value: unknown,
  artifacts: readonly BoardBuildPlanArtifact[]
): BoardBuildPlanLayout | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('plan.layout must be an object.')
  if (value.kind === 'grid') return parseGridLayout(value, artifacts)
  if (value.kind === 'flow') return parseFlowLayout(value, artifacts)
  throw new Error('plan.layout.kind must be grid or flow.')
}

export function boardBuildPlanLayoutMembers(layout: BoardBuildPlanLayout | undefined): string[] {
  if (!layout) return []
  return layout.kind === 'grid' ? layout.members : layout.ranks.flat()
}
