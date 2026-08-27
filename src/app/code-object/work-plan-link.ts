import type { CodeObjectDocument } from '@/app/code-object/model'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function planModel(document: CodeObjectDocument | null) {
  const plan = document?.props.plan
  return isRecord(plan) ? plan : null
}

export function isWorkPlanDocument(document: CodeObjectDocument | null): boolean {
  if (document?.presetId === 'work-plan') return true
  const plan = planModel(document)
  return plan?.version === 1 && Array.isArray(plan.blocks)
}

export function connectedPlanObjectIds(
  frameId: string,
  document: CodeObjectDocument | null
): string[] {
  const objectIds = [frameId]
  const plan = planModel(document)
  if (!Array.isArray(plan?.blocks)) return objectIds
  for (const block of plan.blocks) {
    if (!isRecord(block) || !Array.isArray(block.artifacts)) continue
    for (const artifact of block.artifacts) {
      if (
        !isRecord(artifact) ||
        artifact.kind !== 'code_object' ||
        typeof artifact.objectId !== 'string' ||
        !artifact.objectId.trim()
      ) {
        continue
      }
      objectIds.push(artifact.objectId.trim())
    }
  }
  return [...new Set(objectIds)]
}
