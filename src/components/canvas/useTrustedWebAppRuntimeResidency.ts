import { ref, type ComputedRef } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { reconcileTrustedWebAppResidency } from '@/app/code-object/trusted-web-app-runtime'
import type { EditorStore } from '@/app/editor/active-store'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'

interface TrustedWebAppRuntimeResidencyOptions {
  activeFrameIds: ComputedRef<ReadonlySet<string>>
  frames: ComputedRef<SceneNode[]>
  store: EditorStore
}

export function useTrustedWebAppRuntimeResidency({
  activeFrameIds,
  frames,
  store
}: TrustedWebAppRuntimeResidencyOptions) {
  const interactedAtByFrame = ref<Record<string, number>>({})
  const residentFrameIds = ref<Set<string>>(new Set())
  let interactionSequence = 0

  function selectedFrameId() {
    if (store.state.selectedIds.size !== 1) return null
    const [selectedId] = store.state.selectedIds
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    return selected && isSmylrProductionAppCodeObjectFrame(selected) ? selected.id : null
  }

  function reconcile(activeFrameId = selectedFrameId()) {
    const eligibleFrameIds = frames.value
      .filter(
        (frame) => isSmylrProductionAppCodeObjectFrame(frame) && activeFrameIds.value.has(frame.id)
      )
      .map((frame) => frame.id)
    residentFrameIds.value = reconcileTrustedWebAppResidency({
      activeFrameId:
        activeFrameId && eligibleFrameIds.includes(activeFrameId) ? activeFrameId : null,
      frameIds: eligibleFrameIds,
      interactedAtByFrame: interactedAtByFrame.value,
      residentFrameIds: residentFrameIds.value
    })
  }

  function promote(frameId: string) {
    interactionSequence += 1
    interactedAtByFrame.value = {
      ...interactedAtByFrame.value,
      [frameId]: interactionSequence
    }
    reconcile(frameId)
  }

  function retainCurrentFrames() {
    const currentFrameIds = new Set(frames.value.map((frame) => frame.id))
    interactedAtByFrame.value = Object.fromEntries(
      Object.entries(interactedAtByFrame.value).filter(([frameId]) => currentFrameIds.has(frameId))
    )
    reconcile()
  }

  function isResident(frameId: string) {
    return residentFrameIds.value.has(frameId)
  }

  return { isResident, promote, reconcile, retainCurrentFrames, selectedFrameId }
}
