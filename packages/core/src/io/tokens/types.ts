import type { Variable, VariableCollection } from '@open-pencil/scene-graph'

export const DTCG_SCHEMA_URL = 'https://www.designtokens.org/schemas/2025.10/format.json'
export const OPENPENCIL_TOKEN_EXTENSION = 'org.openpencil'
export const OPENPENCIL_TOKEN_FORMAT = 'openpencil/tokens/v1'

export interface TokenSnapshot {
  collections: VariableCollection[]
  variables: Variable[]
  activeMode: Array<[string, string]>
}

export interface DtcgImportResult {
  snapshot: TokenSnapshot
  warnings: string[]
}

export interface TokenReviewCount {
  added: number
  updated: number
  unchanged: number
  removed: number
}

export interface TokenReview {
  collections: TokenReviewCount
  variables: TokenReviewCount
}

export type DtcgDocument = Record<string, unknown> & {
  $schema: string
  $extensions: Record<string, unknown>
}
