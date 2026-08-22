#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { MCP_VERSION } from './server.js'
import { registerDispatchWorkTool } from './tool/dispatch-registration.js'
import { registerLiveParentTools } from './tool/live-parent-registration.js'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  process.stdout.write(
    `openpencil-dispatch-mcp\n\nOpenPencil MCP: dispatch_work, board_where, board_screenshot, board_go, set_theme. Used by the OpenPencil Codex plugin and Board workers.\n`
  )
  process.exit(0)
}

const mcpServer = new McpServer({ name: 'open-pencil-dispatch', version: MCP_VERSION })
registerDispatchWorkTool(mcpServer)
registerLiveParentTools(mcpServer)
const transport = new StdioServerTransport()
void mcpServer.connect(transport)
