export interface LiveRuntimeVisibilityInput {
  currentPageId: string
  frameId: string
  frameParentId: string | null
  lastInteractedFrameId: string | null
  loadedFrameId: string | null
  ownsInteraction: boolean
}

export interface LiveRuntimeSelectionInput {
  activeFrameId: string | null
  alternateFrameIds: readonly string[]
  hasLiveContainerSelection: boolean
  selectedSceneNodeIds: ReadonlySet<string>
}

export function resolveSelectedLiveRuntimeFrameId({
  activeFrameId,
  alternateFrameIds,
  hasLiveContainerSelection,
  selectedSceneNodeIds
}: LiveRuntimeSelectionInput) {
  const alternateFrameIdSet = new Set(alternateFrameIds)
  if (hasLiveContainerSelection && activeFrameId && alternateFrameIdSet.has(activeFrameId)) {
    return activeFrameId
  }
  return alternateFrameIds.find((frameId) => selectedSceneNodeIds.has(frameId)) ?? null
}

export function shouldShowLiveRuntime({
  currentPageId,
  frameId,
  frameParentId,
  lastInteractedFrameId,
  loadedFrameId,
  ownsInteraction
}: LiveRuntimeVisibilityInput) {
  const isLiveStateOwner = ownsInteraction || lastInteractedFrameId === frameId
  return frameParentId === currentPageId && loadedFrameId === frameId && isLiveStateOwner
}
