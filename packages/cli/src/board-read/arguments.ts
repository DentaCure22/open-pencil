import type { FreshBoardReadLogicalArgs } from './fresh-context'

type BoardJsonObject = { [key: string]: unknown }

const PROJECTIONS = ['detail', 'geometry', 'id_only', 'summary'] as const
const SCOPES = ['selection', 'page', 'objects', 'query'] as const
const SORTS = ['document', 'name', 'x', 'y'] as const

export type BoardReadCliArgs = {
  limit?: string
  'object-ids'?: string
  projection?: string
  query?: string
  scope?: string
  sort?: string
  'token-budget'?: string
}

function optionalInteger(
  value: string | undefined,
  flag: string,
  minimum: number,
  maximum: number
): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${flag} must be between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function objectIds(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined
  const ids = value
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length === 0 || ids.length > 25) {
    throw new Error('--object-ids must contain from 1 to 25 comma-separated IDs.')
  }
  if (new Set(ids).size !== ids.length) throw new Error('--object-ids must contain unique IDs.')
  return ids
}

function queryObject(value: string | undefined): BoardJsonObject | undefined {
  if (!value?.trim()) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('--query must be a JSON object.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--query must be a JSON object.')
  }
  return parsed as BoardJsonObject
}

function optionalLiteral<const Values extends readonly string[]>(
  value: string | undefined,
  flag: string,
  allowed: Values
): Values[number] | undefined {
  if (!value?.trim()) return undefined
  const trimmed = value.trim()
  if (!allowed.includes(trimmed)) {
    throw new Error(`${flag} must be ${allowed.slice(0, -1).join(', ')}, or ${allowed.at(-1)}.`)
  }
  return trimmed as Values[number]
}

function readScope(
  value: string | undefined,
  ids: string[] | undefined,
  query: BoardJsonObject | undefined
): FreshBoardReadLogicalArgs['scope'] {
  let fallback: FreshBoardReadLogicalArgs['scope'] = 'selection'
  if (ids) fallback = 'objects'
  else if (query) fallback = 'query'
  return optionalLiteral(value, '--scope', SCOPES) ?? fallback
}

export function parseBoardReadCliArgs(args: BoardReadCliArgs): FreshBoardReadLogicalArgs {
  const limit = optionalInteger(args.limit, '--limit', 1, 100)
  const tokenBudget = optionalInteger(args['token-budget'], '--token-budget', 256, 6_000)
  const ids = objectIds(args['object-ids'])
  const query = queryObject(args.query)
  const scope = readScope(args.scope, ids, query)
  if ((scope === 'objects') !== Boolean(ids)) {
    throw new Error(
      '--scope objects requires --object-ids, and --object-ids requires objects scope.'
    )
  }
  if ((scope === 'query') !== Boolean(query)) {
    throw new Error('--scope query requires --query, and --query requires query scope.')
  }
  const projection = optionalLiteral(args.projection, '--projection', PROJECTIONS)
  const sort = optionalLiteral(args.sort, '--sort', SORTS)
  if (scope !== 'query' && (projection || sort || tokenBudget !== undefined)) {
    throw new Error('--projection, --sort, and --token-budget require query scope.')
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(ids ? { object_ids: ids } : {}),
    ...(projection ? { projection } : {}),
    ...(query ? { query } : {}),
    scope,
    ...(sort ? { sort } : {}),
    ...(tokenBudget === undefined ? {} : { token_budget: tokenBudget })
  }
}
