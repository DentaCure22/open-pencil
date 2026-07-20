import type { KnowledgeWorkspace, SurfaceRun } from './types'

/**
 * A workspace stores only the current SurfaceRun revision, so every persisted
 * projection ref (including archived views) must advance with that object.
 */
export function advanceExperienceProjectionViewRefs(
  workspace: KnowledgeWorkspace,
  surface: SurfaceRun,
  now: string
): string[] {
  const advancedViewIds: string[] = []
  for (const view of Object.values(workspace.views).toSorted((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const projection = view.experienceProjection
    if (
      projection?.rootSurface.objectId !== surface.id ||
      projection.rootSurface.revision === surface.revision
    ) {
      continue
    }
    workspace.views[view.id] = {
      ...view,
      experienceProjection: {
        ...structuredClone(projection),
        rootSurface: { objectId: surface.id, revision: surface.revision }
      },
      revision: view.revision + 1,
      updatedAt: now
    }
    advancedViewIds.push(view.id)
  }
  return advancedViewIds
}
