export type RecentBoardOptions = {
  boardIds: string[]
  currentId: string
  limit: number
  validIds: Iterable<string>
}

export type WarmBoardOptions = RecentBoardOptions & {
  pinnedIds: Iterable<string>
  recentIds: string[]
}

function uniqueValidBoardIds(boardIds: string[], validIds: Set<string>) {
  const seen = new Set<string>()
  return boardIds.filter((id) => {
    if (!validIds.has(id) || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function updateRecentBoardIds({ boardIds, currentId, limit, validIds }: RecentBoardOptions) {
  const valid = new Set(validIds)
  if (!valid.has(currentId)) return uniqueValidBoardIds(boardIds, valid).slice(0, limit)
  return [
    currentId,
    ...uniqueValidBoardIds(boardIds, valid).filter((id) => id !== currentId)
  ].slice(0, limit)
}

export function updateWarmBoardIds({
  boardIds,
  currentId,
  limit,
  pinnedIds,
  recentIds,
  validIds
}: WarmBoardOptions) {
  const pinned = new Set(pinnedIds)
  const valid = new Set(validIds)
  const slots = uniqueValidBoardIds(boardIds, valid).slice(0, limit)
  if (!valid.has(currentId) || pinned.has(currentId) || slots.includes(currentId)) return slots

  const reusableSlot = slots.findIndex((id) => pinned.has(id))
  if (reusableSlot !== -1) {
    slots[reusableSlot] = currentId
    return slots
  }

  if (slots.length < limit) {
    slots.push(currentId)
    return slots
  }

  const recentRank = new Map(recentIds.map((id, index) => [id, index]))
  let replacementSlot = 0
  let leastRecentRank = -1
  for (const [index, id] of slots.entries()) {
    const rank = recentRank.get(id) ?? Number.MAX_SAFE_INTEGER
    if (rank <= leastRecentRank) continue
    replacementSlot = index
    leastRecentRank = rank
  }
  slots[replacementSlot] = currentId
  return slots
}
