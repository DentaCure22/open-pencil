import { localWorkspaceAuthorityFetch } from '@/app/workspace-document/local-authority/client'

export type BridgeDictationPhase =
  | 'cancelled'
  | 'connecting'
  | 'error'
  | 'finishing'
  | 'ready'
  | 'recording'
  | 'starting'

export type BridgeDictationSnapshot = {
  code?: string
  error?: string
  phase: BridgeDictationPhase
  sessionId: string
  transcript: string
  updatedAt: string
}

export type VoiceDictationContext = {
  active?: {
    composerText?: string
    conversationTitle?: string
    recentPhrases?: string[]
    terms?: string[]
    todoTitle?: string
  }
  global?: {
    projectPaths?: string[]
  }
  project?: {
    childNames?: string[]
    path?: string[]
    todoTitles?: string[]
  }
}

const ROUTE = '/agent-router/v1/pi/voice-dictation'

async function snapshot(response: Response): Promise<BridgeDictationSnapshot> {
  const value = (await response.json().catch(() => null)) as
    | (Partial<BridgeDictationSnapshot> & { error?: unknown })
    | null
  if (!response.ok) {
    throw new Error(typeof value?.error === 'string' ? value.error : 'CLI dictation is unavailable')
  }
  if (
    !value ||
    typeof value.phase !== 'string' ||
    typeof value.sessionId !== 'string' ||
    typeof value.transcript !== 'string'
  ) {
    throw new Error('CLI dictation returned an invalid response')
  }
  return value as BridgeDictationSnapshot
}

export async function startBridgeDictation(
  context?: VoiceDictationContext
): Promise<BridgeDictationSnapshot> {
  return snapshot(
    await localWorkspaceAuthorityFetch(ROUTE, {
      ...(context
        ? {
            body: JSON.stringify({ context }),
            headers: { 'content-type': 'application/json' }
          }
        : {}),
      method: 'POST'
    })
  )
}

export async function readBridgeDictation(sessionId: string): Promise<BridgeDictationSnapshot> {
  return snapshot(await localWorkspaceAuthorityFetch(`${ROUTE}/${encodeURIComponent(sessionId)}`))
}

export async function sendBridgeDictationAudio(
  sessionId: string,
  audio: ArrayBuffer
): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(
    `${ROUTE}/${encodeURIComponent(sessionId)}/audio`,
    { body: audio, method: 'POST' }
  )
  if (!response.ok) {
    const value = (await response.json().catch(() => null)) as { error?: unknown } | null
    throw new Error(
      typeof value?.error === 'string' ? value.error : 'CLI dictation lost microphone audio'
    )
  }
}

export async function stopBridgeDictation(sessionId: string): Promise<BridgeDictationSnapshot> {
  return snapshot(
    await localWorkspaceAuthorityFetch(`${ROUTE}/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST'
    })
  )
}

export async function cancelBridgeDictation(sessionId: string): Promise<void> {
  const response = await localWorkspaceAuthorityFetch(`${ROUTE}/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  })
  if (!response.ok && response.status !== 404) {
    const value = (await response.json().catch(() => null)) as { error?: unknown } | null
    throw new Error(typeof value?.error === 'string' ? value.error : 'CLI dictation could not stop')
  }
}
