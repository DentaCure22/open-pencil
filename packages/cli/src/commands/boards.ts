import { readFile } from 'node:fs/promises'

import { defineCommand } from 'citty'

import type { WorkspaceSearchResult } from '@open-pencil/core/rpc'

import { rpcEnvelopeExact, type AppRpcEnvelope, type AppRpcTarget } from '#cli/app-client'
import { appTargetOptions, exactAppTargetRpcArgs } from '#cli/app-target'
import {
  boardListIndex,
  boardListLimit,
  boardsListRpcArgs,
  DEFAULT_BOARD_LIST_LIMIT,
  MAX_BOARD_LIST_LIMIT,
  resolveBoardIndexTarget,
  type BoardListArgs,
  type BoardListIndexResult,
  type BoardListResult
} from '#cli/board-list'
import { bold, entity, fmtList, printError } from '#cli/format'

type JsonObject = { [key: string]: unknown }

export type ExactBoardCliArgs = {
  'content-document-id'?: string
  'document-id'?: string
  'page-id'?: string
  'runtime-instance-id'?: string
  'workspace-id'?: string
}

type BoardCreateArgs = ExactBoardCliArgs & {
  base?: string
  'base-file'?: string
  json?: boolean
  name?: string
  'request-id'?: string
}

type ExactBoardOpenArgs = ExactBoardCliArgs & {
  'editor-runtime-instance-id'?: string
  json?: boolean
}

type BoardOpenArgs = {
  'editor-runtime-instance-id'?: string
  json?: boolean
  target?: string
}

type BoardSearchArgs = BoardListArgs

export type BoardCreateResult = {
  creation: JsonObject
  created_context?: JsonObject
  opened: JsonObject | null
  open_error?: string
  source_page_id: string
  status: 'completed' | 'created_headless' | 'created_not_opened'
  target?: AppRpcTarget
}

export type BoardOpenResult = {
  navigation: JsonObject
  status: 'ambiguous_editor' | 'completed' | 'needs_editor' | 'queued_for_editor'
  target?: AppRpcTarget
}

export type BoardRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<JsonObject>>

const jsonOption = { type: 'boolean', description: 'Output as JSON' } as const

const boardCreateTargetOptions = {
  'content-document-id': appTargetOptions['content-document-id'],
  'document-id': appTargetOptions['document-id'],
  'page-id': appTargetOptions['page-id'],
  'runtime-instance-id': appTargetOptions['runtime-instance-id'],
  'workspace-id': appTargetOptions['workspace-id']
} as const

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${flag} is required.`)
  return trimmed
}

function record(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} did not return an object.`)
  }
  return value as JsonObject
}

function jsonObject(value: string, flag: string): JsonObject {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`${flag} must contain a JSON object.`)
  }
  return record(parsed, flag)
}

function boardBuildBase(value: JsonObject, label: string): JsonObject {
  const direct = value.contract === 'board-build/v1' ? value : undefined
  const contextBase = value.board_build_base
  const createdContext = value.created_context
  const createdBase =
    createdContext && typeof createdContext === 'object' && !Array.isArray(createdContext)
      ? (createdContext as JsonObject).board_build_base
      : undefined
  const nested = contextBase ?? createdBase
  const base = direct ?? (nested === undefined ? undefined : record(nested, `${label} base`))
  if (base?.contract !== 'board-build/v1') {
    throw new Error(
      `${label} must be a board-build/v1 base, Board context JSON, or Board create JSON.`
    )
  }
  return base
}

function stringField(value: JsonObject, field: string, label: string): string {
  const result = value[field]
  if (typeof result !== 'string' || !result.trim()) {
    throw new Error(`${label} did not return ${field}.`)
  }
  return result
}

function numberField(value: JsonObject, field: string, label: string): number {
  const result = value[field]
  if (typeof result !== 'number' || !Number.isInteger(result) || result < 0) {
    throw new Error(`${label} did not return a valid ${field}.`)
  }
  return result
}

