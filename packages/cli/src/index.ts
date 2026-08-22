#!/usr/bin/env bun
import { defineCommand, runMain } from 'citty'

import { rewriteStdinValueArgs } from './argv'
import analyze from './commands/analyze'
import board, { boardInternalCommand } from './commands/board'
import convert from './commands/convert'
import evalCmd from './commands/eval'
import exportCmd from './commands/export'
import formats from './commands/formats'
import importCmd from './commands/import'
import inspect from './commands/inspect'
import lint from './commands/lint'
import trace from './commands/trace'
import { applyAgentOutputMode } from './output-mode'

const { version } = await import('../package.json')

const rawArgs = applyAgentOutputMode(
  rewriteStdinValueArgs(process.argv.slice(2)),
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
      rawArgs[0] === 'board' && (rawArgs[1] === 'connect' || rawArgs[1] === 'edit')
        ? boardInternalCommand
        : board,
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
