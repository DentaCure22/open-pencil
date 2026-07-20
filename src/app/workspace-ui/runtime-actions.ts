import { nextTick, watch } from 'vue'

import {
  liveInspectorActiveFrameId,
  liveInspectorDocument,
  liveInspectorStatus,
  setLiveInspectorActiveFrame
} from '@/app/smylr-live-inspector/session'
import { fitSmylrPageToViewport } from '@/app/smylr-production/workspace'
import {
  getKnowledgeWorkspace,
  workspaceRegistry,
  type LiveAppBlock,
  type WorkspaceObject
} from '@/app/workspace'

import { liveFrameForObject } from './helpers'
import type { WorkspaceMutationApi, WorkspaceUiState } from './types'

export type WorkspaceRuntimeActions = {
  activateLive: (object: WorkspaceObject) => Promise<void>
}

export function createWorkspaceRuntimeActions(
  state: WorkspaceUiState,
  api: WorkspaceMutationApi,
  objectForSceneNode: (sceneNodeId: string) => WorkspaceObject | null
): WorkspaceRuntimeActions {
  function releaseOtherRuntimeOwners(workspaceId: string): void {
    for (const other of workspaceRegistry.list()) {
      if (other.id === workspaceId || !other.activeRuntimeBlockId) continue
      api.mutate(other, [{ blockId: null, type: 'set-runtime-owner' }])
    }
  }

  async function claimRuntime(object: LiveAppBlock, handshakeAt: string): Promise<void> {
    const workspace = getKnowledgeWorkspace(object.documentId, object.pageId)
    if (!workspace || !Object.hasOwn(workspace.objects, object.id)) return
    const current = workspace.objects[object.id]
    if (current.type !== 'live-app-block') return
    if (workspace.activeRuntimeBlockId === current.id && current.runtime.status === 'live') return
    releaseOtherRuntimeOwners(workspace.id)
    api.mutate(workspace, [{ blockId: current.id, handshakeAt, type: 'set-runtime-owner' }])
    await api.persist()
  }

  async function activateLive(object: WorkspaceObject): Promise<void> {
    if (object.type !== 'live-app-block') return
    const frame = liveFrameForObject(state.store, object)
    if (!frame) return
    const pageId = frame.parentId ?? object.pageId
    await state.store.switchPage(pageId)
    state.store.select([frame.id])
    state.store.setTool('SMYLR_CONTAINER')
    setLiveInspectorActiveFrame(frame.id)
    await nextTick()
    await fitSmylrPageToViewport(state.store, [frame.id])
    if (
      liveInspectorStatus.value === 'connected' &&
      liveInspectorActiveFrameId.value === frame.id &&
      liveInspectorDocument.value
    ) {
      await claimRuntime(object, liveInspectorDocument.value.capturedAt)
    }
  }

  watch(
    [liveInspectorStatus, liveInspectorActiveFrameId],
    ([status, frameId]) => {
      if (status !== 'connected' || !frameId || !liveInspectorDocument.value) return
      const object = objectForSceneNode(frameId)
      if (object?.type === 'live-app-block') {
        void claimRuntime(object, liveInspectorDocument.value.capturedAt)
      }
    },
    { flush: 'post' }
  )

  return { activateLive }
}
