import type { User } from '@supabase/supabase-js'
import { computed, readonly, ref } from 'vue'

import { getOpenPencilSupabase, isOpenPencilCloudConfigured } from '@/app/cloud/client'
import {
  buildCofounderInviteUrl,
  clearInviteTokenFromBrowserUrl,
  readInviteToken
} from '@/app/cloud/invite'
import { loadPreferredCloudWorkspaceId, savePreferredCloudWorkspaceId } from '@/app/cloud/storage'
import { createSupabaseDurableYjsStore } from '@/app/collab/persistence/supabase-store'
import type { DurableYjsStore } from '@/app/collab/persistence/types'

export type OpenPencilCloudStatus = 'disabled' | 'loading' | 'signed-out' | 'ready' | 'error'

export type OpenPencilCloudWorkspace = {
  workspaceId: string
  documentId: string
  roomId: string
  workspaceName: string
  documentName: string
  role: 'owner' | 'editor'
  durableStore: DurableYjsStore
}

type BootstrapRecord = {
  document_id: string
  document_name: string
  member_role: 'owner' | 'editor'
  room_id: string
  workspace_id: string
  workspace_name: string
}

type OpenPencilCloudState = {
  status: OpenPencilCloudStatus
  user: User | null
  workspace: OpenPencilCloudWorkspace | null
  message: string | null
}

const configured = isOpenPencilCloudConfigured()
const state = ref<OpenPencilCloudState>({
  status: configured ? 'loading' : 'disabled',
  user: null,
  workspace: null,
  message: null
})
let initialization: Promise<void> | null = null
let bootstrappingUserId: string | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'OpenPencil Cloud could not connect'
}

function bootstrapRecord(value: unknown): BootstrapRecord {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') throw new Error('OpenPencil workspace was not created')
  const record = row as Partial<BootstrapRecord>
  if (
    typeof record.workspace_id !== 'string' ||
    typeof record.document_id !== 'string' ||
    typeof record.room_id !== 'string' ||
    typeof record.workspace_name !== 'string' ||
    typeof record.document_name !== 'string' ||
    (record.member_role !== 'owner' && record.member_role !== 'editor')
  ) {
    throw new Error('OpenPencil workspace response is invalid')
  }
  return record as BootstrapRecord
}

async function acceptPendingInvite(): Promise<string | null> {
  const token = readInviteToken()
  if (!token) return null
  const result = await getOpenPencilSupabase().rpc('openpencil_accept_invite', {
    p_token: token
  })
  if (result.error) throw result.error
  if (typeof result.data !== 'string') throw new Error('OpenPencil invite response is invalid')
  clearInviteTokenFromBrowserUrl()
  await savePreferredCloudWorkspaceId(result.data)
  return result.data
}

async function bootstrapWorkspace(user: User) {
  if (bootstrappingUserId === user.id) return
  bootstrappingUserId = user.id
  state.value = { status: 'loading', user, workspace: null, message: null }
  try {
    const invitedWorkspaceId = await acceptPendingInvite()
    const result = await getOpenPencilSupabase().rpc('openpencil_bootstrap_workspace', {
      p_workspace_id: invitedWorkspaceId ?? (await loadPreferredCloudWorkspaceId())
    })
    if (result.error) throw result.error
    const record = bootstrapRecord(result.data)
    await savePreferredCloudWorkspaceId(record.workspace_id)
    state.value = {
      status: 'ready',
      user,
      message: null,
      workspace: {
        documentId: record.document_id,
        documentName: record.document_name,
        durableStore: createSupabaseDurableYjsStore(getOpenPencilSupabase(), record.document_id),
        role: record.member_role,
        roomId: record.room_id,
        workspaceId: record.workspace_id,
        workspaceName: record.workspace_name
      }
    }
  } catch (error) {
    state.value = {
      status: 'error',
      user,
      workspace: null,
      message: errorMessage(error)
    }
  } finally {
    bootstrappingUserId = null
  }
}

export function initializeOpenPencilCloud(): Promise<void> {
  if (!configured) return Promise.resolve()
  initialization ??= (async () => {
    const client = getOpenPencilSupabase()
    const sessionResult = await client.auth.getSession()
    if (sessionResult.error) throw sessionResult.error
    const user = sessionResult.data.session?.user ?? null
    if (user) await bootstrapWorkspace(user)
    else state.value = { status: 'signed-out', user: null, workspace: null, message: null }

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session?.user) {
        state.value = { status: 'signed-out', user: null, workspace: null, message: null }
        return
      }
      if (state.value.status === 'ready' && state.value.user?.id === session.user.id) return
      void bootstrapWorkspace(session.user)
    })
  })().catch((error) => {
    state.value = {
      status: 'error',
      user: null,
      workspace: null,
      message: errorMessage(error)
    }
  })
  return initialization
}

export async function signInToOpenPencilCloud(email: string, password: string) {
  state.value = { status: 'loading', user: null, workspace: null, message: null }
  const result = await getOpenPencilSupabase().auth.signInWithPassword({ email, password })
  if (result.error) {
    state.value = {
      status: 'signed-out',
      user: null,
      workspace: null,
      message: result.error.message
    }
    return false
  }
  await bootstrapWorkspace(result.data.session.user)
  return state.value.status === 'ready'
}

export async function createOpenPencilCloudAccount(email: string, password: string) {
  state.value = { status: 'loading', user: null, workspace: null, message: null }
  const result = await getOpenPencilSupabase().auth.signUp({ email, password })
  if (result.error) {
    state.value = {
      status: 'signed-out',
      user: null,
      workspace: null,
      message: result.error.message
    }
    return false
  }
  if (!result.data.session) {
    state.value = {
      status: 'signed-out',
      user: null,
      workspace: null,
      message: 'Check your email, confirm the account, then sign in.'
    }
    return false
  }
  await bootstrapWorkspace(result.data.session.user)
  return state.value.status === 'ready'
}

export async function signOutOfOpenPencilCloud() {
  const result = await getOpenPencilSupabase().auth.signOut()
  if (result.error) throw result.error
}

export async function retryOpenPencilCloud() {
  const user = state.value.user
  if (user) await bootstrapWorkspace(user)
  else {
    initialization = null
    await initializeOpenPencilCloud()
  }
}

export async function createCofounderInviteUrl(): Promise<string> {
  const workspace = state.value.workspace
  if (workspace?.role !== 'owner') {
    throw new Error('Only the workspace owner can invite a cofounder')
  }
  const result = await getOpenPencilSupabase().rpc('openpencil_create_invite', {
    p_workspace_id: workspace.workspaceId
  })
  if (result.error) throw result.error
  if (typeof result.data !== 'string') throw new Error('OpenPencil invite response is invalid')
  return buildCofounderInviteUrl(result.data)
}

export const openPencilCloud = {
  configured,
  state: readonly(state),
  isReady: computed(() => state.value.status === 'ready')
}
