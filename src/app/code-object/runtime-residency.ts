export const CODE_OBJECT_LIVE_RUNTIME_CAP = 6

export function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

export interface LiveRuntimeResidencyInput {
  cap: number
  frameIds: readonly string[]
  interactedAtByFrame: Readonly<Record<string, number>>
  pinnedFrameIds: readonly string[]
  residentFrameIds: ReadonlySet<string>
}

function interactionTime(frameId: string, interactedAtByFrame: Readonly<Record<string, number>>) {
  return interactedAtByFrame[frameId] ?? 0
}

/**
 * Choose which on-page runtimes stay hot for JS work. Visibility stays
 * separate: last paint remains in the overlay even when a frame is cold.
 * Residency is volatile and never enters the Board document.
 */
export function reconcileLiveRuntimeResidency({
  cap,
  frameIds,
  interactedAtByFrame,
  pinnedFrameIds,
  residentFrameIds
}: LiveRuntimeResidencyInput): Set<string> {
  const availableFrameIds = new Set(frameIds)
  const pinned = pinnedFrameIds.filter((frameId) => availableFrameIds.has(frameId))
  const pinnedSet = new Set(pinned)
  const rest = frameIds
    .filter((frameId) => !pinnedSet.has(frameId))
    .sort((left, right) => {
      const timeDifference =
        interactionTime(right, interactedAtByFrame) - interactionTime(left, interactedAtByFrame)
      if (timeDifference !== 0) return timeDifference
      const leftResident = residentFrameIds.has(left)
      const rightResident = residentFrameIds.has(right)
      if (leftResident !== rightResident) return leftResident ? -1 : 1
      return frameIds.indexOf(left) - frameIds.indexOf(right)
    })
  return new Set([...pinned, ...rest].slice(0, Math.max(cap, pinned.length)))
}
