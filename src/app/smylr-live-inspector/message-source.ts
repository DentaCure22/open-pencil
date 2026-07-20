export type LiveInspectorMessageEvent = Pick<MessageEvent, 'origin' | 'source'>

export type LiveInspectorFrameMessageCandidate = {
  frameId: string
  frameWindow: Window | null
}

/**
 * Resolve an inspector packet to the exact iframe that emitted it.
 * Origin alone is not enough because Current and every alternate share the
 * Smylr origin. The source window is the frame identity boundary.
 */
export function liveInspectorFrameIdForMessage(
  event: LiveInspectorMessageEvent,
  expectedOrigin: string,
  candidates: LiveInspectorFrameMessageCandidate[]
) {
  if (!expectedOrigin || event.origin !== expectedOrigin || !event.source) return null
  return candidates.find((candidate) => candidate.frameWindow === event.source)?.frameId ?? null
}

export function isLiveInspectorMessageFromFrame(
  event: LiveInspectorMessageEvent,
  expectedOrigin: string,
  frameId: string,
  frameWindow: Window | null
) {
  return (
    liveInspectorFrameIdForMessage(event, expectedOrigin, [{ frameId, frameWindow }]) === frameId
  )
}
