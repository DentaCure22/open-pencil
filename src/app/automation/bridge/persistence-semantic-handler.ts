import type { AutomationTarget } from '@/app/automation/bridge/target'
import { getDocumentPersistenceReadiness } from '@/app/document/persistence-target'

export function handleGetDocumentPersistenceReadiness(target: AutomationTarget) {
  return {
    ok: true,
    result: {
      persistence: getDocumentPersistenceReadiness(target.store),
      revision: target.store.state.sceneVersion,
      scope: 'workspace-metadata' as const
    }
  }
}
