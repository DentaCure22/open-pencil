import { ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import { chatTransportOverride, setChatTransportOverride } from '@/app/ai/chat/override'
import {
  apiKey,
  customAPIType,
  customBaseURL,
  customModelID,
  isACPProvider,
  isConfigured,
  maxOutputTokens,
  modelID,
  pexelsApiKey,
  providerDef,
  providerID,
  registerAIChatEffects,
  setAPIKey,
  unsplashAccessKey
} from '@/app/ai/chat/storage'
import { exposeChatTransportOverride } from '@/app/browser-bridge'
import { getActiveEditorStore } from '@/app/editor/active-store'

export type EditorPanelTab = 'design' | 'code' | 'ai'

const activeTab = ref<EditorPanelTab>('code')

type ChatSessionManager = ReturnType<
  typeof import('@/app/ai/chat/transports').createChatSessionManager
>
let chatSessionPromise: Promise<ChatSessionManager> | null = null
let transportDirty = false

function loadChatSession() {
  chatSessionPromise ??= import('@/app/ai/chat/transports').then(({ createChatSessionManager }) => {
    const chatSession = createChatSessionManager({
      isConfigured,
      isACPProvider,
      providerID,
      apiKey,
      modelID,
      customModelID,
      customBaseURL,
      customAPIType,
      maxOutputTokens,
      getActiveEditorStore
    })
    if (chatTransportOverride.value) {
      chatSession.setOverrideTransport(chatTransportOverride.value)
    }
    if (transportDirty) chatSession.markTransportDirty()
    return chatSession
  })
  return chatSessionPromise
}

function markTransportDirty() {
  transportDirty = true
  if (chatSessionPromise) {
    void chatSessionPromise.then((chatSession) => chatSession.markTransportDirty())
  }
}

async function ensureChat() {
  const chatSession = await loadChatSession()
  transportDirty = false
  return chatSession.ensureChat()
}

function resetChat() {
  transportDirty = false
  if (chatSessionPromise) {
    void chatSessionPromise.then((chatSession) => chatSession.resetChat())
  }
}

registerAIChatEffects(markTransportDirty)

if (IS_BROWSER) {
  exposeChatTransportOverride((factory) => {
    setChatTransportOverride(factory)
    if (chatSessionPromise) {
      void chatSessionPromise.then((chatSession) => chatSession.setOverrideTransport(factory))
    }
  })
}

export function useAIChat() {
  return {
    providerID,
    providerDef,
    apiKey,
    setAPIKey,
    modelID,
    customBaseURL,
    customModelID,
    customAPIType,
    maxOutputTokens,
    pexelsApiKey,
    unsplashAccessKey,
    activeTab,
    isConfigured,
    ensureChat,
    resetChat
  }
}
