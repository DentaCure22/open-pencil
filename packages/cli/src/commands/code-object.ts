import { readFile } from 'node:fs/promises'

import { defineCommand } from 'citty'

import { rpcDirect } from '#cli/app-client'
import { appTargetOptions, exactAppTargetRpcArgs, type AppTargetCliArgs } from '#cli/app-target'
import { bold, entity, fmtList, printError } from '#cli/format'

type CodeObjectResult = {
  applied?: boolean
  component: {
    definition_id: string
    name: string
    props: Record<string, unknown>
    source: string
    source_hash: string
    source_length: number
    state: Record<string, unknown>
  }
  frame: {
    height: number
    id: string
    name: string
    type: string
    width: number
    x: number
    y: number
  }
  mutation_receipt?: { appliedRevision: number; requestId: string; status: string }
  persistence?: { requested: boolean; status: string }
}

type CodeObjectUpsertIdentityArgs = AppTargetCliArgs & {
  objectKey: string
  json?: boolean
}

type CodeObjectInspectArgs = AppTargetCliArgs & {
  'owner-id': string
  json?: boolean
}

type CodeObjectUpsertArgs = CodeObjectUpsertIdentityArgs & {
  'expected-revision'?: string
  'request-id'?: string
}

type CodeObjectJson = { [key: string]: unknown }

const exactTargetOptions = {
  'content-document-id': {
    ...appTargetOptions['content-document-id'],
    required: true
  },
  'document-id': { ...appTargetOptions['document-id'], required: true },
  'page-id': { ...appTargetOptions['page-id'], required: true },
  'runtime-instance-id': { ...appTargetOptions['runtime-instance-id'], required: true },
  'workspace-id': { ...appTargetOptions['workspace-id'], required: true }
} as const

const upsertArgs = {
  objectKey: {
    type: 'string',
    description: 'Stable Code Component identity used across reruns',
    required: true
  },
  ...exactTargetOptions,
  json: { type: 'boolean', description: 'Output as JSON' }
} as const

const inspectArgs = {
  'owner-id': {
    type: 'string',
    description: 'Exact page-owned Code Object frame ID returned by Board context or build',
    required: true
  },
  ...exactTargetOptions,
  json: { type: 'boolean', description: 'Output as JSON' }
} as const

export function codeObjectInspectRpcArgs(args: CodeObjectInspectArgs) {
  return {
    ...exactAppTargetRpcArgs(args, true),
    owner_id: required(args['owner-id'], '--owner-id')
  }
}

function required(value: string | undefined, flag: string): string {
  const trimmed = value?.trim()
  if (!trimmed) throw new Error(`${flag} is required.`)
  return trimmed
}

function expectedRevision(value: string | undefined): number {
  const parsed = Number(required(value, '--expected-revision'))
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('--expected-revision must be a non-negative integer.')
  }
  return parsed
}

function optionalFiniteNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a finite number.`)
  return parsed
}

export function codeObjectUpsertRpcArgs(
  args: CodeObjectUpsertArgs,
  input: {
    height?: number
    name?: string
    persist: boolean
    props: CodeObjectJson
    source: string
    state: CodeObjectJson
    width?: number
    x?: number
    y?: number
    zoomToSelection: boolean
  }
) {
  return {
    ...exactAppTargetRpcArgs(args, true),
    height: input.height,
    name: input.name,
    mutation: {
      expectedRevision: expectedRevision(args['expected-revision']),
      requestId: required(args['request-id'], '--request-id')
    },
    object_key: args.objectKey,
    persist: input.persist,
    props: input.props,
    source: input.source,
    state: input.state,
    width: input.width,
    x: input.x,
    y: input.y,
    zoom_to_selection: input.zoomToSelection
  }
}

function isCodeObjectJson(value: unknown): value is CodeObjectJson {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function readJsonObject(path: string | undefined): Promise<CodeObjectJson> {
  if (!path) return {}
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isCodeObjectJson(parsed)) {
    throw new Error(`"${path}" must contain one JSON object.`)
  }
  return parsed
}

function printCodeObject(result: CodeObjectResult, json: boolean) {
  if (json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log('')
  console.log(bold('  Code Object'))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: entity('frame', result.frame.name, result.frame.id),
          details: {
            component: entity('component', result.component.name, result.component.definition_id),
            persistence: result.persistence?.status ?? 'read-only',
            revision: result.mutation_receipt?.appliedRevision ?? 'unchanged',
            source: `${result.component.source_length} chars`,
            sourceHash: result.component.source_hash
          }
        }
      ],
      { compact: true }
    )
  )
  console.log('')
}

export const codeObjectUpsertCommand = defineCommand({
  meta: {
    name: 'upsert',
    description:
      'Deprecated compatibility command; use board context then board build for Code Object creation and refinement'
  },
  args: {
    ...upsertArgs,
    source: { type: 'string', description: 'TypeScript/TSX source file', required: true },
    name: { type: 'string', description: 'Visible Code Object name', required: false },
    props: { type: 'string', description: 'JSON properties file', required: false },
    state: { type: 'string', description: 'JSON persisted-state file', required: false },
    width: { type: 'string', description: 'Frame width', required: false },
    height: { type: 'string', description: 'Frame height', required: false },
    x: { type: 'string', description: 'Canvas x position', required: false },
    y: { type: 'string', description: 'Canvas y position', required: false },
    'expected-revision': {
      type: 'string',
      description: 'Board revision returned by exact Board context',
      required: true
    },
    'request-id': {
      type: 'string',
      description: 'Stable mutation request ID for this upsert',
      required: true
    },
    noPersist: { type: 'boolean', description: 'Skip durable workspace/document save' },
    noZoom: { type: 'boolean', description: 'Do not focus the resulting frame' }
  },
  async run({ args }) {
    try {
      const [source, props, state] = await Promise.all([
        readFile(args.source, 'utf8'),
        readJsonObject(args.props),
        readJsonObject(args.state)
      ])
      const result = await rpcDirect<CodeObjectResult>(
        'upsert_code_object',
        codeObjectUpsertRpcArgs(args, {
          height: optionalFiniteNumber(args.height, '--height'),
          name: args.name,
          persist: !args.noPersist,
          props,
          source,
          state,
          width: optionalFiniteNumber(args.width, '--width'),
          x: optionalFiniteNumber(args.x, '--x'),
          y: optionalFiniteNumber(args.y, '--y'),
          zoomToSelection: !args.noZoom
        })
      )
      printCodeObject(result, !!args.json)
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const inspect = defineCommand({
  meta: {
    name: 'inspect',
    description: 'Read one authored Code Object by exact page-owned owner ID'
  },
  args: inspectArgs,
  async run({ args }) {
    try {
      const result = await rpcDirect<CodeObjectResult>(
        'get_code_object',
        codeObjectInspectRpcArgs(args)
      )
      printCodeObject(result, !!args.json)
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const codeObjectMeta = {
  name: 'code-object',
  description:
    'Author and inspect trusted in-process TypeScript/TSX Code Objects; this is not a security sandbox, so never use external or untrusted source'
}

export const codeObjectWithUpsertCommand = defineCommand({
  meta: codeObjectMeta,
  subCommands: { inspect, upsert: codeObjectUpsertCommand }
})

export default defineCommand({
  meta: codeObjectMeta,
  subCommands: { inspect }
})
