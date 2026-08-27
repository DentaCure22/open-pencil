#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import {
  BOARD_WORKER_THREAD_BINDING_ENV,
  BOARD_WORKER_THREAD_ENV,
  boardWorkerThreadId
} from './pi/worker-mcp.js'
import { MCP_VERSION } from './server.js'
import { registerDispatchWorkTool } from './tool/dispatch-registration.js'
import { PARENT_LIVE_TOOL_NAMES, registerLiveParentTools } from './tool/live-parent-registration.js'
import { registerWorkMapTools } from './tool/work-map-registration.js'

const parentOnly = process.argv.includes('--parent')
const boardWorkerProcess = Boolean(
  process.env[BOARD_WORKER_THREAD_ENV]?.trim() ||
  process.env[BOARD_WORKER_THREAD_BINDING_ENV]?.trim()
)

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    `openpencil-dispatch-mcp\n\nDefault worker tools: list_agent_chats, get_agent_chat_context, dispatch_work, board_where, board_query, trace_query, board_apply, board_screenshot, board_go, set_theme, workmap_query, workmap_apply, workmap_capture_future_work. Pass --parent for the Codex live-parent surface: list_agent_chats, get_agent_chat_context, dispatch_work, board_where, trace_query, board_go, set_theme, workmap_query, workmap_apply, workmap_capture_future_work.\n`
  )
  process.exit(0)
}

const mcpServer = new McpServer({ name: 'open-pencil-dispatch', version: MCP_VERSION })
const workerContext = {
  allowConversationLifecycle: !boardWorkerProcess,
  get currentThreadId(): string | undefined {
    return boardWorkerThreadId()
  }
}
registerDispatchWorkTool(mcpServer, workerContext)
registerLiveParentTools(mcpServer, undefined, parentOnly ? PARENT_LIVE_TOOL_NAMES : undefined)
registerWorkMapTools(mcpServer, workerContext)
const transport = new StdioServerTransport()
void mcpServer.connect(transport)
