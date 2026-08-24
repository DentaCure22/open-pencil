import { defineCommand } from 'citty'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import { rpcEnvelopeExact, type AppRpcEnvelope, type AppRpcTarget } from '#cli/app-client'
import { exactAppTargetRpcArgs } from '#cli/app-target'
import { readEditorPresence } from '#cli/board-file/workspace'
import { boardsListRpcArgs, resolveBoardIndexTarget, type BoardListResult } from '#cli/board-list'
import { bold, entity, kv, printError } from '#cli/format'

type JsonObject = { [key: string]: unknown }

export type ExactBoardCliArgs = {
  'content-document-id'?: string
  'document-id'?: string
  'page-id'?: string
  'runtime-instance-id'?: string
  'workspace-id'?: string
}

type ExactBoardOpenArgs = ExactBoardCliArgs & {
  objects?: string
  region?: string
}

type BoardOpenArgs = {
  objects?: string
  region?: string
  target?: string
}

export type BoardOpenResult = {
  navigation: JsonObject
  status: 'queued_for_editor'
  target?: AppRpcTarget
}

export type BoardRpcSender = (
  command: string,
  args: Record<string, unknown>
) => Promise<AppRpcEnvelope<JsonObject>>

const jsonOption = { type: 'boolean', description: 'Output as JSON' } as const

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${flag} is required.`)
  return trimmed
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

export const exactBoardRpcArgs = exactAppTargetRpcArgs

function assertBoardNavigationTarget(
  target: AppRpcTarget | undefined,
  expected: Record<string, unknown>
): asserts target is AppRpcTarget {
  if (!target) throw new Error('Board navigation did not return an exact target.')
  const fields: Array<[string, string | undefined]> = [
    ['workspace_id', target.workspaceId],
    ['document_id', target.documentId],
    ['content_document_id', target.contentDocumentId],
    ['page_id', target.pageId]
  ]
  const mismatches = fields.filter(([field, actual]) => actual !== expected[field])
  if (mismatches.length > 0) {
    throw new Error(
      `Board navigation returned the wrong exact target: ${mismatches
        .map(([field]) => field)
        .join(', ')}.`
    )
  }
}

function parseNavigationObjects(value: string | undefined): string[] {
  if (!value?.trim()) return []
  return value
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

function parseNavigationRegion(value: string | undefined): Rect | undefined {
  if (!value?.trim()) return undefined
  const parts = value.split(',').map((part) => Number.parseFloat(part.trim()))
  const [x, y, width, height] = parts
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isFinite(part)) ||
    width === undefined ||
    width <= 0 ||
    height === undefined ||
    height <= 0
  ) {
    throw new Error('--region requires x,y,width,height with positive width and height.')
  }
  return { height, width, x: x as number, y: y as number }
}

export async function openBoardPage(
  args: ExactBoardOpenArgs,
  send: BoardRpcSender = rpcEnvelopeExact<JsonObject>
): Promise<BoardOpenResult> {
  const exact = exactBoardRpcArgs(args)
  const objectIds = parseNavigationObjects(args.objects)
  const region = parseNavigationRegion(args.region)
  const navigation = await send('board_open', {
    ...exact,
    ...(objectIds.length > 0 ? { object_ids: objectIds } : {}),
    ...(region ? { region } : {})
  })
  assertBoardNavigationTarget(navigation.target, exact)
  const status = navigation.result.status
  if (status !== 'queued_for_editor') {
    throw new Error('Board navigation returned an unknown status.')
  }
  return {
    navigation: navigation.result,
    status,
    target: navigation.target
  }
}

export async function openBoardByTarget(
  args: BoardOpenArgs,
  send?: BoardRpcSender
): Promise<BoardOpenResult> {
  const listSend = send ?? rpcEnvelopeExact<JsonObject>
  const listed = await listSend('list_documents', boardsListRpcArgs())
  const exact = resolveBoardIndexTarget(
    boardListResult(listed.result),
    required(args.target, 'Board name or ID')
  )
  return openBoardPage(
    {
      'content-document-id': exact.content_document_id,
      'document-id': exact.document_id,
      ...(args.objects ? { objects: args.objects } : {}),
      'page-id': exact.page_id,
      ...(args.region ? { region: args.region } : {}),
      'runtime-instance-id': exact.runtime_instance_id,
      'workspace-id': exact.workspace_id
    },
    send
  )
}

export const where = defineCommand({
  meta: {
    name: 'where',
    description:
      'Show which Board the user is looking at right now, from the editor presence heartbeat'
  },
  args: { json: jsonOption },
  async run({ args }) {
    try {
      const presence = await readEditorPresence()
      if (args.json) {
        console.log(JSON.stringify({ presence }, null, 2))
        return
      }
      if (!presence) {
        console.log('No editor presence recorded yet; open the OpenPencil editor first.')
        return
      }
      const ageSeconds = Math.max(
        0,
        Math.round((Date.now() - Date.parse(presence.updatedAt)) / 1000)
      )
      console.log(bold(presence.pageName))
      console.log(kv('page_id', entity(presence.pageId)))
      console.log(kv('updated', `${String(ageSeconds)}s ago`))
      if (presence.viewport) {
        console.log(kv('zoom', presence.viewport.zoom.toFixed(2)))
        console.log(
          kv(
            'pan',
            `${String(Math.round(presence.viewport.panX))}, ${String(Math.round(presence.viewport.panY))}`
          )
        )
      }
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})
