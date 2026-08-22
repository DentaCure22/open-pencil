import { ref } from 'vue'

export const fullFrameCodeObjectId = ref<string | null>(null)

export function openCodeObjectFullFrame(frameId: string) {
  fullFrameCodeObjectId.value = frameId
}

export function closeCodeObjectFullFrame(frameId?: string) {
  if (frameId && fullFrameCodeObjectId.value !== frameId) return
  fullFrameCodeObjectId.value = null
}

export function toggleCodeObjectFullFrame(frameId: string) {
  if (fullFrameCodeObjectId.value === frameId) {
    closeCodeObjectFullFrame(frameId)
    return false
  }
  openCodeObjectFullFrame(frameId)
  return true
}
