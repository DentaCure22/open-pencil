import type { CodeObjectSurface } from '#core/code-object/document'
import type { CodeObjectUiBlockName } from '#core/code-object/ui-block'
import type { CodeObjectViewportPresetId } from '#core/code-object/viewport'

export const BOARD_BUILD_PLAN_CONTRACT = 'board-build-plan/v1' as const
export const BOARD_BUILD_PLAN_MAX_ARTIFACTS = 32
export const BOARD_BUILD_PLAN_MAX_OPERATIONS = 64

export type BoardBuildPlanDirection = 'above' | 'below' | 'left' | 'right'

export type BoardBuildPlanReference = { alias: string } | { object_id: string }

export type BoardBuildPlanPlacementTarget =
  | { kind: 'auto' }
  | { height: number; kind: 'near_region'; width: number; x: number; y: number }
  | { kind: 'point'; x: number; y: number }
  | { kind: 'relative'; object_id: string }
  | { height: number; kind: 'region'; width: number; x: number; y: number }

export type BoardBuildPlanNearRegionTarget = Extract<
  BoardBuildPlanPlacementTarget,
  { kind: 'near_region' }
>
export type BoardBuildPlanRegionTarget = Extract<BoardBuildPlanPlacementTarget, { kind: 'region' }>

export type BoardBuildPlanLayoutAnchor =
  | BoardBuildPlanNearRegionTarget
  | BoardBuildPlanReference
  | BoardBuildPlanRegionTarget

export type BoardBuildPlanPlacement = {
  clearance?: number
  preferred_directions?: BoardBuildPlanDirection[]
  relative_offset?: BoardBuildPlanRelativeOffset
  target?: BoardBuildPlanPlacementTarget
}

export type BoardBuildPlanRelativeOffset = {
  column: -1 | 0 | 1
  row: -1 | 0 | 1
}

export type BoardBuildPlanGridAlign = 'center' | 'end' | 'start'
export type BoardBuildPlanFlowDirection = 'down' | 'left' | 'right' | 'up'

export type BoardBuildPlanGridPlacement = {
  clearance?: number
  preferred_directions?: BoardBuildPlanDirection[]
}

export type BoardBuildPlanGridLayout = {
  align: BoardBuildPlanGridAlign
  anchor: BoardBuildPlanLayoutAnchor
  column_gap: number
  columns: number
  kind: 'grid'
  members: string[]
  placement?: BoardBuildPlanGridPlacement
  row_gap: number
}

export type BoardBuildPlanFlowLayout = {
  align: BoardBuildPlanGridAlign
  anchor: BoardBuildPlanLayoutAnchor
  direction: BoardBuildPlanFlowDirection
  kind: 'flow'
  node_gap: number
  placement?: BoardBuildPlanGridPlacement
  rank_gap: number
  ranks: string[][]
}

export type BoardBuildPlanLayout = BoardBuildPlanFlowLayout | BoardBuildPlanGridLayout

export type BoardBuildPlanCompositionDensity = 'airy' | 'balanced' | 'compact'
export type BoardBuildPlanCompositionDirection = 'horizontal' | 'vertical'
export type BoardBuildPlanCompositionGeography = 'preserve' | 'recompose'

export type BoardBuildPlanCompositionPreferences = {
  density?: BoardBuildPlanCompositionDensity
  direction?: BoardBuildPlanCompositionDirection
  emphasis?: BoardBuildPlanReference[]
  groups?: BoardBuildPlanReference[][]
  reading_order?: BoardBuildPlanReference[]
}

export type BoardBuildPlanComposition = {
  anchor?: BoardBuildPlanLayoutAnchor
  geography: BoardBuildPlanCompositionGeography
  members: BoardBuildPlanReference[]
  placement?: BoardBuildPlanDirection
  preferences?: BoardBuildPlanCompositionPreferences
}

export type BoardBuildPlanNativeTextRecipe = {
  font_size?: number
  height?: number
  kind: 'native_text'
  max_width?: number
  name?: string
  placement?: BoardBuildPlanPlacement
  text: string
}

export type BoardBuildPlanNativeCardRecipe = {
  body: string
  height?: number
  kind: 'native_card'
  name?: string
  placement?: BoardBuildPlanPlacement
  title: string
  width?: number
}

export type BoardBuildPlanNativeDiagramRecipe = {
  kind: 'native_diagram'
  owner_id?: string
  placement?: BoardBuildPlanPlacement
  source: string
  source_format: 'mermaid'
  zoom_to_selection?: boolean
}

