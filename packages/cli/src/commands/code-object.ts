import { readFile } from 'node:fs/promises'

import { defineCommand } from 'citty'

import { rpc } from '#cli/app-client'
import { appTargetOptions, appTargetRpcArgs, type AppTargetCliArgs } from '#cli/app-target'
import { bold, entity, fmtSummary, printError } from '#cli/format'

type CodeObjectResult = {
  applied?: boolean
  component: {
    definition_id: string
    name: string
    props: Record<string, unknown>
    source: string
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

type CodeObjectIdentityArgs = AppTargetCliArgs & {
  objectKey: string
  json?: boolean
}

type CodeObjectJson = { [key: string]: unknown }

const identityArgs = {
  objectKey: {
    type: 'string',
    description: 'Stable Code Component identity used across reruns',
    required: true
  },
  ...appTargetOptions,
  json: { type: 'boolean', description: 'Output as JSON' }
} as const

function targetArgs(args: CodeObjectIdentityArgs) {
  return {
    object_key: args.objectKey,
    ...appTargetRpcArgs(args)
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
    fmtSummary({
      component: entity('component', result.component.name, result.component.definition_id),
      frame: entity('frame', result.frame.name, result.frame.id),
      persistence: result.persistence?.status ?? 'read-only',
      revision: result.mutation_receipt?.appliedRevision ?? 'unchanged',
      source: `${result.component.source_length} chars`
    })
  )
  console.log('')
}

const upsert = defineCommand({
  meta: { description: 'Create or update one trusted TypeScript/TSX Code Object' },
  args: {
    ...identityArgs,
    source: { type: 'string', description: 'TypeScript/TSX source file', required: true },
    name: { type: 'string', description: 'Visible Code Object name', required: false },
    props: { type: 'string', description: 'JSON properties file', required: false },
    state: { type: 'string', description: 'JSON persisted-state file', required: false },
    width: { type: 'string', description: 'Frame width', required: false },
    height: { type: 'string', description: 'Frame height', required: false },
    x: { type: 'string', description: 'Canvas x position', required: false },
    y: { type: 'string', description: 'Canvas y position', required: false },
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
      const result = await rpc<CodeObjectResult>('upsert_code_object', {
        ...targetArgs(args),
        height: args.height === undefined ? undefined : Number(args.height),
        name: args.name,
        persist: !args.noPersist,
        props,
        source,
        state,
        width: args.width === undefined ? undefined : Number(args.width),
        x: args.x === undefined ? undefined : Number(args.x),
        y: args.y === undefined ? undefined : Number(args.y),
        zoom_to_selection: !args.noZoom
      })
      printCodeObject(result, !!args.json)
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const inspect = defineCommand({
  meta: { description: 'Read one authored Code Object by stable identity' },
  args: identityArgs,
  async run({ args }) {
    try {
      const result = await rpc<CodeObjectResult>('get_code_object', targetArgs(args))
      printCodeObject(result, !!args.json)
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export default defineCommand({
  meta: { description: 'Author and inspect trusted TypeScript/TSX Code Objects' },
  subCommands: { inspect, upsert }
})