function boardListResult(value: JsonObject): BoardListResult {
  if (!Array.isArray(value.documents)) throw new Error('Board index did not return Boards.')
  return {
    documents: value.documents as BoardListResult['documents'],
    ...(typeof value.runtime_instance_id === 'string'
      ? { runtime_instance_id: value.runtime_instance_id }
      : {})
  }
}

function workspaceSearchResult(value: JsonObject): WorkspaceSearchResult {
  if (value.contract !== 'workspace-search/v1' || !Array.isArray(value.results)) {
    throw new Error('Workspace search did not return a compact search result.')
  }
  return value as WorkspaceSearchResult
}

export const exactBoardRpcArgs = exactAppTargetRpcArgs

function optionalTargetValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function hasExactBoardTarget(args: ExactBoardCliArgs): boolean {
  return [
    args['content-document-id'],
    args['document-id'],
    args['page-id'],
    args['runtime-instance-id']
  ].every((value) => optionalTargetValue(value) !== undefined)
}

function persistedAuthorityCreateTarget(
  args: BoardCreateArgs,
  listed: BoardListResult
): Record<string, unknown> {
  const requestedRuntimeId = optionalTargetValue(args['runtime-instance-id'])
  const runtimeInstanceId = optionalTargetValue(listed.runtime_instance_id)
  if (!runtimeInstanceId?.startsWith('local-authority:')) {
    throw new Error('Persisted Board authority did not return its runtime identity.')
  }
  if (requestedRuntimeId && requestedRuntimeId !== runtimeInstanceId) {
    throw new Error('--runtime-instance-id does not match the persisted Board authority.')
  }

  const workspaceId = optionalTargetValue(args['workspace-id'])
  const contentDocumentId = optionalTargetValue(args['content-document-id'])
  const documentId = optionalTargetValue(args['document-id'])
  const pageId = optionalTargetValue(args['page-id'])
  const matches = listed.documents.filter(
    (document) =>
      (!workspaceId || document.workspace_id === workspaceId) &&
      (!contentDocumentId || document.content_document_id === contentDocumentId) &&
      (!documentId || document.id === documentId) &&
      (!pageId || document.pages.some((page) => page.id === pageId))
  )
  if (matches.length === 0) {
    throw new Error('No persisted Board document matches the supplied creation target flags.')
  }
  if (matches.length > 1) {
    throw new Error(
      `Board creation is ambiguous across ${matches.length} persisted Board documents; pin one with --workspace-id or --content-document-id.`
    )
  }

  const document = matches[0]
  const sourcePageId = pageId ?? document.pages[0]?.id
  if (!sourcePageId) {
    throw new Error('Persisted Board document has no page available for authority context.')
  }
  return {
    content_document_id: required(
      document.content_document_id,
      'Persisted Board content document ID'
    ),
    document_id: required(document.id, 'Persisted Board document ID'),
    page_id: sourcePageId,
    runtime_instance_id: runtimeInstanceId,
    workspace_id: required(document.workspace_id, 'Persisted Board workspace ID')
  }
}

async function boardCreateRpcArgs(
  args: BoardCreateArgs,
  send: BoardRpcSender
): Promise<Record<string, unknown>> {
  if (hasExactBoardTarget(args)) return exactBoardRpcArgs(args)

  const requestedRuntimeId = optionalTargetValue(args['runtime-instance-id'])
  if (requestedRuntimeId && !requestedRuntimeId.startsWith('local-authority:')) {
    return exactBoardRpcArgs(args)
  }

  const listed = await send('list_documents', boardsListRpcArgs())
  return persistedAuthorityCreateTarget(args, boardListResult(listed.result))
}

export async function boardTargetSource<
  T extends ExactBoardCliArgs & { base?: string; 'base-file'?: string }
