import { defineCommand } from 'citty'

import { setEditorTheme } from '#cli/board-file/workspace'
import { openBoardByTarget, where } from '#cli/commands/boards'
import { bold, entity, fmtList, kv, printError } from '#cli/format'

const jsonOption = { type: 'boolean', description: 'Output as JSON' } as const

const go = defineCommand({
  meta: {
    name: 'go',
    description: 'Move the live OpenPencil camera to a Board by name or ID'
  },
  args: {
    target: {
      type: 'positional',
      description: 'Exact Board name or ID',
      required: true
    },
    objects: {
      type: 'string',
      description: 'Comma-separated Board object IDs to select and reveal after opening'
    },
    region: {
      type: 'string',
      description: 'Page-space rectangle to frame after opening, as x,y,width,height'
    },
    json: jsonOption
  },
  async run({ args }) {
    try {
      const result = await openBoardByTarget(args)
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      const status = typeof result.status === 'string' ? result.status : 'completed'
      console.log('')
      console.log(bold('  Board navigation queued'))
      console.log('')
      console.log(
        fmtList(
          [
            {
              header: entity('status', status),
              details: {
                ...(result.target
                  ? {
                      board: `${result.target.documentName} / ${result.target.pageName}`,
                      page: result.target.pageId
                    }
                  : {}),
                ...result.navigation
              }
            }
          ],
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

const theme = defineCommand({
  meta: {
    name: 'theme',
    description: 'Set the live OpenPencil window to light, dark, or auto'
  },
  args: {
    mode: {
      type: 'positional',
      description: 'light, dark, or auto',
      required: true
    },
    json: jsonOption
  },
  async run({ args }) {
    try {
      const mode = args.mode.trim()
      if (mode !== 'light' && mode !== 'dark' && mode !== 'auto') {
        throw new Error('theme must be light, dark, or auto.')
      }
      const result = await setEditorTheme(mode)
      if (args.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }
      console.log(kv('theme', String(result.theme ?? mode)))
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

const boardSubCommands = {
  where,
  go,
  theme
}

export default defineCommand({
  meta: {
    name: 'board',
    description: 'Show the current Board, move the camera, or set light/dark/auto'
  },
  subCommands: boardSubCommands
})
