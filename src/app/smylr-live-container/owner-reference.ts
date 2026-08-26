import type { SmylrLiveContainerOwner } from './types'

export function liveContainerOwnerReference(owner: SmylrLiveContainerOwner) {
  return {
    ...(owner.componentName ? { componentName: owner.componentName } : {}),
    ...(owner.filePath ? { filePath: owner.filePath } : {}),
    ...(owner.lineNumber ? { lineNumber: owner.lineNumber } : {})
  }
}
