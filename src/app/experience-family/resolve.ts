import {
  WorkspaceDomainError,
  type KnowledgeWorkspace,
  type SurfaceRun,
  type WorkspaceObject,
  type WorkspaceObjectRevisionRef,
} from '@/app/workspace'
import type {
  ExperienceFamilyMemberV1,
  ExperienceFamilyRelationRef,
  PrimaryExperienceFamilyMemberV1,
  ResolvedExperienceFamilyV1,
  ResolveExperienceFamilyOptions,
  SupportExperienceFamilyMemberV1,
} from './types'

type CompositionLineage = NonNullable<SurfaceRun['formChoice']['composition']>

function reconstructionConflict(message: string): never {
  throw new WorkspaceDomainError('reconstruction_conflict', message)
}

function sameReference(
  left: WorkspaceObjectRevisionRef,
  right: WorkspaceObjectRevisionRef
): boolean {
  return left.objectId === right.objectId && left.revision === right.revision
}

function exactSurface(
  workspace: KnowledgeWorkspace,
  reference: WorkspaceObjectRevisionRef
): SurfaceRun {
  const object = workspace.objects[reference.objectId] as
    WorkspaceObject | undefined
  if (object?.type !== 'surface-run') {
    reconstructionConflict(
      `composition root surface ${reference.objectId} is unavailable`
    )
  }
  if (object.revision !== reference.revision) {
    reconstructionConflict(
      `composition root surface ${reference.objectId} revision ${reference.revision} is stale`
    )
  }
  if (object.lifecycle !== 'active' || object.workspaceId !== workspace.id) {
    reconstructionConflict(
      `composition root surface ${reference.objectId} is outside active scope`
    )
  }
  return object
}

function exactLineageObject(
  workspace: KnowledgeWorkspace,
  reference: WorkspaceObjectRevisionRef,
  type: 'evidence-manifest' | 'intent-record'
): void {
  const object = workspace.objects[reference.objectId] as
    WorkspaceObject | undefined
  if (
    object?.type !== type ||
    object.revision !== reference.revision ||
    object.lifecycle !== 'active' ||
    object.workspaceId !== workspace.id
  ) {
    reconstructionConflict(
      `composition ${type} ${reference.objectId} revision ${reference.revision} is unavailable`
    )
  }
}

function compositionLineage(surface: SurfaceRun): CompositionLineage {
  const composition = surface.formChoice.composition
  if (!composition) {
    reconstructionConflict(
      `surface ${surface.id} has no exact composition-family lineage`
    )
  }
  if (
    !composition.id.trim() ||
    !composition.instanceId.trim() ||
    !composition.recipeDigest.startsWith('fnv1a-') ||
    !['primary', 'support'].includes(composition.role) ||
    !Number.isInteger(composition.surfaceCount) ||
    composition.surfaceCount < 1 ||
    composition.surfaceCount > 4 ||
    !Number.isInteger(composition.surfaceIndex) ||
    composition.surfaceIndex < 0 ||
    composition.surfaceIndex >= composition.surfaceCount ||
    (composition.role === 'primary' && composition.surfaceIndex !== 0) ||
    (composition.role === 'support' && composition.surfaceIndex === 0)
  ) {
    reconstructionConflict(
      `surface ${surface.id} has invalid composition-family lineage`
    )
  }
  return composition
}

function familySurfaces(
  workspace: KnowledgeWorkspace,
  root: SurfaceRun,
  rootComposition: CompositionLineage
): SurfaceRun[] {
  const surfaces = Object.values(workspace.objects).filter(
    (object): object is SurfaceRun =>
      object.type === 'surface-run' &&
      object.lifecycle === 'active' &&
      object.formChoice.composition?.id === rootComposition.id
  )
  if (surfaces.length !== rootComposition.surfaceCount) {
    reconstructionConflict(
      `composition ${rootComposition.id} expected ${rootComposition.surfaceCount} surfaces but resolved ${surfaces.length}`
    )
  }

  const indices = new Set<number>()
  const instanceIds = new Set<string>()
  for (const surface of surfaces) {
    if (surface.workspaceId !== workspace.id) {
      reconstructionConflict(
        `composition surface ${surface.id} has mismatched workspace scope`
      )
    }
    const composition = compositionLineage(surface)
    if (
      composition.recipeDigest !== rootComposition.recipeDigest ||
      composition.surfaceCount !== rootComposition.surfaceCount
    ) {
      reconstructionConflict(
        `composition surface ${surface.id} conflicts with the family recipe`
      )
    }
    if (indices.has(composition.surfaceIndex)) {
      reconstructionConflict(
        `composition ${rootComposition.id} has duplicate surface index ${composition.surfaceIndex}`
      )
    }
    if (instanceIds.has(composition.instanceId)) {
      reconstructionConflict(
        `composition ${rootComposition.id} has duplicate instance ${composition.instanceId}`
      )
    }
    if (!sameReference(surface.intent, root.intent)) {
      reconstructionConflict(
        `composition surface ${surface.id} has conflicting intent lineage`
      )
    }
    if (!sameReference(surface.evidenceManifest, root.evidenceManifest)) {
      reconstructionConflict(
        `composition surface ${surface.id} has conflicting evidence lineage`
      )
    }
    indices.add(composition.surfaceIndex)
    instanceIds.add(composition.instanceId)
  }

  for (let index = 0; index < rootComposition.surfaceCount; index += 1) {
    if (!indices.has(index)) {
      reconstructionConflict(
        `composition ${rootComposition.id} is missing surface index ${index}`
      )
    }
  }
  const ordered = surfaces.toSorted(
    (left, right) =>
      compositionLineage(left).surfaceIndex -
      compositionLineage(right).surfaceIndex
  )
  const primaries = ordered.filter(
    (surface) => compositionLineage(surface).role === 'primary'
  )
  if (primaries.length !== 1 || primaries[0]?.id !== root.id) {
    reconstructionConflict(
      `composition ${rootComposition.id} must resolve one exact primary root surface`
    )
  }
  return ordered
}

