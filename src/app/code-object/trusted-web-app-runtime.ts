import { reconcileLiveRuntimeResidency } from './runtime-residency'

export const TRUSTED_WEB_APP_LIVE_RUNTIME_CAP = 4

export interface TrustedWebAppResidencyFrameScopeInput {
  frameIds: readonly string[]
  relevantFrameIds: ReadonlySet<string>
  residentFrameIds: ReadonlySet<string>
}

export interface TrustedWebAppResidencyInput {
  activeFrameId: string | null
  frameIds: readonly string[]
  interactedAtByFrame: Readonly<Record<string, number>>
  residentFrameIds: ReadonlySet<string>
}

export function trustedWebAppResidencyFrameIds({
  frameIds,
  relevantFrameIds,
  residentFrameIds
}: TrustedWebAppResidencyFrameScopeInput): string[] {
  return frameIds.filter(
    (frameId) => relevantFrameIds.has(frameId) || residentFrameIds.has(frameId)
  )
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
  return reconcileLiveRuntimeResidency({
    cap: TRUSTED_WEB_APP_LIVE_RUNTIME_CAP,
    frameIds,
    interactedAtByFrame,
    pinnedFrameIds: activeFrameId ? [activeFrameId] : [],
    residentFrameIds
  })
}
