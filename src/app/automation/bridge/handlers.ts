import type { FigmaAPI } from '@open-pencil/core/figma-api'

import { createAutomationEvalHandler } from '@/app/automation/bridge/eval-handler'
import { assertGuardedAutomationTarget } from '@/app/automation/bridge/exact-target'
import { handleExport, handleExportJsx } from '@/app/automation/bridge/export-handlers'
import {
  handleNewDocument,
  handleOpenFile,
  handleSaveFile
} from '@/app/automation/bridge/file-handlers'
import { createLiveBoardHandlers } from '@/app/automation/bridge/live-board'
import { handleRpcFallback } from '@/app/automation/bridge/rpc-handler'
import { handleSelection } from '@/app/automation/bridge/selection-handler'
import {
  isUnknownRecord,
  resolveAutomationTarget,
  responseWithTarget,
  stripAutomationTargetArgs
} from '@/app/automation/bridge/target'
import { handleSetTheme } from '@/app/automation/bridge/theme-handler'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import type { EditorStore } from '@/app/editor/active-store'

type FigmaFactory = (store: EditorStore, pageId?: string) => FigmaAPI

type CommandHandler = (
  target: ReturnType<typeof resolveAutomationTarget>,
  args: unknown
) => Promise<unknown>

function boardCommand(handler: CommandHandler): CommandHandler {
  return async (target, args) => ({
    ok: true,
    result: await handler(target, args)
  })
}

export function createAutomationCommandHandlers(
  makeFigma: FigmaFactory,
  runtimeInstanceId = 'runtime:test'
) {
  const board = createLiveBoardHandlers(runtimeInstanceId)
  const handleEval = createAutomationEvalHandler(makeFigma)
  const handleTool = createAutomationToolHandler(makeFigma)

  const commandHandlers: Partial<Record<string, CommandHandler>> = {
    board_context: boardCommand((target) => board.context(target)),
    board_present: boardCommand((target, args) => board.present(target, args)),
    eval: handleEval,
    tool: handleTool,
    export: handleExport,
    export_jsx: handleExportJsx,
    selection: handleSelection,
    save_file: handleSaveFile,
    new_document: handleNewDocument,
    open_file: handleOpenFile,
    set_theme: handleSetTheme
  }

  async function handleRequest(
    store: EditorStore,
    command: string,
    args: unknown
  ): Promise<unknown> {
    if (command === 'open_file' || command === 'new_document') {
      const handler = commandHandlers[command]
      if (handler) {
        return handler(resolveAutomationTarget(store, undefined, runtimeInstanceId), args)
      }
    }

    const rawArgs = isUnknownRecord(args) ? args : {}
    assertGuardedAutomationTarget(command, rawArgs)
    const target = resolveAutomationTarget(store, rawArgs, runtimeInstanceId)
    const targetArgs = stripAutomationTargetArgs(rawArgs)
    const handler = commandHandlers[command]
    const result = handler
      ? await handler(target, targetArgs)
      : await handleRpcFallback(target, command, targetArgs)
    return responseWithTarget(result, target)
  }

  return { handleRequest }
}
