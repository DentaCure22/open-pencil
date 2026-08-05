import type { Rect, Vector } from '@open-pencil/scene-graph'

import type { BoardComponentClient } from './components'

export const BOARD_EXPERIENCE_SCHEMA_VERSION = 1 as const

export type BoardExperienceId = 'tower-defense'

export type BoardExperienceDocument = {
  definitionId: BoardExperienceId
  schemaVersion: typeof BOARD_EXPERIENCE_SCHEMA_VERSION
  settings: Record<string, unknown>
}

export type BoardExperiencePoint = Vector

export type BoardExperienceBounds = Rect

export type BoardExperienceSnapshot = {
  bounds: BoardExperienceBounds
  componentIds: string[]
  definitionId: BoardExperienceId
  description: string
  running: boolean
  title: string
}

export type BoardExperienceRuntimeContext = {
  board: () => BoardComponentClient
  deactivate: () => void
  invalidate: () => void
  origin: BoardExperiencePoint
  pageId: string
}

export type BoardExperienceRuntime = {
  dispose: () => void
  getSnapshot: () => BoardExperienceSnapshot
  tick: (elapsedMs: number) => void
}

export type BoardExperienceDefinition = {
  createRuntime: (context: BoardExperienceRuntimeContext) => BoardExperienceRuntime
  createSettings: (center: BoardExperiencePoint) => Record<string, unknown>
  description: string
  id: BoardExperienceId
  label: string
  resolveOrigin: (settings: Record<string, unknown>) => BoardExperiencePoint
}

export type BoardExperienceSession = {
  definition: BoardExperienceDefinition
  document: BoardExperienceDocument
  pageId: string
  runtime: BoardExperienceRuntime
}
