import type { FigmaAPI } from '@open-pencil/core/figma-api'

import { createAutomationBoardBuildHandler } from '@/app/automation/bridge/board-build'
import { createAutomationBoardOpenHandler } from '@/app/automation/bridge/board-navigation-handler'
import { createAutomationBoardPrepareEditHandler } from '@/app/automation/bridge/board-prepare-edit'
import { createAutomationBoardHandlers } from '@/app/automation/bridge/board-tools'
import {
  createAutomationCodeObjectCreateHandler,
  createAutomationCodeObjectReadHandler,
  createAutomationCodeObjectRefineHandler,
  createAutomationCodeObjectUpsertHandler
} from '@/app/automation/bridge/code-object-handler'
import { createAutomationEvalHandler } from '@/app/automation/bridge/eval-handler'
import {
  assertGuardedAutomationTarget,
  normalizeGuardedAutomationArgs
} from '@/app/automation/bridge/exact-target'
import { handleExport, handleExportJsx } from '@/app/automation/bridge/export-handlers'
import {
  handleNewDocument,
  handleOpenFile,
  handleSaveFile
} from '@/app/automation/bridge/file-handlers'
import {
  createAutomationMermaidHandler,
  createAutomationMermaidSourceHandler
} from '@/app/automation/bridge/mermaid-handler'
import { handleRpcFallback } from '@/app/automation/bridge/rpc-handler'
import { handleSelection } from '@/app/automation/bridge/selection-handler'
import {
  isUnknownRecord,
  listAutomationDocuments,
  resolveAutomationTarget,
  responseWithTarget,
  stripAutomationTargetArgs
} from '@/app/automation/bridge/target'
import { createAutomationToolHandler } from '@/app/automation/bridge/tool-handlers'
import { handleTraceGesture, handleTraceQuery } from '@/app/automation/bridge/trace-handler'
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
  const board = createAutomationBoardHandlers(runtimeInstanceId)
  const handleBoardOpen = createAutomationBoardOpenHandler()
  const handleEval = createAutomationEvalHandler(makeFigma)
  const handleMermaid = createAutomationMermaidHandler()
  const handleMermaidSource = createAutomationMermaidSourceHandler()
  const handleCodeObjectCreate = createAutomationCodeObjectCreateHandler()
  const handleCodeObjectRefine = createAutomationCodeObjectRefineHandler()
  const handleCodeObjectUpsert = createAutomationCodeObjectUpsertHandler()
  const handleCodeObjectRead = createAutomationCodeObjectReadHandler()
  const handleBoardPrepareEdit = createAutomationBoardPrepareEditHandler({
    board,
    codeObjectRead: handleCodeObjectRead
  })
  const handleBoardBuild = createAutomationBoardBuildHandler({
    board,
    codeObjectCreate: handleCodeObjectCreate,
    codeObjectRead: handleCodeObjectRead,
    codeObjectRefine: handleCodeObjectRefine,
    mermaid: handleMermaid,
    mermaidSource: handleMermaidSource
  })
  const handleTool = createAutomationToolHandler(makeFigma)

  const commandHandlers: Partial<Record<string, CommandHandler>> = {
    board_build: boardCommand(handleBoardBuild),
    board_change: boardCommand((target, args) => board.change(target, args)),
    board_context: boardCommand((target) => board.context(target)),
    board_fixture: async () => {
      throw new Error(
        'board_fixture is available only through persisted local_workspace_authority. Live fixture reset is unavailable because its complete page-and-Object-Graph history boundary is not implemented.'
      )
    },
    board_open: boardCommand(handleBoardOpen),
    board_prepare_edit: boardCommand(handleBoardPrepareEdit),
    board_present: boardCommand((target, args) => board.present(target, args)),
    board_read: boardCommand((target, args) => board.read(target, args)),
    board_verify: boardCommand((target, args) => board.verify(target, args)),
    connect_objects: boardCommand((target, args) => board.connect(target, args)),
    eval: handleEval,
    upsert_code_object: handleCodeObjectUpsert,
    get_code_object: handleCodeObjectRead,
    insert_mermaid_diagram: handleMermaid,
    get_mermaid_source: handleMermaidSource,
    tool: handleTool,
    export: handleExport,
    export_jsx: handleExportJsx,
    selection: handleSelection,
    trace_get_gesture: handleTraceGesture,
    trace_query: handleTraceQuery,
    save_file: handleSaveFile,
    new_document: handleNewDocument,
    open_file: handleOpenFile
  }

  async function handleRequest(
    store: EditorStore,
    command: string,
    args: unknown
  ): Promise<unknown> {
    if (command === 'list_documents') {
      return {
        ok: true,
        result: {
          documents: listAutomationDocuments(store),
          runtime_instance_id: runtimeInstanceId
        }
      }
    }

    if (command === 'open_file' || command === 'new_document') {
      const handler = commandHandlers[command]
      if (handler) {
        return handler(resolveAutomationTarget(store, undefined, runtimeInstanceId), args)
      }
    }

    const rawArgs = normalizeGuardedAutomationArgs(command, isUnknownRecord(args) ? args : {})
    assertGuardedAutomationTarget(command, rawArgs)
    const target = resolveAutomationTarget(store, rawArgs, runtimeInstanceId)
    const targetArgs = stripAutomationTargetArgs(rawArgs)
    const handler = commandHandlers[command]
    const result = handler
      ? await handler(target, targetArgs)
      : await handleRpcFallback(target, command, targetArgs)
    if (command === 'trace_get_gesture' || command === 'trace_query') return result
    return responseWithTarget(result, target)
  }

  return { handleRequest }
}
