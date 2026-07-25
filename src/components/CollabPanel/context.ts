import { useClipboard } from '@vueuse/core'
import { computed, inject, provide, proxyRefs, ref, watch } from 'vue'
import type { InjectionKey, ShallowUnwrapRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useI18n } from '@open-pencil/vue'

import {
  createCofounderInviteUrl,
  openPencilCloud,
  signOutOfOpenPencilCloud
} from '@/app/cloud/workspace'
import { DEFAULT_COLLAB_STATE, useCollabInjected } from '@/app/collab/use'
import { toast } from '@/app/shell/ui'
import { getShareUrl } from '@/constants'

function createCollabPanelContext() {
  const route = useRoute()
  const router = useRouter()
  const collab = useCollabInjected()
  const { copy, copied } = useClipboard({ copiedDuring: 2000 })
  const { dialogs } = useI18n()

  const joinInput = ref('')
  const creatingInvite = ref(false)
  const nameDraft = ref(collab?.state.value.localName ?? '')
  const pendingRoomId = computed(() =>
    typeof route.params.roomId === 'string' ? route.params.roomId : null
  )
  const popoverOpen = ref(!!pendingRoomId.value)
  const state = computed(() => collab?.state.value ?? DEFAULT_COLLAB_STATE)
  const peers = computed(() => collab?.remotePeers.value ?? [])
  const followingPeer = computed(() => collab?.followingPeer.value ?? null)
  const shareUrl = computed(() => {
    if (!state.value.roomId) return ''
    return getShareUrl(state.value.roomId)
  })
  const isJoining = computed(() => !!pendingRoomId.value && !state.value.connected)
  const cloudWorkspace = computed(() => openPencilCloud.state.value.workspace)
  const isCloudWorkspace = computed(
    () => cloudWorkspace.value?.roomId === state.value.roomId && state.value.connected
  )
  const canInviteCofounder = computed(
    () => isCloudWorkspace.value && cloudWorkspace.value?.role === 'owner'
  )

  watch(
    pendingRoomId,
    (roomId) => {
      if (!state.value.connected) popoverOpen.value = !!roomId
    },
    { immediate: true }
  )

  function copyLink() {
    if (!shareUrl.value) return
    void copy(shareUrl.value)
    toast.info('Link copied to clipboard')
  }

  async function copyCofounderInvite() {
    if (creatingInvite.value) return
    creatingInvite.value = true
    try {
      await copy(await createCofounderInviteUrl())
      toast.info('Cofounder invite copied')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the invite')
    } finally {
      creatingInvite.value = false
    }
  }

  async function signOutCloud() {
    try {
      await signOutOfOpenPencilCloud()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not sign out')
    }
  }

  function share() {
    if (!collab || !nameDraft.value.trim()) return
    collab.setLocalName(nameDraft.value.trim())
    const roomId = collab.shareCurrentDoc()
    void router.push(`/share/${roomId}`)
    void copy(getShareUrl(roomId))
    toast.info('Link copied to clipboard')
    popoverOpen.value = false
  }

  function join() {
    if (!collab) return
    const roomId = pendingRoomId.value || joinInput.value.trim().replace(/.*\/share\//, '')
    if (!roomId || !nameDraft.value.trim()) return
    collab.setLocalName(nameDraft.value.trim())
    collab.connect(roomId)
    void router.push(`/share/${roomId}`)
    popoverOpen.value = false
  }

  function disconnect() {
    if (!collab) return
    collab.disconnect()
    popoverOpen.value = false
    void router.push('/')
  }

  function toggleFollowPeer(clientId: number) {
    collab?.followPeer(followingPeer.value === clientId ? null : clientId)
  }

  return {
    dialogs,
    copied,
    joinInput,
    nameDraft,
    popoverOpen,
    state,
    peers,
    followingPeer,
    shareUrl,
    isJoining,
    isCloudWorkspace,
    canInviteCofounder,
    creatingInvite,
    copyLink,
    copyCofounderInvite,
    share,
    join,
    disconnect,
    signOutCloud,
    toggleFollowPeer
  }
}

export type CollabPanelContext = ShallowUnwrapRef<ReturnType<typeof createCollabPanelContext>>

const COLLAB_PANEL_KEY: InjectionKey<CollabPanelContext> = Symbol('CollabPanelContext')

export function provideCollabPanel() {
  const ctx = proxyRefs(createCollabPanelContext())
  provide(COLLAB_PANEL_KEY, ctx)
  return ctx
}

export function useCollabPanelContext(): CollabPanelContext {
  const ctx = inject(COLLAB_PANEL_KEY)
  if (!ctx) throw new Error('Collab panel controls must be used within CollabPanel')
  return ctx
}
