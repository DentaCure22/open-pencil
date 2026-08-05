import type { UnknownRecord } from '@/app/automation/bridge/target'

import type { BoardBuildCardPlacement, BoardBuildPlacement, BoardBuildRecipeInput } from './types'

function placementArgs(placement: BoardBuildCardPlacement | BoardBuildPlacement | undefined) {
  return placement
    ? {
        placement: {
          ...(placement.clearance === undefined ? {} : { clearance: placement.clearance }),
          ...(placement.preferredDirections
            ? { preferred_directions: placement.preferredDirections }
            : {}),
          ...('target' in placement && placement.target
            ? {
                target:
                  placement.target.kind === 'relative'
                    ? {
                        kind: placement.target.kind,
                        object_id: placement.target.objectId
                      }
                    : placement.target
              }
            : {})
        }
      }
    : {}
}

export function nativeArtifactChangeArgs(
  input: BoardBuildRecipeInput,
  artifact: UnknownRecord,
  placement: BoardBuildCardPlacement | BoardBuildPlacement | undefined,
  visualProfile: 'local-legible-card-v1' | 'local-legible-text-v1'
) {
  return {
    context_token: input.contextToken,
    expected_revision: input.expectedRevision,
    operation: {
      ...(input.anchorId ? { anchor_id: input.anchorId } : {}),
      artifact,
      kind: 'artifact.create',
      ...placementArgs(placement)
    },
    request_id: input.requestId,
    ...(input.taskId ? { task_id: input.taskId } : {}),
    ...(input.traceId ? { trace_id: input.traceId } : {}),
    visual: { profile: visualProfile }
  }
}
