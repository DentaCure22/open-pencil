<script setup lang="ts">
import { computed } from 'vue'

import AppGroupedSelect from '@/components/ui/AppGroupedSelect.vue'
import { ACP_AGENTS, AI_PROVIDERS, IS_TAURI } from '@open-pencil/core/constants'
import { useAIChat } from '@/app/ai/chat/use'

const { providerID, providerDef } = useAIChat()

const acpAgents = computed(() => (IS_TAURI ? ACP_AGENTS : []))

const displayName = computed(() => {
  if (providerID.value.startsWith('acp:')) {
    const agentId = providerID.value.replace('acp:', '')
    return ACP_AGENTS.find((a) => a.id === agentId)?.name ?? providerID.value
  }
  return providerDef.value.name
})

interface ProviderSelectProps {
  ui?: {
    trigger?: string
    content?: string
    item?: string
    label?: string
    separator?: string
  }
}

const { ui } = defineProps<ProviderSelectProps>()

const groups = computed(() => {
  const result: Array<{ label?: string; items: Array<{ value: string; label: string }> }> = []

  if (acpAgents.value.length) {
    result.push({
      label: 'Your agents',
      items: acpAgents.value.map((agent) => ({
        value: `acp:${agent.id}`,
        label: agent.name
      }))
    })
  }

  result.push({
    label: acpAgents.value.length ? 'API key' : undefined,
    items: AI_PROVIDERS.map((provider) => ({
      value: provider.id,
      label: provider.name
    }))
  })

  return result
})
</script>

<template>
  <AppGroupedSelect v-model="providerID" :groups="groups" :display-value="displayName" :ui="ui" />
</template>
