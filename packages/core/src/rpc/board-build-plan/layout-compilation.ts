import type {
  BoardBuildPlanBounds,
  BoardBuildPlanFlowLayout,
  BoardBuildPlanGridAlign,
  BoardBuildPlanGridCompilation,
  BoardBuildPlanGridLayout,
  BoardBuildPlanLayout,
  BoardBuildPlanLayoutCompilation
} from './types'

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
type BoardBuildPlanFootprints = Readonly<Partial<Record<string, BoardBuildPlanFootprint>>>

function requiredLayoutFootprint(
  member: string,
  footprints: BoardBuildPlanFootprints,
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
  footprints: BoardBuildPlanFootprints
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
    columnWidths[column] = Math.max(columnWidths.at(column) ?? 0, footprint.width)
    rowHeights[row] = Math.max(rowHeights.at(row) ?? 0, footprint.height)
  })
  const columns = spacedAxis(columnWidths, layout.column_gap)
  const rows = spacedAxis(rowHeights, layout.row_gap)
  const aliases: Record<string, BoardBuildPlanBounds> = {}
  layout.members.forEach((member, index) => {
    const footprint = memberFootprints.at(index)
    const column = index % layout.columns
    const row = Math.floor(index / layout.columns)
    const columnWidth = columnWidths.at(column)
    const rowHeight = rowHeights.at(row)
    const columnStart = columns.starts.at(column)
    const rowStart = rows.starts.at(row)
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
  footprints: BoardBuildPlanFootprints
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
    const primaryStart = primaryAxis.starts.at(rankIndex)
    if (primaryStart === undefined) throw new Error(`Flow rank ${rankIndex} could not be compiled.`)
    let secondaryCursor = gridAlignmentOffset(secondarySize, rank.secondary, layout.align)
    rank.members.forEach((member, memberIndex) => {
      const footprint = rank.memberFootprints.at(memberIndex)
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
  footprints: BoardBuildPlanFootprints
): BoardBuildPlanLayoutCompilation {
  return layout.kind === 'grid'
    ? compileBoardBuildPlanGridLayout(layout, footprints)
    : compileBoardBuildPlanFlowLayout(layout, footprints)
}
