import { defineCommand } from 'citty'

import { rpcEnvelopeExact, type AppRpcTarget } from '#cli/app-client'
import {
  exactAppTargetOptions,
  exactAppTargetRpcArgs,
  type AppTargetCliArgs
} from '#cli/app-target'
import { bold, entity, fmtList, printError } from '#cli/format'

type FixtureOperation = 'assert' | 'capture' | 'reset'
type FixtureArgs = AppTargetCliArgs & {
  'context-token'?: string
  'expected-revision'?: string
  'fixture-id'?: string
  json?: boolean
  operation: FixtureOperation
  'request-id'?: string
}

const sharedOptions = {
  ...exactAppTargetOptions,
  'context-token': {
    type: 'string',
    description: 'Exact token returned by board context',
    required: true
  },
  json: { type: 'boolean', description: 'Output as JSON' }
} as const

function required(value: string | undefined, flag: string): string {
  const result = value?.trim()
  if (!result) throw new Error(`${flag} is required.`)
  return result
}

function revision(value: string | undefined): number {
  const result = Number(required(value, '--expected-revision'))
  if (!Number.isInteger(result) || result < 0) {
    throw new Error('--expected-revision must be a non-negative integer.')
  }
  return result
}

export function boardFixtureRpcArgs(args: FixtureArgs): Record<string, unknown> {
  return {
    ...exactAppTargetRpcArgs(args, true),
    context_token: required(args['context-token'], '--context-token'),
    operation: args.operation,
    ...(args.operation === 'capture'
      ? {}
      : { fixture_id: required(args['fixture-id'], '--fixture-id') }),
    ...(args.operation === 'reset'
      ? {
          expected_revision: revision(args['expected-revision']),
          request_id: required(args['request-id'], '--request-id')
        }
      : {})
  }
}

function printResult(
  operation: FixtureOperation,
  result: Record<string, unknown>,
  target: AppRpcTarget | undefined,
  json: boolean
): void {
  if (json) {
    console.log(JSON.stringify({ ...result, ...(target ? { target } : {}) }, null, 2))
    return
  }
  console.log('')
  console.log(bold(`  Board fixture ${operation}`))
  console.log('')
  console.log(
    fmtList(
      [
        {
          header: entity('status', String(result.status ?? operation)),
          details: {
            board: target ? `${target.documentName} / ${target.pageName}` : 'unreported',
            result: JSON.stringify(result)
          }
        }
      ],
      { compact: true }
    )
  )
  console.log('')
}

async function run(args: FixtureArgs): Promise<void> {
  try {
    const response = await rpcEnvelopeExact<Record<string, unknown>>(
      'board_fixture',
      boardFixtureRpcArgs(args)
    )
    printResult(args.operation, response.result, response.target, Boolean(args.json))
  } catch (error) {
    printError(error)
    process.exit(1)
  }
}

const capture = defineCommand({
  meta: {
    name: 'capture',
    description: 'Capture one authority-owned semantic baseline token for the exact persisted Board'
  },
  args: sharedOptions,
  run: ({ args }) => run({ ...args, operation: 'capture' })
})

const assert = defineCommand({
  meta: {
    name: 'assert',
    description: 'Compare the exact persisted Board with an authority-owned semantic fixture token'
  },
  args: {
    ...sharedOptions,
    'fixture-id': {
      type: 'string',
      description: 'Authority-owned token returned by fixture capture',
      required: true
    }
  },
  run: ({ args }) => run({ ...args, operation: 'assert' })
})

const reset = defineCommand({
  meta: {
    name: 'reset',
    description:
      'Durably restore an authority-owned fixture with CAS; external evaluator reset, not Undo'
  },
  args: {
    ...sharedOptions,
    'expected-revision': {
      type: 'string',
      description: 'Current authority revision returned by board context',
      required: true
    },
    'fixture-id': {
      type: 'string',
      description: 'Authority-owned token returned by fixture capture',
      required: true
    },
    'request-id': {
      type: 'string',
      description: 'Stable idempotency ID for this fixture reset',
      required: true
    }
  },
  run: ({ args }) => run({ ...args, operation: 'reset' })
})

export const boardFixtureCommand = defineCommand({
  meta: {
    name: 'fixture',
    description:
      'Capture, assert, or externally reset persisted evaluator fixtures; unavailable on live runtimes'
  },
  subCommands: { assert, capture, reset }
})
