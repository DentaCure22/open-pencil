import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { defineCommand } from 'citty'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  DEFAULT_NEARBY_ROWS,
  getWorkspaceNodes,
  listWorkspaceChildren,
  loadWorkspace,
  MAX_GET_NODES,
  MAX_LS_ROWS,
  MAX_NEARBY_ROWS,
  nearbyWorkspaceUnits,
  parseIdList,
  parseRowLimit,
  type SlimUnit
} from '#cli/board-file/inspect'
import { readEditorPresence, resolveWorkspacePath } from '#cli/board-file/workspace'
import { bold, entity, fmtList, kv, printError } from '#cli/format'

const jsonOption = { type: 'boolean', description: 'Output as JSON' } as const
const workspaceOption = {
  type: 'string',
  description: 'Path to workspace.json or its directory; defaults to the local Board file'
} as const

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function unitLine(unit: SlimUnit): string {
  return `${entity(unit.type, unit.name, unit.id)}  ${String(Math.round(unit.x))},${String(Math.round(unit.y))}  ${String(Math.round(unit.width))}×${String(Math.round(unit.height))}`
}

function printUnits(
  title: string,
  units: readonly SlimUnit[],
  omitted: number,
  json: boolean,
  payload: unknown
): void {
  if (json) {
    printJson(payload)
    return
  }
  console.log('')
  console.log(bold(`  ${title}`))
  console.log('')
  console.log(
    fmtList(
      units.map((unit) => ({ header: unitLine(unit) })),
      { compact: true }
    )
  )
  if (omitted > 0) console.log(kv('omitted', String(omitted)))
  console.log('')
}

async function resolveLsContainer(containerId: string | undefined): Promise<string> {
  if (containerId?.trim()) return containerId.trim()
  const presence = await readEditorPresence()
  if (!presence) {
    throw new Error(
      'Pass a page or frame id, or open the editor so board ls can use the current page.'
    )
  }
  return presence.pageId
}

