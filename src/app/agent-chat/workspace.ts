import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

import { agentRouterResponseError } from './router-response'

export type AgentWorkspaceFile = {
  path: string
}

export type AgentWorkspaceFileContents = {
  bytes: number
  content: string
  path: string
  truncated: boolean
}

export type AgentWorkspaceTerminalChunk = {
  sequence: number
  stream: 'stderr' | 'stdout'
  text: string
}

export type AgentWorkspaceTerminalSnapshot = {
  chunks: AgentWorkspaceTerminalChunk[]
  id: string
  running: boolean
}

export async function searchAgentWorkspaceFiles(
  query: string,
  limit = 24
): Promise<AgentWorkspaceFile[]> {
  const params = new URLSearchParams({ limit: String(limit), query })
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/workspace-files?${params.toString()}`
  )
  if (!response.ok) throw new Error('Workspace files unavailable')
  const payload = (await response.json()) as { files?: AgentWorkspaceFile[] }
  return payload.files ?? []
}

export async function readAgentWorkspaceFile(path: string): Promise<AgentWorkspaceFileContents> {
  const params = new URLSearchParams({ path })
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/workspace-file?${params.toString()}`
  )
  if (!response.ok) throw await agentRouterResponseError(response, 'Workspace file unavailable')
  return (await response.json()) as AgentWorkspaceFileContents
}

export async function createAgentWorkspaceTerminal(): Promise<AgentWorkspaceTerminalSnapshot> {
  const response = await localWorkspaceAuthorityFetch('/agent-router/v1/pi/terminal-sessions', {
    method: 'POST'
  })
  if (!response.ok) throw await agentRouterResponseError(response, 'Terminal unavailable')
  return (await response.json()) as AgentWorkspaceTerminalSnapshot
}

export async function readAgentWorkspaceTerminal(
  sessionId: string,
  after = 0
): Promise<AgentWorkspaceTerminalSnapshot> {
  const params = new URLSearchParams({ after: String(after) })
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/terminal-sessions/${encodeURIComponent(sessionId)}?${params.toString()}`
  )
  if (!response.ok) throw await agentRouterResponseError(response, 'Terminal unavailable')
  return (await response.json()) as AgentWorkspaceTerminalSnapshot
}

export async function writeAgentWorkspaceTerminal(
  sessionId: string,
  data: string
): Promise<AgentWorkspaceTerminalSnapshot> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/terminal-sessions/${encodeURIComponent(sessionId)}/input`,
    {
      body: JSON.stringify({ data }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST'
    }
  )
  if (!response.ok) throw await agentRouterResponseError(response, 'Terminal input was rejected')
  return (await response.json()) as AgentWorkspaceTerminalSnapshot
}

export async function closeAgentWorkspaceTerminal(sessionId: string): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(
    `/agent-router/v1/pi/terminal-sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  )
  if (!response.ok && response.status !== 404) {
    throw await agentRouterResponseError(response, 'Terminal could not be closed')
  }
}