function exactSupportRelation(
  workspace: KnowledgeWorkspace,
  primary: SurfaceRun,
  support: SurfaceRun
): ExperienceFamilyRelationRef {
  const outgoing = Object.values(workspace.relations).filter(
    (relation) =>
      relation.lifecycle === 'active' &&
      relation.relationType === 'companion-view-of' &&
      relation.sourceId === support.id
  )
  if (outgoing.length !== 1 || outgoing[0]?.targetId !== primary.id) {
    reconstructionConflict(
      `composition support ${support.id} has a missing, stale, or ambiguous primary relation`
    )
  }
  const relation = outgoing[0]
  if (
    relation.workspaceId !== workspace.id ||
    !Number.isInteger(relation.revision) ||
    relation.revision < 1 ||
    relation.lastWorkspaceRevision > workspace.revision
  ) {
    reconstructionConflict(
      `composition relation ${relation.id} is stale or outside workspace scope`
    )
  }
  return { relationId: relation.id, revision: relation.revision }
}

function assertArtifact(
  surface: SurfaceRun,
  options: ResolveExperienceFamilyOptions
): void {
  const artifact = surface.artifact
  if (
    !artifact.artifactId.trim() ||
    !artifact.boardId.trim() ||
    !artifact.sourceHash.trim() ||
    !Number.isInteger(artifact.boardRevision) ||
    artifact.boardRevision < 1 ||
    !Number.isInteger(artifact.boardSchemaVersion) ||
    artifact.boardSchemaVersion < 1
  ) {
    reconstructionConflict(
      `composition surface ${surface.id} has an invalid board artifact`
    )
  }
  if (!options.requireMaterializedBoards) return
  if (!options.graph) {
    reconstructionConflict(
      'materialized composition-family resolution requires a scene graph'
    )
  }
  if (!options.graph.getNode(artifact.boardId)) {
    reconstructionConflict(
      `composition board ${artifact.boardId} for surface ${surface.id} is not materialized`
    )
  }
}

function primaryMemberFor(
  surface: SurfaceRun
): PrimaryExperienceFamilyMemberV1 {
  const composition = compositionLineage(surface)
  if (composition.role !== 'primary') {
    reconstructionConflict(
      `composition surface ${surface.id} is not a primary member`
    )
  }
  return {
    artifact: structuredClone(surface.artifact),
    formKind: surface.form.kind,
    instanceId: composition.instanceId,
    rendererId: surface.rendererId,
    role: 'primary',
    surfaceIndex: composition.surfaceIndex,
    surfaceRun: { objectId: surface.id, revision: surface.revision },
  }
}

function supportMemberFor(
  surface: SurfaceRun,
  relation: ExperienceFamilyRelationRef
): SupportExperienceFamilyMemberV1 {
  const composition = compositionLineage(surface)
  if (composition.role !== 'support') {
    reconstructionConflict(
      `composition surface ${surface.id} is not a support member`
    )
  }
  return {
    artifact: structuredClone(surface.artifact),
    formKind: surface.form.kind,
    instanceId: composition.instanceId,
    relation: { ...relation },
    rendererId: surface.rendererId,
    role: 'support',
    surfaceIndex: composition.surfaceIndex,
    surfaceRun: { objectId: surface.id, revision: surface.revision },
  }
}

function familyDigest(
  value: Omit<ResolvedExperienceFamilyV1, 'familyDigest'>
): string {
  const source = JSON.stringify(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function resolveExperienceFamily(
  workspace: KnowledgeWorkspace,
  rootSurfaceRef: WorkspaceObjectRevisionRef,
  options: ResolveExperienceFamilyOptions = {}
): ResolvedExperienceFamilyV1 {
  const root = exactSurface(workspace, rootSurfaceRef)
  const rootComposition = compositionLineage(root)
  if (
    rootComposition.role !== 'primary' ||
    rootComposition.surfaceIndex !== 0
  ) {
    reconstructionConflict(
      `surface ${root.id} is not the exact composition-family primary`
    )
  }
  exactLineageObject(workspace, root.intent, 'intent-record')
  exactLineageObject(workspace, root.evidenceManifest, 'evidence-manifest')

  const surfaces = familySurfaces(workspace, root, rootComposition)
  const primarySurface = surfaces[0]
  for (const surface of surfaces) assertArtifact(surface, options)
  const primary = primaryMemberFor(primarySurface)
  const supports = surfaces
    .slice(1)
    .map((surface) =>
      supportMemberFor(
        surface,
        exactSupportRelation(workspace, primarySurface, surface)
      )
    )
  if (supports.length !== rootComposition.surfaceCount - 1) {
    reconstructionConflict(
      `composition ${rootComposition.id} has invalid support membership`
    )
  }
  const members: ExperienceFamilyMemberV1[] = [primary, ...supports]
  const relations = supports.map((support) => ({ ...support.relation }))
  const snapshot: Omit<ResolvedExperienceFamilyV1, 'familyDigest'> = {
    complete: true,
    compositionId: rootComposition.id,
    evidenceManifest: { ...root.evidenceManifest },
    intent: { ...root.intent },
    members,
    primary,
    recipeDigest: rootComposition.recipeDigest,
    relations,
    schemaVersion: 1,
    supports,
    surfaceCount: rootComposition.surfaceCount,
  }
  return { ...snapshot, familyDigest: familyDigest(snapshot) }
}