export const get = defineCommand({
  meta: {
    name: 'get',
    description:
      'Print one or a few workspace.json nodes without loading the Board file into context'
  },
  args: {
    ids: {
      type: 'positional',
      description: `Object id, or comma-separated ids (max ${String(MAX_GET_NODES)})`,
      required: true
    },
    full: {
      type: 'boolean',
      description: 'Do not truncate long strings or pluginData'
    },
    json: jsonOption,
    workspace: workspaceOption
  },
  async run({ args }) {
    try {
      const nodeIds = parseIdList([args.ids])
      const result = getWorkspaceNodes(
        await loadWorkspace(resolveWorkspacePath(args.workspace)),
        nodeIds,
        Boolean(args.full)
      )
      printJson(result)
      if (result.nodes.length === 0) process.exit(1)
      if (result.missing.length > 0) process.exitCode = 1
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export const ls = defineCommand({
  meta: {
    name: 'ls',
    description:
      'Show the current box (id/name/size) then its children; omit the id to use the page on screen'
  },
  args: {
    container: {
      type: 'positional',
      description: 'Page or frame id; omit to use the current editor page',
      required: false
    },
    json: jsonOption,
    limit: {
      type: 'string',
      description: `Maximum child rows from 1 to ${String(MAX_LS_ROWS)}; defaults to ${String(MAX_LS_ROWS)}`
    },
    workspace: workspaceOption
  },
  async run({ args }) {
    try {
      const containerId = await resolveLsContainer(args.container)
      const result = listWorkspaceChildren(
        await loadWorkspace(resolveWorkspacePath(args.workspace)),
        containerId,
        parseRowLimit(args.limit, MAX_LS_ROWS, MAX_LS_ROWS)
      )
      const size =
        result.container.width > 0 && result.container.height > 0
          ? `  ${String(Math.round(result.container.width))}×${String(Math.round(result.container.height))}`
          : ''
      printUnits(
        `${result.container.name}${size}`,
        [result.container, ...result.units],
        result.omitted,
        Boolean(args.json),
        result
      )
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export const nearby = defineCommand({
  meta: {
    name: 'nearby',
    description: 'List the nearest sibling boxes around one object'
  },
  args: {
    id: {
      type: 'positional',
      description: 'Object id to stand next to',
      required: true
    },
    json: jsonOption,
    limit: {
      type: 'string',
      description: `Maximum neighbor rows from 1 to ${String(MAX_NEARBY_ROWS)}; defaults to ${String(DEFAULT_NEARBY_ROWS)}`
    },
    workspace: workspaceOption
  },
  async run({ args }) {
    try {
      const result = nearbyWorkspaceUnits(
        await loadWorkspace(resolveWorkspacePath(args.workspace)),
        args.id,
        parseRowLimit(args.limit, DEFAULT_NEARBY_ROWS, MAX_NEARBY_ROWS)
      )
      printUnits(
        `near ${result.around.name}`,
        result.units,
        result.omitted,
        Boolean(args.json),
        result
      )
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

type WorkspacePageIndex = {
  contract: string
  pageCount: number
  recordCount: number
  records: WorkspacePageIndexRecord[]
  revision: number
}

type WorkspacePageIndexRecord = {
  bounds: Rect
  id: string
  kind: 'node' | 'page'
  name: string
  pageId: string
  parentId: string | null
  type: string
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function workspacePageIndex(value: string): WorkspacePageIndex {
  const lines = value.split('\n').filter(Boolean)
  const metadata = JSON.parse(lines[0] ?? 'null') as Partial<WorkspacePageIndex> | null
  if (
    !metadata ||
    metadata.contract !== 'workspace-jsonl-index/v1' ||
    !isNonNegativeInteger(metadata.pageCount) ||
    !isNonNegativeInteger(metadata.recordCount) ||
    !isNonNegativeInteger(metadata.revision)
  ) {
    throw new Error('workspace.index.jsonl is not a valid Board index.')
  }
  const records = lines.slice(1).map((line) => JSON.parse(line) as WorkspacePageIndexRecord)
  if (records.length !== metadata.recordCount) {
    throw new Error('workspace.index.jsonl is not a valid Board index.')
  }
  return {
    contract: metadata.contract,
    pageCount: metadata.pageCount,
    recordCount: metadata.recordCount,
    records,
    revision: metadata.revision
  }
}

export const pages = defineCommand({
  meta: {
    name: 'pages',
    description:
      'List every Board page from the compact workspace.index.jsonl without scanning workspace.json'
  },
  args: {
    json: jsonOption,
    workspace: workspaceOption
  },
  async run({ args }) {
    try {
      const workspacePath = resolveWorkspacePath(args.workspace)
      const indexPath = path.join(path.dirname(workspacePath), 'workspace.index.jsonl')
      let index: WorkspacePageIndex
      try {
        index = workspacePageIndex(await readFile(indexPath, 'utf8'))
      } catch (error) {
        if (error instanceof Error && error.message.includes('not a valid')) throw error
        throw new Error(
          `No workspace.index.jsonl next to ${workspacePath}; open OpenPencil once so the authority writes it.`
        )
      }
      if (args.json) {
        printJson(index)
        return
      }
      console.log('')
      console.log(
        bold(
          `  ${String(index.pageCount)} pages · ${String(index.recordCount)} records · revision ${String(index.revision)}`
        )
      )
      console.log('')
      console.log(
        fmtList(
          index.records
            .filter((record) => record.kind === 'page')
            .map((page) => ({
              header: `${entity(page.type, page.name, page.id)}  ${String(index.records.filter((record) => record.pageId === page.id && record.parentId === page.id).length)} top-level · ${String(index.records.filter((record) => record.pageId === page.id && record.kind === 'node').length)} objects`,
              ...(page.bounds
                ? {
                    details: {
                      bounds: `${String(Math.round(page.bounds.x))},${String(Math.round(page.bounds.y))} ${String(Math.round(page.bounds.width))}×${String(Math.round(page.bounds.height))}`
                    }
                  }
                : {})
            })),
          { compact: true }
        )
      )
      console.log('')
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})