>(args: T): Promise<T> {
  const inline = args.base?.trim()
  const path = args['base-file']?.trim()
  if (inline && path) throw new Error('--base and --base-file are mutually exclusive.')

  const targetValues = [
    args['content-document-id'],
    args['document-id'],
    args['page-id'],
    args['runtime-instance-id'],
    args['workspace-id']
  ]
  const hasFlatTarget = targetValues.some((value) => Boolean(value?.trim()))
  if ((inline || path) && hasFlatTarget) {
    throw new Error('--base and --base-file cannot be combined with flattened Board target fields.')
  }
  if (!inline && !path) return args

  const label = inline ? '--base' : '--base-file'
  const base = boardBuildBase(
    jsonObject(inline ?? (await readFile(path ?? '', 'utf8')), label),
    label
  )
  return {
    ...args,
    'content-document-id': stringField(base, 'content_document_id', 'Board create base'),
    'document-id': stringField(base, 'document_id', 'Board create base'),
    'page-id': stringField(base, 'page_id', 'Board create base'),
    'runtime-instance-id': stringField(base, 'runtime_instance_id', 'Board create base'),
    'workspace-id': stringField(base, 'workspace_id', 'Board create base')
  }
}

function assertExactTarget(
  target: AppRpcTarget | undefined,
  expected: Record<string, unknown>,
  label: string
): asserts target is AppRpcTarget {
  if (!target) throw new Error(`${label} did not return an exact target.`)
  const fields: Array<[string, string | undefined]> = [
    ['runtime_instance_id', target.runtimeInstanceId],
    ['workspace_id', target.workspaceId],
    ['document_id', target.documentId],
    ['content_document_id', target.contentDocumentId],
    ['page_id', target.pageId]
  ]
  const mismatches = fields.filter(([field, actual]) => actual !== expected[field])
  if (mismatches.length > 0) {
    throw new Error(
      `${label} returned the wrong exact target: ${mismatches.map(([field]) => field).join(', ')}.`
    )
  }
}

function writerRevision(context: JsonObject): number {
  const runtime = record(context.runtime, 'Board context runtime')
  if (runtime.write_authority !== 'writer') {
    throw new Error('The exact OpenPencil Board is view-only; Board creation was not attempted.')
  }
  return numberField(record(context.revisions, 'Board context revisions'), 'board', 'Board context')
}

