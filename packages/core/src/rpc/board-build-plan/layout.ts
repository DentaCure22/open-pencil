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
  BoardBuildPlanBounds,
  BoardBuildPlanComposition,
  BoardBuildPlanCompositionPreferences,
  BoardBuildPlanFlowDirection,
  BoardBuildPlanFlowLayout,
  BoardBuildPlanGridAlign,
  BoardBuildPlanGridCompilation,
  BoardBuildPlanGridLayout,
  BoardBuildPlanGridPlacement,
  BoardBuildPlanLayout,
  BoardBuildPlanLayoutAnchor,
  BoardBuildPlanLayoutCompilation,
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
  if (!Array.isArray(value.members) || value.members.length < 2) {
    throw new Error(`${label}.members must contain at least two aliases.`)
  }
  const members = value.members.map((member, index) =>
    parseLayoutMember(member, `${label}.members[${index}]`)
  )
  if (new Set(members).size !== members.length) {
    throw new Error(`${label}.members must contain unique aliases with one membership each.`)
  }
  const artifactIndexes = new Map(artifacts.map((artifact, index) => [artifact.alias, index]))
  for (const member of members) {
    if (!artifactIndexes.has(member)) {
      throw new Error(`${label}.members references unknown alias "${member}".`)
    }
  }
  const anchor = parseLayoutAnchor(value.anchor, `${label}.anchor`)
  const anchorIndex = layoutAnchorArtifactIndex(artifactIndexes, members, anchor, label, 'grid')
  if (anchorIndex !== undefined) {
    const memberIndexes = members.flatMap((member) => {
      const index = artifactIndexes.get(member)
      return index === undefined ? [] : [index]
    })
    const firstMemberIndex = Math.min(...memberIndexes)
    if (anchorIndex >= firstMemberIndex) {
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
  const align = value.align ?? 'start'
  if (align !== 'start' && align !== 'center' && align !== 'end') {
    throw new Error(`${label}.align must be start, center, or end.`)
  }
  return {
    align,
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

function parseCompositionPreferences(
  value: unknown,
  members: readonly BoardBuildPlanReference[]
): BoardBuildPlanCompositionPreferences | undefined {
  if (value === undefined) return undefined
  const label = 'plan.composition.preferences'
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  exactFields(value, ['density', 'direction', 'emphasis', 'groups', 'reading_order'], label)
  const memberKeys = new Set(members.map(boardBuildPlanReferenceKey))
  const density = value.density ?? 'balanced'
  if (density !== 'airy' && density !== 'balanced' && density !== 'compact') {
    throw new Error(`${label}.density must be airy, balanced, or compact.`)
  }
  const direction = value.direction
  if (direction !== undefined && direction !== 'horizontal' && direction !== 'vertical') {
    throw new Error(`${label}.direction must be horizontal or vertical.`)
  }
  const emphasis =
    value.emphasis === undefined
      ? undefined
      : parseCompositionReferences(value.emphasis, `${label}.emphasis`)
  if (emphasis) assertCompositionPreferenceMembers(emphasis, memberKeys, `${label}.emphasis`)
  const readingOrder =
    value.reading_order === undefined
      ? undefined
      : parseCompositionReferences(value.reading_order, `${label}.reading_order`)
  if (readingOrder) {
    assertCompositionPreferenceMembers(readingOrder, memberKeys, `${label}.reading_order`)
  }
  let groups: BoardBuildPlanReference[][] | undefined
  if (value.groups !== undefined) {
    if (!Array.isArray(value.groups) || value.groups.length < 1 || value.groups.length > 12) {
      throw new Error(`${label}.groups must contain 1 to 12 groups.`)
    }
    groups = value.groups.map((group, index) =>
      parseCompositionReferences(group, `${label}.groups[${index}]`)
    )
    const grouped = groups.flat()
    assertCompositionPreferenceMembers(grouped, memberKeys, `${label}.groups`)
    const groupedKeys = grouped.map(boardBuildPlanReferenceKey)
    if (new Set(groupedKeys).size !== groupedKeys.length) {
      throw new Error(`${label}.groups may assign each member at most once.`)
    }
  }
  return {
    density,
    ...(direction ? { direction } : {}),
    ...(emphasis ? { emphasis } : {}),
    ...(groups ? { groups } : {}),
    ...(readingOrder ? { reading_order: readingOrder } : {})
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
  const geography = value.geography ?? 'preserve'
  if (geography !== 'preserve' && geography !== 'recompose') {
    throw new Error(`${label}.geography must be preserve or recompose.`)
  }
  if (geography === 'preserve' && members.some((member) => 'object_id' in member)) {
    throw new Error(`${label} requires geography recompose to move existing Board objects.`)
  }
  const placement = value.placement
  if (
    placement !== undefined &&
    placement !== 'above' &&
    placement !== 'below' &&
    placement !== 'left' &&
    placement !== 'right'
  ) {
    throw new Error(`${label}.placement must be above, below, left, or right.`)
  }
  const anchor =
    value.anchor === undefined ? undefined : parseLayoutAnchor(value.anchor, `${label}.anchor`)
  if (!anchor && placement) {
    throw new Error(`${label}.anchor is required when relative placement is requested.`)
  }
  if (anchor && !('kind' in anchor) && memberKeys.has(boardBuildPlanReferenceKey(anchor))) {
    throw new Error(`${label}.anchor cannot also be a composition member.`)
  }
  const artifactIndexes = new Map(artifacts.map((artifact, index) => [artifact.alias, index]))
  const aliasMembers = members.filter(
    (member): member is Extract<BoardBuildPlanReference, { alias: string }> => 'alias' in member
  )
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
  if (anchor && 'alias' in anchor) {
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

function gridAlignmentOffset(
  available: number,
  size: number,
  align: BoardBuildPlanGridAlign
): number {
  if (align === 'center') return (available - size) / 2
  if (align === 'end') return available - size
  return 0
}

type BoardBuildPlanFootprint = Pick<BoardBuildPlanBounds, 'height' | 'width'>

function requiredLayoutFootprint(
  member: string,
  footprints: Readonly<Record<string, BoardBuildPlanFootprint>>,
  layoutKind: 'Flow' | 'Grid'
): BoardBuildPlanFootprint {
  const footprint = footprints[member]
  if (
    !footprint ||
    !Number.isFinite(footprint.width) ||
    !Number.isFinite(footprint.height) ||
    footprint.width <= 0 ||
    footprint.height <= 0
  ) {
    throw new Error(`${layoutKind} member "${member}" requires a positive finite footprint.`)
  }
  return footprint
}

function spacedAxis(sizes: readonly number[], gap: number): { size: number; starts: number[] } {
  let cursor = 0
  const starts = sizes.map((size) => {
    const start = cursor
    cursor += size + gap
    return start
  })
  return { size: Math.max(0, cursor - gap), starts }
}

export function compileBoardBuildPlanGridLayout(
  layout: BoardBuildPlanGridLayout,
  footprints: Readonly<Record<string, BoardBuildPlanFootprint>>
): BoardBuildPlanGridCompilation {
  const memberFootprints = layout.members.map((member) =>
    requiredLayoutFootprint(member, footprints, 'Grid')
  )
  const rowCount = Math.ceil(layout.members.length / layout.columns)
  const columnWidths = Array.from({ length: layout.columns }, () => 0)
  const rowHeights = Array.from({ length: rowCount }, () => 0)
  memberFootprints.forEach((footprint, index) => {
    const column = index % layout.columns
    const row = Math.floor(index / layout.columns)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, footprint.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, footprint.height)
  })
  const columns = spacedAxis(columnWidths, layout.column_gap)
  const rows = spacedAxis(rowHeights, layout.row_gap)
  const aliases: Record<string, BoardBuildPlanBounds> = {}
  layout.members.forEach((member, index) => {
    const footprint = memberFootprints[index]
    const column = index % layout.columns
    const row = Math.floor(index / layout.columns)
    const columnWidth = columnWidths[column]
    const rowHeight = rowHeights[row]
    const columnStart = columns.starts[column]
    const rowStart = rows.starts[row]
    if (
      !footprint ||
      columnWidth === undefined ||
      rowHeight === undefined ||
      columnStart === undefined ||
      rowStart === undefined
    ) {
      throw new Error(`Grid member "${member}" could not be compiled.`)
    }
    aliases[member] = {
      height: footprint.height,
      width: footprint.width,
      x: columnStart + gridAlignmentOffset(columnWidth, footprint.width, layout.align),
      y: rowStart + gridAlignmentOffset(rowHeight, footprint.height, layout.align)
    }
  })
  return {
    aliases,
    footprint: { height: rows.size, width: columns.size }
  }
}

export function compileBoardBuildPlanFlowLayout(
  layout: BoardBuildPlanFlowLayout,
  footprints: Readonly<Record<string, BoardBuildPlanFootprint>>
): BoardBuildPlanLayoutCompilation {
  const horizontal = layout.direction === 'left' || layout.direction === 'right'
  const ranks = layout.ranks.map((members) => {
    const memberFootprints = members.map((member) =>
      requiredLayoutFootprint(member, footprints, 'Flow')
    )
    return {
      members,
      memberFootprints,
      primary: horizontal
        ? Math.max(...memberFootprints.map(({ width }) => width))
        : Math.max(...memberFootprints.map(({ height }) => height)),
      secondary:
        memberFootprints.reduce(
          (total, footprint) => total + (horizontal ? footprint.height : footprint.width),
          0
        ) +
        Math.max(0, memberFootprints.length - 1) * layout.node_gap
    }
  })
  const primaryAxis = spacedAxis(
    ranks.map((rank) => rank.primary),
    layout.rank_gap
  )
  const secondarySize = Math.max(...ranks.map((rank) => rank.secondary))
  const aliases: Record<string, BoardBuildPlanBounds> = {}

  ranks.forEach((rank, rankIndex) => {
    const primaryStart = primaryAxis.starts[rankIndex]
    if (primaryStart === undefined) throw new Error(`Flow rank ${rankIndex} could not be compiled.`)
    let secondaryCursor = gridAlignmentOffset(secondarySize, rank.secondary, layout.align)
    rank.members.forEach((member, memberIndex) => {
      const footprint = rank.memberFootprints[memberIndex]
      if (!footprint) throw new Error(`Flow member "${member}" could not be compiled.`)
      const raw = horizontal
        ? {
            height: footprint.height,
            width: footprint.width,
            x: primaryStart + (rank.primary - footprint.width) / 2,
            y: secondaryCursor
          }
        : {
            height: footprint.height,
            width: footprint.width,
            x: secondaryCursor,
            y: primaryStart + (rank.primary - footprint.height) / 2
          }
      aliases[member] = {
        ...raw,
        x: layout.direction === 'left' ? primaryAxis.size - raw.x - raw.width : raw.x,
        y: layout.direction === 'up' ? primaryAxis.size - raw.y - raw.height : raw.y
      }
      secondaryCursor += (horizontal ? footprint.height : footprint.width) + layout.node_gap
    })
  })

  return {
    aliases,
    footprint: horizontal
      ? { height: secondarySize, width: primaryAxis.size }
      : { height: primaryAxis.size, width: secondarySize }
  }
}

export function compileBoardBuildPlanLayout(
  layout: BoardBuildPlanLayout,
  footprints: Readonly<Record<string, BoardBuildPlanFootprint>>
): BoardBuildPlanLayoutCompilation {
  return layout.kind === 'grid'
    ? compileBoardBuildPlanGridLayout(layout, footprints)
    : compileBoardBuildPlanFlowLayout(layout, footprints)
}
