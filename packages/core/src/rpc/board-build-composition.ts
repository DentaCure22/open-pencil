import {
  boardBuildPlanReferenceKey,
  compileBoardBuildPlanGridLayout,
  type BoardBuildPlanBounds,
  type BoardBuildPlanComposition,
  type BoardBuildPlanGridLayout,
  type BoardBuildPlanReference
} from './board-build-plan'

export type BoardBuildPlanCompositionCompilation = {
  footprint: Pick<BoardBuildPlanBounds, 'height' | 'width'>
  members: Record<string, BoardBuildPlanBounds>
  strategy: 'flow' | 'grid'
}

type CompositionFootprints = Readonly<
  Record<string, Pick<BoardBuildPlanBounds, 'height' | 'width'>>
>

const DENSITY_GAPS = {
  airy: 72,
  balanced: 48,
  compact: 32
} as const

const COMPOSITION_LOCAL_ORIGIN = {
  height: 1,
  kind: 'near_region' as const,
  width: 1,
  x: 0,
  y: 0
}

function uniqueKeys(references: readonly BoardBuildPlanReference[]): string[] {
  return [...new Set(references.map(boardBuildPlanReferenceKey))]
}

function orderedMemberKeys(composition: BoardBuildPlanComposition): string[] {
  const preferences = composition.preferences
  const base = composition.members.map(boardBuildPlanReferenceKey)
  let preferred: string[] = []
  if (preferences?.reading_order) preferred = uniqueKeys(preferences.reading_order)
  else if (preferences?.groups) preferred = uniqueKeys(preferences.groups.flat())
  else if (preferences?.emphasis) preferred = uniqueKeys(preferences.emphasis)
  return [...preferred, ...base.filter((key) => !preferred.includes(key))]
}

function groupSplitPenalty(
  composition: BoardBuildPlanComposition,
  memberKeys: readonly string[],
  columns: number
): number {
  const groups = composition.preferences?.groups ?? []
  return groups.reduce((penalty, group) => {
    const rows = new Set(
      group.map((reference) => {
        const index = memberKeys.indexOf(boardBuildPlanReferenceKey(reference))
        return Math.floor(index / columns)
      })
    )
    return penalty + Math.max(0, rows.size - 1) * 0.6
  }, 0)
}

function gridScore(
  composition: BoardBuildPlanComposition,
  memberKeys: readonly string[],
  columns: number,
  footprint: Pick<BoardBuildPlanBounds, 'height' | 'width'>
): number {
  const direction = composition.preferences?.direction
  let targetRatio = 1.3
  if (direction === 'horizontal') targetRatio = 2.4
  else if (direction === 'vertical') targetRatio = 0.55
  const ratio = footprint.width / Math.max(1, footprint.height)
  const rows = Math.ceil(memberKeys.length / columns)
  let directionPenalty = 0
  if (direction === 'horizontal') directionPenalty = Math.max(0, rows - 1) * 0.12
  else if (direction === 'vertical') directionPenalty = Math.max(0, columns - 1) * 0.12
  const extremePenalty =
    memberKeys.length > 6 && (columns === 1 || rows === 1) ? memberKeys.length * 0.15 : 0
  return (
    Math.abs(Math.log(Math.max(0.01, ratio) / targetRatio)) +
    directionPenalty +
    extremePenalty +
    groupSplitPenalty(composition, memberKeys, columns)
  )
}

function gridCandidateColumns(
  composition: BoardBuildPlanComposition,
  memberCount: number
): number[] {
  // An explicit direction is a promise: small sets stay on one axis instead of wrapping.
  const direction = composition.preferences?.direction
  if (memberCount <= 6 && direction === 'horizontal') return [memberCount]
  if (memberCount <= 6 && direction === 'vertical') return [1]
  return Array.from({ length: Math.min(memberCount, 6) }, (_, index) => index + 1)
}

function compileGrid(
  composition: BoardBuildPlanComposition,
  footprints: CompositionFootprints,
  memberKeys: readonly string[],
  gap: number
): BoardBuildPlanCompositionCompilation {
  const candidates = gridCandidateColumns(composition, memberKeys.length).map((columns) => {
    const layout: BoardBuildPlanGridLayout = {
      align: 'start',
      anchor: composition.anchor ?? COMPOSITION_LOCAL_ORIGIN,
      column_gap: gap,
      columns,
      kind: 'grid',
      members: [...memberKeys],
      row_gap: gap
    }
    const compilation = compileBoardBuildPlanGridLayout(layout, footprints)
    return {
      compilation,
      score: gridScore(composition, memberKeys, columns, compilation.footprint)
    }
  })
  const best = candidates.sort((left, right) => left.score - right.score)[0]
  if (!best) throw new Error('Board composition has no viable arrangement.')
  return {
    footprint: best.compilation.footprint,
    members: best.compilation.aliases,
    strategy: 'grid'
  }
}

export function boardBuildPlanCompositionGap(composition: BoardBuildPlanComposition): number {
  return DENSITY_GAPS[composition.preferences?.density ?? 'balanced']
}

export function boardBuildPlanCompositionMembers(
  composition: BoardBuildPlanComposition | undefined
): BoardBuildPlanReference[] {
  return composition ? composition.members.map((member) => ({ ...member })) : []
}

export function boardBuildPlanCompositionCurrentBounds(
  composition: BoardBuildPlanComposition,
  boundsForObjectId: (objectId: string) => BoardBuildPlanBounds | undefined
): BoardBuildPlanBounds | undefined {
  const bounds = composition.members.flatMap((member) => {
    if (!('object_id' in member)) return []
    const objectBounds = boundsForObjectId(member.object_id)
    return objectBounds ? [objectBounds] : []
  })
  if (bounds.length === 0) return undefined
  const left = Math.min(...bounds.map((item) => item.x))
  const top = Math.min(...bounds.map((item) => item.y))
  const right = Math.max(...bounds.map((item) => item.x + item.width))
  const bottom = Math.max(...bounds.map((item) => item.y + item.height))
  return { height: bottom - top, width: right - left, x: left, y: top }
}

export function compileBoardBuildPlanComposition(
  composition: BoardBuildPlanComposition,
  footprints: CompositionFootprints
): BoardBuildPlanCompositionCompilation {
  const memberKeys = orderedMemberKeys(composition)
  const gap = boardBuildPlanCompositionGap(composition)
  return compileGrid(composition, footprints, memberKeys, gap)
}
