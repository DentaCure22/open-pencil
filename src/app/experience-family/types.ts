import type {
  KnowledgeWorkspace,
  ResolvedExperienceFamilyV1,
  WorkspaceObjectRevisionRef,
} from '@/app/workspace'
import type { SceneGraph } from '@open-pencil/scene-graph'

export type {
  ExperienceFamilyMemberV1,
  ExperienceFamilyRelationRef,
  PrimaryExperienceFamilyMemberV1,
  ResolvedExperienceFamilyV1,
  SupportExperienceFamilyMemberV1,
} from '@/app/workspace'

export type ResolveExperienceFamilyOptions = {
  graph?: Pick<SceneGraph, 'getNode'>
  requireMaterializedBoards?: boolean
}

export type ResolveExperienceFamily = (
  workspace: KnowledgeWorkspace,
  rootSurfaceRef: WorkspaceObjectRevisionRef,
  options?: ResolveExperienceFamilyOptions
) => ResolvedExperienceFamilyV1
