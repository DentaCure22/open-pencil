import type {
  ExperienceProjectionPurpose,
  SurfaceMode,
  SurfaceModeKind,
  SurfaceRun
} from '@/app/workspace'

export type InteractiveSurfacePresentationRole = 'companion-surface' | 'root-surface'
export type InteractiveSurfaceComparisonBasis = 'companion-surfaces' | 'none' | 'renderer-mode'

export type InteractiveSurfacePresentationResolution = {
  modeId?: string
  modeKind?: SurfaceModeKind
  purpose: ExperienceProjectionPurpose
  reason:
    | 'companion-focus'
    | 'native-compare'
    | 'not-embedded-for-purpose'
    | 'renderer-target-unavailable'
    | 'surface-focus'
  rendererViewId?: string
  role: InteractiveSurfacePresentationRole
  status: 'not-applicable' | 'resolved' | 'unsupported'
  surfaceRunId: string
}

function legacyRendererViewId(surface: SurfaceRun, mode: SurfaceMode): string | undefined {
  if (surface.rendererId === 'interactive-program-v1') {
    if (mode.kind === 'focus') return 'explore'
    if (mode.kind === 'overview' || mode.kind === 'review') return mode.kind
  }
  if (surface.rendererId === 'spatial-map-v1') {
    if (mode.kind === 'focus') return 'map'
    if (mode.kind === 'review') return 'review'
  }
  if (
    surface.rendererId === 'flow-clarification-v1' ||
    surface.rendererId === 'record-explorer-v1' ||
    surface.rendererId === 'evidence-brief-v1'
  ) {
    return mode.kind
  }
  return undefined
}

function rendererTarget(surface: SurfaceRun, mode: SurfaceMode): string | undefined {
  const explicit = mode.rendererViewId?.trim()
  return explicit || legacyRendererViewId(surface, mode)
}

function unsupported(
  surface: SurfaceRun,
  purpose: ExperienceProjectionPurpose,
  role: InteractiveSurfacePresentationRole
): InteractiveSurfacePresentationResolution {
  return {
    purpose,
    reason: 'renderer-target-unavailable',
    role,
    status: 'unsupported',
    surfaceRunId: surface.id
  }
}

/**
 * Resolves one presentation-only renderer target for a visible SurfaceRun.
 * Workspace view IDs, mode IDs, and semantic revisions are never treated as
 * renderer DOM targets.
 */
export function resolveInteractiveSurfacePresentation(
  surface: SurfaceRun,
  input: {
    comparisonBasis: InteractiveSurfaceComparisonBasis
    purpose: ExperienceProjectionPurpose
    role: InteractiveSurfacePresentationRole
  }
): InteractiveSurfacePresentationResolution {
  if (input.purpose === 'knowledge' || input.purpose === 'review') {
    return {
      purpose: input.purpose,
      reason: 'not-embedded-for-purpose',
      role: input.role,
      status: 'not-applicable',
      surfaceRunId: surface.id
    }
  }

  let modeKind: SurfaceModeKind = 'focus'
  let reason: InteractiveSurfacePresentationResolution['reason'] = 'surface-focus'
  if (input.purpose === 'compare') {
    if (input.comparisonBasis === 'renderer-mode' && input.role === 'root-surface') {
      modeKind = 'compare'
      reason = 'native-compare'
    } else if (input.comparisonBasis === 'companion-surfaces') {
      reason = 'companion-focus'
    } else {
      return unsupported(surface, input.purpose, input.role)
    }
  }

  const mode = surface.modes.find((candidate) => candidate.kind === modeKind)
  if (!mode) return unsupported(surface, input.purpose, input.role)
  const rendererViewId = rendererTarget(surface, mode)
  if (!rendererViewId) return unsupported(surface, input.purpose, input.role)
  return {
    modeId: mode.id,
    modeKind,
    purpose: input.purpose,
    reason,
    rendererViewId,
    role: input.role,
    status: 'resolved',
    surfaceRunId: surface.id
  }
}
