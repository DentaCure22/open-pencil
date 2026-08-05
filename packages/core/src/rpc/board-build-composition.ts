import {
  boardBuildPlanReferenceKey,
  compileBoardBuildPlanFlowLayout,
  compileBoardBuildPlanGridLayout,
  type BoardBuildPlanBounds,
  type BoardBuildPlanComposition,
  type BoardBuildPlanConnection,
  type BoardBuildPlanFlowLayout,
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
  const preferred = preferences?.reading_order
    ? uniqueKeys(preferences.reading_order)
    : preferences?.groups
      ? uniqueKeys(preferences.groups.flat())
      : preferences?.emphasis
        ? uniqueKeys(preferences.emphasis)
        : []
  return [...preferred, ...base.filter((key) => !preferred.includes(key))]
}

function topologyRanks(
  memberKeys: readonly string[],
  connections: readonly BoardBuildPlanConnection[]
): string[][] | undefined {
  const members = new Set(memberKeys)
  const outgoing = new Map(memberKeys.map((key) => [key, new Set<string>()]))
  const indegree = new Map(memberKeys.map((key) => [key, 0]))
  for (const connection of connections) {
    const source = boardBuildPlanReferenceKey(connection.source)
    const target = boardBuildPlanReferenceKey(connection.target)
    if (!members.has(source) || !members.has(target) || source === target) continue
    const targets = outgoing.get(source)
    if (!targets || targets.has(target)) continue
    targets.add(target)
    indegree.set(target, (indegree.get(target) ?? 0) + 1)
  }
  if ([...outgoing.values()].every((targets) => targets.size === 0)) return undefined

  const depth = new Map(memberKeys.map((key) => [key, 0]))
  const queue = memberKeys.filter((key) => indegree.get(key) === 0)
  const visited: string[] = []
  while (queue.length > 0) {
    const key = queue.shift()
    if (!key) break
    visited.push(key)
    for (const target of outgoing.get(key) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(key) ?? 0) + 1))
      const nextIndegree = (indegree.get(target) ?? 0) - 1
      indegree.set(target, nextIndegree)
      if (nextIndegree === 0) queue.push(target)
    }
  }
  if (visited.length !== memberKeys.length) return undefined
  const rankCount = Math.max(...depth.values()) + 1
  return Array.from({ length: rankCount }, (_, rank) =>
    memberKeys.filter((key) => depth.get(key) === rank)
  ).filter((rank) => rank.length > 0)
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
  const targetRatio = direction === 'horizontal' ? 2.4 : direction === 'vertical' ? 0.55 : 1.3
  const ratio = footprint.width / Math.max(1, footprint.height)
  const rows = Math.ceil(memberKeys.length / columns)
  const directionPenalty =
    direction === 'horizontal'
      ? Math.max(0, rows - 1) * 0.12
      : direction === 'vertical'
        ? Math.max(0, columns - 1) * 0.12
        : 0
  const extremePenalty =
    memberKeys.length > 6 && (columns === 1 || rows === 1) ? memberKeys.length * 0.15 : 0
  return (
    Math.abs(Math.log(Math.max(0.01, ratio) / targetRatio)) +
    directionPenalty +
    extremePenalty +
    groupSplitPenalty(composition, memberKeys, columns)
  )
}

function compileGrid(
  composition: BoardBuildPlanComposition,
  footprints: CompositionFootprints,
  memberKeys: readonly string[],
  gap: number
): BoardBuildPlanCompositionCompilation {
  const candidates = Array.from(
    { length: Math.min(memberKeys.length, 6) },
    (_, index) => index + 1
  ).map((columns) => {
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
  footprints: CompositionFootprints,
  connections: readonly BoardBuildPlanConnection[] = []
): BoardBuildPlanCompositionCompilation {
  const memberKeys = orderedMemberKeys(composition)
  const gap = boardBuildPlanCompositionGap(composition)
  const ranks = topologyRanks(memberKeys, connections)
  if (!ranks) return compileGrid(composition, footprints, memberKeys, gap)
  const direction = composition.preferences?.direction ?? 'horizontal'
  const layout: BoardBuildPlanFlowLayout = {
    align: 'center',
    anchor: composition.anchor ?? COMPOSITION_LOCAL_ORIGIN,
    direction: direction === 'horizontal' ? 'right' : 'down',
    kind: 'flow',
    node_gap: gap,
    rank_gap: gap * 2,
    ranks
  }
  const compilation = compileBoardBuildPlanFlowLayout(layout, footprints)
  return { footprint: compilation.footprint, members: compilation.aliases, strategy: 'flow' }
}
