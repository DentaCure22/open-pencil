export const TRUSTED_WEB_APP_LIVE_RUNTIME_CAP = 4

export interface TrustedWebAppResidencyInput {
  activeFrameId: string | null
  frameIds: readonly string[]
  interactedAtByFrame: Readonly<Record<string, number>>
  residentFrameIds: ReadonlySet<string>
}

function interactionTime(frameId: string, interactedAtByFrame: Readonly<Record<string, number>>) {
  return interactedAtByFrame[frameId] ?? 0
}

/**
 * Keep the selected runtime resident, then retain the most recently used
 * passive runtimes. Residency is volatile and never enters the Board document.
 */
export function reconcileTrustedWebAppResidency({
  activeFrameId,
  frameIds,
  interactedAtByFrame,
  residentFrameIds
}: TrustedWebAppResidencyInput): Set<string> {
  const availableFrameIds = new Set(frameIds)
  const candidates = [...frameIds].sort((left, right) => {
    if (left === activeFrameId) return -1
    if (right === activeFrameId) return 1

    const leftResident = residentFrameIds.has(left)
    const rightResident = residentFrameIds.has(right)
    const timeDifference =
      interactionTime(right, interactedAtByFrame) - interactionTime(left, interactedAtByFrame)
    if (timeDifference !== 0) return timeDifference
    if (leftResident !== rightResident) return leftResident ? -1 : 1
    return frameIds.indexOf(left) - frameIds.indexOf(right)
  })

  if (
    activeFrameId &&
    availableFrameIds.has(activeFrameId) &&
    !candidates.includes(activeFrameId)
  ) {
    candidates.unshift(activeFrameId)
  }
  return new Set(candidates.slice(0, TRUSTED_WEB_APP_LIVE_RUNTIME_CAP))
}