function executionSurface(context: JsonObject): string | undefined {
  const value = context.execution_surface
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function contextToken(context: JsonObject): string {
  return stringField(context, 'context_token', 'Board context')
}

function compactCreatedContext(context: JsonObject): JsonObject {
  const compact: JsonObject = {}
  for (const key of [
    'board_build_base',
    'context_token',
    'execution_surface',
    'revisions',
    'runtime',
    'target'
  ]) {
    if (context[key] !== undefined) compact[key] = context[key]
  }
  return compact
}

export async function createBoardPage(
  args: BoardCreateArgs,
  send: BoardRpcSender = rpcEnvelopeExact<JsonObject>
): Promise<BoardCreateResult> {
  const sourceTarget = await boardCreateRpcArgs(args, send)
  const sourcePageId = sourceTarget.page_id as string

  let context = await send('board_context', sourceTarget)
  assertExactTarget(context.target, sourceTarget, 'Board context')
  let expectedRevision = writerRevision(context.result)
  const headless = executionSurface(context.result) === 'local_workspace_authority'

  if (!headless) {
    const sourceOpen = await send('board_open', sourceTarget)
    assertExactTarget(sourceOpen.target, sourceTarget, 'Board open')
    context = await send('board_context', sourceTarget)
    assertExactTarget(context.target, sourceTarget, 'Board context')
    expectedRevision = writerRevision(context.result)
  }

  const creation = await send('tool', {
    ...sourceTarget,
    args: { name: required(args.name, '--name') },
    ...(headless ? { context_token: contextToken(context.result) } : {}),
    mutation: {
      expectedRevision,
      requestId: required(args['request-id'], '--request-id')
    },
    name: 'create_page'
  })
  assertExactTarget(creation.target, sourceTarget, 'Board creation')
  const createdPageId = stringField(creation.result, 'id', 'Board creation')
  const createdTarget = { ...sourceTarget, page_id: createdPageId }

  if (headless) {
    const createdContext = await send('board_context', createdTarget)
    assertExactTarget(createdContext.target, createdTarget, 'Created Board context')
    return {
      created_context: compactCreatedContext(createdContext.result),
      creation: creation.result,
      opened: null,
      source_page_id: sourcePageId,
      status: 'created_headless',
      target: createdContext.target
    }
  }

  try {
    const opened = await send('board_open', createdTarget)
    assertExactTarget(opened.target, createdTarget, 'Created Board open')
    return {
      creation: creation.result,
      opened: opened.result,
      source_page_id: sourcePageId,
      status: 'completed',
      target: opened.target
    }
  } catch (error) {
    return {
      creation: creation.result,
      opened: null,
      open_error: error instanceof Error ? error.message : String(error),
      source_page_id: sourcePageId,
      status: 'created_not_opened'
    }
  }
}

export async function openBoardPage(
  args: ExactBoardOpenArgs,
  send: BoardRpcSender = rpcEnvelopeExact<JsonObject>
): Promise<BoardOpenResult> {
  const exact = exactBoardRpcArgs(args)
  const editorRuntimeInstanceId = args['editor-runtime-instance-id']?.trim()
  const navigation = await send('board_open', {
    ...exact,
    ...(editorRuntimeInstanceId ? { editor_runtime_instance_id: editorRuntimeInstanceId } : {})
  })
  assertExactTarget(navigation.target, exact, 'Board navigation')
  const status = navigation.result.status
  if (
    status !== 'ambiguous_editor' &&
    status !== 'completed' &&
    status !== 'needs_editor' &&
    status !== 'queued_for_editor'
  ) {
    throw new Error('Board navigation returned an unknown status.')
  }
  return {
    navigation: navigation.result,
    status,
    target: navigation.target
  }
}

export async function searchBoardPages(
  args: BoardSearchArgs,
  send: BoardRpcSender = rpcEnvelopeExact<JsonObject>
): Promise<BoardListIndexResult | WorkspaceSearchResult> {
  const query = args.query?.trim()
  if (query) {
    const searched = await send('workspace_search', {
      limit: boardListLimit(args.limit),
      query
    })
    return workspaceSearchResult(searched.result)
  }
  const listed = await send('list_documents', boardsListRpcArgs())
  return boardListIndex(boardListResult(listed.result), args)
}

export async function openBoardByTarget(
  args: BoardOpenArgs,
  send: BoardRpcSender = rpcEnvelopeExact<JsonObject>
): Promise<BoardOpenResult> {
  const listed = await send('list_documents', boardsListRpcArgs())
  const exact = resolveBoardIndexTarget(
    boardListResult(listed.result),
    required(args.target, 'Board name or ID')
  )
  return openBoardPage(
    {
      'content-document-id': exact.content_document_id,
      'document-id': exact.document_id,
      ...(args['editor-runtime-instance-id']
        ? { 'editor-runtime-instance-id': args['editor-runtime-instance-id'] }
        : {}),
      'page-id': exact.page_id,
      'runtime-instance-id': exact.runtime_instance_id,
      'workspace-id': exact.workspace_id
    },
    send
  )
}

function printList(result: BoardListIndexResult | WorkspaceSearchResult, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if ('contract' in result) {
    console.log('')
    console.log(bold(`  ${result.returned} of ${result.total} matching Boards and objects`))
    console.log('')
    console.log(
      fmtList(
        result.results.map((item) => ({
          header: entity(item.kind === 'board' ? 'Board' : item.type, item.name, item.id),
          ...(item.kind === 'object'
            ? { details: { Board: `${item.board.name} (${item.board.id})` } }
            : {})
        })),
        { compact: true }
      )
    )
    console.log('')
    return
  }
  console.log('')
  console.log(bold(`  ${result.returned} of ${result.total} matching Boards`))
  console.log('')
  console.log(
    fmtList(
      result.boards.map((board) => ({
        header: `${entity('Board', board.name, board.id)}${board.active ? ' [active]' : ''}`
      })),
      { compact: true }
    )
  )
  console.log('')
}

function printOperation(
  title: string,
  result: { status?: unknown },
  target: AppRpcTarget | undefined
): void {
  const status = typeof result.status === 'string' ? result.status : 'completed'
  console.log('')
  console.log(bold(`  ${title}`))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: entity('status', status),
          details: {
            ...(target
              ? {
                  workspace: target.workspaceId ?? 'unreported',
                  content_document: target.contentDocumentId ?? 'unreported',
                  document_tab: target.documentId,
                  page: `${target.pageName} (${target.pageId})`,
                  revision: target.boardRevision,
                  runtime: target.runtimeInstanceId ?? 'unreported'
                }
              : {}),
            result: JSON.stringify(result)
          }
        }
      ],
      { compact: true }
    )
  )
  console.log('')
}

