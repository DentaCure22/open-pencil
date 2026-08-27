#!/usr/bin/env bun
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

import { registerAgentAttachmentRoutes } from './agent-attachments/routes'
import { AgentAttachmentStore } from './agent-attachments/store'
import { resolveFfmpegExecutable } from './agent-attachments/video'
import { BotBackupService } from './agent-router/bot-backup'
import { ensureBotCharter } from './agent-router/bot-charter'
import type { AgentConversationRouter } from './agent-router/contracts'
import { registerAgentRoutes } from './agent-router/routes'
import { normalizeTodoCodeObjectBrief } from './agent-router/todo-document'
import { WorkMapStore } from './agent-router/work-map'
import { WorkMapRoutineScheduler } from './agent-router/work-map-routine-scheduler'
import { localAppLaunchersFromEnv } from './local-apps/config'
import { LocalAppManager } from './local-apps/manager'
import { registerLocalAppRoutes } from './local-apps/routes'
import { assertLocalAuthorityPortAvailable } from './local-authority-port'
import { LocalWorkspaceBoardRuntime } from './local-workspace-authority/board-runtime'
import { registerLocalWorkspaceAuthorityRoutes } from './local-workspace-authority/routes'
import { LocalWorkspaceAuthorityStore } from './local-workspace-authority/store'
import { loadPiAgentModels } from './pi/board-model-catalog'
import { resolvePiExecutable } from './pi/executable'
import { xaiConversationTitleOptions } from './pi/providers/xai/title'
import { PiAgentRouter } from './pi/router'
import { PiConversationTitleGenerator } from './pi/title-generator'
import { AgyVoiceDictationManager } from './voice-dictation/manager'
import { registerVoiceDictationRoutes } from './voice-dictation/routes'

const port = Number.parseInt(process.env.OPENPENCIL_LOCAL_AUTHORITY_PORT ?? '7602', 10)
const host = process.env.HOST ?? '127.0.0.1'
const authToken = process.env.OPENPENCIL_LOCAL_AUTHORITY_AUTH_TOKEN?.trim() || null
const configuredCorsOrigins = process.env.OPENPENCIL_LOCAL_AUTHORITY_CORS_ORIGIN?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
const localWorkspaceRoot =
  process.env.OPENPENCIL_LOCAL_WORKSPACE_ROOT?.trim() ||
  path.join(homedir(), '.openpencil', 'local-workspace-authority-v1')
const agentExecutable = resolvePiExecutable()
const agentWorkspaceRoot = process.env.OPENPENCIL_AGENT_WORKSPACE_ROOT?.trim() || process.cwd()
const boardWorkerWorkspaceRoot =
  process.env.OPENPENCIL_BOARD_WORKER_WORKSPACE_ROOT?.trim() ||
  path.join(localWorkspaceRoot, 'pi-worker-workspace')

await assertLocalAuthorityPortAvailable(host, port)
await mkdir(boardWorkerWorkspaceRoot, { recursive: true })

