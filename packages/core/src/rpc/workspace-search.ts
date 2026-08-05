export const WORKSPACE_SEARCH_CONTRACT = 'workspace-search/v1' as const

export type WorkspaceSearchBoard = {
  id: string
  name: string
}

export type WorkspaceSearchHit = {
  board: WorkspaceSearchBoard
  canonical_object_id: string
  id: string
  kind: 'board' | 'object'
  name: string
  owner_id: string
  type: string
}

export type WorkspaceSearchResult = {
  contract: typeof WORKSPACE_SEARCH_CONTRACT
  indexed_revision: number
  query: string
  results: WorkspaceSearchHit[]
  returned: number
  total: number
  truncated: boolean
}
