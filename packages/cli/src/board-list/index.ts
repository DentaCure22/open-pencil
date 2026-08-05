import type { AutomationDocumentSummary } from '@open-pencil/core/rpc'

export type BoardListArgs = {
  json?: boolean
  limit?: string
  query?: string
}

export type BoardListResult = {
  documents: AutomationDocumentSummary[]
  runtime_instance_id?: string
}

export type BoardIndexEntry = {
  active?: true
  id: string
  name: string
}

export type BoardListIndexResult = {
  boards: BoardIndexEntry[]
  query?: string
  returned: number
  total: number
  truncated: boolean
}

export type ExactBoardIndexTarget = {
  content_document_id: string
  document_id: string
  page_id: string
  runtime_instance_id: string
  workspace_id: string
}

export const DEFAULT_BOARD_LIST_LIMIT = 20
export const MAX_BOARD_LIST_LIMIT = 100

export function boardsListRpcArgs(): Record<string, never> {
  return {}
}

export function boardListLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_BOARD_LIST_LIMIT
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_BOARD_LIST_LIMIT) {
    throw new Error(`--limit must be an integer between 1 and ${MAX_BOARD_LIST_LIMIT}.`)
  }
  return parsed
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('en-US')
}

type BoardCandidate = {
  active: boolean
  contentDocumentId: string
  documentId: string
  documentName: string
  pageId: string
  pageName: string
  path?: string
  workspaceId?: string
}

function boardCandidates(result: BoardListResult): BoardCandidate[] {
  return result.documents.flatMap((document) =>
    document.pages.map((page) => ({
      active: document.active && document.current_page_id === page.id,
      contentDocumentId: document.content_document_id,
      documentId: document.id,
      documentName: document.name,
      pageId: page.id,
      pageName: page.name,
      ...(document.path ? { path: document.path } : {}),
      ...(document.workspace_id ? { workspaceId: document.workspace_id } : {})
    }))
  )
}

function matchRank(candidate: BoardCandidate, query: string): number | null {
  const target = normalized(query)
  const id = normalized(candidate.pageId)
  const name = normalized(candidate.pageName)
  if (id === target) return 0
  if (name === target) return 1
  if (name.startsWith(target)) return 2
  if (name.includes(target)) return 3
  const context = normalized([candidate.documentName, candidate.path].filter(Boolean).join(' '))
  return context.includes(target) ? 4 : null
}

function matchingBoards(result: BoardListResult, query?: string): BoardCandidate[] {
  const candidates = boardCandidates(result)
  const target = query?.trim()
  if (!target) return candidates
  return candidates
    .flatMap((candidate, index) => {
      const rank = matchRank(candidate, target)
      return rank === null ? [] : [{ candidate, index, rank }]
    })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ candidate }) => candidate)
}

export function boardListIndex(result: BoardListResult, args: BoardListArgs): BoardListIndexResult {
  const query = args.query?.trim()
  const boards = matchingBoards(result, query)
  const limit = boardListLimit(args.limit)
  const returned = boards.slice(0, limit)
  return {
    boards: returned.map((board) => ({
      ...(board.active ? { active: true as const } : {}),
      id: board.pageId,
      name: board.pageName
    })),
    ...(query ? { query } : {}),
    returned: returned.length,
    total: boards.length,
    truncated: returned.length < boards.length
  }
}

export function resolveBoardIndexTarget(
  result: BoardListResult,
  target: string
): ExactBoardIndexTarget {
  const query = target.trim()
  if (!query) throw new Error('Board name or ID is required.')
  const matches = matchingBoards(result, query)
  if (matches.length === 0) throw new Error(`No Board matches "${query}".`)

  const first = matches[0]
  const bestRank = matchRank(first, query)
  const best = matches.filter((candidate) => matchRank(candidate, query) === bestRank)
  if (best.length > 1) {
    const choices = best
      .slice(0, 5)
      .map((candidate) => `${candidate.pageName} (${candidate.pageId})`)
      .join(', ')
    throw new Error(`Board "${query}" is ambiguous: ${choices}. Use the exact Board ID.`)
  }

  const selected = best[0]
  const runtimeInstanceId = result.runtime_instance_id?.trim()
  if (!runtimeInstanceId || !selected.workspaceId) {
    throw new Error('Persisted Board authority did not return its workspace identity.')
  }
  return {
    content_document_id: selected.contentDocumentId,
    document_id: selected.documentId,
    page_id: selected.pageId,
    runtime_instance_id: runtimeInstanceId,
    workspace_id: selected.workspaceId
  }
}
