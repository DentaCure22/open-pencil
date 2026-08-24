import { ref, type ComputedRef, type Ref } from 'vue'

import type { SceneNode } from '@open-pencil/scene-graph'

import { sameStringSet } from '@/app/code-object/runtime-residency'
import {
  reconcileTrustedWebAppResidency,
  trustedWebAppResidencyFrameIds
} from '@/app/code-object/trusted-web-app-runtime'
import type { EditorStore } from '@/app/editor/active-store'
import { isSmylrProductionAppCodeObjectFrame } from '@/app/smylr-production/workspace'

interface TrustedWebAppRuntimeResidencyOptions {
  activeFrameIds: ComputedRef<ReadonlySet<string>>
  documentVisible: Readonly<Ref<boolean>>
  frames: ComputedRef<SceneNode[]>
  store: EditorStore
}

export function useTrustedWebAppRuntimeResidency({
  activeFrameIds,
  documentVisible,
  frames,
  store
}: TrustedWebAppRuntimeResidencyOptions) {
  const interactedAtByFrame = ref<Record<string, number>>({})
  const residentFrameIds = ref<Set<string>>(new Set())
  const paintedFrameIds = ref<Set<string>>(new Set())
  let interactionSequence = 0

  function selectedFrameId() {
    if (store.state.selectedIds.size !== 1) return null
    const [selectedId] = store.state.selectedIds
    const selected = selectedId ? store.graph.getNode(selectedId) : null
    return selected && isSmylrProductionAppCodeObjectFrame(selected) ? selected.id : null
  }

  function rememberPainted(nextResidentFrameIds: ReadonlySet<string>) {
    const currentFrameIds = new Set(frames.value.map((frame) => frame.id))
    const nextPaintedFrameIds = new Set<string>()
    for (const frameId of paintedFrameIds.value) {
      if (currentFrameIds.has(frameId)) nextPaintedFrameIds.add(frameId)
    }
    for (const frameId of nextResidentFrameIds) {
      if (currentFrameIds.has(frameId)) nextPaintedFrameIds.add(frameId)
    }
    if (!sameStringSet(paintedFrameIds.value, nextPaintedFrameIds)) {
      paintedFrameIds.value = nextPaintedFrameIds
    }
  }

  function reconcile(activeFrameId = selectedFrameId()) {
    if (!documentVisible.value) {
      rememberPainted(residentFrameIds.value)
      return
    }
    const productionFrames = frames.value.filter(isSmylrProductionAppCodeObjectFrame)
    const eligibleFrameIds = trustedWebAppResidencyFrameIds({
      frameIds: productionFrames.map((frame) => frame.id),
      relevantFrameIds: activeFrameIds.value,
      residentFrameIds: residentFrameIds.value
    })
    const nextResidentFrameIds = reconcileTrustedWebAppResidency({
      activeFrameId:
        activeFrameId && eligibleFrameIds.includes(activeFrameId) ? activeFrameId : null,
      frameIds: eligibleFrameIds,
      interactedAtByFrame: interactedAtByFrame.value,
      residentFrameIds: residentFrameIds.value
    })
    if (!sameStringSet(residentFrameIds.value, nextResidentFrameIds)) {
      residentFrameIds.value = nextResidentFrameIds
    }
    rememberPainted(nextResidentFrameIds)
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

  function isPainted(frameId: string) {
    return paintedFrameIds.value.has(frameId) || residentFrameIds.value.has(frameId)
  }

  return { isPainted, isResident, promote, reconcile, retainCurrentFrames, selectedFrameId }
}
