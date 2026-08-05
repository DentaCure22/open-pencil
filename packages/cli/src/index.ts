#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

import analyze from './commands/analyze'
import board, { boardWithChangeCommand } from './commands/board'
import codeObject, { codeObjectWithUpsertCommand } from './commands/code-object'
import convert from './commands/convert'
import evalCmd from './commands/eval'
import exportCmd from './commands/export'
import formats from './commands/formats'
import importCmd from './commands/import'
import inspect from './commands/inspect'
import lint from './commands/lint'
import trace from './commands/trace'
import { rewriteLegacyInspectionArgs, rewriteStdinValueArgs } from './compatibility'
import { applyAgentOutputMode } from './output-mode'

const { version } = await import('../package.json')

const rawArgs = applyAgentOutputMode(
  rewriteStdinValueArgs(rewriteLegacyInspectionArgs(process.argv.slice(2))),
  process.env.OPENPENCIL_OUTPUT
)
const main = defineCommand({
  meta: {
    name: 'openpencil',
    description: 'OpenPencil CLI — build, inspect, and automate persisted and live Boards',
    version
  },
  subCommands: {
    analyze,
    board:
      rawArgs[0] === 'board' &&
      (rawArgs[1] === 'change' || rawArgs[1] === 'connect' || rawArgs[1] === 'edit')
        ? boardWithChangeCommand
        : board,
    'code-object':
      rawArgs[0] === 'code-object' && rawArgs[1] === 'upsert'
        ? codeObjectWithUpsertCommand
        : codeObject,
    convert,
    eval: evalCmd,
    export: exportCmd,
    import: importCmd,
    inspect,
    formats,
    lint,
    trace
  }
})

void runMain(main, { rawArgs })
