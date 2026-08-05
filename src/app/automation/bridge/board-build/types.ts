import type { BoardBuildPlan } from '@open-pencil/core/rpc'
import type { ObjectGraphPortDefinition } from '@open-pencil/scene-graph'

export const BOARD_BUILD_CONTRACT = 'board-build/v1' as const
export const BOARD_BUILD_EXTENSION_CONTRACT = 'board-builder-extension/v1' as const

export type BoardBuildExtension = {
  contract: typeof BOARD_BUILD_EXTENSION_CONTRACT
  outputDigest?: string
  profileId?: string
  skillId: string
  skillVersion?: string
}

export type BoardBuildPlacement = {
  clearance?: number
  preferredDirections?: Array<'above' | 'below' | 'left' | 'right'>
}

export type BoardBuildPlacementTarget =
  | { kind: 'auto' }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'relative'; objectId: string }
  | { height: number; kind: 'region'; width: number; x: number; y: number }

export type BoardBuildCardPlacement = BoardBuildPlacement & {
  target?: BoardBuildPlacementTarget
}

export type NativeTextBuildRecipe = {
  fontSize?: number
  height?: number
  kind: 'native_text'
  maxWidth?: number
  name?: string
  placement?: BoardBuildPlacement
  text: string
}

export type NativeCardBuildRecipe = {
  body: string
  height?: number
  kind: 'native_card'
  name?: string
  placement?: BoardBuildCardPlacement
  title: string
  width?: number
}

export type NativeDiagramBuildRecipe = {
  allowAdditionalOwner?: boolean
  kind: 'native_diagram'
  ownerId?: string
  source: string
  sourceFormat: 'mermaid'
  zoomToSelection?: boolean
}

export type CodeObjectCreateBuildRecipe = {
  height?: number
  initialState: Record<string, unknown>
  kind: 'code_object'
  name: string
  objectKey: string
  operation: 'create'
  placement?: BoardBuildCardPlacement
  ports?: ObjectGraphPortDefinition[]
  props: Record<string, unknown>
  source: string
  sourceFormat: 'tsx'
  width?: number
}

export type CodeObjectRefineBuildRecipe = {
  expectedSourceHash: string
  kind: 'code_object'
  name?: string
  objectKey: string
  operation: 'refine'
  ownerId: string
  props?: Record<string, unknown>
  source: string
  sourceFormat: 'tsx'
}

export type CodeObjectBuildRecipe = CodeObjectCreateBuildRecipe | CodeObjectRefineBuildRecipe

export type BoardBuildRecipe =
  | CodeObjectBuildRecipe
  | NativeCardBuildRecipe
  | NativeDiagramBuildRecipe
  | NativeTextBuildRecipe

type BoardBuildInputBase = {
  anchorId?: string
  contextToken: string
  expectedRevision: number
  extension?: BoardBuildExtension
  intent: string
  requestId: string
  taskId?: string
  traceId?: string
}

export type BoardBuildRecipeInput = BoardBuildInputBase & {
  plan?: never
  recipe: BoardBuildRecipe
}

export type BoardBuildPlanInput = BoardBuildInputBase & {
  plan: BoardBuildPlan
  recipe?: never
}

export type BoardBuildInput = BoardBuildPlanInput | BoardBuildRecipeInput
