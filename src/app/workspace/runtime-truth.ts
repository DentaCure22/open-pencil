import type { KnowledgeWorkspace, LiveAppCapture } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isValidCapture(capture: unknown): capture is LiveAppCapture {
  if (!isRecord(capture)) return false
  const capturedAt = capture.capturedAt
  const maskedFieldIds = capture.maskedFieldIds
  const provenance = capture.provenance
  return (
    typeof capture.assetRef === 'string' &&
    Boolean(capture.assetRef) &&
    typeof capturedAt === 'string' &&
    Number.isFinite(Date.parse(capturedAt)) &&
    Array.isArray(maskedFieldIds) &&
    maskedFieldIds.every((fieldId) => typeof fieldId === 'string' && Boolean(fieldId)) &&
    (provenance === 'illustrative' || provenance === 'import' || provenance === 'runtime') &&
    typeof capture.sourceRevision === 'string' &&
    Boolean(capture.sourceRevision)
  )
}

/**
 * Removes runtime claims that cannot survive process or browser hydration.
 * A fresh runtime handshake may claim ownership again through set-runtime-owner.
 */
export function reconcileHydratedRuntimeTruth(workspace: KnowledgeWorkspace): KnowledgeWorkspace {
  const hasPersistedRuntimeClaim =
    Boolean(workspace.activeRuntimeBlockId) ||
    Object.values(workspace.objects).some(
      (object) => object.type === 'live-app-block' && object.runtime.status === 'live'
    )
  if (!hasPersistedRuntimeClaim) return workspace

  const reconciled = structuredClone(workspace)
  reconciled.activeRuntimeBlockId = undefined
  for (const object of Object.values(reconciled.objects)) {
    if (object.type !== 'live-app-block' || object.runtime.status !== 'live') continue
    object.runtime = {
      status: isValidCapture(object.capture) ? 'captured' : 'unavailable'
    }
  }
  return reconciled
}