const store = new LocalWorkspaceAuthorityStore({
  preferredWorkspaceId: process.env.OPENPENCIL_LOCAL_WORKSPACE_ID?.trim() || null,
  root: localWorkspaceRoot,
  semanticServices: false
})
const app = new Hono()
const attachmentStore = new AgentAttachmentStore(localWorkspaceRoot)
const workMap = new WorkMapStore(path.join(localWorkspaceRoot, 'work-map.json'))
function agentContextPathForBot(botId: string): string | undefined {
  const snapshot = workMap.snapshot()
  const bot = snapshot.bots.find((candidate) => candidate.id === botId)
  const directoryName = bot?.projectId
    ? snapshot.projects.find((project) => project.id === bot.projectId)?.name
    : undefined
  return ensureBotCharter(localWorkspaceRoot, { botId, directoryName })
}
for (const bot of workMap.snapshot().bots) agentContextPathForBot(bot.id)
const boardRuntime = new LocalWorkspaceBoardRuntime(store)
const localAppManager = new LocalAppManager(localAppLaunchersFromEnv())
const sharedAgentRouterConfig = {
  agentContextPathForBot,
  boardWarmEffort: process.env.OPENPENCIL_PI_BOARD_WARM_EFFORT?.trim() || 'low',
  boardWarmModel:
    process.env.OPENPENCIL_PI_BOARD_WARM_MODEL?.trim() || 'antigravity/gemini-3-7-flash',
  boardWarmPoolSize: Number.parseInt(process.env.OPENPENCIL_PI_BOARD_WARM_POOL_SIZE ?? '1', 10),
  boardWorkerWorkspaceRoot,
  executable: agentExecutable,
  historyPath: path.join(localWorkspaceRoot, 'pi-conversations.json'),
  stallTimeoutMs: Number.parseInt(process.env.OPENPENCIL_PI_STALL_TIMEOUT_MS ?? '900000', 10),
  // Recent local work is Board-scoped, so keep that isolated worker warm while
  // letting general-purpose Pi sessions start on demand instead of sitting resident.
  warmPoolSize: Number.parseInt(process.env.OPENPENCIL_PI_WARM_POOL_SIZE ?? '0', 10),
  watchdogProbeMs: Number.parseInt(process.env.OPENPENCIL_PI_WATCHDOG_PROBE_MS ?? '30000', 10),
  workspaceRoot: agentWorkspaceRoot
}
const agentRouter: AgentConversationRouter = new PiAgentRouter({
  ...sharedAgentRouterConfig,
  models: loadPiAgentModels(),
  onConversationTitleChanged: ({ threadId, title }) => {
    workMap.syncTodoTitleForThread(threadId, title)
  },
  sessionDir: path.join(localWorkspaceRoot, 'pi-sessions'),
  titleGenerator: new PiConversationTitleGenerator({
    cwd: boardWorkerWorkspaceRoot,
    executable: agentExecutable,
    ...xaiConversationTitleOptions()
  })
})
for (const thread of agentRouter.conversations()) {
  if (!thread.todoDraft) continue
  const title =
    thread.title?.trim() ||
    thread.todoDraft.brief.title?.trim() ||
    thread.todoDraft.brief.goal.trim()
  agentRouter.updateTodoDraft(
    thread.id,
    normalizeTodoCodeObjectBrief(thread.todoDraft.brief, title)
  )
}
await attachmentStore.reconcile(agentRouter.conversations().map((thread) => thread.id))
const botBackup = new BotBackupService(localWorkspaceRoot, workMap, agentRouter)
const routineScheduler = new WorkMapRoutineScheduler(workMap, agentRouter)
const voiceDictation = new AgyVoiceDictationManager({ cwd: agentWorkspaceRoot })
await voiceDictation.ready()

if (configuredCorsOrigins && configuredCorsOrigins.length > 0) {
  app.use(
    '*',
    cors({
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['DELETE', 'GET', 'OPTIONS', 'POST'],
      origin: configuredCorsOrigins
    })
  )
}

registerLocalWorkspaceAuthorityRoutes(app, {
  getAuthToken: () => authToken,
  sendRpc: (body) => boardRuntime.sendRpc(body),
  store
})
registerAgentAttachmentRoutes(app, {
  authorityRoot: localWorkspaceRoot,
  ffmpegExecutable: resolveFfmpegExecutable(process.env, agentExecutable),
  getAuthToken: () => authToken,
  store: attachmentStore
})
registerLocalAppRoutes(app, {
  getAuthToken: () => authToken,
  manager: localAppManager
})
registerVoiceDictationRoutes(app, {
  getAuthToken: () => authToken,
  manager: voiceDictation
})
registerAgentRoutes(app, {
  attachmentStore,
  authorityRoot: localWorkspaceRoot,
  boardSpace: store,
  getAuthToken: () => authToken,
  router: agentRouter,
  routineScheduler,
  traceEvidence: store,
  workMap
})

// Publish local agent credentials so MCP tools (e.g. dispatch_work) can reach
// the authority without sharing the Vite build-time token path.
const agentAuthPath = path.join(localWorkspaceRoot, 'agent-auth.json')
if (authToken) {
  await mkdir(localWorkspaceRoot, { recursive: true })
  await writeFile(
    agentAuthPath,
    JSON.stringify({ port, token: authToken, updatedAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 }
  )
} else {
  await rm(agentAuthPath, { force: true })
}

await store.status()
const server = serve({ fetch: app.fetch, hostname: host, port })

async function close(): Promise<void> {
  // Remove published agent credentials first so a stale file never implies a live server.
  await rm(agentAuthPath, { force: true }).catch(() => undefined)
  routineScheduler.close()
  botBackup.close()
  voiceDictation.close()
  agentRouter.close()
  server.close()
}

process.once('SIGINT', () => void close())
process.once('SIGTERM', () => void close())

process.stderr.write(`OpenPencil local workspace authority\n`)
process.stderr.write(`  HTTP:  http://${host}:${String(port)}/local-workspace/v1\n`)
process.stderr.write(`  Data:  ${localWorkspaceRoot}\n`)