export type BoardBuildPlanCodeObjectRecipe = {
  height?: number
  initial_state?: Record<string, unknown>
  kind: 'code_object'
  name: string
  object_key: string
  operation: 'create'
  placement?: BoardBuildPlanPlacement
  props?: Record<string, unknown>
  source: string
  source_format: 'tsx'
  surface?: CodeObjectSurface
  width?: number
}

export type BoardBuildPlanUiBlockRecipe = {
  block: CodeObjectUiBlockName
  config?: Record<string, unknown>
  height?: number
  initial_state?: Record<string, unknown>
  kind: 'ui_block'
  name: string
  object_key: string
  operation: 'create'
  placement?: BoardBuildPlanPlacement
  surface?: CodeObjectSurface
  width?: number
}

export type BoardBuildPlanTrustedWebAppRecipe = {
  app_id: 'smylr'
  height?: number
  kind: 'trusted_web_app'
  name: string
  operation: 'create'
  placement?: BoardBuildPlanPlacement
  route: string
  viewport_preset?: CodeObjectViewportPresetId
  width?: number
}

export type BoardBuildPlanCanonicalObjectRecipe = {
  kind: 'canonical_object'
  operation: 'place'
  placement?: BoardBuildPlanPlacement
  source_object_id: string
}

export type BoardBuildPlanArtifactRecipe =
  | BoardBuildPlanCanonicalObjectRecipe
  | BoardBuildPlanCodeObjectRecipe
  | BoardBuildPlanNativeCardRecipe
  | BoardBuildPlanNativeDiagramRecipe
  | BoardBuildPlanNativeTextRecipe
  | BoardBuildPlanUiBlockRecipe
  | BoardBuildPlanTrustedWebAppRecipe

export type BoardBuildPlanArtifact = {
  alias: string
  anchor?: BoardBuildPlanReference
  recipe: BoardBuildPlanArtifactRecipe
}

export type BoardBuildPlanObjectPatch = {
  cornerRadius?: number
  fill?: string
  locked?: boolean
  name?: string
  opacity?: number
  text?: string
  visible?: boolean
}

export type BoardBuildPlanCanonicalObjectOperation = {
  kind: 'canonical_object.fork'
  object_id: string
}

export type BoardBuildPlanAbsoluteMoveOperation = {
  kind: 'object.move'
  object_id: string
  x: number
  y: number
}

export type BoardBuildPlanRelativeMove = {
  align?: BoardBuildPlanGridAlign
  gap?: number
  object_id: string
  side: BoardBuildPlanDirection
}

export type BoardBuildPlanRelativeMoveOperation = {
  kind: 'object.move'
  object_id: string
  relative_to: BoardBuildPlanRelativeMove
}

export type BoardBuildPlanResizeOperation = {
  height: number
  kind: 'object.resize'
  object_id: string
  viewport_preset?: CodeObjectViewportPresetId
  width: number
}

export type BoardBuildPlanOperation =
  | BoardBuildPlanCanonicalObjectOperation
  | { kind: 'transaction.revert'; transaction_id: string }
  | { kind: 'object.delete'; object_id: string }
  | { kind: 'object.duplicate'; object_id: string; offset_x?: number; offset_y?: number }
  | BoardBuildPlanAbsoluteMoveOperation
  | BoardBuildPlanRelativeMoveOperation
  | BoardBuildPlanResizeOperation
  | { kind: 'object.update'; object_id: string; patch: BoardBuildPlanObjectPatch }

export type BoardBuildPlanResolvedOperation = Exclude<
  BoardBuildPlanOperation,
  BoardBuildPlanRelativeMoveOperation
>

export type BoardBuildPlan = {
  artifacts: BoardBuildPlanArtifact[]
  composition?: BoardBuildPlanComposition
  contract: typeof BOARD_BUILD_PLAN_CONTRACT
  layout?: BoardBuildPlanLayout
  operations?: BoardBuildPlanOperation[]
}

export type BoardBuildPlanTargetIdentity = {
  content_document_id: string
  document_id: string
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

export type BoardBuildPlanBounds = {
  height: number
  width: number
  x: number
  y: number
}

export type BoardBuildPlanGridCompilation = {
  aliases: Record<string, BoardBuildPlanBounds>
  footprint: Pick<BoardBuildPlanBounds, 'height' | 'width'>
}

export type BoardBuildPlanLayoutCompilation = BoardBuildPlanGridCompilation

export type BoardBuildPlanDigestMetadata = {
  intent: string
  target: BoardBuildPlanTargetIdentity
  task_id?: string
  trace_id?: string
}
