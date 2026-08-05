import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

const LOCAL_APPS_ENDPOINT = '/local-apps/v1'
const LOCAL_APP_REQUEST_TIMEOUT_MS = 35_000

export type LocalAppRuntimeState = 'running' | 'starting' | 'stopped'

export type LocalAppStatus = {
  appId: string
  label: string
  startScript: string
  state: LocalAppRuntimeState
}

export type LocalAppStartReceipt = {
  appId: string
  label: string
  startScript: string
  state: 'already_running' | 'started' | 'starting'
}

type LocalAppError = {
  error?: string
}

async function authorizedRequest(
  appId: string,
  action: 'start' | 'status',
  method: 'GET' | 'POST'
): Promise<Response> {
  return localWorkspaceAuthorityFetch(
    `${LOCAL_APPS_ENDPOINT}/${encodeURIComponent(appId)}/${action}`,
    {
      method,
      signal: AbortSignal.timeout(LOCAL_APP_REQUEST_TIMEOUT_MS)
    }
  )
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as LocalAppError | null
  return new Error(body?.error ?? `Local app request failed: HTTP ${response.status}`)
}

export async function readLocalAppStatus(appId: string): Promise<LocalAppStatus | null> {
  const response = await authorizedRequest(appId, 'status', 'GET')
  if (response.status === 404) return null
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as LocalAppStatus
}

export async function startLocalApp(appId: string): Promise<LocalAppStartReceipt> {
  const response = await authorizedRequest(appId, 'start', 'POST')
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as LocalAppStartReceipt
}