function boardOpenTitle(status: BoardOpenResult['status']): string {
  switch (status) {
    case 'completed':
      return 'Board opened'
    case 'queued_for_editor':
      return 'Board navigation queued'
    case 'ambiguous_editor':
      return 'Board editor is ambiguous'
    case 'needs_editor':
      return 'Board editor is needed'
  }
  throw new Error('Unknown Board open status.')
}

async function runBoardSearchCommand(args: BoardSearchArgs): Promise<void> {
  try {
    printList(await searchBoardPages(args), Boolean(args.json))
  } catch (error) {
    printError(error)
    process.exit(1)
  }
}

export const list = defineCommand({
  meta: {
    name: 'list',
    description: 'List the compact persisted Board index'
  },
  args: {
    limit: {
      type: 'string',
      description: `Maximum compact Board results from 1 to ${MAX_BOARD_LIST_LIMIT}; defaults to ${DEFAULT_BOARD_LIST_LIMIT}`
    },
    json: jsonOption
  },
  async run({ args }) {
    await runBoardSearchCommand(args)
  }
})

export const search = defineCommand({
  meta: {
    name: 'search',
    description: 'Find persisted Boards and objects by meaning, name, or ID'
  },
  args: {
    query: {
      type: 'positional',
      description: 'Board or object meaning, name, or ID; omit to return the Board index',
      required: false
    },
    limit: {
      type: 'string',
      description: `Maximum results from 1 to ${MAX_BOARD_LIST_LIMIT}; defaults to ${DEFAULT_BOARD_LIST_LIMIT}`
    },
    json: jsonOption
  },
  async run({ args }) {
    await runBoardSearchCommand(args)
  }
})

export const open = defineCommand({
  meta: {
    name: 'open',
    description: 'Open a persisted Board by name or ID, like opening a file'
  },
  args: {
    target: {
      type: 'positional',
      description: 'Exact Board name or ID',
      required: true
    },
    'editor-runtime-instance-id': {
      type: 'string',
      description: 'Exact connected editor runtime to use when more than one can open the Board'
    },
    json: jsonOption
  },
  async run({ args }) {
    try {
      const result = await openBoardByTarget(args)
      if (args.json) console.log(JSON.stringify(result, null, 2))
      else {
        printOperation(
          boardOpenTitle(result.status),
          { ...result.navigation, status: result.status },
          result.target
        )
      }
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export const create = defineCommand({
  meta: {
    name: 'create',
    description:
      'Create one durable Board page; the sole persisted authority is automatic, while optional target flags pin and validate it'
  },
  args: {
    ...boardCreateTargetOptions,
    base: {
      type: 'string',
      description: 'Complete board_build_base JSON returned by board context'
    },
    'base-file': {
      type: 'string',
      description:
        'Path to a board-build/v1 base or Board context/create JSON; exclusive with --base and flattened target fields'
    },
    name: { type: 'string', description: 'New Board page name', required: true },
    'request-id': {
      type: 'string',
      description: 'Stable idempotency ID for safe replay',
      required: true
    },
    json: jsonOption
  },
  async run({ args }) {
    try {
      const result = await createBoardPage(await boardTargetSource(args))
      if (args.json) console.log(JSON.stringify(result, null, 2))
      else printOperation('Board created', result, result.target)
      if (result.status === 'created_not_opened') process.exitCode = 1
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export default defineCommand({
  meta: {
    name: 'boards',
    description: 'Search, open, and create persisted Boards'
  },
  subCommands: { create, list, open, search }
})
